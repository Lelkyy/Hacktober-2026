/** HDH menus written by `npm run fetch:menus`. Wait times are not in this file. */

export interface DiningHours {
  day: string;
  open: string;
  close: string;
}

export interface DiningStation {
  name: string;
  locId: string;
  locDetId: string;
  hours: DiningHours[];
}

export interface DiningHall {
  name: string;
  locId: string;
  stations: DiningStation[];
}

export interface DiningItem {
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

export interface DiningMenus {
  fetchedAt: string;
  days: { dayNum: number; date: string }[];
  halls: DiningHall[];
  items: DiningItem[];
}

export interface DiningMatch {
  hall: DiningHall;
  /** Stations to list. Null is the whole hall. */
  stations: string[] | null;
}

const WEEK = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const WEEK_NAME: Record<string, string> = {
  SUN: "Sunday",
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
};

/** Campus-map pin for a hall whose map name isn't the hall's name. */
const HALL_PIN: Record<string, string> = {
  Bistro: "The Bistro at the Strand",
  "Cecil's at Faculty Club": "Ida and Cecil Green Faculty Club",
  "Restaurants at Sixth College": "Crave",
};

/** Names people tap that aren't the hall's own name. */
const ALIASES: Record<string, string> = {
  "the bistro at the strand": "bistro",
  "ida and cecil green faculty club": "cecil s at faculty club",
  "the rooftop": "rooftop",
};

export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function hallPinName(hall: string): string {
  return HALL_PIN[hall] ?? hall;
}

export function findDining(menus: DiningMenus, label: string): DiningMatch | null {
  const key = ALIASES[nameKey(label)] ?? nameKey(label);
  if (!key) return null;
  const hall = menus.halls.find((h) => nameKey(h.name) === key);
  if (hall) return { hall, stations: null };

  const stations = menus.halls.flatMap((h) =>
    h.stations.filter((s) => nameKey(s.name) === key).map((s) => ({ hall: h, station: s.name })),
  );
  if (stations.length) {
    const same = stations.filter((s) => s.hall.name === stations[0].hall.name);
    if (same.length === stations.length) return { hall: same[0].hall, stations: same.map((s) => s.station) };
  }

  const prefixed = menus.halls.flatMap((h) =>
    h.stations
      .filter((s) => {
        const sk = nameKey(s.name);
        return sk !== nameKey(h.name) && (sk.startsWith(`${key} `) || key.startsWith(`${sk} `));
      })
      .map((s) => ({ hall: h, station: s.name })),
  );
  if (prefixed.length && prefixed.every((s) => s.hall.name === prefixed[0].hall.name)) {
    return { hall: prefixed[0].hall, stations: prefixed.map((s) => s.station) };
  }
  return null;
}

export function localDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The menu day to show: today, or the same weekday from the file when today isn't in it. */
export function menuDate(menus: DiningMenus, now = new Date()): string {
  const today = localDate(now);
  if (menus.items.some((item) => item.date === today) || menus.days.some((day) => day.date === today)) return today;
  const want = WEEK[new Date(`${today}T12:00:00`).getDay()];
  const same = menus.days.find((day) => WEEK[new Date(`${day.date}T12:00:00`).getDay()] === want);
  return same?.date ?? menus.days[0]?.date ?? today;
}

export function formatMenuDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function weekday(iso: string): string {
  return WEEK[new Date(`${iso}T12:00:00`).getDay()];
}

export function hoursOn(station: DiningStation, iso: string): string | null {
  const row = station.hours.find((h) => h.day === weekday(iso));
  if (!row) return null;
  if (row.open === "Closed" || row.close === "Closed") return "Closed";
  return `${row.open} – ${row.close}`;
}

/** When this station next opens, if it is closed on `iso`. */
export function nextOpen(station: DiningStation, iso: string): string | null {
  const start = WEEK.indexOf(weekday(iso) as (typeof WEEK)[number]);
  for (let step = 1; step <= 7; step++) {
    const day = WEEK[(start + step) % 7];
    const row = station.hours.find((h) => h.day === day);
    if (row && row.open !== "Closed" && row.close !== "Closed") return `${WEEK_NAME[day]} ${row.open} – ${row.close}`;
  }
  return null;
}

export function pickMeal(meals: string[], now = new Date()): string {
  const hour = now.getHours();
  const order =
    hour < 11
      ? ["Breakfast", "Brunch", "Lunch", "Lunch Dinner", "Dinner", "Late Night"]
      : hour < 16
        ? ["Lunch", "Brunch", "Lunch Dinner", "Dinner", "Late Night", "Breakfast"]
        : ["Dinner", "Late Night", "Lunch Dinner", "Lunch", "Brunch", "Breakfast"];
  return order.find((meal) => meals.includes(meal)) ?? meals[0] ?? "";
}

export function money(price: number): string {
  return `$${price.toFixed(2)}`;
}
