import type { LngLat, Place } from "./types.ts";

/**
 * Places to search for beyond buildings and rooms: food, and places to swim, play and work out.
 *
 * Two sources:
 *   - UCSD's campus map points (apps/web/public/data/campus-places.json): restaurants, dining halls, cafés, markets,
 *     courts, fields, pools;
 *   - the official food lists (October 2026), for what the campus map leaves out: HDH Dining's restaurants and
 *     markets with the stations inside them (hdh-web.ucsd.edu/dining/apps/diningservices), and University Centers'
 *     eateries in Price Center, the Student Center and the Student Services Center
 *     (universitycenters.ucsd.edu/dining-and-retail).
 */

/** UCSD's campus map points: [lng, lat, category index, name, kind, building]. */
export interface CampusMapPoints {
  points: [number, number, number, string, string, string][];
}

/** Campus map kinds you can search for. */
const SEARCHABLE = new Set([
  "Cafes and Restaurants",
  "Dining Halls",
  "Coffee",
  "Markets",
  "Recreation Facilities",
  "Athletic Facilities",
]);

/** A food place from the official lists, placed at `near`: a campus map point in the same spot. */
interface FoodPlace {
  name: string;
  near: string;
  /** `near` is this same place under its campus map name ("Rogers Market" is "Roger's Place and Market"). */
  same?: boolean;
  /** Also found by: a station's own name ("Breeze" for "Breeze at Pines"). */
  aliases?: string[];
  note?: string;
}

/**
 * HDH halls and markets: the campus map point for each, and the stations inside.
 * `same` when that point is the hall itself; `at` names the hall in its stations' names.
 */
const HDH: { hall: string; near: string; same?: boolean; at?: string; stations: string[] }[] = [
  { hall: "64 Degrees", near: "64 Degrees", same: true, stations: ["Al Dente", "Garden Bar", "Taqueria", "Triton Grill", "Umi", "Wok This Way"] },
  { hall: "Bistro", near: "The Bistro at the Strand", same: true, stations: ["The Bistro Sushi"] },
  { hall: "Canyon Vista Marketplace", near: "Canyon Vista Marketplace", same: true, stations: ["360", "Earl's Coffeehouse", "Fresh", "Fusion Grill", "Quick Service"] },
  { hall: "Cecil's at Faculty Club", near: "Ida and Cecil Green Faculty Club", same: true, stations: [] },
  { hall: "Club Med", near: "Club Med", same: true, stations: [] },
  { hall: "Foodworx", near: "Foodworx", same: true, stations: ["Foodworx Deli & Salad", "Foodworx Impinger", "Foodworx Salad BYO", "Foodworx Sandwich BYO"] },
  { hall: "OceanView", near: "OceanView", same: true, stations: ["Counter Culture", "Scholar's Italian", "Scholar's Pizza", "Spice"] },
  { hall: "Pines", near: "Pines", same: true, stations: ["Breeze", "Char", "Current", "Heat", "Morning Fog", "Pacific Coast Hwy", "Slice at Pines", "Street Eats"] },
  { hall: "Restaurants at Sixth College", near: "Crave", at: "Sixth College", stations: ["Crave", "Makai", "Noodles", "Rooftop", "Wolftown Latin", "Wolftown Street"] },
  { hall: "Ventanas", near: "Ventanas", same: true, stations: ["HaPi", "Journey", "Kaldi", "Soul", "Tandoor", "Vibe"] },
  { hall: "Audrey's Cafe", near: "Audrey’s", same: true, stations: [] },
  { hall: "Goody's Marketplace", near: "Goody's Marketplace", same: true, stations: [] },
  { hall: "Rogers Market", near: "Roger's Place and Market", same: true, stations: ["Rogers Market Coffeehouse"] },
  { hall: "Seventh Market Coffeehouse", near: "Seventh Market", same: true, at: "Seventh Market", stations: ["Seventh Market Northside Deli"] },
  { hall: "Sixth Market", near: "Sixth Market", same: true, stations: ["Sixth Market Coffeehouse"] },
  { hall: "Sunshine Market", near: "Sunshine Market", same: true, stations: [] },
];

/** University Centers eateries, by the campus map point of a neighbour in the same building. */
const UNIVERSITY_CENTERS: { building: string; near: string; places: string[] }[] = [
  {
    building: "Price Center",
    near: "Panda Express",
    places: [
      "Burger King", "Curry Up Now", "Dirty Birds", "FlavorFull", "Panda Express", "Santorini Greek Island Grill",
      "Starbucks", "Subway", "Su Pan Bakery", "Sun Dry: Home of Asian Snacks", "Taco Bell", "Tapioca Express",
      "Zanzibar Café at The Loft",
    ],
  },
  { building: "Student Center", near: "Blue Pepper Asian Cuisine", places: ["Food Co-op"] },
  { building: "Student Services Center", near: "Croutons", places: ["Croutons", "Yogurt World"] },
];

/** Every food place on the official lists. */
export const OFFICIAL_FOOD: FoodPlace[] = [
  ...HDH.flatMap(({ hall, near, same, at = hall, stations }): FoodPlace[] => [
    { name: hall, near, same },
    // "Breeze at Pines", so it's clear where it is; "Slice at Pines" already says.
    ...stations.map((s) => (s.includes(at) ? { name: s, near, note: `At ${hall}` } : { name: `${s} at ${at}`, near, aliases: [s], note: `At ${hall}` })),
  ]),
  ...UNIVERSITY_CENTERS.flatMap(({ building, near, places }) => places.map((name) => ({ name, near, note: building }))),
  // Places the campus map has under other or older names.
  { name: "Jamba", near: "Jamba Juice", same: true },
  { name: "Lemongrass", near: "Lemongrass Farm Fresh Plates", same: true },
  { name: "Blue Pepper Cuisine", near: "Blue Pepper Asian Cuisine", same: true },
  { name: "IPO Fusion BBQ", near: "IPO Hawaiian BBQ", same: true },
];

/**
 * Search places from the campus map and the official food lists. Points with the same name ("Basketball Court")
 * are one place: a route goes to the nearest. A food place the campus map already has, under any of its names, is
 * that place, found by both names.
 */
export function campusMapPlaces(data: CampusMapPoints | null | undefined): Place[] {
  const byName = new Map<string, Place>();
  for (const [lng, lat, , name, kind] of data?.points ?? []) {
    if (!SEARCHABLE.has(kind)) continue;
    const at: LngLat = [lng, lat];
    const place = byName.get(name);
    if (place) {
      place.points.push(at);
      continue;
    }
    const pool = /aquatic|natatorium/i.test(name) ? ["pool"] : [];
    byName.set(name, { id: `campus:${name}`, name, aliases: [kind, ...pool], points: [at], kind: "campus", note: kind });
  }
  const known = new Map([...byName.values()].map((p) => [nameKey(p.name), p]));
  for (const food of OFFICIAL_FOOD) {
    const near = byName.get(food.near);
    if (!near) continue;
    const existing = food.same ? near : [food.name, ...(food.aliases ?? [])].map((n) => known.get(nameKey(n))).find(Boolean);
    if (existing) {
      if (nameKey(existing.name) !== nameKey(food.name)) existing.aliases.push(food.name);
      continue;
    }
    const place: Place = {
      id: `campus:${food.name}`,
      name: food.name,
      aliases: food.aliases ?? [],
      points: [near.points[0]],
      kind: "campus",
      note: food.note ?? "Food",
    };
    byName.set(food.name, place);
    known.set(nameKey(food.name), place);
  }
  return [...byName.values()];
}

/** HDH hall names, as the menu file spells them. */
export function hdhHalls(): string[] {
  return HDH.map((h) => h.hall);
}

/**
 * Campus-map name for an HDH hall. The hall's own name when the map uses that
 * ("Pines"); the map's name when it doesn't ("Bistro" is "The Bistro at the Strand").
 */
export function diningPin(hall: string): string {
  const key = nameKey(hall);
  return HDH.find((h) => nameKey(h.hall) === key)?.near ?? hall;
}

/** Names compared without case, accents or punctuation: "Zanzibar Café" is "Zanzibar Cafe", "Audrey's" is "Audrey’s". */
export function nameKey(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
