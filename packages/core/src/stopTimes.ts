import { secondsSinceMidnight, type TransitNetwork, type TransitRoute } from "./transit.ts";
import type { LngLat } from "./types.ts";

/** A line that calls at a stop, with the directions it runs. */
export interface StopLine {
  route: TransitRoute;
  headsigns: string[];
}

/** One scheduled departure from a stop (from the published timetable). */
export interface StopArrival {
  route: TransitRoute;
  headsign: string;
  at: Date;
}

/** Lines that serve `stopId`, in the order they first appear in the feed. */
export function linesAtStop(transit: TransitNetwork, stopId: string): StopLine[] {
  const i = transit.data.stops.findIndex((s) => s.id === stopId);
  if (i < 0) return [];
  const byRoute = new Map<string, StopLine>();
  for (const { pattern } of transit.stopPatterns[i]) {
    const pat = transit.data.patterns[pattern];
    const route = transit.data.routes[pat.route];
    const cur = byRoute.get(route.id) ?? { route, headsigns: [] };
    if (pat.headsign && !cur.headsigns.includes(pat.headsign)) cur.headsigns.push(pat.headsign);
    byRoute.set(route.id, cur);
  }
  return [...byRoute.values()];
}

/** One drawn line through a stop: a route (and direction) and its published shape. */
export interface StopRouteShape {
  route: TransitRoute;
  headsign: string;
  shape: LngLat[];
}

/** Shapes of every line (and direction) that calls at `stopId`, for drawing the stop's routes. */
export function shapesAtStop(transit: TransitNetwork, stopId: string): StopRouteShape[] {
  const i = transit.data.stops.findIndex((s) => s.id === stopId);
  if (i < 0) return [];
  const out: StopRouteShape[] = [];
  const seen = new Set<string>();
  for (const { pattern } of transit.stopPatterns[i]) {
    const pat = transit.data.patterns[pattern];
    if (pat.shape.length < 2) continue;
    const route = transit.data.routes[pat.route];
    const key = `${route.id}|${pat.headsign}|${pat.shape.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ route, headsign: pat.headsign, shape: pat.shape });
  }
  return out;
}

/**
 * Upcoming scheduled departures at `stopId` after `from`, from today's timetable
 * (tomorrow's if nothing is left today). Uses the published GTFS times in transit.json.
 */
export function arrivalsAtStop(transit: TransitNetwork, stopId: string, from = new Date(), limit = 12): StopArrival[] {
  const i = transit.data.stops.findIndex((s) => s.id === stopId);
  if (i < 0) return [];
  const out: StopArrival[] = [];
  for (let dayOffset = 0; dayOffset < 2 && out.length === 0; dayOffset++) {
    const day = new Date(from);
    day.setDate(day.getDate() + dayOffset);
    day.setHours(0, 0, 0, 0);
    const after = dayOffset === 0 ? secondsSinceMidnight(from) : -1;
    const services = transit.activeServices(new Date(day.getTime() + 12 * 3600 * 1000));
    for (const { pattern, pos } of transit.stopPatterns[i]) {
      const pat = transit.data.patterns[pattern];
      const route = transit.data.routes[pat.route];
      for (const tr of pat.trips) {
        if (!services.has(tr.service)) continue;
        const sec = tr.times[pos];
        if (sec == null || sec <= after) continue;
        out.push({ route, headsign: pat.headsign, at: new Date(day.getTime() + sec * 1000) });
      }
    }
  }
  out.sort((a, b) => a.at.getTime() - b.at.getTime() || a.route.short.localeCompare(b.route.short));
  const seen = new Set<string>();
  return out
    .filter((a) => {
      const k = `${a.route.id}|${a.at.getTime()}|${a.headsign}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, limit);
}
