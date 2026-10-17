"""Measure the running API: latency per endpoint, ingest throughput, time until an accepted
transaction shows up in the served results, and the server's CPU and memory.

  python -m infra.bench --url http://127.0.0.1:8000 --replay replay.csv --pid <server pid> --out bench.json

It sends real requests to a running API and records only what it observes. It ADDS transactions to the
API's history (replay rows and a few probe transactions), so restart the API afterwards to get a clean
state. Latency is wall-clock time as seen by this client (includes HTTP and JSON), in milliseconds.
"""
import argparse
import json
import math
import os
import platform
import statistics
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

from .simulator import Stats, iter_batches


def percentile(values: list[float], q: float) -> float:
    """Nearest-rank percentile."""
    ordered = sorted(values)
    return ordered[max(0, math.ceil(q / 100 * len(ordered)) - 1)]


def summarize(samples: list[float]) -> dict:
    if not samples:
        return {"n": 0}
    return {"n": len(samples), "p50_ms": round(percentile(samples, 50), 2), "p95_ms": round(percentile(samples, 95), 2),
            "max_ms": round(max(samples), 2), "mean_ms": round(statistics.fmean(samples), 2)}


class Recorder:
    def __init__(self):
        self.samples: dict[str, list[float]] = {}
        self.errors: dict[str, int] = {}
        self.lock = threading.Lock()

    def add(self, label: str, ms: float, ok: bool) -> None:
        with self.lock:
            self.samples.setdefault(label, []).append(ms)
            if not ok:
                self.errors[label] = self.errors.get(label, 0) + 1

    def report(self) -> dict:
        return {k: {**summarize(v), "errors": self.errors.get(k, 0)} for k, v in sorted(self.samples.items())}


def timed(client: httpx.Client, rec: Recorder, label: str, method: str, path: str, **kw) -> httpx.Response | None:
    began = time.perf_counter()
    try:
        resp = client.request(method, path, **kw)
        ok = resp.status_code == 200
    except httpx.HTTPError:
        resp, ok = None, False
    rec.add(label, (time.perf_counter() - began) * 1000, ok)
    return resp


class Feed:
    """Hands out batches of replay rows, thread-safe, never repeating a row."""

    def __init__(self, path: Path, start_row: int):
        self._it = iter_batches(path, 1, Stats(), start_row=start_row)
        self._lock = threading.Lock()
        self.used = 0

    def take(self, n: int) -> list[dict]:
        out = []
        with self._lock:
            for batch in self._it:
                out.extend(batch)
                if len(out) >= n:
                    break
            self.used += len(out)
        return out


# -- process CPU and memory (Linux /proc, or psutil if installed)
def process_sample(pid: int | None) -> dict | None:
    if not pid:
        return None
    status = Path(f"/proc/{pid}/status")
    if status.exists():
        fields = dict(line.split(":", 1) for line in status.read_text().splitlines() if ":" in line)
        stat = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        ticks = int(stat[11]) + int(stat[12])  # utime + stime
        return {"cpu_seconds": ticks / os.sysconf("SC_CLK_TCK"), "rss_mb": int(fields["VmRSS"].split()[0]) / 1024,
                "peak_rss_mb": int(fields["VmHWM"].split()[0]) / 1024}
    try:
        import psutil

        p = psutil.Process(pid)
        t = p.cpu_times()
        mem = p.memory_info()
        return {"cpu_seconds": t.user + t.system, "rss_mb": mem.rss / 2**20,
                "peak_rss_mb": getattr(mem, "peak_wset", mem.rss) / 2**20}
    except Exception:  # noqa: BLE001 - psutil missing or process gone: report as not measured
        return None


def machine_info(client: httpx.Client) -> dict:
    info = {"date_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"), "os": platform.platform(),
            "machine": platform.machine(), "python": platform.python_version(), "cpu_count": os.cpu_count(),
            "client_host_is_server_host": True}
    try:
        meminfo = Path("/proc/meminfo").read_text()
        info["ram_gb"] = round(int(meminfo.split("MemTotal:")[1].split()[0]) / 2**20, 1)
    except OSError:
        pass
    info["health"] = client.get("/health").json()
    return info


def pick_targets(client: httpx.Client) -> tuple[str, str]:
    rings = client.get("/rings").json()
    if not rings:
        raise SystemExit("the API has no rings, so there is nothing to measure for /rings/{id} and /accounts/{id}")
    ring_id = rings[0]["ring_id"]
    return ring_id, client.get(f"/rings/{ring_id}").json()["members"][0]["id"]


def read_mix(client, rec, ring_id, account_id, suffix=""):
    timed(client, rec, "GET /health" + suffix, "GET", "/health")
    timed(client, rec, "GET /rings" + suffix, "GET", "/rings")
    timed(client, rec, "GET /rings/{id}" + suffix, "GET", f"/rings/{ring_id}")
    timed(client, rec, "GET /accounts/{id}" + suffix, "GET", f"/accounts/{account_id}")
    timed(client, rec, "GET /alerts" + suffix, "GET", "/alerts?limit=50")


def phase_idle(client, ring_id, account_id, rounds, feed, batch_size) -> dict:
    rec = Recorder()
    for _ in range(rounds):
        read_mix(client, rec, ring_id, account_id)
    for _ in range(min(rounds, 20)):  # ingest requests each add rows to the history
        batch = feed.take(batch_size)
        if batch:
            timed(client, rec, f"POST /transactions (batch {batch_size})", "POST", "/transactions", json=batch)
    return rec.report()


def phase_load(client_factory, ring_id, account_id, seconds, concurrency, feed, batch_size, pid) -> dict:
    """Readers on several threads while one thread keeps ingesting, so background refreshes are running."""
    rec, stop, refresh_samples = Recorder(), threading.Event(), []
    ingested = {"accepted": 0, "rejected": 0}

    def reader():
        with client_factory() as c:
            while not stop.is_set():
                read_mix(c, rec, ring_id, account_id)

    def ingester():
        with client_factory() as c:
            while not stop.is_set():
                batch = feed.take(batch_size)
                if not batch:
                    return
                r = timed(c, rec, f"POST /transactions (batch {batch_size})", "POST", "/transactions", json=batch)
                if r is not None and r.status_code == 200:
                    ingested["accepted"] += r.json()["accepted"]
                    ingested["rejected"] += len(batch) - r.json()["accepted"]
                else:
                    ingested["rejected"] += len(batch)
                time.sleep(0.5)  # about 2 requests per second, so a refresh is nearly always pending

    def sampler():
        with client_factory() as c:
            while not stop.is_set():
                h = c.get("/health").json()
                refresh_samples.append((h.get("refreshing"), h.get("state_age_seconds"), h.get("refreshes_completed")))
                time.sleep(0.25)

    before = process_sample(pid)
    threads = [threading.Thread(target=reader, daemon=True) for _ in range(concurrency)]
    threads += [threading.Thread(target=ingester, daemon=True), threading.Thread(target=sampler, daemon=True)]
    began = time.perf_counter()
    [t.start() for t in threads]
    time.sleep(seconds)
    stop.set()
    [t.join(60) for t in threads]
    elapsed = time.perf_counter() - began
    after = process_sample(pid)
    busy = [s for s in refresh_samples if s[0] is not None]
    out = {"seconds": round(elapsed, 1), "reader_threads": concurrency, "ingest": ingested,
           "share_of_samples_with_refresh_running": round(sum(1 for s in busy if s[0]) / len(busy), 2) if busy else None,
           "refreshes_completed_during_phase": (refresh_samples[-1][2] - refresh_samples[0][2]) if refresh_samples else None,
           "max_state_age_seconds": max((s[1] for s in refresh_samples if s[1] is not None), default=None),
           "latency": rec.report()}
    if before and after:
        out["server_cpu_percent_of_one_core"] = round(100 * (after["cpu_seconds"] - before["cpu_seconds"]) / elapsed, 1)
    return out


def phase_throughput(client, feed, batch_size, max_rows) -> dict:
    accepted = rejected = batches = 0
    began = time.perf_counter()
    while accepted + rejected < max_rows:
        batch = feed.take(batch_size)
        if not batch:
            break
        r = client.post("/transactions", json=batch)
        batches += 1
        got = r.json()["accepted"] if r.status_code == 200 else 0
        accepted += got
        rejected += len(batch) - got
    elapsed = time.perf_counter() - began
    return {"submitted": accepted + rejected, "accepted": accepted, "rejected": rejected, "batch_size": batch_size,
            "batches": batches, "seconds": round(elapsed, 3),
            "accepted_per_second": round(accepted / elapsed, 1) if elapsed else None,
            "note": "rate at which the API accepts rows into its queue; it does not mean they are scored yet"}


def phase_freshness(client, source_account, probes, timeout, poll=0.05) -> dict:
    """Seconds from a probe transaction being accepted until GET /accounts/<its destination> stops being 404."""
    run, results = int(time.time()), []
    for k in range(probes):
        dst = f"PROBE-{run}-{k}"
        # wait for any pending refresh to finish so each probe starts from an idle server
        while (h := client.get("/health").json()) and (h.get("refreshing") or h.get("pending_transactions")):
            time.sleep(0.2)
        tx = {"tx_id": dst, "ts": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(), "src": source_account,
              "dst": dst, "amount": 1.0, "channel": "ACH"}
        # keep the probe's timestamp inside the served window: use the served data_as_of
        if h.get("data_as_of"):
            tx["ts"] = h["data_as_of"].replace("+00:00", "")
        r = client.post("/transactions", json=tx)
        accepted_at = time.perf_counter()
        if r.status_code != 200 or r.json().get("accepted") != 1:
            results.append({"probe": dst, "error": f"not accepted: HTTP {r.status_code}"})
            continue
        seen = None
        while time.perf_counter() - accepted_at < timeout:
            if client.get(f"/accounts/{dst}").status_code == 200:
                seen = time.perf_counter() - accepted_at
                break
            time.sleep(poll)
        results.append({"probe": dst, "seconds_until_visible": round(seen, 2) if seen else None,
                        "timed_out": seen is None})
    seen_all = [r["seconds_until_visible"] for r in results if r.get("seconds_until_visible")]
    h = client.get("/health").json()
    return {"probes": results, "min_s": min(seen_all, default=None), "max_s": max(seen_all, default=None),
            "refresh_interval_seconds": h.get("refresh_interval_seconds"), "last_rebuild_seconds": h.get("last_rebuild_seconds")}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--url", default="http://127.0.0.1:8000")
    ap.add_argument("--replay", type=Path, required=True, help="replay CSV from `infra.simulator prepare`")
    ap.add_argument("--start-row", type=int, default=0)
    ap.add_argument("--pid", type=int, help="server process id, for CPU and memory")
    ap.add_argument("--idle-rounds", type=int, default=100)
    ap.add_argument("--load-seconds", type=float, default=60)
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--batch-size", type=int, default=500)
    ap.add_argument("--throughput-rows", type=int, default=50000)
    ap.add_argument("--probes", type=int, default=3)
    ap.add_argument("--probe-timeout", type=float, default=180)
    ap.add_argument("--timeout", type=float, default=120, help="HTTP timeout per request")
    ap.add_argument("--out", type=Path)
    args = ap.parse_args(argv)

    def factory():
        return httpx.Client(base_url=args.url, timeout=args.timeout)

    result = {}
    with factory() as client:
        result["environment"] = machine_info(client)
        if result["environment"]["health"].get("backend") != "model":
            print("warning: the API is not running the model backend; these numbers are NOT model measurements", file=sys.stderr)
        ring_id, account_id = pick_targets(client)
        result["targets"] = {"ring_id": ring_id, "account_id": account_id}
        feed = Feed(args.replay, args.start_row)
        result["resources_at_start"] = process_sample(args.pid)
        print("phase 1/4: idle latency", file=sys.stderr)
        result["idle_latency"] = phase_idle(client, ring_id, account_id, args.idle_rounds, feed, args.batch_size)
        print("phase 2/4: ingest throughput", file=sys.stderr)
        result["ingest_throughput"] = phase_throughput(client, feed, args.batch_size, args.throughput_rows)
        print("phase 3/4: latency under load with background refresh", file=sys.stderr)
        result["load"] = phase_load(factory, ring_id, account_id, args.load_seconds, args.concurrency, feed,
                                    args.batch_size, args.pid)
        print("phase 4/4: freshness", file=sys.stderr)
        result["freshness"] = phase_freshness(client, account_id, args.probes, args.probe_timeout)
        result["resources_at_end"] = process_sample(args.pid)
        result["replay_rows_used"] = feed.used
        result["environment"]["health_at_end"] = client.get("/health").json()
    text = json.dumps(result, indent=2, default=str)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
