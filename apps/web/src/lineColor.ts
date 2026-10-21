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

/** Colour for a line's logo: official for trolleys and shuttles, a unique swatch per bus number. */
export function lineColor(route: Pick<TransitRoute, "short" | "color" | "mode">): string {
  if (route.mode !== "bus") return route.color || "#4A6497";
  if (!route.short) return route.color || BUS_SWATCHES[0];
  const official = (route.color || "").toLowerCase();
  if (official && official !== "#000099") return route.color;
  return BUS_SWATCHES[hash(route.short) % BUS_SWATCHES.length];
}

/** Up to three colours for a stop logo, one per line, never repeating a colour. */
export function stopLogoColors(routes: Pick<TransitRoute, "short" | "color" | "mode">[]): string[] {
  const colors: string[] = [];
  const used = new Set<string>();
  for (const r of routes) {
    let c = lineColor(r);
    if (used.has(c.toLowerCase())) c = BUS_SWATCHES[(hash(r.short || r.color) + used.size) % BUS_SWATCHES.length];
    if (used.has(c.toLowerCase())) continue;
    used.add(c.toLowerCase());
    colors.push(c);
    if (colors.length === 3) break;
  }
  return colors.length ? colors : ["#4A6497"];
}

/** Short mark on a logo: "30", "IL", or "B" for the Blue Line. */
export function lineMark(route: Pick<TransitRoute, "short" | "mode">): string {
  if (!route.short) return "";
  if (route.mode === "trolley") return route.short.slice(0, 1);
  return route.short;
}
