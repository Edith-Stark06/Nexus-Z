import subprocess
import sys

SERVING_MODULES = ["ml.service", "ml.api_backend", "ml.bundle", "ml.stack", "ml.neighbors", "ml.explain", "ml.narrative", "ml.ring_ids", "ml.elliptic_actors_eval", "api.main"]


def test_everything_the_server_imports_works_without_scikit_learn():
    """The LinuxONE serving environment has no scikit-learn (it does not build on s390x). Training code must import it lazily."""
    code = "import sys; sys.modules['sklearn'] = None\n" + "\n".join(f"import {m}" for m in SERVING_MODULES)
    done = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert done.returncode == 0, done.stderr[-800:]
