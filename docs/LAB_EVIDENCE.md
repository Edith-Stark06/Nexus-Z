# Platform lab runs (LinuxONE Community Cloud Jupyter Lab ML)

The Participant Guidebook lists two platform labs as prerequisites: predictive AI hybrid (multi-model) scenarios, and predictive AI plus generative AI. The notebooks come from https://github.com/linuxone-community-cloud/jupyter-lab-ml and live inside the Jupyter Lab container on our VM. All four were run end to end, headless, on 2026-10-17 (Jupyter `nbconvert --execute`, no cell errors). The executed copies, with outputs, are on the VM in `~/shared/labs/` and are not committed here, because the notebooks are IBM's.

The guidebook does not say which notebooks are the two labs. The Loan Approval notebook is the predictive plus generative one by its own description. We ran all four so either reading is covered; confirm with the organizers if it matters.

## Machine

IBM LinuxONE VM: machine type 9175, RHEL 9.8, s390x, 3 vCPUs, 7.5 GB RAM. The CPU reports the `nnpa` flag (Neural Network Processing Assist) and the vector extensions `vxe`, `vxe2`. Notebooks ran in the platform's Podman container.

## Results

| Notebook | Time | What it produced |
|---|---|---|
| `Churn_Scikit_PyTorch` | 13 s | scikit-learn models on customer data, with a decision tree exported to PMML; a PyTorch network trained for 300 epochs, test accuracy 73.3% |
| `Digit_Class_TensorFlow` | 20 s | MNIST digit classifier in TensorFlow, test accuracy 95.2%, exported to ONNX; inference benchmark 4.0 ms median for 1,000 images |
| `Fraud_LSTM_Keras_TF` | 68 s | LSTM fraud detector on credit-card transactions (5 epochs); on a 2,000-row sample 3 true positives, 6 false positives, 0 false negatives (precision 0.33, recall 1.0); exported as SavedModel and ONNX |
| `Loan_Approval_Demo` | 67 s | Hybrid pipeline: XGBoost risk score (low risk, probability 0.997), a Granite language model extracts document features, retrieval over policy documents, and the language model writes an approve recommendation with reasons |

These are the platform's own demo data and demo models. They show that the environment works; they are not our model's results.

## What the accelerator evidence does and does not show

Checked at runtime, not copied from the notebooks:

- `zdnn_is_nnpa_installed()` returns **True** from inside the container. The accelerator facility is available to code running in it.
- In the Loan Approval lab, llama.cpp logs `ggml_zdnn_init: found 1 device`, `NNPA_PARMBLKFORMAT_0 = true`, and **places 501 MiB of the Granite model's weights in a zDNN buffer**. It reports that 235 tensors cannot use the zDNN buffer and fall back to CPU, and that the layers are assigned to the CPU device.

Not shown:

- The MNIST and LSTM notebooks print a list titled "Ops accelerated by NNPA", but those lines are fixed text in the notebook, not a detection. Library presence and a timing benchmark do not prove the accelerator executed those operations. We have not verified it.
- For llama.cpp, a registered backend and weights in its buffer mean the accelerator path is set up. We did not measure which operations ran on it or compare against CPU only.
- **Our own model does not use the accelerator.** NEXUS Z runs XGBoost, pandas and NetworkX on ordinary CPU. No accelerator gain is claimed for it.

## Generated text quality

The language model in the container is `granite-4.0-h-350m-base`, a 350M base model, while the notebook's check text expects a larger instruct model (`granite-3.3-2b-instruct`). Its output in the demo is short and plain. Treat it as a demonstration, not as a quality benchmark.

## Still needed

Screenshots from the Jupyter Lab interface (open it through the SSH tunnel in `ml/LINUXONE.md`): each executed notebook, plus the VM and container. The guidebook asks for screenshots as evidence of platform use.
