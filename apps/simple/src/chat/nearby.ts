import { distanceMeters, type CampusMapPoints, type LngLat } from "@campus/core";

/** Something people ask for "the nearest" of, and the campus map kinds that count. */
interface Kind {
  /** What Gemma (or the patterns) puts in Intent.what. */
  id: string;
  /** Said as "the nearest …". */
  label: string;
  words: RegExp;
  kinds: string[];
  /** Only points whose name matches (coffee among the cafés and restaurants). */
  names?: RegExp;
}

/** Order matters: the first whose words match wins ("coffee" before "food"). */
export const NEARBY_KINDS: Kind[] = [
  { id: "restroom", label: "restroom", words: /\b(restrooms?|bathrooms?|toilets?|washrooms?|loo|wc)\b/, kinds: ["Gender Inclusive", "Public"] },
  { id: "water", label: "water refill station", words: /\b(water|refill|hydration|fountain|bottle filler)\b/, kinds: ["Hydration"] },
  {
    id: "coffee",
    label: "coffee",
    words: /\b(coffee|espresso|latte|cafe|café)\b/,
    kinds: ["Coffee", "Cafes and Restaurants"],
    names: /coffee|caf[eé]|espresso|starbucks|peet|roast|tea\b|java/i,
  },
  { id: "food", label: "place to eat", words: /\b(food|eat|lunch|dinner|breakfast|hungry|restaurants?|dining|meal|snacks?)\b/, kinds: ["Cafes and Restaurants", "Dining Halls", "Markets", "Coffee"] },
  { id: "vending", label: "vending machine", words: /\b(vending|vending machines?)\b/, kinds: ["Vending Machines"] },
  { id: "print", label: "printer", words: /\b(print|printers?|printing)\b/, kinds: ["Printers and Print Services", "Computer Labs"] },
  { id: "study", label: "place to study", words: /\b(study|library|libraries|lounge|quiet)\b/, kinds: ["Libraries", "Lounges", "Computer Labs"] },
  { id: "computer", label: "computer lab", words: /\b(computer labs?|computers?)\b/, kinds: ["Computer Labs"] },
  { id: "charge", label: "phone charging station", words: /\b(charge my phone|phone charg\w*|charging stations?)\b/, kinds: ["Charging Stations"] },
  { id: "ev", label: "EV charger", words: /\b(ev|electric car|car charg\w*|chargers?)\b/, kinds: ["Level 2 Chargers", "DC Fast Chargers"] },
  { id: "parking", label: "parking", words: /\b(park|parking|parking lot|parking structure)\b/, kinds: ["Parking Structures", "Parking Lots"] },
  { id: "bike", label: "bike rack", words: /\b(bike racks?|bicycle racks?|lock my bike)\b/, kinds: ["Bicycle Racks", "Bicycle Enclosures"] },
  { id: "spin", label: "Spin hub", words: /\b(spin|scooters?|e-?bikes?)\b/, kinds: ["SPIN Hubs"] },
  { id: "atm", label: "ATM", words: /\b(atms?|cash)\b/, kinds: ["ATMs"] },
  { id: "mail", label: "mailbox", words: /\b(mail|mailbox|post office|package)\b/, kinds: ["Mail Boxes and Services"] },
  { id: "laundry", label: "laundry room", words: /\b(laundry|washer|dryer)\b/, kinds: ["Laundry"] },
  { id: "lactation", label: "lactation room", words: /\b(lactation|nursing room|pump)\b/, kinds: ["Lactation Rooms"] },
  { id: "period", label: "period product dispenser", words: /\b(period|tampons?|pads?)\b/, kinds: ["Period Product Dispensers"] },
  { id: "shower", label: "shower", words: /\b(showers?)\b/, kinds: ["Showers"] },
  { id: "aed", label: "AED / trauma kit", words: /\b(aed|defibrillator|trauma kit|first aid)\b/, kinds: ["AED/Trauma Kits"] },
  { id: "callbox", label: "emergency call box", words: /\b(call box|blue light|emergency phone)\b/, kinds: ["Call Boxes"] },
  { id: "clinic", label: "clinic", words: /\b(clinic|doctor|health center|medical|urgent care|sick)\b/, kinds: ["Student Health & Well-Being", "Medical Clinics", "Emergency Care"] },
];

export interface NearbyPoint {
  name: string;
  kind: string;
  /** The building it's in, when the campus map says. */
  building: string;
  lngLat: LngLat;
  meters: number;
}

/** The kind a message asks for, by Gemma's word or the message's words. */
export function nearbyKind(what: string): Kind | undefined {
  const text = what.toLowerCase();
  return NEARBY_KINDS.find((k) => k.id === text) ?? NEARBY_KINDS.find((k) => k.words.test(text));
}

/** The closest points of a kind to `at`, straight-line (the route then gives the real walk). */
export function nearest(points: CampusMapPoints | null, kind: Kind, at: LngLat, limit = 3): NearbyPoint[] {
  const wanted = new Set(kind.kinds);
  const sorted = (points?.points ?? [])
    .filter((p) => wanted.has(p[4]) && (!kind.names || p[4] === "Coffee" || kind.names.test(p[3])))
    .map(([lng, lat, , name, pointKind, building]) => ({
      name,
      kind: pointKind,
      building,
      lngLat: [lng, lat] as LngLat,
      meters: distanceMeters([lng, lat], at),
    }))
    .sort((a, b) => a.meters - b.meters);
  // One per name and building: a restroom on each floor of Price Center West is one answer.
  const seen = new Set<string>();
  return sorted.filter((p) => !seen.has(`${p.name}|${p.building}`) && seen.add(`${p.name}|${p.building}`)).slice(0, limit);
}
