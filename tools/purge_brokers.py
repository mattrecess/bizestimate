"""Drops everything found on contact-data broker pages (etl/brokers.py) from the saved search results
and clears owners sourced from them, at no cost: the search steps run without API keys, so they only
re-save their cached results through the broker filter. Run via the DB probe workflow (script: purge_brokers)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "etl"))
for k in ("ANTHROPIC_API_KEY", "SERPER_API_KEY", "BRAVE_API_KEY"):
    os.environ.pop(k, None)   # never search or call AI here

import owner_search  # noqa: E402
import people_search  # noqa: E402

sys.argv = [sys.argv[0], "--state", os.environ.get("STATE", "OK")]
people_search.main()
owner_search.main()   # also re-applies owners, removing broker-sourced ones
