/**
 * Answers a food question from today's menu.
 * The student's sentence is the question, not a dish name.
 */

import { money } from "./dining.ts";
import { skillPrompt } from "./skill.ts";
import { budgetOf, dishOf, pricePhrase, recommend, resolveHall, type FoodAsk, type FoodPick, type ScrapedMenus } from "./menus.ts";

export interface FoodAnswer {
  ask: FoodAsk;
  picks: FoodPick[];
  /** The first sentence. Empty when the menu lines already say the whole thing. */
  lead: string;
}

/** A price or a "what should I eat" question. A route or a payment question is not one. A price of $0 is ignored. */
export function answerFood(message: string, menus: ScrapedMenus, now = new Date(), lastPlace?: string | null): FoodAnswer | null {
  const text = message.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
  const budget = budgetOf(text);
  const max = budget.max != null && budget.max > 0 ? budget.max : undefined;
  const min = budget.min != null && budget.min > 0 ? budget.min : undefined;
  const cheapest = /\b(cheapest|lowest(?:\s+price)?|least expensive|most affordable)\b/.test(text);
  const askingMenu = /\b(what(?:'s| is) good|something to eat|cheap(?:est|er)?|recommend|hungry|on the menu)\b/.test(text);
  const wantsFood = askingMenu || cheapest || /\b(foods?|eats?|eating|hungry|meals?|menus?|lunch|dinner|breakfast|dishes?|snacks?)\b/.test(text);
  if (max == null && min == null && !wantsFood) return null;
  if (/\b(dining dollars?|triton dollars?|triton cash|\bebt\b|calfresh)\b/.test(text)) return null;
  if (max == null && min == null && /\b(map me to|map to|take me to|directions to|bring me to|get me to|send me to)\b/.test(text)) return null;

  const hall = resolveHall(text);
  const item = dishOf(text, hall);
  const under = max != null && /\b(?:under|below|less than|cheaper than)\b/.test(text);
  const ask: FoodAsk = {
    hall,
    item,
    minPrice: min,
    maxPrice: max,
    maxInclusive: under ? false : undefined,
    sort: cheapest ? "cheapest" : undefined,
    meals: !item,
    now,
  };
  let picks = recommend(menus, ask, 8);
  let lead = "";
  const checking = /\b(is it|is that|actually|really|for real)\b/.test(text);
  const cafe = checking && lastPlace && !resolveHall(lastPlace) ? `${lastPlace} isn't on the dining-hall menu, so I can't confirm its prices. ` : "";

  if (!picks.length) {
    picks = recommend(menus, { hall, sort: "cheapest", now }, 4);
    const range = pricePhrase(min, max);
    const where = hall ? ` at ${hall}` : "";
    const dish = item ? ` matching “${item}”` : "";
    const top = picks.find((p) => p.price != null);
    lead = `${cafe}Nothing on today's dining menu${where}${dish}${range ? ` is ${range}` : ""}.${top ? ` Closest price: ${top.name} at ${top.hall}, ${money(top.price!)}.` : ""} Dining halls only — I don't have prices for other cafes.`;
    ask.maxPrice = undefined;
    ask.minPrice = undefined;
    ask.item = undefined;
  } else if (cheapest && !item) {
    lead = `${cafe}Here are the cheapest meals on today's dining menus. I'll take you to the nearest hall. Dining halls only — I don't have prices for other cafes.`;
  } else if (!hall && !item) {
    lead = `${cafe}Here's what's on today's dining menus. I'll take you to the nearest hall. Dining halls only — I don't have prices for other cafes.`;
  } else if (cafe) {
    lead = cafe.trim();
  }
  return { ask, picks, lead };
}

const NAV = /\b(?:map(?: me)? to|take me(?: to)?|bring me(?: to)?|get me to|send me to|show me|directions to|route to|navigate to|walk me to|head to|go to|going to)\s+(?:a |an |the )?(.+?)\s*$/;

/**
 * A "take me there" sentence, in any wording the pattern covers.
 * `vagueFood` means they asked for food but did not name a place or a dish.
 */
export function whereTo(message: string): { place: string; vagueFood: boolean } | null {
  const text = message.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
  const budget = budgetOf(text);
  if (budget.max != null || budget.min != null) return null;
  const dest = text.match(NAV)?.[1]?.replace(/[?.!]+$/g, "").trim();
  if (!dest) return null;
  const hall = resolveHall(dest);
  const foodish = /\b(foods?|eats?|eating|dining|restaurants?|hungry|meals?|lunch|dinner|breakfast)\b/.test(dest);
  const dish = dishOf(dest, hall);
  const vagueFood = foodish && !hall && (!dish || !dish.includes(" "));
  return { place: hall ?? dest, vagueFood };
}

/** A dining hall that is actually serving, so an unnamed "food place" still goes somewhere. */
export function pickHall(menus: ScrapedMenus, now = new Date()): string {
  const picks = recommend(menus, { meals: true, sort: "cheapest", now }, 30);
  return picks.find((p) => p.open)?.hall ?? picks[0]?.hall ?? menus.halls[0]?.name ?? "Pines";
}

/** Places and prices Gemma is allowed to copy. The same card is used for every wording. */
export function factCard(menus: ScrapedMenus | null | undefined, now = new Date()): string {
  const meals = menus?.items.length ? recommend(menus, { meals: true, sort: "cheapest", now }, 6) : [];
  const lines = meals.map((p) => `- ${p.name} | ${p.hall} | ${p.price != null ? money(p.price) : "no price"} | ${p.open ? "open" : "closed"}`);
  return [
    "Places: Pines, 64 Degrees, OceanView, Ventanas, Canyon Vista, Foodworx, Bistro, Club Med, Taco Bell, Panda Express, Subway, Burger King, Starbucks, Sunshine Market",
    "Menu:",
    lines.join("\n") || "- none loaded",
    "Payment: Dining Dollars = dining halls and HDH markets. Triton Cash = those plus Panda Express, Subway, Taco Bell, Burger King, Starbucks. EBT = HDH markets only.",
  ].join("\n");
}

/**
 * Instructions for every message. One skill, not a different rule per sentence:
 * the shortest-route skill from .cursor/skills is part of it.
 */
export function turnSkill(): string {
  return [
    "You help a UCSD student. The sentence may be casual, incomplete, or misspelled.",
    "Use only the Facts for food and prices. Do not copy the student's sentence into item or place.",
    "action route: they want to go somewhere. place is the building or place they named (Geisel, Price Center, WLH 2001), as written. Only if they asked for food without naming a place, copy one from Places.",
    "from: where they start, if they said it.",
    "action order: they want what to eat or a price. item is a Menu dish only when they named that dish. Otherwise omit item. Price Center is a place, not a price.",
    "action nearby: they want the closest restroom, water, coffee, or food.",
    "reply is two sentences using the Facts.",
    skillPrompt(),
  ].join("\n");
}

/**
 * The only instructions Gemma gets on a food turn. Routes go through turnSkill, which carries
 * the shortest-route skill; the long navigation prompt is too much for a menu question.
 */
export function foodSkill(): string {
  return [
    "You fill one JSON object for a UCSD dining question.",
    "The user message already has the fields and the only menu you may use.",
    "Copy action, item, place, and maxPrice from that message.",
    "reply is two sentences. Use dish names and prices from Menu only.",
    "Do not invent a dish or a price.",
  ].join("\n");
}

/**
 * The user turn sent to the model. The blanks come first, then the menu, then the
 * sentence. A small model copies the blanks instead of guessing a dish and a price.
 */
export function formatQuestion(message: string, found: FoodAnswer): string {
  const lines = found.picks.slice(0, 8).map((p) => {
    const price = p.price != null ? money(p.price) : "no price";
    const when = p.open ? "open" : "closed";
    return `- ${p.name} | ${p.hall} | ${price} | ${when}`;
  });
  const price = found.ask.maxPrice != null
    ? `maxPrice: ${found.ask.maxPrice}${found.ask.maxInclusive === false ? " (under this, so this price itself is too much)" : ""}`
    : "maxPrice: omit";
  const item = found.ask.item ? `item: ${found.ask.item}` : "item: omit";
  const place = found.ask.hall ? `place: ${found.ask.hall}` : "place: omit";
  const asked = found.ask.item
    ? `Student asked: ${message.trim()}`
    : found.ask.sort === "cheapest"
      ? "Student asked for the cheapest food. They did not name a dish."
      : found.ask.maxPrice != null
        ? `Student asked for food under $${found.ask.maxPrice}. They did not name a dish.`
        : "Student asked for food. They did not name a dish or a budget.";
  return [
    "Fill this JSON in. Copy the fields. Do not guess a dish or a price.",
    "action: order",
    item,
    place,
    price,
    "reply: two sentences. Name dishes and prices copied from Menu. Say you will take them to the nearest hall.",
    "",
    "Menu:",
    lines.join("\n") || "- none",
    "",
    asked,
  ].join("\n");
}

/** The model's sentence, when it actually used the menu. Otherwise the menu text stands. */
export function usableReply(reply: string | undefined, picks: FoodPick[]): string | undefined {
  if (!reply) return undefined;
  const text = reply.replace(/\s+/g, " ").trim();
  if (text.length < 20 || text.length > 360) return undefined;
  if (/find that|under \$0|nothing costs/i.test(text)) return undefined;
  if (!picks.some((p) => text.toLowerCase().includes(p.name.toLowerCase()))) return undefined;
  const amounts = text.match(/\$\d+(?:\.\d+)?/g) ?? [];
  for (const amount of amounts) {
    const n = Number(amount.slice(1));
    if (!picks.some((p) => p.price != null && Math.abs(p.price - n) < 0.001)) return undefined;
  }
  return text;
}
