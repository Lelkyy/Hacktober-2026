import type { TransitRoute } from "@campus/core";

/**
 * Distinct swatches for bus numbers. MTS paints almost every local bus #000099 in GTFS,
 * so a 30 stop and a 41 stop would otherwise look the same.
 */
const BUS_SWATCHES = [
  "#1B6CA8",
  "#C45C12",
  "#9B2D4A",
  "#5A3D9E",
  "#0E7C74",
  "#8A6A12",
  "#2A7A38",
  "#B33A2A",
  "#345C80",
  "#C46A2E",
  "#4A5FBF",
  "#187A6A",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * The golden-angle step paints some route numbers the same colour even when they are not
 * neighbours. 921 lands 6° from 201, so both were purple. These hues replace that result.
 */
const BUS_HUE: Record<string, number> = {
  "921": 18,
};

/** Golden-angle hue so neighbouring route numbers (201 and 202) land far apart. */
function busSwatch(short: string, spin = 0): string {
  const n = Number(short);
  const seed = Number.isFinite(n) && short.trim() !== "" ? n : hash(short);
  const base = BUS_HUE[short] ?? (seed * 137.508) % 360;
  const hue = (base + spin * 47) % 360;
  return hslToHex(hue, 62, 36);
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = lig - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Colour for a line's logo. Trolleys and campus shuttles keep their published colour.
 * Buses get a swatch per route number: MTS paints 201 and 202 (and most local buses) with one shared red or navy.
 */
export function lineColor(route: Pick<TransitRoute, "short" | "color" | "mode">): string {
  if (route.mode !== "bus") return route.color || "#4A6497";
  if (!route.short) return route.color || BUS_SWATCHES[0];
  return busSwatch(route.short);
}

export interface LineBadge {
  color: string;
  /** The line's name on its chip: "30", "IL", "Blue". */
  mark: string;
  short: string;
  mode: TransitRoute["mode"];
}

/** One badge per line at a stop, each with its own colour and route name. */
export function lineBadges(routes: Pick<TransitRoute, "short" | "color" | "mode">[]): LineBadge[] {
  const used = new Set<string>();
  const out: LineBadge[] = [];
  for (const r of routes) {
    let color = lineColor(r);
    let spin = 0;
    while (used.has(color.toLowerCase()) && spin < 6) color = busSwatch(r.short || r.color, ++spin);
    used.add(color.toLowerCase());
    out.push({ color, mark: lineMark(r), short: r.short, mode: r.mode });
  }
  return out;
}

/** A line's name on its chip: "30", "IL", or "Blue" for the Blue Line ("MTG" for the MTG Event Line). */
export function lineMark(route: Pick<TransitRoute, "short" | "mode">): string {
  if (!route.short) return "";
  if (route.mode === "trolley") return route.short.split(" ")[0];
  return route.short;
}
