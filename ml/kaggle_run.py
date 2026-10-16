"""Run NEXUS Z training and evaluation jobs inside one Kaggle CPU notebook.

Kaggle gives a CPU notebook far more memory than a laptop and does not use the weekly GPU quota,
so XGBoost work belongs here. Edit JOBS below, then follow ml/KAGGLE.md to upload and run.

Inputs it expects under /kaggle/input:
  the IBM AML dataset (ealtman2019/ibm-transactions-for-anti-money-laundering-aml)
  a dataset holding this repo's ml/, data/ and api/ folders (edithstark/nexusz-code)
Everything worth keeping is copied to /kaggle/working (logs, models, exports, summary).
"""
import os
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

# (module, argument). "tests" runs pytest first and stops the whole run if it fails.
JOBS = [
    ("tests", None),
    ("ablation", "HI-Small"),
    ("ring_eval", "HI-Small"),
    ("bundle", "HI-Small"),
    ("export_scores", "HI-Small"),
    ("ablation", "LI-Small"),
    ("ring_eval", "LI-Small"),
]

INPUT, TEMP, OUT = Path("/kaggle/input"), Path("/kaggle/temp"), Path("/kaggle/working")


def find_code() -> Path:
    for root in INPUT.iterdir():
        if (root / "ml" / "__init__.py").exists():
            return root
    target = TEMP / "code"
    for z in INPUT.rglob("*.zip"):  # Kaggle normally unpacks zips; handle the case where it did not
        zipfile.ZipFile(z).extractall(target if z.name != "ml.zip" else target / "ml")
    if not (target / "ml" / "__init__.py").exists():
        sys.exit("could not find the nexusz-code dataset under /kaggle/input")
    return target


def sh(cmd, cwd, env, log: Path) -> int:
    started = time.time()
    with open(log, "w") as f:
        proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=f, stderr=subprocess.STDOUT)
        code = proc.wait()
    print(f"{' '.join(cmd[-2:]):<40} exit {code}  {time.time() - started:6.0f}s", flush=True)
    return code


def main() -> None:
    code = find_code()
    ibm = next(INPUT.rglob("HI-Small_Trans.csv")).parent
    data = TEMP / "nexusz-data"
    data.mkdir(parents=True, exist_ok=True)
    if not (data / "ibm-aml").exists():
        (data / "ibm-aml").symlink_to(ibm)
    logs = OUT / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "NEXUSZ_DATA_DIR": str(data), "PYTHONPATH": str(code)}

    print(f"cpus {os.cpu_count()}  code {code}  data {ibm}", flush=True)
    status = []
    for module, arg in JOBS:
        name = module if arg is None else f"{module}-{arg}"
        if module == "tests":
            cmd = [sys.executable, "-m", "pytest", "ml/tests", "api/tests", "-q"]
        else:
            cmd = [sys.executable, "-m", f"ml.{module}", arg]
        exit_code = sh(cmd, code, env, logs / f"{name}.log")
        status.append((name, exit_code))
        if module == "tests" and exit_code != 0:
            print("tests failed, stopping before any heavy job (see logs/tests.log)")
            break

    for sub in ("models", "exports"):
        if (data / sub).exists():
            shutil.copytree(data / sub, OUT / sub, dirs_exist_ok=True)
    (OUT / "summary.txt").write_text("\n".join(f"{n}: exit {c}" for n, c in status) + "\n")
    print("done:", status)


if __name__ == "__main__":
    main()
