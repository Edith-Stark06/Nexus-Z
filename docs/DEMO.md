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
NEXUSZ_BACKEND=model NEXUSZ_SLICE=HI-Pig-Slice NEXUSZ_BUNDLE=$HOME/Nexus-Z/ml/artifacts/HI-Small-pig \
  NEXUSZ_HISTORY_HOURS=24 NEXUSZ_ENV_FILE=/dev/null bash infra/run_api.sh          # wait for "Application startup complete" (about 30 s)
```
On your laptop:
```
ssh -i <key> -N -L 8000:127.0.0.1:8000 <user>@<vm address>                   # the API stays on the VM's loopback
cd dashboard && npm ci && npm run dev                                         # http://localhost:3000, badge must say LIVE API
```
Start the stream when you are ready to show it (a second terminal on the VM):
```
~/nexusz-venv/bin/python -m infra.simulator replay --input ~/pig-replay.csv --speed 600 --batch-size 500
```
`--speed 600` plays 10 minutes of payments per second (a full 24 hours in about 2.5 minutes). Use `--speed 300` for a slower, easier-to-narrate stream.

## What to show

1. The terminal on the VM: `podman ps` (the platform container), `ss -ltn` (only loopback), the API log.
2. The home page: the flagged rings, highest risk first. Read the ring ids off the screen; they depend on the data seen so far and change as the stream arrives.
3. Open one ring: the flow graph (victims, collectors, mules, cash-out), the payments, **why it was flagged**.
4. Start the replay. Within about 12 seconds the ring list changes; refreshes go on while payments arrive.
5. The alerts page: ring alerts and likely-victim alerts. Open "Preview" on a victim alert: the screen shows the ring account that was paid.
6. Back to the VM terminal: `curl -s http://127.0.0.1:8000/health` shows the model backend, rebuild time and data time.

## Say, and do not say

- Say: "synthetic data", "estimated roles", "near real time, about 12 seconds on the idle VM".
- Do not say: real-time or instant; that an account is a criminal (say flagged); that warnings were sent (we flag likely victims); that the accelerator is used (it is not).
- Reasons marked "(absent)" mean the model is flagging the *lack* of something (for example no history); explain it that way if asked.

## Between takes

Restart the API (the replay adds payments to its history). Ring ids are the same on a fresh start.

## If something breaks

- Dashboard shows "sample data" instead of LIVE API: the tunnel or the API is down. `curl http://127.0.0.1:8000/health` on the laptop.
- API will not start: `tail ~/bench/api_pig.log`; check `NEXUSZ_DATA_DIR`, that `HI-Pig-Slice_Trans.csv` exists, and that no other process holds port 8000.
- A ring page says it was updated: ring ids change when a ring grows; go back to the list.
