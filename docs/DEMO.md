# Running the demo

The demo shows NEXUS Z end to end: payments stream into the API on the LinuxONE VM, the model re-scores them, and the dashboard shows rings, reasons and the pre-payment warning. It serves the typology bundle on the synthetic pig-butchering slice (see `docs/ML_RESULTS.md` section 7). Say "synthetic" whenever you show it.

Dress-rehearsal result (VM, 2026-10-17): first state in 16 s; a 24-hour replay of 209,126 payments at 600x took about 3 minutes, the API refreshed 12 times, each rebuild took 11 to 16 s, and the dashboard (through an SSH tunnel) showed the new rings.

## One-time setup (already done on the VM)

```
python -m ml.bundle HI-Small ~/data/models/HI-Small-pig payment 0      # train the demo bundle (about 32 min, in the platform container)
python -m ml.make_demo_slice HI-Small 48 HI-Pig-Slice 1                # writes <data>/ibm-aml/HI-Pig-Slice_Trans.csv
```
The bundle is also in the repo as `ml/artifacts/HI-Small-pig`, so `NEXUSZ_BUNDLE=~/Nexus-Z/ml/artifacts/HI-Small-pig` works after a `git pull`. The slice file is not in the repo (data); copy it to `~/data/ibm-aml/` on the VM.

## Start (every take)

On the VM (keep it idle: no training or benchmarks while recording):
```
cd ~/Nexus-Z && git checkout main && git pull
export NEXUSZ_DATA_DIR=$HOME/data
~/nexusz-venv/bin/python -m infra.simulator prepare --slice HI-Pig-Slice --history-hours 24 --out ~/pig-replay.csv --force
bash infra/podman_api.sh deps        # once: the three web packages the platform image lacks go in ~/nexusz-pylibs
bash infra/podman_api.sh start       # the API in a hardened container; wait about 30 s, then: bash infra/podman_api.sh status
bash infra/podman_api.sh dash-start  # the dashboard in a second hardened container (needs the built dashboard in ~/nexusz-dashboard-dist, see below)
bash infra/podman_api.sh check       # optional on camera: loopback only, non-root, read-only, no capabilities, memory limit
```
Everything now runs on the VM, so the laptop only needs a tunnel and a browser:
```
ssh -i <key> -o ServerAliveInterval=30 -N -L 8000:127.0.0.1:8000 -L 3000:127.0.0.1:3000 <user>@<vm address>
```
then open http://localhost:3000 (the badge must say LIVE API). Both ports stay on the VM's loopback; nothing is exposed.

**The dashboard is built where Node is installed, then copied to the VM** (once, and again whenever the dashboard changes):
```
cd dashboard && npm ci && npm run build
tar -czf dist.tgz dist && scp -i <key> dist.tgz <user>@<vm address>:        # on Windows Git Bash add --force-local to tar
ssh <user>@<vm address> 'rm -rf ~/nexusz-dashboard-dist && mkdir ~/nexusz-dashboard-dist && tar -xzf ~/dist.tgz -C ~/nexusz-dashboard-dist --strip-components=1'
```
Fallback if the VM container fails: `cd dashboard && npm run dev` on the laptop serves the same pages on http://localhost:3000 (stop the tunnel's port 3000 first).
Start the stream when you are ready to show it (a second terminal on the VM):
```
~/nexusz-venv/bin/python -m infra.simulator replay --input ~/pig-replay.csv --speed 600 --batch-size 500
```
`--speed 600` plays 10 minutes of payments per second (a full 24 hours in about 2.5 minutes). Use `--speed 300` for a slower, easier-to-narrate stream.

## What to show

1. The terminal on the VM: `podman ps` (the Jupyter container and the API container), `bash infra/podman_api.sh check` (the security settings), `ss -ltn` (only loopback).
2. The home page: the flagged rings, highest risk first. Read the ring ids off the screen; they depend on the data seen so far and change as the stream arrives.
3. Open one ring: the flow graph (victims, collectors, mules, cash-out), the payments, **why it was flagged**.
4. Start the replay. Within about 10 seconds the ring list changes (up to about 36 seconds while payments stream in); refreshes go on while payments arrive.
5. The alerts page: ring alerts and likely-victim alerts. Open "Preview" on a victim alert: the screen shows the ring account that was paid.
6. Back to the VM terminal: `curl -s http://127.0.0.1:8000/health` shows the model backend, rebuild time and data time.
6b. Optional, 1 minute: the **Assistant** page. Click a suggestion, or type a paraphrase such as "which clusters carry the most risk" or "who is likely to be cheated next". The badge reads "IBM Granite Embedding · on this machine": Granite works out which question it is, and the answer is a fixed sentence with facts from our API. Say exactly that; it writes no text. Off-topic questions get the help text. `docs/CHATBOT.md` has the measured accuracy (87% on 31 fresh questions of ours).
7. Optional, 2 minutes, **VM idle (stop the replay first)**: `bash infra/accel_counters.sh` prints the processor's NNPA counters for XGBoost (0), a neural network (about 6,500) and a small Granite 4.0 350M model (about 36,000). Save the output and take the screenshot (evidence image 10): the raw output was never archived. Say exactly this: "the accelerator is real and we can count it; some operations of a network and a small Granite model run on it, trees do not; we tested a network on our data and it lost to the trees, so detection stays on trees." Do not say NEXUS Z runs on the accelerator.

## Say, and do not say

- Say: "synthetic data", "estimated roles", "near real time, about 10 seconds on the idle VM".
- Do not say: real-time or instant; that an account is a criminal (say flagged); that warnings were sent (we flag likely victims); that NEXUS Z detection runs on the accelerator (it does not; only the measurement in step 7 does).
- Reasons marked "(absent)" mean the model is flagging the *lack* of something (for example no history); explain it that way if asked.

## Between takes

Restart the API (the replay adds payments to its history): `bash infra/podman_api.sh stop && bash infra/podman_api.sh start`. Ring ids are the same on a fresh start. A ring keeps its id while it grows during the stream; one that dissolves or leaves the 24 hour window is gone, and its page says so.

## If something breaks

- Dashboard shows "sample data" instead of LIVE API: the tunnel or the API is down. `curl http://127.0.0.1:8000/health` on the laptop.
- API will not start: `bash infra/podman_api.sh logs`; check `NEXUSZ_DATA_DIR`, that `HI-Pig-Slice_Trans.csv` exists, and that no other process holds port 8000.
- A ring page says it was updated: ring ids change when a ring grows; go back to the list.
