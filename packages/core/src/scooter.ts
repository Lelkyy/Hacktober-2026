import { MinHeap } from "./heap.ts";
import { distanceMeters, WALKING_SPEED_MPS } from "./geo.ts";
import type { CampusGraph } from "./graph.ts";
import { approachCosts, planRoute, resolveTrip, type Endpoint } from "./plan.ts";
import { edgeTravel, PROFILES, type MoveLeg, type Profile, type Route } from "./route.ts";
import type { SharedBike } from "./gbfs.ts";
import type { LngLat } from "./types.ts";

/**
 * Riding a shared scooter (Spin) across campus: walk to a free one, ride it, park it where
 * the operator allows, walk the rest. Spin's geofencing zones (GBFS `geofencing_zones`) say
 * where you can't ride (the motor stops: walk it), where you can ride through but not park,
 * and any speed limits; UCSD's rules are in the map data (scooters off footpaths, walked on
 * Library Walk and other no-scooter walks, 8 mph on shared paths).
 */

/** A zone from a GBFS geofencing feed, with the rules for scooters. */
export interface RideZone {
  /** Polygons, each outer ring then holes. */
  polygons: LngLat[][][];
  /** A ride can start and end (park) here. */
  park: boolean;
  /** A ride can go through here. */
  through: boolean;
  /** Speed limit, when the operator sets one. */
  maxKph?: number;
  bbox: [number, number, number, number];
}

export interface GbfsGeofencing {
  data: {
    geofencing_zones: {
      features: {
        geometry: { type: string; coordinates: number[][][][] | number[][][] };
        properties: {
          rules?: { vehicle_type_id?: string[]; ride_allowed: boolean; ride_through_allowed: boolean; maximum_speed_kph?: number }[];
        };
      }[];
    };
  };
}

/**
 * The zones in a GBFS 2.x geofencing feed, in its order (where zones overlap, the first one's
 * rules apply), with the rules for `vehicleTypes` (the scooter types; rules without vehicle
 * types apply to all).
 */
export function geofencingZones(feed: GbfsGeofencing, vehicleTypes: string[] = []): RideZone[] {
  const zones: RideZone[] = [];
  for (const f of feed.data.geofencing_zones.features) {
    const rule = (f.properties.rules ?? []).find((r) => !r.vehicle_type_id?.length || r.vehicle_type_id.some((t) => vehicleTypes.includes(t)));
    if (!rule) continue;
    const g = f.geometry;
    const polygons = (g.type === "MultiPolygon" ? (g.coordinates as number[][][][]) : g.type === "Polygon" ? [g.coordinates as number[][][]] : []).map(
      (poly) => poly.map((ring) => ring.map(([x, y]) => [x, y] as LngLat)),
    );
    if (!polygons.length) continue;
    const pts = polygons.flat(2);
    zones.push({
      polygons,
      park: rule.ride_allowed,
      through: rule.ride_through_allowed,
      ...(rule.maximum_speed_kph ? { maxKph: rule.maximum_speed_kph } : {}),
      bbox: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))],
    });
  }
  return zones;
}

function inRing(p: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The zone whose rules hold at a point: the first that contains it. */
export function zoneAt(zones: RideZone[], p: LngLat): RideZone | undefined {
  return zones.find(
    (z) =>
      p[0] >= z.bbox[0] &&
      p[1] >= z.bbox[1] &&
      p[0] <= z.bbox[2] &&
      p[1] <= z.bbox[3] &&
      z.polygons.some(([outer, ...holes]) => inRing(p, outer) && !holes.some((h) => inRing(p, h))),
  );
}

/** Whether a ride can end here: inside a zone that allows it (outside every zone is outside the service area). */
export function canPark(zones: RideZone[], p: LngLat): boolean {
  return !zones.length || (zoneAt(zones, p)?.park ?? false);
}

/** Every zone that contains `p`, in feed order. */
function zonesAt(zones: RideZone[], p: LngLat): RideZone[] {
  return zones.filter(
    (z) =>
      p[0] >= z.bbox[0] &&
      p[1] >= z.bbox[1] &&
      p[0] <= z.bbox[2] &&
      p[1] <= z.bbox[3] &&
      z.polygons.some(([outer, ...holes]) => inRing(p, outer) && !holes.some((h) => inRing(p, h))),
  );
}

/**
 * Each edge's speed limit from the zones (at its middle), m/s.
 * 0 where any overlapping zone stops the motor. Otherwise the lowest `maximum_speed_kph`
 * among the zones that cover it, so a slow zone still counts when a wider zone is listed first.
 * Infinity where the feed sets no cap (the scooter profile's own 15 mph cap still applies).
 */
export function zoneLimits(graph: CampusGraph, zones: RideZone[]): Float32Array {
  const limits = new Float32Array(graph.edgeCount).fill(Infinity);
  if (!zones.length) return limits;
  for (let e = 0; e < graph.edgeCount; e++) {
    const [a, b] = [graph.edgeFrom[e], graph.edgeTo[e]];
    const covering = zonesAt(zones, [(graph.lon[a] + graph.lon[b]) / 2, (graph.lat[a] + graph.lat[b]) / 2]);
    if (!covering.length) continue;
    if (covering.some((z) => !z.through)) limits[e] = 0;
    else {
      const caps = covering.flatMap((z) => (z.maxKph ? [z.maxKph] : []));
      if (caps.length) limits[e] = Math.min(...caps) / 3.6;
    }
  }
  return limits;
}

/** The scooter profile with the zones' limits. */
export function scooterProfile(limits?: Float32Array): Profile {
  return limits ? { ...PROFILES.scooter, rideLimit: (e) => limits[e] } : PROFILES.scooter;
}

/**
 * Travel time (seconds, with the profile's preferences) from the sources to every node within
 * `maxSeconds`; with `reverse`, from every node to the sources.
 */
export function travelTimes(graph: CampusGraph, profile: Profile, sources: Map<number, number>, maxSeconds: number, reverse = false): Float64Array {
  const cost = new Float64Array(graph.nodeCount).fill(Infinity);
  const open = new MinHeap();
  for (const [node, c] of sources) {
    if (c < cost[node]) {
      cost[node] = c;
      open.push(node, c);
    }
  }
  const done = new Uint8Array(graph.nodeCount);
  while (open.size > 0) {
    const u = open.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (cost[u] > maxSeconds) break;
    for (let k = graph.adjStart[u]; k < graph.adjStart[u + 1]; k++) {
      const e = graph.adjEdge[k];
      const v = graph.other(e, u);
      // Backwards, the edge is travelled from v to u.
      const { speed, prefer } = edgeTravel(graph, profile, e, reverse ? v : u);
      if (!speed) continue;
      const c = cost[u] + (graph.edgeLength[e] / speed) * prefer;
      if (c < cost[v]) {
        cost[v] = c;
        open.push(v, c);
      }
    }
  }
  return cost;
}

/** Somewhere a shared scooter may be parked: a Spin hub, or a bike rack. */
export interface ParkingSpot {
  lngLat: LngLat;
  name: string;
  kind: "hub" | "rack";
}

/**
 * Parking from UC San Diego's campus places ([lng, lat, category, name, kind, building] rows):
 * its Spin hubs and bike racks, named by the building they're at.
 */
export function parkingSpots(points: [number, number, number, string, string, string][]): ParkingSpot[] {
  return points.flatMap((p): ParkingSpot[] => {
    const at = p[5] ? ` by ${p[5]}` : "";
    if (p[4] === "SPIN Hubs") return [{ lngLat: [p[0], p[1]], name: at ? `the Spin hub${at}` : "a Spin hub", kind: "hub" }];
    if (p[4] === "Bicycle Racks") return [{ lngLat: [p[0], p[1]], name: at ? `the bike racks${at}` : "a bike rack", kind: "rack" }];
    return [];
  });
}

export interface ScooterTrip {
  route: Route;
  connectors: [LngLat, LngLat][];
  scooter: SharedBike;
  parking: ParkingSpot;
  /** Seconds walking to the scooter, riding (and walking it), and walking from where it's parked. */
  walkTo: number;
  ride: number;
  walkFrom: number;
}

/** Unlocking a scooter in the app, and parking it and ending the ride (with the photo). */
const UNLOCK_S = 30;
const PARK_S = 45;
/** Walk at most this far to a scooter. */
const MAX_WALK_TO_S = 15 * 60;
/** Ride at most this long. */
const MAX_RIDE_S = 40 * 60;
/** Scooters tried: the ones nearest on foot. */
const CANDIDATES = 5;
/** A scooter needs this much charge (when the feed says) and range for the ride with room to spare. */
const MIN_BATTERY = 0.15;
const RANGE_MARGIN = 1.5;
/** A hub is where Spin asks riders to park: worth a short extra walk over a bike rack. */
const RACK_PENALTY_S = 30;

/**
 * The quickest trip by shared scooter: walk to one of the free scooters nearest on foot, ride it
 * (walking it where scooters aren't allowed), park at a hub or bike rack where the zones allow
 * ending a ride, then walk to the destination.
 */
export function planScooterTrip(
  graph: CampusGraph,
  from: Endpoint,
  to: Endpoint,
  opts: {
    scooters: SharedBike[];
    parking: ParkingSpot[];
    zones?: RideZone[];
    limits?: Float32Array;
    departAt?: Date;
    /** Already on a scooter (re-planning mid-ride): ride it from the start, no walk to one. */
    riding?: boolean;
  },
): { ok: true; trip: ScooterTrip } | { ok: false; error: string } {
  const walk = PROFILES.walk;
  const zones = opts.zones ?? [];
  const limits = opts.limits ?? zoneLimits(graph, zones);
  const ride = scooterProfile(limits);
  const trip = resolveTrip(graph, from, to, walk);
  if (!trip.ok) return trip;
  const { startCost, targetCost } = approachCosts(graph, trip.ends, walk);
  const sources = (nodes: number[], costs?: Map<number, number>) => new Map(nodes.map((n) => [n, costs?.get(n) ?? 0]));
  const fromStart = travelTimes(graph, walk, sources(trip.start, startCost), MAX_WALK_TO_S);
  const toEnd = travelTimes(graph, walk, sources(trip.targets, targetCost), MAX_WALK_TO_S, true);
  const straight = distanceMeters(endpointAt(from), endpointAt(to));

  // Free scooters with charge for the trip, by how far they are on foot (or yours, where you are).
  const onBoth = (i: number) => graph.onWalkNetwork(i) && graph.onBikeNetwork(i);
  const unlock = opts.riding ? 0 : UNLOCK_S;
  const fleet: SharedBike[] = opts.riding ? [{ id: "yours", kind: "scooter", lngLat: endpointAt(from) }] : opts.scooters;
  const scooters = fleet
    .filter((s) => s.kind === "scooter" && (s.battery ?? 1) >= MIN_BATTERY && (s.rangeMeters ?? Infinity) >= straight * RANGE_MARGIN)
    .map((s) => {
      const node = graph.nearestNode(s.lngLat, { accept: onBoth, maxMeters: 60 });
      const walk = opts.riding ? 0 : fromStart[node] + distanceMeters(s.lngLat, graph.coord(node)) / WALKING_SPEED_MPS;
      return { s, node, walk: node === -1 ? Infinity : walk };
    })
    .filter((c) => c.walk <= MAX_WALK_TO_S)
    .sort((a, b) => a.walk - b.walk)
    .slice(0, CANDIDATES);
  if (!scooters.length) return { ok: false, error: "No Spin scooter free within a 15-minute walk right now." };

  // Where the ride can end, and the walk on from each.
  const spots = opts.parking
    .filter((p) => canPark(zones, p.lngLat))
    .map((p) => {
      const node = graph.nearestNode(p.lngLat, { accept: onBoth, maxMeters: 40 });
      const after = node === -1 ? Infinity : toEnd[node] + distanceMeters(p.lngLat, graph.coord(node)) / WALKING_SPEED_MPS;
      return { p, node, after: after + (p.kind === "rack" ? RACK_PENALTY_S : 0) };
    })
    .filter((x) => x.after <= MAX_WALK_TO_S);
  if (!spots.length) return { ok: false, error: "No Spin parking within a 15-minute walk of the destination." };

  let best: { s: (typeof scooters)[number]; spot: (typeof spots)[number]; total: number } | null = null;
  for (const s of scooters) {
    const rideTimes = travelTimes(graph, ride, new Map([[s.node, 0]]), MAX_RIDE_S);
    for (const spot of spots) {
      const total = s.walk + unlock + rideTimes[spot.node] + PARK_S + spot.after;
      if (total < (best?.total ?? Infinity)) best = { s, spot, total };
    }
  }
  if (!best) return { ok: false, error: "No scooter ride reaches parking near the destination." };

  // The three parts, routed properly.
  const scooterAt: Endpoint = { kind: "point", lngLat: best.s.s.lngLat, label: "Spin scooter" };
  const parkAt: Endpoint = { kind: "point", lngLat: best.spot.p.lngLat, label: best.spot.p.name };
  const parts = [
    ...(opts.riding ? [] : [planRoute(graph, from, scooterAt, { profile: walk, departAt: opts.departAt })]),
    planRoute(graph, opts.riding ? from : scooterAt, parkAt, { profile: ride, departAt: opts.departAt }),
    planRoute(graph, parkAt, to, { profile: walk, departAt: opts.departAt }),
  ];
  for (const p of parts) if (!p.ok) return p;
  const routes = parts.map((p) => (p as Extract<typeof p, { ok: true }>).route);
  const [a, b, c] = opts.riding ? [null, ...routes] : routes;
  const rideLegs = b!.legs.map((l, i) =>
    l.mode === "bike" ? ({ ...l, parkAt: best!.spot.p.name, ...(i === 0 && !opts.riding ? { pickUp: true } : {}) } as MoveLeg) : l,
  );
  const legs = [...(a?.legs ?? []), ...rideLegs, ...c!.legs];
  const seconds = (a?.seconds ?? 0) + unlock + b!.seconds + PARK_S + c!.seconds;
  const leaveAt = opts.departAt ?? new Date();
  return {
    ok: true,
    trip: {
      route: {
        legs,
        coordinates: routes.flatMap((r) => r.coordinates),
        meters: routes.reduce((m, r) => m + r.meters, 0),
        seconds,
        minutes: seconds / 60,
        stairSegments: routes.reduce((n, r) => n + r.stairSegments, 0),
        leaveAt,
        arriveAt: new Date(leaveAt.getTime() + seconds * 1000),
        usesTransit: false,
      },
      connectors: parts.flatMap((p) => (p.ok ? p.connectors : [])),
      scooter: best.s.s,
      parking: best.spot.p,
      walkTo: a?.seconds ?? 0,
      ride: b!.seconds,
      walkFrom: c!.seconds,
    },
  };
}

function endpointAt(e: Endpoint): LngLat {
  return e.kind === "building" ? e.building.center : e.kind === "place" ? e.place.points[0] : e.lngLat;
}
