/**
 * Today's HDH menus from the scraper (`menus.json`), so the chat can
 * recommend dishes in a price range and point at the station that serves them.
 * Hours, open/closed, and which day to read come from diningMenu.ts.
 */

import { hdhHalls } from "@campus/core";
import { hoursOn, isOpenAt, mealOrder, menuDate } from "./diningMenu.ts";

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
  /** Dishes to keep from each hall when none is named. Default 3, so one hall doesn't fill the list. */
  perHall?: number;
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
  { name: "Bistro", alias: "strand" },
  { name: "OceanView", alias: "ocean view" },
  { name: "OceanView", alias: "oceanview" },
  { name: "OceanView", alias: "marshall" },
  { name: "Club Med", alias: "school of medicine" },
  { name: "Club Med", alias: "club med" },
  { name: "Ventanas", alias: "cafe ventanas" },
  { name: "Ventanas", alias: "erc" },
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
  "dude", "bro", "bruh", "lol", "lmao", "ngl", "lowkey", "highkey", "whatever", "basically",
  "gimme", "give", "just", "that", "this", "or", "actually", "really", "very", "kinda", "sorta",
]);

/**
 * What an HDH category is, from classifying today's menus with the local
 * model (Qwen). add-on is a sauce, topping, extra, protein, or BYO base —
 * ranch is here, a burrito is not.
 */
export type FoodKind = "meal" | "side" | "drink" | "dessert" | "addon";

const FOOD_KIND: Record<string, FoodKind> = {
  appetizers: "meal",
  "bagel bar": "meal",
  base: "addon",
  beverages: "drink",
  bowls: "meal",
  breads: "side",
  "breakfast a la carte": "addon",
  "breakfast bowls": "meal",
  "breakfast burrito": "meal",
  "breakfast cravings": "meal",
  "breakfast sandwiches": "meal",
  "breakfast specials": "meal",
  "build your own": "addon",
  "burger styles": "meal",
  burgers: "meal",
  burritos: "meal",
  combos: "meal",
  desserts: "dessert",
  "detroit pizza": "meal",
  "dinner specials": "meal",
  extras: "addon",
  "grab n go": "meal",
  "ice cream": "dessert",
  loaded: "meal",
  "menu items": "addon",
  nachos: "meal",
  oatmeal: "meal",
  "pasta bowls": "meal",
  pizza: "meal",
  "pizza slices": "meal",
  plates: "meal",
  "poke bowls": "meal",
  proteins: "addon",
  quesadillas: "meal",
  "salad byo base": "addon",
  salads: "meal",
  "sandwiches & more": "meal",
  sauces: "addon",
  "side salads": "side",
  sides: "side",
  "small plates": "meal",
  soups: "meal",
  specials: "meal",
  "specialty bowls": "meal",
  "sushi rolls": "meal",
  tacos: "meal",
  toppings: "addon",
  wings: "meal",
  wrap: "meal",
};

/** HDH category → meal, side, drink, dessert, or add-on. Unknown names stay meals. */
export function foodKind(category: string): FoodKind {
  return FOOD_KIND[category.trim().toLowerCase()] ?? "meal";
}

export function pricePhrase(min?: number, max?: number): string {
  if (min != null && max != null) return `${dollars(min)}–${dollars(max)}`;
  if (max != null) return `under ${dollars(max)}`;
  if (min != null) return `at least ${dollars(min)}`;
  return "";
}

function dollars(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

const HALL_NAMES = new Set(hdhHalls());

/** A hall from the menu file. Nicknames that aren't one of those halls don't match. */
export function resolveHall(text: string): string | undefined {
  const hits = HALL_ALIASES.filter((entry) => HALL_NAMES.has(entry.name) && hasAlias(text, entry.alias)).sort(
    (a, b) => b.alias.length - a.alias.length,
  );
  return hits[0]?.name;
}

const CASH_WORD = "one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty";
const CASH_AMOUNT = `(?:\\d+(?:\\.\\d+)?|${CASH_WORD})`;
const CASH_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20,
};

function cashAmount(raw: string): number | undefined {
  if (CASH_WORDS[raw] != null) return CASH_WORDS[raw];
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** "under $10", "between 5 and 12", "cheap", "under ten dollars" -> a dollar range. */
export function budgetOf(text: string): { min?: number; max?: number } {
  const between = text.match(new RegExp(String.raw`\bbetween\s+\$?(${CASH_AMOUNT})\s+and\s+\$?(${CASH_AMOUNT})`));
  if (between) {
    const min = cashAmount(between[1]);
    const max = cashAmount(between[2]);
    if (min != null && max != null) return ordered(min, max);
  }
  const under = text.match(new RegExp(String.raw`\b(?:under|below|less than|cheaper than|up to|at most|max(?:imum)?(?:\s+price)?)\s+\$?\s*(${CASH_AMOUNT})\b\s*\$?`));
  const over = text.match(new RegExp(String.raw`\b(?:over|above|more than|at least)\s+\$?(${CASH_AMOUNT})\b`));
  const range: { min?: number; max?: number } = {};
  const underAmount = under ? cashAmount(under[1]) : undefined;
  const overAmount = over ? cashAmount(over[1]) : undefined;
  if (underAmount != null) range.max = underAmount;
  if (overAmount != null) range.min = overAmount;
  if (range.min == null && range.max == null && /\bcheap(?:est)?\b|\bbroke\b/.test(text)) range.max = 10;
  const cash = text.match(new RegExp(String.raw`\b(${CASH_AMOUNT})\s*(?:bucks|dollars?)\b`));
  const cashValue = cash ? cashAmount(cash[1]) : undefined;
  if (range.max == null && cashValue != null) range.max = cashValue;
  return range;
}

/** Dish words left after the hall, the budget, and filler are removed. */
export function dishOf(text: string, hall?: string): string | undefined {
  let dish = text.toLowerCase();
  if (hall) {
    for (const entry of HALL_ALIASES.filter((e) => e.name === hall)) dish = dish.replace(new RegExp(escapeReg(entry.alias), "g"), " ");
  }
  dish = dish
    .replace(/\bbetween\s+\$?\d+(?:\.\d+)?\s+and\s+\$?\d+(?:\.\d+)?/g, " ")
    .replace(new RegExp(String.raw`\b(?:under|below|less than|cheaper than|up to|at most|over|above|more than|at least|max(?:imum)?(?:\s+price)?)\s+\$?\s*${CASH_AMOUNT}\b\s*\$?`, "g"), " ")
    .replace(new RegExp(String.raw`\b${CASH_AMOUNT}\s*(?:bucks|dollars?)\b`, "g"), " ")
    .replace(/\$\d+(?:\.\d+)?/g, " ");
  for (const word of [
    "how much", "how long", "what should i", "what's", "whats", "what is", "is", "are", "a", "an", "the", "at", "for", "from",
    "price", "cost", "costs", "order", "menu", "please", "i want", "i need", "something", "best", "good", "cheap", "cheapest", "recommend",
    "me", "some", "food", "to eat", "eat", "eating", "get", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "and", "with", "under", "dollars", "dollar", "bucks",
    "heading", "toward", "towards", "going", "make", "it", "i'm", "im", "i've", "ive", "starving", "broke", "can", "got", "like", "only", "on", "to", "way", "route", "class",
    "open", "closed", "hours", "lunch", "dinner", "breakfast",
    "dude", "bro", "bruh", "yo", "lol", "lmao", "ngl", "lowkey", "highkey", "whatever", "that", "this",
    "ok", "okay", "so", "basically", "gimme", "give", "just", "tbh", "kinda", "sorta", "ugh", "man",
    "hey", "hi", "or", "actually", "now", "right", "really", "very", "even", "know", "want", "wanna", "but", "also",
  ]) {
    dish = dish.replace(new RegExp(`\\b${word}\\b`, "g"), " ");
  }
  const words = dish.replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((w) => w.length > 1 && !GENERIC.has(w) && !/^\d+$/.test(w));
  const item = words.join(" ");
  if (words.length > 4 || /\b(going|route|from|anything|near|pepper|canyon)\b/.test(item)) return undefined;
  return item.length > 2 ? item : undefined;
}

/** Priced dishes from today's scraped menu that fit the ask, open stations first. */
export function recommend(menus: ScrapedMenus, ask: FoodAsk, limit = 12): FoodPick[] {
  const now = ask.now ?? new Date();
  const date = menuDate(menus, now);
  const meals = mealOrder(now);
  const words = ask.item ? stems(ask.item) : [];
  const hallName = ask.hall ? menus.halls.find((h) => h.name === ask.hall)?.name : undefined;
  const scored: { pick: FoodPick; meal: number; match: number }[] = [];

  for (const item of menus.items) {
    if (item.date !== date) continue;
    if (hallName && item.hall !== hallName) continue;
    if (ask.minPrice != null && (item.price == null || item.price < ask.minPrice)) continue;
    if (ask.maxPrice != null && (item.price == null || (ask.maxInclusive === false ? item.price >= ask.maxPrice : item.price > ask.maxPrice))) continue;
    if (item.price == null && (ask.minPrice != null || ask.maxPrice != null || words.length === 0)) continue;
    // "What's good" is a plate. Ranch, naan, and cookies wait until they're named.
    if (!words.length && foodKind(item.category) !== "meal") continue;
    const match = words.length ? scoreDish(item.name, words) : 1;
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
    if (!ask.hall) {
      const count = perHall.get(row.pick.hall) ?? 0;
      if (count >= (ask.perHall ?? 3)) continue;
      perHall.set(row.pick.hall, count + 1);
    }
    unique.push(row.pick);
    if (unique.length >= limit) break;
  }
  return unique;
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

export function stems(query: string): string[] {
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

/** How well a dish name matches the words, 0–100. 50 means at least half the words hit. */
export function scoreDish(name: string, words: string[]): number {
  const stemmed = name.toLowerCase().split(/\s+/).map(stem).join(" ");
  if (stemmed === words.join(" ")) return 100;
  if (words.every((w) => stemmed.includes(w))) return 80;
  const hits = words.filter((w) => stemmed.includes(w)).length;
  return words.length ? (hits / words.length) * 50 : 0;
}
