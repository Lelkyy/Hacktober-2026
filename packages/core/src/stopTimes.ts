import { haversine } from "./geo.ts";
import { lineShare } from "./lineOffset.ts";
import { secondsSinceMidnight, type TransitNetwork, type TransitRoute, type TransitStop } from "./transit.ts";
import type { LngLat } from "./types.ts";

/** Platforms of one station (both directions of a trolley) sit about this far apart. */
const CLUSTER_M = 30;

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
    const key = `${route.id}|${pat.headsign}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ route, headsign: pat.headsign, shape: pat.shape });
  }
  return collapseOppositeDirections(out);
}

/** Compass bearings (0 = north) of buses as they pass `stopId`, one per line and direction. */
export function approachBearings(transit: TransitNetwork, stopId: string): number[] {
  const i = transit.data.stops.findIndex((s) => s.id === stopId);
  if (i < 0) return [];
  const out: number[] = [];
  const seen = new Set<string>();
  for (const { pattern, pos } of transit.stopPatterns[i]) {
    const pat = transit.data.patterns[pattern];
    const route = transit.data.routes[pat.route];
    const key = `${route.id}|${pat.headsign}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const heading = bearingThrough(pat.shape, pat.shapeIndex[pos] ?? 0);
    if (heading !== null) out.push(heading);
  }
  return out;
}

/** One heading when every approach faces the same way (within 50°); otherwise none. */
export function sharedApproach(bearings: number[]): number | null {
  if (bearings.length === 0) return null;
  const base = bearings[0];
  let [x, y] = [0, 0];
  for (const b of bearings) {
    const delta = Math.abs(((b - base + 540) % 360) - 180);
    if (delta > 50) return null;
    const rad = (b * Math.PI) / 180;
    x += Math.sin(rad);
    y += Math.cos(rad);
  }
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

/** Bearing of the shape as it passes `idx`, stepping to a point far enough to be stable. */
function bearingThrough(shape: LngLat[], idx: number): number | null {
  if (shape.length < 2) return null;
  let i = Math.max(0, Math.min(shape.length - 1, idx));
  let j = i;
  while (j < shape.length - 1 && haversine(shape[i][0], shape[i][1], shape[j][0], shape[j][1]) < 12) j++;
  if (j === i) {
    while (i > 0 && haversine(shape[i][0], shape[i][1], shape[j][0], shape[j][1]) < 12) i--;
  }
  if (i === j) return null;
  return travelBearing(shape[i], shape[j]);
}

function travelBearing(a: LngLat, b: LngLat): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad);
  const x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad) - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/** Same route, opposite ways on the same tracks: keep one drawn line. */
function collapseOppositeDirections(shapes: StopRouteShape[]): StopRouteShape[] {
  const kept: StopRouteShape[] = [];
  for (const s of shapes) {
    if (kept.some((k) => k.route.id === s.route.id && lineShare(k.shape, s.shape) >= 0.45)) continue;
    kept.push(s);
  }
  return kept;
}

/**
 * Upcoming scheduled departures at `stopId` after `from`, from today's timetable
 * (tomorrow's if nothing is left today). Uses the published GTFS times in transit.json.
 * A trip's last stop isn't a departure: the bus ends its run there (a loop like the SIO Shuttle
 * arrives back at Gilman Transit Center as it finishes), so it's left out.
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
      if (pos === pat.stops.length - 1) continue;
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

function mergeLines(into: Map<string, StopLine>, add: StopLine[]): void {
  for (const l of add) {
    const cur = into.get(l.route.id) ?? { route: l.route, headsigns: [] };
    for (const h of l.headsigns) if (h && !cur.headsigns.includes(h)) cur.headsigns.push(h);
    into.set(l.route.id, cur);
  }
}

/** Lines at any of `stopIds`, one entry per route. */
export function linesAtStops(transit: TransitNetwork, stopIds: string[]): StopLine[] {
  const byRoute = new Map<string, StopLine>();
  for (const id of stopIds) mergeLines(byRoute, linesAtStop(transit, id));
  return [...byRoute.values()];
}

export interface PassingRoute {
  route: TransitRoute;
  headsign: string;
  shape: LngLat[];
  meters: number;
  /** Way the line is heading where it passes nearest this point. */
  bearing: number | null;
  stopIds: string[];
}

/** Distance from a point to a shape segment, in meters, and where along the segment (0–1) it falls. */
function metersToSegment(p: LngLat, a: LngLat, b: LngLat): { meters: number; t: number } {
  const lat = (p[1] * Math.PI) / 180;
  const x = (lon: number) => lon * 111_320 * Math.cos(lat);
  const y = (lat2: number) => lat2 * 110_540;
  const ax = x(a[0]);
  const ay = y(a[1]);
  const dx = x(b[0]) - ax;
  const dy = y(b[1]) - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x(p[0]) - ax) * dx + (y(p[1]) - ay) * dy) / len2));
  return { meters: Math.hypot(x(p[0]) - (ax + dx * t), y(p[1]) - (ay + dy * t)), t };
}

/**
 * Lines whose published shape runs past a point, for a stop that has no scheduled calls of its own
 * (a temporary curb the timetable never lists). Keeps every route that passes as close as the nearest one.
 */
export function routesPassing(transit: TransitNetwork, lngLat: LngLat): PassingRoute[] {
  const near: { route: TransitRoute; meters: number; at: number; pat: (typeof transit.data.patterns)[number] }[] = [];
  for (const pat of transit.data.patterns) {
    if (pat.shape.length < 2) continue;
    let meters = Infinity;
    let at = 0;
    for (let i = 0; i < pat.shape.length - 1; i++) {
      const hit = metersToSegment(lngLat, pat.shape[i], pat.shape[i + 1]);
      if (hit.meters < meters) {
        meters = hit.meters;
        at = hit.t < 0.5 ? i : i + 1;
      }
    }
    const route = transit.data.routes[pat.route];
    const prev = near.find((n) => n.route.id === route.id);
    if (prev && meters >= prev.meters) continue;
    const row = { route, meters, at, pat };
    if (prev) Object.assign(prev, row);
    else near.push(row);
  }
  if (!near.length) return [];
  const closest = Math.min(...near.map((n) => n.meters));
  if (closest > 200) return [];
  return near
    .filter((n) => n.meters <= closest + 30)
    .map((n) => ({
      route: n.route,
      headsign: n.pat.headsign,
      shape: n.pat.shape,
      meters: n.meters,
      bearing: bearingThrough(n.pat.shape, n.at),
      stopIds: n.pat.stops.map((i) => transit.data.stops[i]?.id).filter((id): id is string => !!id),
    }));
}

/** Every stop a line visits when that line also calls at one of `stopIds`. */
export function stopsOnLinesThrough(transit: TransitNetwork, stopIds: string[]): string[] {
  const seenPat = new Set<number>();
  const seenStop = new Set<string>();
  const out: string[] = [];
  for (const id of stopIds) {
    const i = transit.data.stops.findIndex((s) => s.id === id);
    if (i < 0) continue;
    for (const { pattern } of transit.stopPatterns[i]) {
      if (seenPat.has(pattern)) continue;
      seenPat.add(pattern);
      for (const si of transit.data.patterns[pattern].stops) {
        const stop = transit.data.stops[si];
        if (!stop || seenStop.has(stop.id)) continue;
        seenStop.add(stop.id);
        out.push(stop.id);
      }
    }
  }
  return out;
}

/** Shapes through any of `stopIds`, one per route and direction. */
export function shapesAtStops(transit: TransitNetwork, stopIds: string[]): StopRouteShape[] {
  const seen = new Set<string>();
  const out: StopRouteShape[] = [];
  for (const id of stopIds) {
    for (const s of shapesAtStop(transit, id)) {
      const key = `${s.route.id}|${s.headsign}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return collapseOppositeDirections(out);
}

/** Upcoming departures at any of `stopIds`. */
export function arrivalsAtStops(transit: TransitNetwork, stopIds: string[], from = new Date(), limit = 12): StopArrival[] {
  const seen = new Set<string>();
  const out: StopArrival[] = [];
  for (const id of stopIds) {
    for (const a of arrivalsAtStop(transit, id, from, limit)) {
      const k = `${a.route.id}|${a.at.getTime()}|${a.headsign}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(a);
    }
  }
  out.sort((a, b) => a.at.getTime() - b.at.getTime() || a.route.short.localeCompare(b.route.short));
  return out.slice(0, limit);
}

/**
 * Group stop platforms that share a name and sit next to each other (both
 * directions of a trolley station, a Triton stop and its MTS twin).
 */
export function clusterSameNameStops(stops: TransitStop[], withinM = CLUSTER_M): TransitStop[][] {
  const parent = stops.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      if (stops[i].name !== stops[j].name) continue;
      if (haversine(stops[i].lngLat[0], stops[i].lngLat[1], stops[j].lngLat[0], stops[j].lngLat[1]) <= withinM) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, TransitStop[]>();
  stops.forEach((s, i) => {
    const r = find(i);
    const g = groups.get(r) ?? [];
    g.push(s);
    groups.set(r, g);
  });
  return [...groups.values()];
}

/** One pin per cluster, placed on a real platform so it stays on the stop at every zoom. */
export function clusteredStop(members: TransitStop[]): TransitStop {
  return members[0];
}

/** Every platform of the same named station as `stop`. */
export function sameNameCluster(stops: TransitStop[], stop: TransitStop, withinM = CLUSTER_M): TransitStop[] {
  return stops.filter(
    (s) => s.name === stop.name && haversine(s.lngLat[0], s.lngLat[1], stop.lngLat[0], stop.lngLat[1]) <= withinM,
  );
}
