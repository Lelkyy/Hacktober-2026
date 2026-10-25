import { arrivalsAtStops, distanceMeters, linesAtStops, sameNameCluster, type LiveVehicle, type LngLat, type TransitStop } from "@campus/core";
import type { ChatCampus } from "./types.ts";
import { clock } from "./classes.ts";

/** A stop and the stops with its name across the street: one place to wait. */
export interface StopGroup {
  stop: TransitStop;
  ids: string[];
}

export function groupOf(campus: ChatCampus, stop: TransitStop): StopGroup {
  const cluster = sameNameCluster(campus.transit.data.stops, stop);
  return { stop, ids: (cluster.length ? cluster : [stop]).map((s) => s.id) };
}

/** The stop a name means: every word of it in the stop's name, the shortest name first. */
export function stopNamed(campus: ChatCampus, query: string): TransitStop | undefined {
  const words = query.toLowerCase().replace(/\b(the|stop|station|bus|shuttle|trolley)\b/g, " ").split(/\W+/).filter(Boolean);
  if (!words.length) return undefined;
  return campus.transit.data.stops
    .filter((s) => words.every((w) => s.name.toLowerCase().includes(w)))
    .sort((a, b) => a.name.length - b.name.length)[0];
}

export function nearestStop(campus: ChatCampus, at: LngLat): TransitStop | undefined {
  let best: TransitStop | undefined;
  let bestM = Infinity;
  for (const s of campus.transit.data.stops) {
    const m = distanceMeters(s.lngLat, at);
    if (m < bestM) [best, bestM] = [s, m];
  }
  return best;
}

/** "Gilman Dr & Myers Dr (201, 202, 30)\nNext: …", with which of those lines are live on the map. */
export function stopSummary(campus: ChatCampus, group: StopGroup, vehicles: LiveVehicle[]): string {
  const lines = linesAtStops(campus.transit, group.ids);
  const names = lines.map((l) => (l.route.mode === "trolley" ? `${l.route.short} Line` : l.route.short));
  const next = arrivalsAtStops(campus.transit, group.ids, new Date(), 6).map((a) => {
    const minutes = Math.round((a.at.getTime() - Date.now()) / 60_000);
    return `${a.route.short} to ${a.headsign} at ${clock(a.at)}${minutes <= 60 ? ` (${minutes <= 0 ? "now" : `${minutes} min`})` : ""}`;
  });
  const live = vehicles.filter((v) => lines.some((l) => l.route.short === v.route));
  return [
    `${group.stop.name}${names.length ? ` (${names.join(", ")})` : ""}`,
    next.length ? `Scheduled:\n${next.join("\n")}` : "No more departures today.",
    live.length ? `${live.length} of these buses ${live.length === 1 ? "is" : "are"} live on the map now.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
