/**
 * Today's HDH menus from the scraper (`menus.json`), so the chat can
 * recommend dishes in a price range and point at the station that serves them.
 */

export interface ScrapedHours {
  day: string;
  open: string;
  close: string;
}

export interface ScrapedStation {
  name: string;
  hours: ScrapedHours[];
}

export interface ScrapedHall {
  name: string;
  stations: ScrapedStation[];
}

export interface ScrapedItem {
  date: string;
  hall: string;
  station: string;
  meal: string;
  category: string;
  name: string;
  price: number | null;
}

/** The fields the chat reads out of `menus.json`. */
export interface ScrapedMenus {
  days: { date: string }[];
  halls: ScrapedHall[];
  items: ScrapedItem[];
}

export interface FoodAsk {
  hall?: string;
  /** Dish words, such as "burrito". Generic words ("food", "best") are ignored. */
  item?: string;
  minPrice?: number;
  maxPrice?: number;
  /** False for "under $10", so $10.00 itself is left out. */
  maxInclusive?: boolean;
  /** "cheapest" lists the lowest prices. The default prefers the current meal. */
  sort?: "cheapest";
  /** No dish was named, so sauces, sides, and whole fruit are not answers. */
  meals?: boolean;
  now?: Date;
}

export interface FoodPick {
  hall: string;
  station: string;
  meal: string;
  category: string;
  name: string;
  price: number | null;
  /** When that station is open today, or "Closed". */
  hours: string | null;
  open: boolean;
}

const WEEK = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Longest alias wins, so "restaurants at sixth" beats "sixth". */
const HALL_ALIASES: { name: string; alias: string }[] = [
  { name: "64 Degrees", alias: "64 degrees" },
  { name: "64 Degrees", alias: "sixty four" },
  { name: "64 Degrees", alias: "revelle" },
  { name: "64 Degrees", alias: "64" },
  { name: "Canyon Vista Marketplace", alias: "canyon vista" },
  { name: "Cecil's at Faculty Club", alias: "faculty club" },
  { name: "Cecil's at Faculty Club", alias: "cecil" },
  { name: "Restaurants at Sixth College", alias: "restaurants at sixth" },
  { name: "Restaurants at Sixth College", alias: "sixth" },
  { name: "Restaurants at Sixth College", alias: "crave" },
  { name: "Goody's Marketplace", alias: "goody's" },
  { name: "Goody's Marketplace", alias: "goodys" },
  { name: "Goody's Marketplace", alias: "goody" },
  { name: "OceanView", alias: "ocean view" },
  { name: "OceanView", alias: "oceanview" },
  { name: "Club Med", alias: "club med" },
  { name: "Foodworx", alias: "food worx" },
  { name: "Foodworx", alias: "foodworx" },
  { name: "Ventanas", alias: "ventanas" },
  { name: "Pines", alias: "pines" },
  { name: "Pines", alias: "muir" },
  { name: "Bistro", alias: "bistro" },
];

const GENERIC = new Set([
  "food", "meal", "meals", "something", "good", "best", "cheap", "eat", "get", "lunch", "dinner",
  "breakfast", "item", "dish", "things", "thing", "recommend", "recommendation", "suggestion",
  "hungry", "please", "some", "menu", "today", "open", "now",
  "find", "that", "thats", "place", "places", "nearest", "closest", "actually", "really",
  "want", "need", "looking", "show", "give", "anything", "where", "which", "what", "who",
  "cheapest", "cheaper", "lowest", "least", "affordable", "inexpensive", "expensive", "foods",
]);

export function pricePhrase(min?: number, max?: number): string {
  if (min != null && max != null) return `${dollars(min)}–${dollars(max)}`;
  if (max != null) return `under ${dollars(max)}`;
  if (min != null) return `at least ${dollars(min)}`;
  return "";
}

function dollars(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** Campus-map name when it isn't the hall's name. */
export const HALL_PLACE: Record<string, string> = {
  Bistro: "The Bistro at the Strand",
  "Cecil's at Faculty Club": "Ida and Cecil Green Faculty Club",
  "Restaurants at Sixth College": "Crave",
};

export function resolveHall(text: string): string | undefined {
  const hits = HALL_ALIASES.filter((entry) => hasAlias(text, entry.alias)).sort((a, b) => b.alias.length - a.alias.length);
  return hits[0]?.name;
}

/** "under $10", "between 5 and 12", "cheap" -> a dollar range. */
export function budgetOf(text: string): { min?: number; max?: number } {
  const between = text.match(/\bbetween\s+\$?(\d+(?:\.\d+)?)\s+and\s+\$?(\d+(?:\.\d+)?)/);
  if (between) return ordered(Number(between[1]), Number(between[2]));
  const under = text.match(/\b(?:under|below|less than|cheaper than|up to|at most|max(?:imum)?(?:\s+price)?)\s+\$?(\d+(?:\.\d+)?)/);
  const over = text.match(/\b(?:over|above|more than|at least)\s+\$?(\d+(?:\.\d+)?)/);
  const range: { min?: number; max?: number } = {};
  if (under) range.max = Number(under[1]);
  if (over) range.min = Number(over[1]);
  if (range.min == null && range.max == null && /\bcheap\b/.test(text)) range.max = 10;
  return range;
}

/** Dish words left after the hall, the budget, and filler are removed. */
export function dishOf(text: string, hall?: string): string | undefined {
  let dish = text.toLowerCase().replace(/[’']/g, "");
  if (hall) {
    for (const entry of HALL_ALIASES.filter((e) => e.name === hall)) dish = dish.replace(new RegExp(escapeReg(entry.alias), "g"), " ");
  }
  dish = dish
    .replace(/\bbetween\s+\$?\d+(?:\.\d+)?\s+and\s+\$?\d+(?:\.\d+)?/g, " ")
    .replace(/\b(?:under|below|less than|cheaper than|up to|at most|over|above|more than|at least|max(?:imum)?(?:\s+price)?)\s+\$?\d+(?:\.\d+)?/g, " ")
    .replace(/\$\d+(?:\.\d+)?/g, " ");
  for (const word of [
    "how much", "how long", "what should i", "what's", "whats", "what is", "is", "are", "a", "an", "the", "at", "for", "from",
    "price", "cost", "costs", "order", "menu", "please", "i want", "i need", "something", "best", "good", "cheap", "recommend",
    "me", "some", "food", "foods", "to eat", "eat", "get", "two", "three", "four", "five", "and", "with", "under", "dollars", "dollar", "bucks",
    "cheapest", "cheaper", "lowest", "least expensive", "most affordable", "inexpensive", "expensive",
  ]) {
    dish = dish.replace(new RegExp(`\\b${word}\\b`, "g"), " ");
  }
  const words = dish.replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((w) => w.length > 2 && !GENERIC.has(w) && !GENERIC.has(stem(w)) && !/^\d+$/.test(w));
  const item = words.join(" ");
  return item.length > 2 ? item : undefined;
}

/** Priced dishes from today's scraped menu that fit the ask, open stations first. */
export function recommend(menus: ScrapedMenus, ask: FoodAsk, limit = 12): FoodPick[] {
  const now = ask.now ?? new Date();
  const date = menuDay(menus, now);
  const meals = preferredMeals(now);
  const words = ask.item ? stems(ask.item) : [];
  const hallName = ask.hall ? menus.halls.find((h) => h.name === ask.hall)?.name : undefined;
  const scored: { pick: FoodPick; meal: number; match: number }[] = [];

  for (const item of menus.items) {
    if (item.date !== date) continue;
    if (hallName && item.hall !== hallName) continue;
    if (ask.meals && !isMeal(item)) continue;
    if (ask.minPrice != null && (item.price == null || item.price < ask.minPrice)) continue;
    if (ask.maxPrice != null && (item.price == null || (ask.maxInclusive === false ? item.price >= ask.maxPrice : item.price > ask.maxPrice))) continue;
    if (item.price == null && (ask.minPrice != null || ask.maxPrice != null || words.length === 0)) continue;
    const match = words.length ? nameScore(item.name, words) : 1;
    if (words.length && match < 50) continue;
    const station = menus.halls.find((h) => h.name === item.hall)?.stations.find((s) => s.name === item.station);
    const hours = station ? hoursOn(station, date) : null;
    scored.push({
      pick: {
        hall: item.hall,
        station: item.station,
        meal: item.meal,
        category: item.category,
        name: item.name,
        price: item.price,
        hours,
        open: station ? isOpenAt(station, date, now) : false,
      },
      meal: meals.indexOf(item.meal),
      match,
    });
  }

  scored.sort((a, b) => {
    if (ask.sort === "cheapest") {
      if (a.pick.open !== b.pick.open) return a.pick.open ? -1 : 1;
      const ap = a.pick.price ?? Number.POSITIVE_INFINITY;
      const bp = b.pick.price ?? Number.POSITIVE_INFINITY;
      if (ap !== bp) return ap - bp;
      return a.pick.name.localeCompare(b.pick.name);
    }
    if (a.pick.open !== b.pick.open) return a.pick.open ? -1 : 1;
    const am = a.meal < 0 ? 9 : a.meal;
    const bm = b.meal < 0 ? 9 : b.meal;
    if (am !== bm) return am - bm;
    if (a.match !== b.match) return b.match - a.match;
    const ap = a.pick.price ?? 0;
    const bp = b.pick.price ?? 0;
    if (ap !== bp) return ask.maxPrice != null ? bp - ap : ap - bp;
    return a.pick.name.localeCompare(b.pick.name);
  });

  const unique: FoodPick[] = [];
  const seen = new Set<string>();
  const perHall = new Map<string, number>();
  for (const row of scored) {
    const key = `${row.pick.hall}|${row.pick.name}|${row.pick.price ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!ask.hall && ask.sort !== "cheapest") {
      const count = perHall.get(row.pick.hall) ?? 0;
      if (count >= 3) continue;
      perHall.set(row.pick.hall, count + 1);
    }
    unique.push(row.pick);
    if (unique.length >= limit) break;
  }
  return unique;
}

const NOT_A_MEAL = new Set([
  "Sauces", "Sides", "Extras", "Beverages", "Base", "Proteins",
  "Build Your Own", "Burger Styles", "Breakfast A La Carte", "Menu Items", "Side Salads",
  "Desserts", "Ice Cream",
]);

/** A plate, bowl, slice, or sandwich. Not ranch, a banana, or a slice of cheese. */
function isMeal(item: ScrapedItem): boolean {
  if (NOT_A_MEAL.has(item.category)) return false;
  if (/^fruit,/i.test(item.name)) return false;
  return true;
}

function ordered(a: number, b: number): { min: number; max: number } {
  return a <= b ? { min: a, max: b } : { min: b, max: a };
}

function hasAlias(text: string, alias: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${escapeReg(alias)}(?=$|[^a-z0-9])`, "i").test(text);
}

function escapeReg(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stems(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map(stem)
    .filter((w) => w.length > 2 && !GENERIC.has(w));
}

function stem(word: string): string {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

function nameScore(name: string, words: string[]): number {
  const stemmed = name.toLowerCase().split(/\s+/).map(stem).join(" ");
  if (stemmed === words.join(" ")) return 100;
  if (words.every((w) => stemmed.includes(w))) return 80;
  const hits = words.filter((w) => stemmed.includes(w)).length;
  return words.length ? (hits / words.length) * 50 : 0;
}

function localDate(now: Date): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

function weekday(iso: string): string {
  return WEEK[new Date(`${iso}T12:00:00`).getDay()];
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, (d ?? 1) + days);
  return localDate(date);
}

function menuDay(menus: ScrapedMenus, now: Date): string {
  const today = localDate(now);
  if (menus.days.some((d) => d.date === today) || menus.items.some((i) => i.date === today)) return today;
  const same = menus.days.find((d) => weekday(d.date) === WEEK[now.getDay()]);
  return same?.date ?? menus.days[0]?.date ?? today;
}

function preferredMeals(now: Date): string[] {
  const hour = now.getHours();
  if (hour < 11) return ["Breakfast", "Brunch", "Lunch", "Lunch Dinner", "Dinner", "Late Night"];
  if (hour < 16) return ["Lunch", "Brunch", "Lunch Dinner", "Dinner", "Late Night", "Breakfast"];
  return ["Dinner", "Late Night", "Lunch Dinner", "Lunch", "Brunch", "Breakfast"];
}

function hoursOn(station: ScrapedStation, iso: string): string | null {
  const row = station.hours.find((h) => h.day === weekday(iso));
  if (!row) return null;
  if (row.open === "Closed" || row.close === "Closed") return "Closed";
  return `${row.open} – ${row.close}`;
}

function isOpenAt(station: ScrapedStation, iso: string, now: Date): boolean {
  const row = station.hours.find((h) => h.day === weekday(iso));
  if (row && spans(row, now, false)) return true;
  const yesterday = station.hours.find((h) => h.day === weekday(addDays(iso, -1)));
  return !!yesterday && spans(yesterday, now, true);
}

function spans(row: ScrapedHours, now: Date, overnightOnly: boolean): boolean {
  if (row.open === "Closed" || row.close === "Closed") return false;
  const open = clockMinutes(row.open);
  const close = clockMinutes(row.close);
  if (open == null || close == null) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  if (close > open) return !overnightOnly && cur >= open && cur < close;
  if (close === open) return false;
  return overnightOnly ? cur < close : cur >= open;
}

function clockMinutes(label: string): number | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(label.trim());
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + Number(match[2]);
}
