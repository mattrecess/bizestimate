"""Fill the admin page's common-industries table now, without waiting for a data load."""
import runpy
import sys

sys.path.insert(0, "etl")
sys.argv = ["industry_reference.py", "--state", "OK"]
runpy.run_path("etl/industry_reference.py", run_name="__main__")
