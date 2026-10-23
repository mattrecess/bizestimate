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
import os
import statistics
from collections import defaultdict

from benchmarks import load_benchmarks, lookup
from matching import name_score, name_tokens
from overture import _meters, load_layers, pick_website

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
BIZ_CSV = os.path.join(DATA_DIR, "businesses.csv")
LISTED = {"rooftop", "place", "building", "address"}
MIN_CONFIDENCE = 0.6
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
    "b2b_energy_and_utility_service": "21", "specialty_school": "6116", "preschool": "6244",
}
# Finer Overture categories that pin down the industry better than the basic category.
DETAIL_NAICS = [
    (("janitorial", "office_cleaning", "cleaning_service", "industrial_cleaning", "home_cleaning",
      "carpet_cleaning", "air_duct_cleaning", "window_washing", "pest_control", "landscap", "lawn"), "5617"),
    (("dry_cleaning",), "8123"), (("veterinar",), "5419"), (("insurance",), "5242"),
    (("accountant", "tax_preparation", "bookkeep"), "5412"), (("plumb", "hvac", "electrician", "heating"), "2382"),
    (("roof",), "2381"), (("child_care", "day_care"), "6244"),
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
            self.by_zip[r.get("zip", "")[:5]].append(tokens)
            if r.get("lat") and r.get("lon"):
                lat, lon = float(r["lat"]), float(r["lon"])
                self.cells[(int(lon // self.CELL), int(lat // self.CELL))].append((tokens, lat, lon))

    def matches(self, tokens, lat, lon, zip5):
        if any(name_score(tokens, t) >= 0.8 for t in self.by_zip.get(zip5, ())):
            return True
        mx, my = _meters(lat)
        cx, cy = int(lon // self.CELL), int(lat // self.CELL)
        for i in (cx - 1, cx, cx + 1):
            for j in (cy - 1, cy, cy + 1):
                for t, b_lat, b_lon in self.cells.get((i, j), ()):
                    if (name_score(tokens, t) >= 0.6
                            and math.hypot((b_lon - lon) * mx, (b_lat - lat) * my) <= PPP_MATCH_M):
                        return True
        return False


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
    if "source" not in fields:
        fields.append("source")
    for r in rows:
        r["source"] = "ppp"

    averages = industry_averages(rows)
    benchmarks = load_benchmarks()
    borrowers = BorrowerIndex(rows)
    _, _, _, places = load_layers(state)
    cols = {c: places.column(c).to_pylist() for c in places.column_names}

    added, skipped = [], defaultdict(int)
    seen = {}   # (name tokens, ~100 m cell) -> index in added, to drop duplicate Overture records
    for i in range(places.num_rows):
        get = lambda c: cols[c][i]  # noqa: E731
        name, lat, lon = (get("name") or "").strip(), get("lat"), get("lon")
        zip5 = (get("postcode") or "")[:5]
        region = (get("region") or "").upper()
        if region not in STATE_NAMES[state] and not (state == "OK" and zip5[:2] in ("73", "74") and not region):
            continue
        if get("status") == "permanently_closed" or (get("confidence") or 0) < MIN_CONFIDENCE:
            skipped["closed or low confidence"] += 1
            continue
        code = naics_for(get("category"), get("category_detail"))
        tokens = name_tokens(name)
        if not code or not tokens or lat is None:
            skipped["not a business category"] += 1
            continue
        if borrowers.matches(tokens, lat, lon, zip5):
            skipped["already in PPP data"] += 1
            continue
        avg = next((averages[code[:n]] for n in (4, 3, 2) if code[:n] in averages), None)
        if avg is None:
            skipped["no industry average"] += 1
            continue
        key = (tokens, round(lat, 3), round(lon, 3))
        if key in seen:
            skipped["duplicate place"] += 1
            continue
        _, bench = lookup(benchmarks, code)
        low, mid, high = avg
        margin = bench["ebitda_margin"]
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
            "est_confidence": "low", "total_ppp_amount": "", "website": pick_website(get("websites")) or "",
            "source": "overture",
        })

    with open(BIZ_CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
        w.writerows(added)
    print(f"Places-only: added {len(added):,} businesses without loan data; skipped {dict(skipped)}", flush=True)


if __name__ == "__main__":
    main()
