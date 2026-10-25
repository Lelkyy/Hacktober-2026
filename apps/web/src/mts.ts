import {
  decodePolyline,
  decodeVehiclePositions,
  liveVehicles,
  tripAhead,
  type LiveRoute,
  type LiveVehicle,
  type LngLat,
  type TripAhead,
} from "@campus/core";

/**
 * MTS real-time data (https://www.sdmts.com/business-center/app-developers/real-time-data):
 * vehicle positions from its GTFS-realtime feed (~20 KB for the whole fleet, against ~650 KB for
 * the same from its OneBusAway API), and trips and routes from the OneBusAway API, asked for only
 * when needed. It needs a key from MTS's request form, set as VITE_MTS_KEY (e.g. in
 * apps/web/.env.local, which stays out of git). Use is under MTS's developer license agreement.
 */
const KEY: string | undefined = import.meta.env.VITE_MTS_KEY || undefined;
const API = "https://realtime.sdmts.com/api/api/where";
const POSITIONS = "https://realtime.sdmts.com/api/api/gtfs_realtime/vehicle-positions-for-agency/MTS.pb";
export const MTS_LIVE = !!KEY;
/**
 * How often to ask while trolleys or buses are shown. MTS publishes new fixes in batches every
 * 30–40 s, each already a little old; asking every 10 s shows a batch within 10 s of it coming out.
 */
export const LIVE_REFRESH_MS = 10_000;

/** MTS's routes (names, colors, trolley or bus): fetched once. */
let routes: Promise<Map<string, LiveRoute>> | null = null;
const loadRoutes = () => {
  routes ??= get("routes-for-agency/MTS.json").then((r) => new Map(((r.data as { list?: LiveRoute[] }).list ?? []).map((x) => [x.id, x])));
  routes.catch(() => (routes = null));
  return routes;
};

/**
 * Every trolley and bus at its last GPS fix, and when the feed was made. `before` (the last
 * answer, by vehicle) gives each one's heading from how it moved.
 */
export async function fetchLiveVehicles(before?: Map<string, LiveVehicle>): Promise<{ vehicles: LiveVehicle[]; at: number }> {
  if (!KEY) throw new Error("No MTS real-time key (VITE_MTS_KEY)");
  const [byId, feed] = await Promise.all([
    loadRoutes(),
    fetch(`${POSITIONS}?key=${encodeURIComponent(KEY)}`, { signal: AbortSignal.timeout(20_000) }).then(async (res) => {
      if (!res.ok) throw new Error(`MTS vehicle positions: HTTP ${res.status}`);
      return decodeVehiclePositions(new Uint8Array(await res.arrayBuffer()));
    }),
  ]);
  return { vehicles: liveVehicles(feed.fixes, byId, { before }), at: feed.at || Date.now() };
}

/** Trip paths by shape id: they don't change, so each is fetched once. */
const shapes = new Map<string, Promise<LngLat[]>>();
/** When a path last failed: it isn't asked for again for a while. */
const shapeFailed = new Map<string, number>();
const SHAPE_RETRY_MS = 30_000;
/** Paths are fetched one at a time (MTS turns away bursts). */
let shapeQueue: Promise<unknown> = Promise.resolve();

/** A trip's whole path. */
export function getShape(shapeId: string): Promise<LngLat[]> {
  let shape = shapes.get(shapeId);
  if (shape) return shape;
  if (Date.now() - (shapeFailed.get(shapeId) ?? 0) < SHAPE_RETRY_MS) return Promise.reject(new Error(`MTS shape ${shapeId}: failed recently`));
  shape = shapeQueue.then(() =>
    get(`shape/${encodeURIComponent(shapeId)}.json`).then((s) => {
      const points = decodePolyline((s.data as { entry?: { points?: string } } | undefined)?.entry?.points ?? "");
      if (points.length < 2) throw new Error(`MTS shape ${shapeId}: no points`);
      return points;
    }),
  );
  shapeQueue = shape.catch(() => undefined);
  shape.catch(() => {
    shapes.delete(shapeId);
    shapeFailed.set(shapeId, Date.now());
  });
  shapes.set(shapeId, shape);
  return shape;
}

/** Where a trip's vehicle still has to go from its fix `at`: the path ahead and the stops to come, with MTS's times. */
export async function fetchTripAhead(tripId: string, at: LngLat): Promise<TripAhead> {
  const details = await get(`trip-details/${encodeURIComponent(tripId)}.json`, "&includeSchedule=true&includeStatus=true");
  const trip = (details.data as { references?: { trips?: { id: string; shapeId?: string }[] } } | undefined)?.references?.trips?.find(
    (t) => t.id === tripId,
  );
  const path = trip?.shapeId ? await getShape(trip.shapeId).catch(() => []) : [];
  return tripAhead(details as Parameters<typeof tripAhead>[0], path, at);
}

async function get(method: string, extra = ""): Promise<{ currentTime?: number; code?: number; text?: string; data?: unknown }> {
  if (!KEY) throw new Error("No MTS real-time key (VITE_MTS_KEY)");
  // MTS now and then answers with an empty body (and always does without a valid key): try again a
  // couple of times, a moment apart.
  let text = "";
  for (let attempt = 0; attempt < 3 && !text; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 400 * attempt));
    const res = await fetch(`${API}/${method}?key=${encodeURIComponent(KEY)}${extra}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`MTS real-time: HTTP ${res.status}`);
    text = await res.text();
  }
  if (!text) throw new Error("MTS real-time: empty answer (is the key right?)");
  const json = JSON.parse(text) as { currentTime?: number; code?: number; text?: string; data?: unknown };
  if (json.code !== undefined && json.code !== 200) throw new Error(`MTS real-time: ${json.text ?? json.code}`);
  return json;
}
