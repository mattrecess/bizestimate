"""Shared address and business-name normalization for matching records across datasets."""
import re
from collections import defaultdict

NAME_NOISE = {"LLC", "L", "C", "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "PLLC",
              "PC", "LP", "LLP", "PA", "DBA", "THE", "OF", "AND", "OKLAHOMA", "OK", "OKC", "TULSA"}

SUFFIX = {
    "STREET": "ST", "AVENUE": "AVE", "AV": "AVE", "BOULEVARD": "BLVD", "DRIVE": "DR", "ROAD": "RD",
    "LANE": "LN", "COURT": "CT", "PLACE": "PL", "PARKWAY": "PKWY", "HIGHWAY": "HWY", "TERRACE": "TER",
    "CIRCLE": "CIR", "EXPRESSWAY": "EXPY", "FREEWAY": "FWY", "TRAIL": "TRL", "SQUARE": "SQ",
    "CENTER": "CTR", "PLAZA": "PLZ", "POINT": "PT", "CROSSING": "XING", "TURNPIKE": "TPKE",
}
DIRECTION = {
    "NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W", "NORTHWEST": "NW", "NORTHEAST": "NE",
    "SOUTHWEST": "SW", "SOUTHEAST": "SE",
}
# Road names that end in a number ("HWY 66", "COUNTY RD 56"); other trailing numbers are units.
NUMBERED_ROADS = {"HWY", "RD", "ROUTE", "RT", "US", "SH", "FM", "CR", "INTERSTATE", "I", "LOOP", "SPUR"}
UNIT_WORDS = {"STE", "SUITE", "UNIT", "APT", "BLDG", "BUILDING", "RM", "ROOM", "FL", "FLOOR", "SPC", "LOT", "DEPT"}


def parse_address(addr):
    """'13209 N Santa Fe Avenue Ste 100' -> ('13209', 'N SANTA FE AVE'); None for PO boxes etc."""
    s = re.sub(r"[^A-Z0-9 ]", " ", (addr or "").upper().replace("#", " STE "))
    tokens = s.split()
    if not tokens or not re.match(r"^\d+[A-Z]?$", tokens[0]):
        return None
    number = re.match(r"^\d+", tokens[0]).group()
    street = []
    for tok in tokens[1:]:
        if tok in UNIT_WORDS:
            break
        street.append(SUFFIX.get(tok, DIRECTION.get(tok, tok)))
    while len(street) > 1 and street[-1].isdigit() and street[-2] not in NUMBERED_ROADS:
        street.pop()   # bare suite number, e.g. "2525 NW EXPRESSWAY 209"
    return (number, " ".join(street)) if street else None


def normalize_street(street):
    parsed = parse_address(f"0 {street or ''}")
    return parsed[1] if parsed else ""


def street_core(street):
    """Street name without directionals and suffix type, for looser matching."""
    words = [w for w in street.split() if w not in DIRECTION.values() and w not in SUFFIX.values()]
    return " ".join(words) or street


def ordered_name_tokens(name):
    """Significant words of a business name, in order ("THE RED DIRT GYPSY LLC" -> RED, DIRT, GYPSY)."""
    words = re.sub(r"[^A-Z0-9 ]", " ", (name or "").upper().replace("'", "").replace("&", " AND ")).split()
    return [w for w in words if w not in NAME_NOISE and len(w) > 1]


def name_tokens(name):
    return frozenset(ordered_name_tokens(name))


def name_score(a, b):
    """Similarity of two token sets: overlap relative to the smaller set, damped for one-word names."""
    if not a or not b:
        return 0.0
    common = len(a & b)
    score = common / min(len(a), len(b))
    return score if common >= 2 or min(len(a), len(b)) == 1 else score * 0.8


LEGAL = {"LLC", "L", "C", "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "PLLC",
         "PC", "P", "LP", "LLP", "PA", "THE", "DBA"}


def full_name(name):
    """Every word but legal suffixes: stricter than name_tokens, which also drops words like OKLAHOMA."""
    words = re.sub(r"[^A-Z0-9 ]", " ", name.upper().replace("&", " AND ")).split()
    return " ".join(w for w in words if w not in LEGAL)


def match_entities(entities, businesses):
    """Map outside records to listed businesses by name and place, leaving out unsure ones.

    entities: {id: {"names": set of names, "places": set of (address, city, zip)}}
    businesses: [{"biz_key", "name", "address", "city", "zip"}]   ->   {id: biz_key}
    """
    by_token = defaultdict(list)
    for b in businesses:
        b["tokens"] = name_tokens(b["name"])
        b["addr"] = parse_address(b["address"])
        for t in b["tokens"]:
            by_token[t].append(b)
    # How many listed businesses carry each exact name, so a unique name can match on its own.
    name_count = defaultdict(int)
    for b in businesses:
        name_count[b["tokens"]] += 1
    matches = {}
    for ein, s in entities.items():
        addrs = {parse_address(a) for a, _, _ in s["places"]} - {None}
        cities = {c for _, c, _ in s["places"] if c}
        zips = {z for _, _, z in s["places"] if z}
        best = []
        for name in s["names"]:
            toks = name_tokens(name)
            if not toks:
                continue
            rare = min(toks, key=lambda t: len(by_token.get(t, ())))
            for b in by_token.get(rare, ()):
                common = len(toks & b["tokens"])
                same_addr = b["addr"] is not None and b["addr"] in addrs
                same_zip = b["zip"][:5] in zips
                same_city = b["city"].upper() in cities
                if toks == b["tokens"] and (same_addr or same_zip or same_city):
                    score = 3 + same_addr + same_zip   # same name, same place
                elif (toks == b["tokens"] and len(toks) >= 2 and name_count[toks] == 1
                      and full_name(name) == full_name(b["name"])):
                    score = 2                           # same distinctive name, only one in the state
                                                        # (the filing's address is often the accountant's)
                elif common >= 2 and common == min(len(toks), len(b["tokens"])) and (same_addr or same_zip):
                    score = 2 + same_addr               # one name contains the other, same ZIP
                elif same_addr and common >= 1 and common / min(len(toks), len(b["tokens"])) >= 0.5:
                    score = 1                           # same street address, similar name
                else:
                    continue
                best.append((score, b["biz_key"]))
        if not best:
            continue
        top = max(score for score, _ in best)
        keys = {k for score, k in best if score == top}
        if len(keys) == 1:   # two equally good businesses: ambiguous, skip
            matches[ein] = keys.pop()
    return matches
