# Training and scoring on LinuxONE (Jupyter Lab container)

The LinuxONE Community Cloud publishes a Jupyter Lab image with XGBoost, scikit-learn, TensorFlow and PyTorch already built for s390x: https://github.com/linuxone-community-cloud/jupyter-lab-ml. Using it means the model is trained **and** scored on the LinuxONE VM, and scikit-learn is available there (it does not build from PyPI on s390x).

## What is and is not used

CPU only. XGBoost, pandas and scikit-learn run as ordinary s390x code. **No on-chip AI accelerator is used**, so do not claim accelerator gains.

## Set it up (RHEL 9.8 VM)

1. Put this repo at `~/Nexus-Z` and the datasets under `~/data/ibm-aml/` (`HI-Small_Trans.csv`, `HI-Small_Patterns.txt`).
2. Run `bash ~/Nexus-Z/ml/linuxone_jupyter.sh`. It installs Podman, pulls the image (about 6.8 GB), and starts the container.
3. From your own computer: `ssh -i <key> -L 38888:localhost:38888 linux1@<vm address>`, then open http://localhost:38888 and paste the token from `~/.jupyter_token` on the VM.
4. Open `Nexus-Z/ml/notebooks/nexusz_train.ipynb` and run the cells.

Or run the same steps without a browser: `podman exec -w /home/ibm-user/Nexus-Z -e NEXUSZ_DATA_DIR=/home/ibm-user/data notebook python -m ml.bundle HI-Small <output folder>`.

## Why this differs from the platform's README

The README exposes Jupyter on a public port and leaves the published default login token (`Your_Token1`). Jupyter runs code as you, so anyone who finds the port could run commands on the VM. The script binds Jupyter to the VM's loopback and uses a random token. Do not open port 38888 in the firewall.

## Things that went wrong and are handled

- Rootless Podman stops the container when your SSH session ends. The script enables lingering for your user.
- Mounted folders are not writable by the container user unless the user ids are mapped. The script uses `--userns=keep-id:uid=1000,gid=1000`.
- The image has no pyarrow, FastAPI, pydantic or SHAP, and the VM has 7.5 GB of RAM. Training does not need the missing packages. `pip install pydantic fastapi uvicorn httpx pytest` works inside the container (it has a compiler), after which the whole test suite passes there (37 passed, 1 skipped, the SHAP comparison). The transaction loader was changed to use integer codes so it needs less memory without pyarrow.
