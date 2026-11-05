"""Contact-data broker and people-finder sites. Their pages often rank in Google for "who owns X", but
their data is licensed under their own terms, so nothing found on them is used or cited here: searches
skip them, and anything already saved from them is dropped (owner_search, people_search, enrich)."""
import re

DOMAINS = (
    "rocketreach.co", "zoominfo.com", "apollo.io", "lusha.com", "signalhire.com", "contactout.com", "seamless.ai",
    "leadiq.com", "datanyze.com", "uplead.com", "lead411.com", "aeroleads.com", "getprospect.com", "hunter.io",
    "adapt.io", "kendo.ai", "salesintel.io", "cognism.com", "clearbit.com", "swordfish.ai", "snov.io",
    "spokeo.com", "whitepages.com", "beenverified.com", "truepeoplesearch.com", "fastpeoplesearch.com",
    "peoplefinders.com", "radaris.com", "nuwber.com", "intelius.com", "mylife.com", "instantcheckmate.com",
    "dnb.com",   # Dun & Bradstreet: licensed business data, like ZoomInfo (Nov 5)
)
PATTERN = re.compile("|".join(re.escape(d) for d in DOMAINS), re.I)


def is_broker(url):
    return bool(url) and bool(PATTERN.search(url))
