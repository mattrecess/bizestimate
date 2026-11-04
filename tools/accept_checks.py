"""One-off: accept the current data as the checks' new baseline (etl/checks.py), after an intended change
(Nov 4: the simple estimate formula raised median revenue). Same as a load with CHECKS_ACCEPT=1.
Run via the DB probe workflow (script: accept_checks)."""
import os
import sys

os.environ["CHECKS_ACCEPT"] = "1"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "etl"))
sys.argv = ["checks.py", "--state", "OK"]
import checks  # noqa: E402

checks.main()
