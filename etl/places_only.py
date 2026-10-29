"""Add businesses that aren't in the PPP loan data, from Overture Maps places.

    python etl/places_only.py --state OK

Appends to data/businesses.csv every open, reasonably confident Overture place in the state whose
category is a business, unless it matches a PPP borrower (same name nearby or in the same ZIP,
including sole proprietors, which stay excluded). With no loan data, estimates are an industry
average: the median estimated revenue of the PPP businesses in the same industry (most specific
NAICS prefix with enough of them), with the 25th-75th percentile as the range.
"""
import argparse
import csv
import math
import re
import os
import statistics
from collections import defaultdict

from benchmarks import load_benchmarks, lookup
from margins import Margins
from matching import full_name, name_score, name_tokens, parse_address
from overture import _meters, load_layers, pick_phone, pick_website
from csvio import write_rows

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
BIZ_CSV = os.path.join(DATA_DIR, "businesses.csv")
LISTED = {"rooftop", "place", "building", "address"}
MIN_CONFIDENCE = 0.6
MIN_CORROBORATED = 0.45  # a lower score is accepted when the listing has both a website and a phone
MIN_PEERS = 30          # PPP businesses needed before an industry prefix's average is used
PPP_MATCH_M = 400       # an Overture place this close to a same-name PPP borrower is that borrower
STATE_NAMES = {"OK": {"OK", "OKLAHOMA"}}

# Overture basic_category -> NAICS code. Categories not listed (places of worship, parks, public
# schools, government offices, ATMs, lakes, ...) are not businesses we list.
CATEGORY_NAICS = {
    "restaurant": "7225", "casual_eatery": "7225", "fast_food_restaurant": "7225", "coffee_shop": "7225",
    "cafe": "7225", "food_truck_stand": "7225", "smoothie_juice_bar": "7225", "non_alcoholic_beverage_venue": "7225",
    "bar": "7224", "hotel": "7211", "lodging": "7211", "bed_and_breakfast": "7211", "resort": "7211",
    "private_lodging": "7211", "rv_park": "7212", "campground": "7212",
    "home_service": "238", "building_or_construction_service": "23",
    "financial_service": "52", "bank_or_credit_union": "5221",
    "personal_or_beauty_service": "8121", "wellness_service": "8121", "laundry_service": "8123",
    "animal_or_pet_service": "8129", "automotive_service": "8111", "vehicle_service": "8111",
    "b2b_industrial_and_machine_service": "8113",
    "real_estate_service": "5312", "rental_service": "532", "storage_facility": "5311",
    "housing_or_property_service": "5313",
    "hardware_home_and_garden_store": "444", "fashion_and_apparel_store": "448", "food_and_beverage_store": "445",
    "convenience_store": "445", "specialty_store": "453", "second_hand_store": "453",
    "flowers_and_gifts_store": "453", "office_supply_store": "453", "animal_and_pet_store": "453",
    "electronics_store": "443", "discount_store": "452", "department_store": "452", "warehouse_club_store": "452",
    "shopping": "44", "vehicle_parts_store": "4413", "pharmacy_and_drug_store": "446",
    "personal_care_and_beauty_store": "446", "sporting_goods_store": "451", "arts_crafts_and_hobby_store": "451",
    "books_music_and_video_store": "451", "gas_station": "447", "fueling_station": "447",
    "auto_dealer": "4411", "vehicle_dealer": "4411",
    "professional_service": "54", "attorney_or_law_firm": "5411", "legal_service": "5411",
    "technical_service": "5413", "design_service": "5414", "b2b_office_and_professional_service": "54",
    "media_service": "51", "radio_station": "51", "printing_service": "323",
    "health_care": "6211", "specialized_health_care": "6211", "medical_service": "6211",
    "primary_care_or_general_clinic": "6211", "pediatric_clinic": "6211", "surgery": "6211",
    "reproductive_perinatal_and_womens_care": "6211", "emergency_or_urgent_care_facility": "6211",
    "dental_clinic": "6212", "vision_or_eye_care_clinic": "6213", "physical_medicine_and_rehabilitation": "6213",
    "complementary_and_alternative_medicine": "6213", "behavioral_or_mental_health_clinic": "6213",
    "diagnostics_imaging_or_lab_service": "6215", "outpatient_care_facility": "6214",
    "specialized_medical_facility": "6214", "senior_living_facility": "6233",
    "manufacturer": "31", "supplier_or_distributor": "42", "wholesaler": "42",
    "farm": "11", "agricultural_service": "1151",
    "sport_or_fitness_facility": "7139", "gym": "7139", "fitness_studio": "7139",
    "sport_or_recreation_club": "7139", "golf_course": "7139", "amusement_park": "7131", "casino": "7132",
    "movie_theater": "5121", "music_venue": "711", "event_venue": "711", "arts_and_entertainment": "711",
    "shipping_or_delivery_service": "492", "b2b_transportation_and_storage_service": "48",
    "travel_service": "5615", "b2b_service": "56", "corporate_or_business_office": "56",
    "event_or_party_service": "5619", "environmental_or_ecological_service": "562",
    "b2b_energy_and_utility_service": "2131",   # mostly oilfield services, not producers "specialty_school": "6116", "preschool": "6244",
    "family_service": "8122", "brewery": "3121", "winery": "3121", "lounge": "7224", "dance_club": "7224",
    "musical_instrument_and_pro_audio_store": "451", "toys_and_games_store": "451", "tutoring_service": "6116",
    "security_service": "5616", "telecommunications_service": "517", "urgent_care_clinic": "6211",
    "industrial_facility_or_service": "33", "b2b_science_and_technology_service": "5417",
    "arcade": "7139", "gaming_venue": "7139", "marina": "7139", "food_service": "7225",
}
# Finer Overture categories that pin down the industry better than the basic category.
# Checked in order, so the more specific words come first.
DETAIL_NAICS = [
    # Mining, oil and gas, farming: the basic categories ("b2b_energy_and_utility_service",
    # "b2b_service") are too broad for these.
    (("quarry", "sand_and_gravel", "aggregate_supplier", "rock_crusher"), "212321"), (("b2b_mining",), "212"),
    (("oil_and_gas_exploration", "oil_and_gas_extraction"), "211"), (("oil_refinery",), "324110"),
    (("b2b_oil_and_gas",), "213112"), (("well_drilling",), "237110"),
    (("livestock_breeder", "livestock_dealer", "ranch", "cattle"), "112"), (("crops_production",), "111"),
    (("grain_elevator",), "424510"), (("masonry_concrete",), "238140"), (("sandblasting", "powder_coating"), "332812"),
    (("septic_service",), "562991"), (("garbage_collection",), "562111"), (("funeral",), "812210"),
    (("dry_cleaning",), "812320"), (("carpet_cleaning", "upholstery"), "561740"),
    (("pest_control", "exterminat"), "561710"), (("landscap", "lawn", "tree_service", "gardener"), "561730"),
    (("window_washing", "air_duct_cleaning", "pressure_washing", "power_washing"), "561790"),
    (("janitorial", "office_cleaning", "commercial_cleaning", "cleaning_service", "industrial_cleaning",
      "home_cleaning", "house_cleaning", "maid"), "561720"),
    (("veterinar",), "541940"), (("insurance",), "5242"),
    (("accountant", "tax_preparation", "bookkeep"), "5412"), (("plumb", "hvac", "heating"), "238220"),
    (("electrician",), "238210"), (("roof",), "238160"), (("child_care", "day_care"), "624410"),
]


def naics_for(category, detail):
    for words, code in DETAIL_NAICS:
        if detail and any(w in detail for w in words):
            return code
    return CATEGORY_NAICS.get(category or "")


def quartiles(values):
    q = statistics.quantiles(values, n=4)
    return q[0], statistics.median(values), q[2]


def industry_averages(rows):
    """{naics prefix: (p25, median, p75)} of estimated revenue among listed PPP businesses."""
    by_prefix = defaultdict(list)
    for r in rows:
        rev = r.get("est_revenue_mid")
        if r.get("geo_precision") in LISTED and r.get("is_individual") != "True" and rev and r.get("naics"):
            for n in (2, 3, 4):
                by_prefix[r["naics"][:n]].append(float(rev))
    return {p: quartiles(v) for p, v in by_prefix.items() if len(v) >= MIN_PEERS}


class BorrowerIndex:
    """Every PPP borrower (listed or not), to recognise Overture places that are the same business."""
    CELL = 0.01

    def __init__(self, rows):
        self.cells, self.by_zip = defaultdict(list), defaultdict(list)
        for r in rows:
            tokens = name_tokens(r["name"])
            if not tokens:
                continue
            self.by_zip[r.get("zip", "")[:5]].append((tokens, r))
            if r.get("lat") and r.get("lon"):
                lat, lon = float(r["lat"]), float(r["lon"])
                self.cells[(int(lon // self.CELL), int(lat // self.CELL))].append((tokens, lat, lon))

    def matches(self, tokens, lat, lon, zip5):
        """The matched borrower's row (or True for a nearby one), else None."""
        for t, r in self.by_zip.get(zip5, ()):
            if name_score(tokens, t) >= 0.8:
                return r
        mx, my = _meters(lat)
        cx, cy = int(lon // self.CELL), int(lat // self.CELL)
        for i in (cx - 1, cx, cx + 1):
            for j in (cy - 1, cy, cy + 1):
                for t, b_lat, b_lon in self.cells.get((i, j), ()):
                    if (name_score(tokens, t) >= 0.6
                            and math.hypot((b_lon - lon) * mx, (b_lat - lat) * my) <= PPP_MATCH_M):
                        return True
        return None


# Restaurants, hotels, salons, gas stations and convenience stores are mostly franchises or
# separately owned stores, so a shared name doesn't make them one company.
FRANCHISE_HEAVY = ("72", "8121", "447", "457", "4451", "445")
MAX_BRANCHES = 25          # more same-name places than this is a brand or chain, not one local company


def brand_key(name, cities):
    """A company's name without legal endings or a trailing town ("COOK FEED AND OUTDOOR YUKON LLC" ->
    "COOK FEED AND OUTDOOR"), so a map listing matches the company registered for one of its stores."""
    words = full_name(name or "").split()
    changed = True
    while changed and len(words) > 2:
        changed = False
        for n in (2, 1):   # two-word towns first ("BROKEN ARROW", "OKLAHOMA CITY")
            if (len(words) - n >= 2 and " ".join(words[-n:]) in cities | {"OK", "OKLAHOMA", "OKC"}
                    and words[-n - 1] not in ("OF", "AND", "THE", "AT", "IN", "OK", "OKLAHOMA")):
                words = words[:-n]
                changed = True
                break
    return " ".join(words)


def site_domain(url):
    m = re.match(r"^(?:https?://)?(?:www\.)?([^/:?#]+)", (url or "").strip().lower())
    return m.group(1) if m else ""


def trace(queries, name, reason):
    if any(q in name.upper() for q in queries):
        print(f"LOOKUP place {name!r}: {reason}", flush=True)


def branch_row(get, name, code, bench, state, zip5, lat, lon, parent):
    """A location of a listed company: no estimate of its own; the profile points to the parent."""
    blank = {k: "" for k in ("est_payroll", "est_revenue_low", "est_revenue_mid", "est_revenue_high", "est_ebitda_low",
                             "est_ebitda_mid", "est_ebitda_high", "est_revenue_by_employees", "est_revenue_by_payroll",
                             "total_ppp_amount", "est_ebitda_margin", "jobs_reported")}
    return {
        **blank, "biz_key": f"OV|{get('id')}", "name": name, "address": (get("street") or "").strip(),
        "city": (get("locality") or "").strip().title(), "state": state, "zip": zip5, "county": "",
        "naics": parent.get("naics") or code, "industry": parent.get("industry") or bench["label"],
        "business_type": "", "is_individual": "False", "is_nonprofit": "False",
        "lat": lat, "lon": lon, "geo_precision": "place", "est_method": "branch", "est_confidence": "",
        "website": pick_website(get("websites")) or "", "source": "overture",
        "phone": pick_phone(get("phones")) or "",
        "parent_key": parent["biz_key"], "parent_name": parent["name"],
    }


MAX_CHAIN_SCALE = 10      # a map-only company's estimate counts at most this many locations


def group_chains(added, cities, margins):
    """Map-only listings of one company (same name, and a shared website or phone): the first becomes
    the company, sized as an industry-average store times its locations; the rest become its locations."""
    groups = defaultdict(list)
    for r in added:
        if r["est_method"] != "industry_average" or r["naics"].startswith(FRANCHISE_HEAVY):
            continue
        brand = brand_key(r["name"], cities)
        if len(brand.split()) >= 2:
            groups[brand].append(r)
    folded = 0
    for brand, members in groups.items():
        if not 2 <= len(members) <= MAX_BRANCHES:
            continue
        # Same name alone isn't enough ("Quality Plumbing" in two towns are usually two companies).
        sites = defaultdict(list)
        for r in members:
            for k in filter(None, (site_domain(r.get("website")), re.sub(r"\D", "", r.get("phone") or ""))):
                sites[k].append(r)
        chain = max(sites.values(), key=len, default=[])
        if len(chain) < 2:
            continue
        chain_ids = {id(r) for r in chain}
        chain = chain + [r for r in members if id(r) not in chain_ids and not (r.get("website") or r.get("phone"))]
        head = max(chain, key=lambda r: (bool(r.get("website")), bool(r.get("phone"))))
        n = min(len(chain), MAX_CHAIN_SCALE)
        for f in ("est_revenue_low", "est_revenue_mid", "est_revenue_high"):
            head[f] = round(head[f] * n)
        margin = margins.margin(head["naics"], head["est_revenue_mid"])
        for f, g in (("est_ebitda_low", "est_revenue_low"), ("est_ebitda_mid", "est_revenue_mid"), ("est_ebitda_high", "est_revenue_high")):
            head[f] = round(head[g] * margin)
        head["est_ebitda_margin"] = margin if margins.data else ""
        for r in chain:
            if r is head:
                continue
            for f in ("est_revenue_low", "est_revenue_mid", "est_revenue_high", "est_ebitda_low", "est_ebitda_mid",
                      "est_ebitda_high", "est_ebitda_margin"):
                r[f] = ""
            r.update(est_method="branch", est_confidence="", parent_key=head["biz_key"], parent_name=head["name"],
                     naics=head["naics"], industry=head["industry"])
            folded += 1
    return folded


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.upper()
    if os.environ.get("OVERTURE", "1") == "0":
        print("Places-only: skipped (OVERTURE=0)", flush=True)
        return

    with open(BIZ_CSV, newline="") as f:
        reader = csv.DictReader(f)
        fields = list(reader.fieldnames)
        rows = [r for r in reader if r.get("source") != "overture"]   # rebuilt each run
    for extra in ("source", "est_ebitda_margin", "est_inflation", "est_growth", "parent_key", "parent_name", "phone"):
        if extra not in fields:
            fields.append(extra)
    for r in rows:
        r["source"] = "ppp"

    averages = industry_averages(rows)
    benchmarks = load_benchmarks()
    margins = Margins()
    borrowers = BorrowerIndex(rows)
    # Listed PPP companies by full name, to recognise their other locations ("Minick Materials" in
    # Norman is a branch of MINICK MATERIALS COMPANY in Oklahoma City, not a separate business).
    cities = {(r.get("city") or "").strip().upper() for r in rows if r.get("city")}
    by_brand = defaultdict(dict)
    for r in rows:
        if r.get("geo_precision") in LISTED and r.get("est_revenue_mid") and r.get("is_individual") != "True":
            by_brand[brand_key(r["name"], cities)][r["biz_key"]] = r
    _, _, _, places = load_layers(state)
    cols = {c: places.column(c).to_pylist() for c in places.column_names}
    name_counts = defaultdict(int)
    for n in cols["name"]:
        name_counts[brand_key(n, cities)] += 1

    added, skipped, unmapped, moved = [], defaultdict(int), defaultdict(int), 0
    # Names listed in etl/lookup.txt: say in the log what happened to their map listings.
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "lookup.txt")) as f:
        traced = [q.strip().upper() for q in f if q.strip() and not q.startswith("#")]
    seen = {}   # (name tokens, ~100 m cell) -> index in added, to drop duplicate Overture records
    for i in range(places.num_rows):
        get = lambda c: cols[c][i] if c in cols else None  # noqa: E731
        name, lat, lon = (get("name") or "").strip(), get("lat"), get("lon")
        zip5 = (get("postcode") or "")[:5]
        region = (get("region") or "").upper()
        if region not in STATE_NAMES[state] and not (state == "OK" and zip5[:2] in ("73", "74") and not region):
            continue
        confidence = get("confidence") or 0
        corroborated = confidence >= MIN_CORROBORATED and get("websites") and get("phones")
        if get("status") == "permanently_closed" or (confidence < MIN_CONFIDENCE and not corroborated):
            skipped["closed or low confidence"] += 1
            trace(traced, name, f"closed or low confidence ({get('status')}, confidence {get('confidence')})")
            continue
        code = naics_for(get("category"), get("category_detail"))
        tokens = name_tokens(name)
        if not code or not tokens or lat is None:
            skipped["not a business category"] += 1
            unmapped[(get("category"), get("category_detail"))] += 1
            trace(traced, name, f"category not mapped to an industry ({get('category')} / {get('category_detail')})")
            continue
        borrower = borrowers.matches(tokens, lat, lon, zip5)
        if borrower:
            skipped["already in PPP data"] += 1
            if borrower is not True and borrower.get("geo_precision") == "zip":
                # A borrower we could only place at its ZIP: the map listing shows where it is.
                borrower.update({"lat": lat, "lon": lon, "geo_precision": "place"})
                borrower["website"] = borrower.get("website") or pick_website(get("websites")) or ""
                borrower["phone"] = borrower.get("phone") or pick_phone(get("phones")) or ""
                moved += 1
            trace(traced, name, "matched to a PPP borrower (listed from the loan data instead)")
            continue
        avg = next((averages[code[:n]] for n in (4, 3, 2) if code[:n] in averages), None)
        if avg is None:
            skipped["no industry average"] += 1
            trace(traced, name, f"no industry average for {code}")
            continue
        # The same store listed twice ("Cook Feed & Outdoor", "Cook Feed and Outdoor"): same name at the
        # same street address, or within the same ~100 m.
        addr = parse_address(get("street"))
        key = (tokens, zip5, addr) if addr else (tokens, round(lat, 3), round(lon, 3))
        if key in seen:
            skipped["duplicate place"] += 1
            trace(traced, name, "duplicate map listing")
            continue
        _, bench = lookup(benchmarks, code)
        brand = brand_key(name, cities)
        parents = list(by_brand.get(brand, {}).values())
        if (len(parents) == 1 and len(brand.split()) >= 2 and not code.startswith(FRANCHISE_HEAVY)
                and name_counts[brand] <= MAX_BRANCHES):
            p = parents[0]
            seen[key] = len(added)
            added.append(branch_row(get, name, code, bench, state, zip5, lat, lon, p))
            skipped["branch of a listed company (kept as a location)"] += 1
            continue
        low, mid, high = avg
        margin = margins.margin(code, mid)   # industry margin at the typical size
        seen[key] = len(added)
        added.append({
            "biz_key": f"OV|{get('id')}", "name": name, "address": (get("street") or "").strip(),
            "city": (get("locality") or "").strip().title(), "state": state, "zip": zip5, "county": "",
            "naics": code, "industry": bench["label"], "business_type": "", "is_individual": "False",
            "is_nonprofit": "False", "jobs_reported": "", "lat": lat, "lon": lon, "geo_precision": "place",
            "est_payroll": "", "est_revenue_low": round(low), "est_revenue_mid": round(mid),
            "est_revenue_high": round(high), "est_ebitda_low": round(low * margin),
            "est_ebitda_mid": round(mid * margin), "est_ebitda_high": round(high * margin),
            "est_revenue_by_employees": "", "est_revenue_by_payroll": "", "est_method": "industry_average",
            "est_confidence": "low", "total_ppp_amount": "", "est_ebitda_margin": margin if margins.data else "", "website": pick_website(get("websites")) or "",
            "phone": pick_phone(get("phones")) or "", "source": "overture",
        })

    grouped = group_chains(added, cities, margins)
    write_rows(BIZ_CSV, fields, rows + added)
    print(f"Places-only: added {len(added):,} businesses without loan data; skipped {dict(skipped)}; "
          f"{moved:,} ZIP-placed borrowers moved to their map listing; {grouped:,} map listings folded into "
          f"multi-location companies", flush=True)
    top = sorted(unmapped.items(), key=lambda kv: -kv[1])[:25]
    print("Places-only: most common categories not listed: " + ", ".join(f"{c}/{d} {n:,}" for (c, d), n in top), flush=True)


if __name__ == "__main__":
    main()
