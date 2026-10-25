/**
 * Today's menus and prices from HDH's public dining site
 * (hdh-web.ucsd.edu/dining/apps/diningservices). The site is HTML, not JSON:
 * the home page lists halls, stations and weekly hours, and each hall's
 * Venue_V3 page lists items (name, price, meal, allergens).
 *
 * Triton2Go wait times are not on this site. They only appear inside the
 * Transact app for a signed-in order, so this script does not ask for them.
 *
 *   npm run fetch:menus
 *
 * Writes apps/web/public/data/menus.json. One request at a time.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "apps/web/public/data/menus.json");
const HOME = "https://hdh-web.ucsd.edu/dining/apps/diningservices/";
const ORIGIN = "https://hdh-web.ucsd.edu";
const PAUSE_MS = 250;
const MEAL_IDS = ["Breakfast", "Lunch", "Dinner", "Brunch", "Late_Night", "Lunch_Dinner"] as const;
const WEEKDAYS = new Set(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
const MONTHS: Record<string, number> = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
};

interface DayHours {
  day: string;
  open: string;
  close: string;
}

interface Station {
  name: string;
  locId: string;
  locDetId: string;
  hours: DayHours[];
}

interface Hall {
  name: string;
  locId: string;
  stations: Station[];
}

interface MenuItem {
  date: string;
  hall: string;
  locId: string;
  station: string;
  meal: string;
  category: string;
  name: string;
  price: number | null;
  nutrition: string | null;
  icons: string[];
}

interface HallDay {
  date: string;
  items: MenuItem[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function decode(html: string): string {
  return html
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
}

function textOf(html: string): string {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Drop embedded images so the menu markup is what the parser walks. */
function clean(html: string): string {
  return html.replace(/data:[^"']+/g, "").replace(/\r/g, "");
}

async function getText(url: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "ucsd-campus-nav menu fetch (student project)" },
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return res.text();
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(1000 * attempt);
    }
  }
}

function mealLabel(id: string): string {
  if (id === "Late_Night") return "Late Night";
  if (id === "Lunch_Dinner") return "Lunch Dinner";
  return id;
}

function isoDate(label: string): string | null {
  const m = label.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}) (\d{4})\b/);
  if (!m) return null;
  const month = MONTHS[m[1]];
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function nextDay(a: string, b: string): boolean {
  const start = Date.parse(`${a}T00:00:00Z`);
  const end = Date.parse(`${b}T00:00:00Z`);
  return end - start === 86_400_000;
}

function venueUrl(locId: string, locDetId: string, dayNum: number): string {
  return `${ORIGIN}/dining/apps/diningservices/Restaurants/Venue_V3?locId=${locId}&locDetID=${locDetId}&dayNum=${dayNum}`;
}

/** Halls and stations from the dining home page, starting at the restaurant list. */
function parseHome(html: string): Hall[] {
  const at = html.indexOf("Restaurants Open Today");
  if (at < 0) throw new Error("dining home page has no restaurant list");
  const body = html.slice(html.indexOf("</h2>", at) + 5);
  const halls: Hall[] = [];
  for (const part of body.split(/<h2\b[^>]*>/i).slice(1)) {
    const close = part.indexOf("</h2>");
    if (close < 0) continue;
    const name = textOf(part.slice(0, close));
    if (!name || name === "Location Map" || name === "How are we doing?") break;
    if (name === "Markets Open Today") continue;
    const rest = part.slice(close + 5);
    if (!rest.includes("Venue_V3")) continue;
    const stations: Station[] = [];
    for (const bit of rest.split(/<h3\b[^>]*>/i).slice(1)) {
      const end = bit.indexOf("</h3>");
      if (end < 0) continue;
      const stationName = textOf(bit.slice(0, end));
      if (!stationName) continue;
      const after = bit.slice(end + 5);
      const link = after.match(/Venue_V3\?locId=(\d+)&(?:amp;)?locDetID=(\d+)/i);
      if (!link) continue;
      const hours: DayHours[] = [];
      for (const row of after.matchAll(/<tr>\s*<td>\s*([A-Za-z]{3})\s*<\/td>\s*<td>\s*([^<]*?)\s*<\/td>\s*<td>\s*([^<]*?)\s*<\/td>\s*<\/tr>/gi)) {
        const day = row[1].toUpperCase();
        if (!WEEKDAYS.has(day)) continue;
        hours.push({ day, open: textOf(row[2]), close: textOf(row[3]) });
      }
      stations.push({ name: stationName, locId: link[1], locDetId: link[2], hours });
    }
    const locId = stations[0]?.locId;
    if (!locId) continue;
    halls.push({ name, locId, stations });
  }
  return halls;
}

function pageDate(html: string): string | null {
  const label = html.match(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), ([A-Za-z]+ \d{1,2} \d{4})\b/);
  return label ? isoDate(label[1]) : null;
}

function headings(html: string): string[] {
  return [...html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)].map((m) => textOf(m[1])).filter(Boolean);
}

function rowsIn(block: string, item: { date: string; hall: string; locId: string; station: string; meal: string; category: string }): MenuItem[] {
  const items: MenuItem[] = [];
  for (const row of block.split('class="menU-item-row').slice(1)) {
    const link = row.match(/class="sublocsitem" href="([^"]*)"[^>]*>([^<]*)</);
    if (!link) continue;
    const name = textOf(link[2]);
    if (!name) continue;
    const price = row.match(/class="item-price"[^>]*>\s*\$?\s*(\d+(?:\.\d{2})?)/);
    const icons = [...row.matchAll(/<img\b[^>]*\btitle=['"]([^'"]+)['"]/gi)].map((m) => decode(m[1])).filter(Boolean);
    const href = decode(link[1]);
    items.push({
      ...item,
      name,
      price: price ? Number(price[1]) : null,
      nutrition: href.startsWith("http") ? href : `${ORIGIN}${href.startsWith("/") ? "" : "/"}${href}`,
      icons,
    });
  }
  return items;
}

/** Items from one hall page. Large-screen rows only; the page repeats them for phones. */
function parseVenue(html: string, hall: string, locId: string, date: string): MenuItem[] {
  const marks = [...html.matchAll(new RegExp(`<div id="(${MEAL_IDS.join("|")})" class="meal-category">`, "g"))];
  const items: MenuItem[] = [];
  for (let i = 0; i < marks.length; i++) {
    const mealHtml = html.slice(marks[i].index ?? 0, marks[i + 1]?.index ?? html.length);
    if (!mealHtml.includes("sublocsitem")) continue;
    const meal = mealLabel(marks[i][1]);
    for (const stationHtml of mealHtml.split(/<div id="accordion" class="menu-category-section/).slice(1)) {
      const station = textOf((stationHtml.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i) ?? [])[1] ?? "");
      if (!station || station === "Closed") continue;
      let category = "";
      // The phone copy follows in class="... d-lg-none", so this stops at that copy.
      const token = /<h4\b[^>]*>([\s\S]*?)<\/h4>|<div class="d-none d-lg-block[^"]*">([\s\S]*?)class="[^"]*d-lg-none/g;
      for (const m of stationHtml.matchAll(token)) {
        if (m[1] != null) {
          category = textOf(m[1]);
          continue;
        }
        items.push(...rowsIn(m[2], { date, hall, locId, station, meal, category }));
      }
    }
  }
  return items;
}

function dedupe(items: MenuItem[]): MenuItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [item.date, item.locId, item.meal, item.station, item.category, item.name, item.price ?? ""].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadDay(hall: Hall, locId: string, dayNum: number): Promise<HallDay> {
  const first = hall.stations.find((s) => s.locId === locId);
  if (!first) throw new Error(`${hall.name} has no station for locId ${locId}`);
  const html = clean(await getText(venueUrl(locId, first.locDetId, dayNum)));
  const date = pageDate(html);
  if (!date) {
    console.log(`${hall.name} day ${dayNum}: no menu date, skipped`);
    return { date: "", items: [] };
  }
  let items = parseVenue(html, hall.name, locId, date);
  const seen = new Set(headings(html).map((h) => h.toLowerCase()));
  for (const station of hall.stations) {
    if (station.locId !== locId || station.locDetId === first.locDetId) continue;
    if (station.name.toLowerCase() === hall.name.toLowerCase()) continue;
    if (seen.has(station.name.toLowerCase())) continue;
    await sleep(PAUSE_MS);
    const extra = clean(await getText(venueUrl(station.locId, station.locDetId, dayNum)));
    for (const heading of headings(extra)) seen.add(heading.toLowerCase());
    const extraDate = pageDate(extra) ?? date;
    items.push(...parseVenue(extra, hall.name, locId, extraDate));
  }
  items = dedupe(items);
  console.log(`${hall.name} day ${dayNum} (${date}): ${items.length} items`);
  return { date, items };
}

async function main(): Promise<void> {
  const halls = parseHome(clean(await getText(HOME)));
  if (!halls.length) throw new Error("no dining halls with menus");
  const stations = halls.reduce((n, hall) => n + hall.stations.length, 0);
  console.log(`${halls.length} halls, ${stations} stations`);
  for (const hall of halls) console.log(`  ${hall.name} [${hall.locId}] ${hall.stations.map((s) => s.name).join(", ")}`);

  const locIds = (hall: Hall) => [...new Set(hall.stations.map((s) => s.locId))];
  const jobs = halls.flatMap((hall) => locIds(hall).map((locId) => ({ hall, locId })));
  const first = jobs[0];
  const day0 = await loadDay(first.hall, first.locId, 0);
  if (!day0.date) throw new Error(`${first.hall.name} has no menu date`);
  await sleep(PAUSE_MS);
  const day1 = await loadDay(first.hall, first.locId, 1);
  if (!day1.date) throw new Error(`${first.hall.name} day 1 has no menu date`);
  const dayNums = nextDay(day0.date, day1.date) ? [0, 1, 2, 3, 4, 5, 6] : [0];
  if (dayNums.length === 1) console.log(`dayNum=1 (${day1.date}) is not the day after ${day0.date}; storing today only`);
  else console.log(`dayNum walks the week, starting ${day0.date}`);

  const items: MenuItem[] = [...day0.items];
  const days: { dayNum: number; date: string }[] = [{ dayNum: 0, date: day0.date }];
  if (dayNums.length > 1) {
    items.push(...day1.items);
    days.push({ dayNum: 1, date: day1.date });
  }

  for (const dayNum of dayNums) {
    for (const job of jobs) {
      if ((dayNum === 0 || (dayNum === 1 && dayNums.length > 1)) && job.hall === first.hall && job.locId === first.locId) continue;
      await sleep(PAUSE_MS);
      const day = await loadDay(job.hall, job.locId, dayNum);
      if (!day.date) continue;
      const known = days.find((d) => d.dayNum === dayNum);
      if (!known) days.push({ dayNum, date: day.date });
      else if (known.date !== day.date) throw new Error(`${job.hall.name} day ${dayNum} is ${day.date}, expected ${known.date}`);
      items.push(...day.items);
    }
  }

  const menu = {
    source: "HDH Dining Menus (hdh-web.ucsd.edu/dining/apps/diningservices)",
    fetchedAt: new Date().toISOString(),
    waitTimes: "Not included. Triton2Go wait times only show inside the Transact app for your own order.",
    days,
    halls,
    items,
  };
  writeFileSync(OUT, JSON.stringify(menu));
  const priced = items.filter((item) => item.price != null).length;
  console.log(`wrote ${items.length} items (${priced} with a price) for ${halls.length} halls to ${OUT}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
