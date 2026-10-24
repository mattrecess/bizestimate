// Everyday words for kinds of business, mapped to NAICS codes, so a search like "commercial
// cleaning" or "plumbers in tulsa" finds every business in that industry, not only the ones
// whose name happens to contain the words.

export type Industry = { label: string; terms: string[]; naics: string[] };

export const INDUSTRIES: Industry[] = [
  { label: "Commercial cleaning & janitorial", naics: ["561720"],
    terms: ["commercial cleaning", "janitorial", "janitor", "office cleaning", "cleaning service", "cleaning company",
      "cleaning business", "custodial", "maid service", "house cleaning", "cleaner", "cleaning"] },
  { label: "Carpet & upholstery cleaning", naics: ["561740"], terms: ["carpet cleaning", "upholstery cleaning", "rug cleaning"] },
  { label: "Pest control", naics: ["561710"], terms: ["pest control", "exterminator", "termite"] },
  { label: "Landscaping & lawn care", naics: ["561730"], terms: ["landscaping", "landscaper", "lawn care", "lawn service", "mowing", "tree service", "tree trimming"] },
  { label: "Window & pressure washing", naics: ["561790"], terms: ["window cleaning", "window washing", "pressure washing", "power washing", "duct cleaning"] },
  { label: "Plumbing, heating & air", naics: ["238220"], terms: ["plumbing", "plumber", "hvac", "heating and air", "air conditioning", "heating", "furnace"] },
  { label: "Electricians", naics: ["238210"], terms: ["electrician", "electrical contractor", "electrical"] },
  { label: "Roofing", naics: ["238160"], terms: ["roofing", "roofer", "roof repair"] },
  { label: "Concrete & foundations", naics: ["238110"], terms: ["concrete", "foundation repair", "flatwork"] },
  { label: "Painting contractors", naics: ["238320"], terms: ["painting contractor", "painter", "painting company"] },
  { label: "Flooring", naics: ["238330"], terms: ["flooring", "floor installation", "tile installer"] },
  { label: "Drywall & insulation", naics: ["238310"], terms: ["drywall", "insulation"] },
  { label: "Fencing, siding & exterior", naics: ["238990", "238170"], terms: ["fencing", "fence company", "siding"] },
  { label: "Excavation & site work", naics: ["238910"], terms: ["excavation", "dirt work", "site prep", "grading"] },
  { label: "Home builders", naics: ["236115", "236116", "236117", "236118"], terms: ["home builder", "homebuilder", "custom homes", "remodeling", "remodeler"] },
  { label: "Commercial construction", naics: ["236220", "236210"], terms: ["general contractor", "commercial construction", "construction company"] },
  { label: "Road & utility construction", naics: ["237"], terms: ["paving", "asphalt", "pipeline construction", "road construction", "utility construction"] },
  { label: "Septic & waste services", naics: ["562"], terms: ["septic", "waste management", "trash", "garbage", "dumpster", "portable toilet", "porta potty", "recycling", "junk removal"] },
  { label: "Trucking & freight", naics: ["484"], terms: ["trucking", "freight", "hauling", "truck line", "logistics"] },
  { label: "Moving companies", naics: ["484210"], terms: ["moving company", "movers"] },
  { label: "Warehousing & storage", naics: ["493"], terms: ["warehouse", "warehousing", "storage"] },
  { label: "Oil & gas", naics: ["211", "213111", "213112", "486"], terms: ["oil and gas", "oilfield", "oil field", "drilling", "petroleum", "energy company", "midstream"] },
  { label: "Restaurants", naics: ["7225"], terms: ["restaurant", "diner", "pizza", "bbq", "barbecue", "cafe", "coffee shop", "fast food", "catering", "caterer"] },
  { label: "Bars", naics: ["7224"], terms: ["bar", "pub", "tavern", "brewery", "taproom"] },
  { label: "Hotels & motels", naics: ["7211"], terms: ["hotel", "motel", "inn", "lodging"] },
  { label: "Auto repair", naics: ["8111"], terms: ["auto repair", "mechanic", "auto shop", "body shop", "collision", "transmission", "oil change", "tire shop"] },
  { label: "Car dealers", naics: ["4411", "4412"], terms: ["car dealer", "auto dealer", "dealership", "used cars", "rv dealer"] },
  { label: "Car wash", naics: ["811192"], terms: ["car wash", "auto detailing", "detailing"] },
  { label: "Dentists", naics: ["621210"], terms: ["dentist", "dental", "orthodontist", "orthodontics"] },
  { label: "Doctors & clinics", naics: ["621111", "621112", "6214", "6211"], terms: ["doctor", "physician", "medical clinic", "family medicine", "urgent care", "clinic", "medical practice"] },
  { label: "Chiropractors & therapists", naics: ["621310", "621340", "621330", "621390"], terms: ["chiropractor", "chiropractic", "physical therapy", "physical therapist", "counseling", "therapist", "optometrist", "eye doctor"] },
  { label: "Home health & senior care", naics: ["621610", "623", "624120"], terms: ["home health", "home care", "hospice", "nursing home", "assisted living", "senior care", "senior living"] },
  { label: "Pharmacies", naics: ["456110", "446110"], terms: ["pharmacy", "drug store"] },
  { label: "Veterinarians", naics: ["541940"], terms: ["veterinarian", "veterinary", "vet clinic", "animal hospital"] },
  { label: "Child care", naics: ["624410"], terms: ["daycare", "day care", "child care", "childcare", "preschool"] },
  { label: "Accounting & tax", naics: ["5412"], terms: ["accounting", "accountant", "cpa", "bookkeeping", "bookkeeper", "tax preparation", "tax service"] },
  { label: "Law firms", naics: ["5411"], terms: ["law firm", "lawyer", "attorney", "legal services"] },
  { label: "Engineering & architecture", naics: ["5413"], terms: ["engineering", "engineer", "architect", "architecture", "surveying", "surveyor"] },
  { label: "IT & software", naics: ["5415", "5182", "513210"], terms: ["it services", "software", "managed it", "computer services", "web design", "tech company", "cybersecurity"] },
  { label: "Marketing & advertising", naics: ["5418"], terms: ["marketing", "advertising", "marketing agency", "ad agency", "digital marketing"] },
  { label: "Consulting", naics: ["5416"], terms: ["consulting", "consultant", "management consulting"] },
  { label: "Staffing & recruiting", naics: ["5613"], terms: ["staffing", "recruiting", "recruiter", "temp agency", "employment agency"] },
  { label: "Security services", naics: ["5616"], terms: ["security guard", "security company", "alarm company", "security services"] },
  { label: "Insurance agencies", naics: ["5242"], terms: ["insurance agency", "insurance agent", "insurance broker", "insurance"] },
  { label: "Banks & credit unions", naics: ["5221"], terms: ["bank", "credit union"] },
  { label: "Financial advisors", naics: ["5239", "5231"], terms: ["financial advisor", "financial planner", "wealth management", "investment advisor"] },
  { label: "Real estate", naics: ["531"], terms: ["real estate", "realtor", "property management", "brokerage", "apartments", "landlord"] },
  { label: "Equipment rental", naics: ["532"], terms: ["equipment rental", "rental company", "party rental"] },
  { label: "Hair & beauty salons", naics: ["812111", "812112", "812113", "8121"], terms: ["salon", "hair salon", "barber", "barbershop", "nail salon", "spa", "beauty salon"] },
  { label: "Gyms & fitness", naics: ["713940"], terms: ["gym", "fitness", "crossfit", "yoga", "martial arts"] },
  { label: "Funeral homes", naics: ["812210", "812220"], terms: ["funeral home", "mortuary", "cemetery"] },
  { label: "Dry cleaners & laundry", naics: ["8123"], terms: ["dry cleaner", "dry cleaning", "laundromat", "laundry"] },
  { label: "Printing", naics: ["323"], terms: ["printing", "print shop", "screen printing", "signs", "sign company"] },
  { label: "Machine shops & fabrication", naics: ["332710", "332"], terms: ["machine shop", "machining", "fabrication", "welding", "metal fabrication"] },
  { label: "Manufacturing", naics: ["31", "32", "33"], terms: ["manufacturing", "manufacturer", "factory"] },
  { label: "Wholesale & distribution", naics: ["42"], terms: ["wholesale", "distributor", "distribution", "supplier"] },
  { label: "Grocery & convenience stores", naics: ["445"], terms: ["grocery", "convenience store", "supermarket", "liquor store"] },
  { label: "Gas stations", naics: ["447", "457"], terms: ["gas station", "fuel station", "truck stop"] },
  { label: "Hardware & building supply", naics: ["444"], terms: ["hardware store", "lumber yard", "building supply", "nursery", "garden center"] },
  { label: "Furniture & appliance stores", naics: ["442", "443", "449"], terms: ["furniture store", "appliance store", "mattress store"] },
  { label: "Clothing & boutiques", naics: ["448", "458"], terms: ["clothing store", "boutique", "apparel"] },
  { label: "Farms & ranches", naics: ["111", "112"], terms: ["farm", "ranch", "cattle", "agriculture"] },
  { label: "Churches & nonprofits", naics: ["8131", "8132", "8133", "8134", "8139"], terms: ["church", "nonprofit", "non profit", "charity", "association"] },
  { label: "Schools & training", naics: ["611"], terms: ["school", "academy", "training", "tutoring", "driving school"] },
];

// Lower case, punctuation out, and a light singular ("plumbers" -> "plumber", "services" -> "service").
const norm = (s: string) =>
  s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));

const PREPARED = INDUSTRIES.map((ind) => ({ ...ind, words: ind.terms.map(norm) }));
// Words that only connect an industry to a place ("cleaning companies in tulsa").
const FILLER = new Set(["in", "near", "around", "the", "a", "an", "of", "and", "company", "companie", "business",
  "businesse", "service", "firm", "ok", "oklahoma", "okla", "local", "best", "top"]);

const PLACE_ALIASES: Record<string, string> = { okc: "oklahoma city", ba: "broken arrow" };

/** The industry a search names, and what's left of the query (e.g. a city) once it's removed. */
export function matchIndustry(q: string): { industry: Industry; rest: string } | null {
  const words = norm(q);
  if (!words.length) return null;
  let best: { industry: Industry; start: number; len: number } | null = null;
  for (const ind of PREPARED) {
    for (const term of ind.words) {
      for (let i = 0; i + term.length <= words.length; i++) {
        // Every word of the term, in order; the last one may still be half typed ("commercial clea").
        const hit = term.every((t, j) => (i + j === words.length - 1 && j === term.length - 1 && words[i + j].length >= 4
          ? t.startsWith(words[i + j]) : words[i + j] === t));
        if (hit && (!best || term.length > best.len)) best = { industry: ind, start: i, len: term.length };
      }
    }
  }
  if (!best) return null;
  const rest = words.filter((w, i) => (i < best!.start || i >= best!.start + best!.len) && !FILLER.has(w));
  return { industry: best.industry, rest: rest.map((w) => PLACE_ALIASES[w] ?? w).join(" ") };
}

/** The most specific industry label for a NAICS code, or null (callers fall back to the sector). */
export function industryLabel(naics: string | null | undefined): string | null {
  if (!naics) return null;
  let best: { label: string; len: number } | null = null;
  for (const ind of INDUSTRIES) {
    for (const code of ind.naics) {
      // 4+ digit codes only: a 2-3 digit one ("31", "42") is no more specific than the sector.
      if (code.length >= 4 && naics.startsWith(code) && (!best || code.length > best.len)) best = { label: ind.label, len: code.length };
    }
  }
  return best?.label ?? null;
}
