# Evidence from the LinuxONE VM

Captured on **2026-10-17 at 21:18 to 21:19 UTC (2026-10-18, about 02:48 IST)** from the datathon VM (IBM LinuxONE, RHEL 9.8, s390x, 3 vCPUs) over SSH, by Giridharan's session. Times in the images are the VM's own clock.

**How the images were made, read this first.** The capture tool was a command line, not a screen recorder, so these PNGs are **renders of the unedited command output**: the text was copied as the SSH session returned it and drawn into an image (header line, command, output, a footer that says so). Nothing in the output text was edited. Two display changes only: lines longer than 175 characters are wrapped, and in image 06 the `edges` list of the ring is replaced by a count and the member list is cut to six (the command line printed in the image says so). If the judges or the team want pixel screenshots of a live terminal, run the same commands and screenshot them; the commands are below.

No address, key or token appears in any image (only loopback addresses). The Jupyter token file was never read.

| File | What it shows | Command or source |
|---|---|---|
| `01_jupyter_container.png` | The platform's Jupyter Lab ML container (`notebook`) running under rootless Podman, next to the API and dashboard containers | `podman ps` |
| `02_loopback_only.png` | Jupyter (38888), the API (8000) and the dashboard (3000) listen on `127.0.0.1` only. The only other listener is SSH on port 22, which is how the VM is reached | `ss -ltn` |
| `03_default_token_403.png` | The platform's published default token is rejected: prints `403` | `curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:38888/api/status?token=Your_Token1"` |
| `04_tests_on_vm.png` | **The documented test command fails on the VM at collection** (see below), followed by two labelled runs | `bash infra/setup_vm.sh --check --tests`; then `python -m pytest ml/tests api/tests infra/tests -q --ignore=ml/tests/test_stack.py` in `~/nexusz-venv`; then `python -m pytest ml/tests -q` inside the `notebook` container |
| `05_api_running.png` | The API container is up and `/health` reports `"backend":"model"` (656,743 rows of history, last rebuild 12.4 s) | `bash infra/podman_api.sh status` |
| `06_rings_and_reasons.png` | The ring list and one ring with members (estimated roles), reasons (some marked "(absent)"), and the case summary | `curl -s http://127.0.0.1:8000/rings`, then `curl -s http://127.0.0.1:8000/rings/RNG-3E0A24` (an id from that list) |
| `07_bench_result.png` | The idle-VM benchmark tables of `docs/PLATFORM_RESULTS.md` section 3b, read from the file on the VM at commit `23a4fc2`. **Not re-run** | `sed -n '144p;148,154p;158,167p' docs/PLATFORM_RESULTS.md` |
| `08_training_log.png` | The saved training log: 57-feature payment model, account model 374 trees, payment model 358 trees, `exit 0 after 882 s` | `cat ~/shared/logs/bundle_final.log` |
| `09_container_security.png` | The API container is locked down: loopback only, non-root (uid 1000), read-only root filesystem and mounts, `CapEff` all zeros, no new privileges, seccomp, 5 GB memory limit, writes refused except `/tmp` | `bash infra/podman_api.sh check` |
| `10_accelerator_counters.png` | **Not captured yet** (see below) | `bash infra/accel_counters.sh` |

## Things that do not match, or were not done

1. **`04`: the documented test command fails on the VM.** `bash infra/setup_vm.sh --check --tests` stops with `ERROR ml/tests/test_stack.py` : `ModuleNotFoundError: No module named 'sklearn'` (`ml/stack.py` line 15 imports `sklearn.model_selection`). The serving venv `~/nexusz-venv` deliberately has no scikit-learn, and `ml/tests/test_stack.py` is new since the last VM test run (then 102 passed, 4 skipped). Nothing was changed to hide it. Two additional runs, both on `origin/main` at `23a4fc2`: **in the serving venv with only `test_stack.py` excluded: 155 passed, 5 skipped, 0 failed**; **inside the platform container (which has scikit-learn) `ml/tests`: 77 passed, 1 skipped** (the skip is SHAP). The proper fix belongs to the ML side (for example `pytest.importorskip("sklearn")` at the top of `ml/tests/test_stack.py`); it is for Ramana to decide and has not been edited here (the PR description carries the details for him).
2. **`05`:** the API container was already running (started by Ramana about 15 minutes before the capture). It was not started, restarted or stopped by this session. `refreshes_completed` is 0 because no replay was running.
3. **`10` is missing.** `infra/accel_counters.sh` needs the VM to be otherwise idle for about 3 minutes, runs `perf` with `sudo` and three workloads (a TensorFlow network, Granite, XGBoost) inside the `notebook` container, and was not run without Ramana's go-ahead. The numbers it should reproduce are in `docs/ML_RESULTS.md` section 8 and were not edited.
4. **Freshness wording:** the task file says "about 12 seconds on the idle VM". `docs/PLATFORM_RESULTS.md` has 12.27 to 12.61 s for the bare process (3b) and 9.63 to 9.91 s for the final container (3c). The video script says "about ten to twelve seconds", which both support.
5. `09` lists eleven capability names under "dropped capabilities"; the script starts the container with all capabilities dropped. The check that matters is the effective mask read from inside the container, `CapEff: 0000000000000000`, which shows no capability is granted.
