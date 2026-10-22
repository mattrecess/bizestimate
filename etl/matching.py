"""Shared address and business-name normalization for matching records across datasets."""
import re

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
