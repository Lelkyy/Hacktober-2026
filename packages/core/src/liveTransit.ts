import { haversine } from "./geo.ts";
import type { LngLat } from "./types.ts";

/**
 * Live transit vehicles from a OneBusAway API (`where/vehicles-for-agency/{agency}.json`), as MTS
 * publishes for San Diego: where each trolley and bus is, which way it's heading and its next stop.
 */
export interface LiveVehicle {
  id: string;
  /** The trip it's running, for its route ahead (`tripAhead`). */
  tripId?: string;
  /** The trip's path (OneBusAway `where/shape`), and how far along it the vehicle is, in meters. */
  shapeId?: string;
  distanceAlong?: number;
  mode: "trolley" | "bus";
  /** The route's number ("201", "510"). */
  route: string;
  lngLat: LngLat;
  /** Compass heading in degrees (0 = north, 90 = east), when the feed says. */
  heading?: number;
  /** What riders call it: "Blue Line" for a trolley (MTS names them by color), the route number for a bus. */
  line: string;
  /** Line color, "#rrggbb". */
  color: string;
  /** Where it's going ("UTC"). */
  headsign?: string;
  nextStop?: { name: string; lngLat?: LngLat; /** Seconds from the feed's time until it gets there. */ inSeconds: number };
  /** When its last real GPS fix was taken (ms since the epoch); its position since is MTS's estimate. */
  fixAt?: number;
  /** Whether the times are live predictions rather than the timetable. */
  predicted: boolean;
}

interface ObaVehicle {
  vehicleId: string;
  tripId?: string;
  location?: { lat: number; lon: number };
  tripStatus?: {
    activeTripId?: string;
    position?: { lat: number; lon: number };
    distanceAlongTrip?: number;
    /** OneBusAway: degrees counterclockwise from east (0 = east, 90 = north). */
    orientation?: number;
    nextStop?: string;
    nextStopTimeOffset?: number;
    predicted?: boolean;
    lastLocationUpdateTime?: number;
  };
}
interface ObaResponse {
  data?: {
    list?: ObaVehicle[];
    references?: {
      trips?: { id: string; routeId: string; tripHeadsign?: string; shapeId?: string }[];
      routes?: { id: string; shortName?: string; longName?: string; type?: number; color?: string }[];
      stops?: { id: string; name: string; lat?: number; lon?: number }[];
    };
  };
}

/** GTFS route types: tram, streetcar and light rail (MTS's trolley lines); bus. */
const MODES: Record<number, LiveVehicle["mode"]> = { 0: "trolley", 3: "bus" };

/** The trolleys and buses running a trip, from a vehicles-for-agency response. */
export function liveVehicles(response: ObaResponse): LiveVehicle[] {
  const refs = response.data?.references ?? {};
  const trips = new Map((refs.trips ?? []).map((t) => [t.id, t]));
  const routes = new Map((refs.routes ?? []).map((r) => [r.id, r]));
  const stops = new Map((refs.stops ?? []).map((s) => [s.id, s]));
  const out: LiveVehicle[] = [];
  for (const v of response.data?.list ?? []) {
    const trip = trips.get(v.tripStatus?.activeTripId ?? v.tripId ?? "");
    const route = trip && routes.get(trip.routeId);
    const mode = route?.type !== undefined ? MODES[route.type] : undefined;
    if (!trip || !route || !mode) continue;
    const at = v.tripStatus?.position ?? v.location;
    if (!at) continue;
    const s = v.tripStatus;
    const next = s?.nextStop ? stops.get(s.nextStop) : undefined;
    out.push({
      id: v.vehicleId,
      tripId: trip.id,
      shapeId: trip.shapeId,
      distanceAlong: s?.distanceAlongTrip,
      mode,
      route: route.shortName || route.id,
      lngLat: [at.lon, at.lat],
      heading: s?.orientation !== undefined ? (((90 - s.orientation) % 360) + 360) % 360 : undefined,
      line: mode === "trolley" && route.shortName ? `${route.shortName} Line` : route.shortName || route.longName || route.id,
      color: route.color ? `#${route.color.replace(/^#/, "")}` : "#4A6497",
      headsign: trip.tripHeadsign,
      nextStop:
        next && s?.nextStopTimeOffset !== undefined
          ? {
              name: next.name,
              lngLat: next.lat !== undefined && next.lon !== undefined ? [next.lon, next.lat] : undefined,
              inSeconds: s.nextStopTimeOffset,
            }
          : undefined,
      fixAt: s?.lastLocationUpdateTime || undefined,
      predicted: !!s?.predicted,
    });
  }
  return out;
}

/** Points of a Google encoded polyline (as OneBusAway's `where/shape` gives a trip's path). */
export function decodePolyline(encoded: string): LngLat[] {
  const points: LngLat[] = [];
  let [i, lat, lon] = [0, 0, 0];
  const next = () => {
    let [shift, result, b] = [0, 0, 0];
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    lat += next();
    lon += next();
    points.push([lon / 1e5, lat / 1e5]);
  }
  return points;
}

/** The rest of a vehicle's trip: the path still ahead of it, and each stop to come with when it gets there. */
export interface TripAhead {
  path: LngLat[];
  stops: {
    id: string;
    name: string;
    lngLat: LngLat;
    /** Predicted arrival, ms since the epoch. */
    at: number;
    /** Meters along the trip's path. */
    along: number;
  }[];
}

interface ObaTripDetails {
  data?: {
    entry?: {
      serviceDate?: number;
      schedule?: { stopTimes?: { stopId: string; arrivalTime: number; distanceAlongTrip: number }[] };
      status?: { distanceAlongTrip?: number; scheduleDeviation?: number; serviceDate?: number; position?: { lat: number; lon: number } };
    };
    references?: { stops?: { id: string; name: string; lat: number; lon: number }[] };
  };
}

/**
 * Where a vehicle still has to go, from a trip-details response (with schedule and status) and
 * the trip's path: the path from its distance along the trip to the end, and the stops after
 * that point, each at its timetabled arrival plus the vehicle's current delay.
 */
export function tripAhead(details: ObaTripDetails, path: LngLat[]): TripAhead {
  const entry = details.data?.entry;
  const status = entry?.status;
  const along = status?.distanceAlongTrip ?? 0;
  const day = status?.serviceDate ?? entry?.serviceDate ?? 0;
  const delay = status?.scheduleDeviation ?? 0;
  const stopRefs = new Map((details.data?.references?.stops ?? []).map((s) => [s.id, s]));
  const stops = (entry?.schedule?.stopTimes ?? [])
    .filter((t) => t.distanceAlongTrip > along)
    .flatMap((t) => {
      const s = stopRefs.get(t.stopId);
      return s ? [{ id: s.id, name: s.name, lngLat: [s.lon, s.lat] as LngLat, at: day + (t.arrivalTime + delay) * 1000, along: t.distanceAlongTrip }] : [];
    });
  // Cut the path where the vehicle is: walk it until the distance along the trip is reached.
  const ahead: LngLat[] = [];
  let walked = 0;
  for (let k = 1; k < path.length; k++) {
    const [a, b] = [path[k - 1], path[k]];
    const m = haversine(a[0], a[1], b[0], b[1]);
    if (!ahead.length && walked + m >= along) {
      const t = m ? (along - walked) / m : 0;
      ahead.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    if (ahead.length) ahead.push(b);
    walked += m;
  }
  // Start from where the vehicle is drawn, when the feed says.
  if (status?.position && ahead.length) ahead[0] = [status.position.lon, status.position.lat];
  return { path: ahead, stops };
}

/** A path with the distance from its start to each point, for finding a point a distance along it. */
export interface MeasuredPath {
  points: LngLat[];
  /** Meters from the start to each point. */
  at: number[];
  length: number;
}

export function measurePath(points: LngLat[]): MeasuredPath {
  const at = [0];
  for (let k = 1; k < points.length; k++) {
    at.push(at[k - 1] + haversine(points[k - 1][0], points[k - 1][1], points[k][0], points[k][1]));
  }
  return { points, at, length: at[at.length - 1] ?? 0 };
}

/** The point `meters` along a path (clamped to its ends), and the compass heading of the path there. */
export function pointAlong(path: MeasuredPath, meters: number): { lngLat: LngLat; heading: number } {
  const { points, at } = path;
  const d = Math.max(0, Math.min(path.length, meters));
  // Binary search for the segment holding d.
  let [lo, hi] = [0, points.length - 1];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at[mid] <= d) lo = mid;
    else hi = mid;
  }
  const [a, b] = [points[lo], points[hi] ?? points[lo]];
  const seg = at[hi] - at[lo];
  const t = seg > 0 ? (d - at[lo]) / seg : 0;
  const kx = Math.cos((a[1] * Math.PI) / 180);
  const heading = ((Math.atan2((b[0] - a[0]) * kx, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
  return { lngLat: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading };
}

/** The rest of a path from `meters` along it: that point, then every point after. */
export function pathFrom(path: MeasuredPath, meters: number): LngLat[] {
  if (path.points.length < 2) return path.points;
  const start = pointAlong(path, meters).lngLat;
  const next = path.at.findIndex((d) => d > meters);
  return next === -1 ? [start] : [start, ...path.points.slice(next)];
}

/**
 * How far along a path a point lies: the nearest place on the path to it, looking only from
 * `from` meters on (so a route that comes back past the same spot isn't confused).
 */
export function alongPath(path: MeasuredPath, p: LngLat, from = 0): number {
  const { points, at } = path;
  const kx = Math.cos((p[1] * Math.PI) / 180);
  let [best, bestD] = [from, Infinity];
  for (let k = 1; k < points.length; k++) {
    if (at[k] < from) continue;
    const [a, b] = [points[k - 1], points[k]];
    const [ax, ay] = [(a[0] - p[0]) * kx, a[1] - p[1]];
    const [dx, dy] = [(b[0] - a[0]) * kx, b[1] - a[1]];
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    const along = at[k - 1] + t * (at[k] - at[k - 1]);
    if (d < bestD && along >= from) [best, bestD] = [along, d];
  }
  return best;
}
