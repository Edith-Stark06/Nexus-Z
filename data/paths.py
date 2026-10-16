"""Where the downloaded datasets live. Override with the NEXUSZ_DATA_DIR environment variable."""
import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("NEXUSZ_DATA_DIR", r"F:\Nexus-Z-Datasets"))
IBM_AML_DIR = DATA_DIR / "ibm-aml"
ELLIPTIC_DIR = DATA_DIR / "elliptic" / "elliptic_bitcoin_dataset"
