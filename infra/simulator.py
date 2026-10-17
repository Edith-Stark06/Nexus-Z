"""Streaming simulator: replays transactions through the real POST /transactions endpoint.

Two steps, both deterministic (file order; no randomness, so no seed is needed):

  # 1. write the replay file: everything in the slice after the first 24 hours, in API format
  python -m infra.simulator prepare --slice HI-Slice --history-hours 24 --out replay.csv

  # 2. start the API with NEXUSZ_HISTORY_HOURS=24 (see infra/README.md), then replay
  python -m infra.simulator replay --input replay.csv --url http://127.0.0.1:8000 --batch-size 500 --speed 3600

The replay file has the columns tx_id,ts,src,dst,amount,channel. It is built with the same account
ids the API uses (data.ibm_aml pseudonymizes over the whole slice), which is why `prepare` loads the
slice; `replay` itself streams the file row by row and keeps only one batch in memory.
Amounts are sent exactly as in the data. The API assumes US dollars for ingested rows, and the data
mixes currencies, so amounts are not verified dollar values.
"""
import argparse
import csv
import json
import logging
import math
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Iterator

import httpx

log = logging.getLogger("nexusz.simulator")

COLUMNS = ["tx_id", "ts", "src", "dst", "amount", "channel"]
RETRY_STATUS = {429, 502, 503, 504}
MAX_BATCH = 5000  # the API refuses larger requests


@dataclass
class Stats:
    read: int = 0                 # data rows read from the file (after --start-row)
    skipped_malformed: int = 0    # rows that could not be turned into a valid transaction
    submitted: int = 0            # valid rows put into a request
    accepted: int = 0             # rows the API said it accepted
    rejected: int = 0             # submitted rows the API did not accept (422, 413, short count)
    failed: int = 0               # submitted rows lost to timeouts, connection errors or 5xx after retries
    batches: int = 0
    failed_batches: int = 0
    elapsed_seconds: float = 0.0
    aborted: str | None = None
    problems: list[str] = field(default_factory=list)  # first few problems, for the operator

    def note(self, text: str, limit: int = 10) -> None:
        if len(self.problems) < limit:
            self.problems.append(text)


def parse_row(row: dict) -> dict:
    """Validate one CSV row and return the JSON body for the API. Raises ValueError with the reason."""
    if None in row:
        raise ValueError("too many fields")
    out = {}
    for key in ("tx_id", "src", "dst", "channel"):
        value = (row.get(key) or "").strip()
        if not value:
            raise ValueError(f"missing {key}")
        out[key] = value
    try:
        out["ts"] = datetime.fromisoformat((row.get("ts") or "").strip()).isoformat()
    except ValueError:
        raise ValueError(f"bad ts {row.get('ts')!r}") from None
    try:
        amount = float((row.get("amount") or "").strip())
    except ValueError:
        raise ValueError(f"bad amount {row.get('amount')!r}") from None
    if not math.isfinite(amount) or amount <= 0:
        raise ValueError(f"amount must be positive, got {amount}")
    out["amount"] = amount
    return out


def iter_batches(path: Path, batch_size: int, stats: Stats, start_row: int = 0,
                 max_rows: int = 0) -> Iterator[list[dict]]:
    """Yield lists of valid transaction bodies in file order. Streams: one batch in memory at a time."""
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        missing = [c for c in COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"{path} is missing columns {missing}; expected {COLUMNS}")
        batch, valid = [], 0
        for index, row in enumerate(reader):
            if index < start_row:
                continue
            stats.read += 1
            try:
                batch.append(parse_row(row))
            except ValueError as exc:
                stats.skipped_malformed += 1
                stats.note(f"data row {index + 1}: {exc}")
                continue
            valid += 1
            if len(batch) >= batch_size:
                yield batch
                batch = []
            if max_rows and valid >= max_rows:
                break
        if batch:
            yield batch


def send_batch(client: httpx.Client, batch: list[dict], stats: Stats, retries: int,
               sleep: Callable[[float], None]) -> bool:
    """POST one batch. Returns False if it was not delivered. A row counts as accepted only if the API said so."""
    stats.batches += 1
    stats.submitted += len(batch)
    last = "no attempt"
    for attempt in range(retries + 1):
        try:
            resp = client.post("/transactions", json=batch)
        except httpx.TransportError as exc:  # includes timeouts and connection errors
            last = type(exc).__name__
        else:
            if resp.status_code == 200:
                try:
                    accepted = int(resp.json()["accepted"])
                except (ValueError, KeyError, TypeError):
                    stats.failed += len(batch)
                    stats.failed_batches += 1
                    stats.note(f"batch {stats.batches}: 200 response without a usable 'accepted' field")
                    return False
                accepted = max(0, min(accepted, len(batch)))
                stats.accepted += accepted
                stats.rejected += len(batch) - accepted
                return True
            if resp.status_code not in RETRY_STATUS:  # other 4xx: the data is wrong, retrying cannot help
                stats.rejected += len(batch)
                stats.failed_batches += 1
                stats.note(f"batch {stats.batches}: HTTP {resp.status_code} {resp.text[:120]!r}")
                return False
            last = f"HTTP {resp.status_code}"
        if attempt < retries:
            sleep(min(0.5 * 2 ** attempt, 5.0))
    stats.failed += len(batch)
    stats.failed_batches += 1
    stats.note(f"batch {stats.batches}: gave up after {retries + 1} attempts ({last})")
    return False


def replay(client: httpx.Client, path: Path, batch_size: int = 500, delay: float = 0.0, speed: float = 0.0,
           start_row: int = 0, max_rows: int = 0, retries: int = 2, max_failures: int = 5,
           progress_every: int = 20, sleep: Callable[[float], None] = time.sleep,
           clock: Callable[[], float] = time.monotonic) -> Stats:
    """Replay `path` through the API. `speed` is data seconds per wall second (0 = no pacing)."""
    stats = Stats()
    began, first_ts, consecutive = clock(), None, 0
    for batch in iter_batches(path, batch_size, stats, start_row, max_rows):
        if speed > 0:
            first_ts = first_ts or datetime.fromisoformat(batch[0]["ts"])
            due = (datetime.fromisoformat(batch[-1]["ts"]) - first_ts).total_seconds() / speed
            if due > clock() - began:
                sleep(due - (clock() - began))
        if send_batch(client, batch, stats, retries, sleep):
            consecutive = 0
        else:
            consecutive += 1
            if consecutive >= max_failures:
                stats.aborted = f"stopped after {consecutive} failed batches in a row"
                break
        if progress_every and stats.batches % progress_every == 0:
            log.info("batches=%d submitted=%d accepted=%d rejected=%d failed=%d",
                     stats.batches, stats.submitted, stats.accepted, stats.rejected, stats.failed)
        if delay > 0:
            sleep(delay)
    stats.elapsed_seconds = round(clock() - began, 3)
    return stats


def prepare(slice_name: str, history_hours: float, out: Path, force: bool = False) -> tuple[int, int]:
    """Write the part of the slice after the first `history_hours` hours as an API-format CSV."""
    from api.backend import split_history
    from data.ibm_aml import load_transactions

    if out.exists() and not force:
        raise FileExistsError(f"{out} exists; pass --force to overwrite it")
    history, rest = split_history(load_transactions(slice_name), history_hours)
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(COLUMNS)
        for r in rest.itertuples():
            w.writerow([r.tx_id, f"{r.ts:%Y-%m-%dT%H:%M:%S}", r.src, r.dst, repr(float(r.amount)), r.channel])
    return len(history), len(rest)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Replay transactions through POST /transactions.")
    sub = ap.add_subparsers(dest="command", required=True)
    p = sub.add_parser("prepare", help="write the replay CSV from a slice")
    p.add_argument("--slice", default="HI-Slice")
    p.add_argument("--history-hours", type=float, default=24)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--force", action="store_true", help="overwrite --out if it exists")
    r = sub.add_parser("replay", help="send a replay CSV to the API")
    r.add_argument("--input", type=Path, required=True)
    r.add_argument("--url", default="http://127.0.0.1:8000")
    r.add_argument("--batch-size", type=int, default=500, help=f"rows per request, 1..{MAX_BATCH}")
    r.add_argument("--speed", type=float, default=0.0, help="data seconds per wall second; 0 = as fast as possible")
    r.add_argument("--delay", type=float, default=0.0, help="extra seconds to wait after every batch")
    r.add_argument("--max", type=int, default=0, dest="max_rows", help="stop after this many valid rows (0 = all)")
    r.add_argument("--start-row", type=int, default=0, help="skip this many data rows first")
    r.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout in seconds")
    r.add_argument("--retries", type=int, default=2, help="retries per batch on timeouts and 429/502/503/504")
    r.add_argument("--max-failures", type=int, default=5, help="abort after this many failed batches in a row")
    r.add_argument("--progress-every", type=int, default=20, help="log every N batches (0 = never)")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # one INFO line per request drowns the progress lines

    if args.command == "prepare":
        try:
            n_hist, n_rest = prepare(args.slice, args.history_hours, args.out, args.force)
        except (FileExistsError, FileNotFoundError, ValueError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        print(f"history (stays in the API): {n_hist:,} rows; wrote {n_rest:,} rows to {args.out}")
        return 0

    if not 1 <= args.batch_size <= MAX_BATCH or min(args.speed, args.delay, args.start_row, args.max_rows) < 0:
        print(f"error: --batch-size must be 1..{MAX_BATCH} and the other numbers must not be negative", file=sys.stderr)
        return 2
    try:
        with httpx.Client(base_url=args.url, timeout=args.timeout) as client:
            health = client.get("/health").json()
            log.info("API at %s reports backend=%s", args.url, health.get("backend"))
            stats = replay(client, args.input, args.batch_size, args.delay, args.speed, args.start_row,
                           args.max_rows, args.retries, args.max_failures, args.progress_every)
    except (httpx.HTTPError, ValueError, OSError) as exc:
        print(f"error: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(asdict(stats), indent=2))
    return 0 if not (stats.failed or stats.rejected or stats.aborted) else 1


if __name__ == "__main__":
    sys.exit(main())
