/**
 * Triton2Go, the way HDH describes it, plus today's public menu prices.
 * The app does not sign into a student's order. A clock time in Triton2Go is when
 * the kitchen is allowed to see the ticket, not when the food is ready.
 */

export interface DiningHall {
  name: string;
  /** What campus search should route to. */
  place: string;
  locId: string;
  locDetId: string;
  aliases: string[];
}

export interface MenuItem {
  name: string;
  /** Dollars, when the menu lists a price. Some dining-hall plates don't. */
  price?: number;
}

export interface Menu {
  hall: DiningHall;
  hours: string;
  items: MenuItem[];
}

/** Refundable hold per Triton2Go box. Returned when the box goes back to a machine. */
export const BOX_DEPOSIT = 5;

/**
 * Packed in a Triton2Go box except soups, drinks, pizza, burritos, wraps,
 * sandwiches, and pastry (HDH's own exception list).
 */
const NO_BOX = /soup|beverage|drink|coffee|tea|boba|matcha|soda|juice|water|pizza|burrito|wrap|sandwich|pastry|cookie|muffin|croissant|bagel/i;
/** HDH says these are made to order, so they take longer than a fast station. */
const MADE_TO_ORDER = /bistro|burger|hot dog|sandwich|quesadilla|omelet/i;

export const HALLS: DiningHall[] = [
  { name: "64 Degrees", place: "64 Degrees", locId: "2", locDetId: "37", aliases: ["64", "revelle", "sixty four"] },
  { name: "Pines", place: "Pines", locId: "3", locDetId: "6", aliases: ["muir", "pines"] },
  { name: "OceanView", place: "OceanView", locId: "8", locDetId: "8", aliases: ["oceanview", "ocean view", "marshall"] },
  { name: "Ventanas", place: "Ventanas", locId: "9", locDetId: "52", aliases: ["ventanas", "cafe ventanas", "erc"] },
  { name: "The Bistro", place: "The Bistro", locId: "13", locDetId: "27", aliases: ["bistro", "strand"] },
  { name: "Foodworx", place: "Foodworx", locId: "14", locDetId: "13", aliases: ["foodworx", "food worx", "warren"] },
  { name: "Restaurants at Sixth", place: "Crave", locId: "4", locDetId: "30", aliases: ["sixth", "crave", "restaurants at sixth"] },
  { name: "Club Med", place: "Club Med", locId: "12", locDetId: "14", aliases: ["club med", "school of medicine"] },
];

const cache = new Map<string, Promise<Menu>>();

export function hallNamed(text: string): DiningHall | undefined {
  const q = text.toLowerCase();
  return HALLS.find((h) => [h.name, h.place, ...h.aliases].some((n) => q.includes(n.toLowerCase())));
}

/** Items and hours from an HDH Venue page. Each dish is listed twice; one copy is kept. */
export function parseMenu(html: string, hall: DiningHall): Menu {
  const hours = html.match(/id="station-hours">\s*([^<]+)/)?.[1]?.replace(/\s+/g, " ").trim() || "Hours aren't listed";
  const seen = new Set<string>();
  const items: MenuItem[] = [];
  const row = /class="sublocsitem"[^>]*>([^<]+)[\s\S]*?class="item-price"[^>]*>\s*(\$[\d.]+)?/g;
  for (const match of html.matchAll(row)) {
    const name = match[1].replace(/\s+/g, " ").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const price = match[2] ? Number(match[2].slice(1)) : undefined;
    items.push(price !== undefined && Number.isFinite(price) ? { name, price } : { name });
  }
  return { hall, hours, items };
}

export function loadMenu(hall: DiningHall): Promise<Menu> {
  const hit = cache.get(hall.name);
  if (hit) return hit;
  const pending = fetch(`/hdh/dining/apps/diningservices/Restaurants/Venue_V3?locId=${hall.locId}&locDetID=${hall.locDetId}&dayNum=0`)
    .then((res) => {
      if (!res.ok) throw new Error(`HDH menu HTTP ${res.status}`);
      return res.text();
    })
    .then((html) => parseMenu(html, hall));
  cache.set(hall.name, pending);
  pending.catch(() => cache.delete(hall.name));
  return pending;
}

/** "bobas" matches "boba". */
function stem(word: string): string {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

/** Every priced dish that fits the query, best first. "boba" returns each boba on the menu. */
export function findItems(menu: Menu, query: string): MenuItem[] {
  const q = query.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!q) return [];
  const words = q.split(" ").map(stem).filter((w) => w.length > 2);
  const scored = menu.items
    .map((item) => {
      const name = item.name.toLowerCase();
      const stemmed = name.split(/\s+/).map(stem).join(" ");
      if (stemmed === words.join(" ")) return { item, score: 100 };
      if (words.every((w) => stemmed.includes(w))) return { item, score: 80 };
      const hits = words.filter((w) => stemmed.includes(w)).length;
      return { item, score: words.length ? (hits / words.length) * 50 : 0 };
    })
    .filter((s) => s.score >= 50)
    .sort((a, b) => b.score - a.score || (a.item.price ?? 99) - (b.item.price ?? 99));
  if (!scored.length) return [];
  const best = scored[0].score;
  return scored.filter((s) => s.score === best).map((s) => s.item);
}

export function findItem(menu: Menu, query: string): MenuItem | undefined {
  return findItems(menu, query)[0];
}

/** One box for the order, unless every item is on HDH's no-box list. */
export function boxesFor(name: string, quantity: number): number {
  if (NO_BOX.test(name) || quantity < 1) return 0;
  return 1;
}

/**
 * A rough pickup guess from HDH's published notes, in minutes.
 * Not the clock Triton2Go shows.
 */
export function prepMinutes(name: string, hall: DiningHall, now = new Date()): number {
  const hour = now.getHours() + now.getMinutes() / 60;
  const made = MADE_TO_ORDER.test(name) || MADE_TO_ORDER.test(hall.name);
  let minutes = made ? 12 : 5;
  const offPeak = (hour >= 7 && hour < 9) || (hour >= 14 && hour < 17);
  const peak = (hour >= 11 && hour < 13.5) || (hour >= 17 && hour < 19);
  if (offPeak) minutes -= 2;
  if (peak) minutes += 5;
  return Math.max(3, minutes);
}

export function money(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

/**
 * What a Triton2Go status actually means. A time of day is a place in the
 * virtual queue, not an estimate of when the food is cooked.
 */
export function explainStatus(text: string): string | undefined {
  const q = text.toLowerCase();
  if (/pick ?up|ready now/.test(q)) return `On Triton2Go, "Pick up" or "Ready now" is the only status that means the food is ready.`;
  if (/working on it/.test(q)) return `"Working on it" means the ticket is late, not that it's ready. If it stays that way for several minutes, ask at the counter; sometimes a finished order isn't marked.`;
  if (/waiting for release/.test(q)) return `"Waiting for release" means the kitchen has not received the ticket yet. The food is not being made.`;
  if (/\b\d{1,2}:\d{2}\s*(am|pm)?\b/.test(q) && /order|triton|queue|app/.test(q)) {
    return `A clock time in Triton2Go is not when the food will be ready. It's when your ticket joins the line the kitchen can see. You still wait after that.`;
  }
  return undefined;
}

export function quote(menu: Menu, item: MenuItem, quantity: number, now = new Date()): string {
  const qty = Math.max(1, Math.min(20, Math.round(quantity)));
  const boxes = boxesFor(item.name, qty);
  const each = item.price;
  const food = each !== undefined ? each * qty : undefined;
  const deposit = boxes * BOX_DEPOSIT;
  const total = food !== undefined ? food + deposit : undefined;
  const prep = prepMinutes(item.name, menu.hall, now);
  const lines = [
    each !== undefined
      ? `${qty} × ${item.name} at ${menu.hall.name} is ${money(each)} each, ${money(food!)} for the food.`
      : `${item.name} is on the ${menu.hall.name} menu, but HDH isn't listing a price for it today.`,
  ];
  if (boxes) {
    lines.push(
      `Triton2Go packs it in a reusable box: ${money(BOX_DEPOSIT)} refundable deposit, one box for this order. Adding it to a box you already have skips another deposit. Return the box at a Triton2Go machine for the ${money(BOX_DEPOSIT)} back.`,
    );
  } else {
    lines.push(`This one isn't packed in a Triton2Go box (drinks, pizza, burritos, wraps, sandwiches, and pastry aren't), so there's no ${money(BOX_DEPOSIT)} deposit.`);
  }
  if (total !== undefined) lines.push(`About ${money(total)} at checkout${deposit ? `, including the deposit` : ""}.`);
  lines.push(
    `${menu.hall.name} is listed as ${menu.hours}. A rough pickup is about ${prep} min once the kitchen has the ticket${MADE_TO_ORDER.test(item.name) || MADE_TO_ORDER.test(menu.hall.name) ? " (it's made to order)" : ""}. Off-peak, HDH says 7–9am and 2–5pm are faster.`,
  );
  lines.push(`On the Triton2Go app, only "Pick up" or "Ready now" means it's actually ready.`);
  return lines.join(" ");
}
