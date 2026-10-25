/**
 * Fastest campus trip between two points using Triton Trails routing.
 *
 * From the repo root:
 *   npx tsx .cursor/skills/shortest-route/scripts/shortest-route.ts --from "Price Center" --to "Geisel"
 *   npx tsx .cursor/skills/shortest-route/scripts/shortest-route.ts --from 32.877,-117.237 --to Geisel
 *
 * GPS is lat,lng (WGS84). Named places go through CampusSearch (typos OK).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CampusGraph,
  CampusSearch,
  MODES,
  TransitNetwork,
  buildingAt,
  buildSteps,
  endpointLabel,
  planRoute,
  type Building,
  type Endpoint,
  type GraphData,
  type IndoorData,
  type ModeId,
  type Place,
  type PlacesData,
  type SearchHit,
  type TransitData,
} from "@campus/core";

const TIME_MODES: ModeId[] = ["walk", "bike", "bus"];
const DATA = resolve(repoRoot(), "apps/web/public/data");

function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
}

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(DATA, name), "utf8")) as T;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

/** lat,lng or a search query. */
function parseCoord(raw: string): { lngLat: [number, number] } | { query: string } {
  const m = raw.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return { query: raw.trim() };
  const a = Number(m[1]);
  const b = Number(m[2]);
  // Campus is ~32.8 N, 117.2 W. If the first number is longitude, swap.
  const [lat, lng] = Math.abs(a) > 90 ? [b, a] : [a, b];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { query: raw.trim() };
  return { lngLat: [lng, lat] };
}

function hitEndpoint(hit: SearchHit): Endpoint | null {
  if (hit.kind === "building") return { kind: "building", building: hit.building };
  if (hit.kind === "room") return { kind: "building", building: hit.building, room: hit.room };
  if (hit.kind === "place") return { kind: "place", place: hit.place };
  if (hit.kind === "class") return { kind: "building", building: hit.building };
  if (hit.kind === "course") return { kind: "building", building: hit.building, room: hit.room };
  return null;
}

function resolveNamed(
  search: CampusSearch,
  query: string,
  buildings: Building[],
): { endpoint: Endpoint; matched: string } | { error: string; suggestions: string[] } {
  const hits = search.search(query, { limit: 8 });
  const endpoints = hits.map(hitEndpoint).filter((e): e is Endpoint => e !== null);
  if (endpoints.length === 0) {
    const nearby = buildings
      .filter((b) => b.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 5)
      .map((b) => b.name);
    return { error: `No campus match for "${query}".`, suggestions: nearby };
  }
  const endpoint = endpoints[0];
  return { endpoint, matched: endpointLabel(endpoint) };
}

function resolveEndpoint(
  raw: string,
  label: string,
  search: CampusSearch,
  buildings: Building[],
): { endpoint: Endpoint; matched: string } | { error: string; suggestions?: string[] } {
  const parsed = parseCoord(raw);
  if ("lngLat" in parsed) {
    const building = buildingAt(buildings, parsed.lngLat, 25) ?? undefined;
    return {
      endpoint: { kind: "point", lngLat: parsed.lngLat, label, building },
      matched: building ? `${label} (in/beside ${building.name})` : label,
    };
  }
  if (!parsed.query || parsed.query.toLowerCase() === "here" || parsed.query.toLowerCase() === "me") {
    return {
      error:
        "Need a start location: GPS as lat,lng (e.g. 32.877,-117.237) or a campus name (e.g. Price Center).",
    };
  }
  return resolveNamed(search, parsed.query, buildings);
}

function fmtMin(seconds: number): string {
  const m = seconds / 60;
  return m < 10 ? `${m.toFixed(1)} min` : `${Math.round(m)} min`;
}

function fmtMeters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

async function main() {
  const fromRaw = arg("--from");
  const toRaw = arg("--to");
  const modeArg = arg("--mode") as ModeId | undefined;
  const json = hasFlag("--json");
  if (!fromRaw || !toRaw || hasFlag("--help")) {
    console.error(
      [
        "Usage: npx tsx .cursor/skills/shortest-route/scripts/shortest-route.ts --from <here|name|lat,lng> --to <name|lat,lng> [--mode walk|bike|bus|accessible] [--json]",
        "",
        "Default: compare Walk, Bike, and Transit and pick the shortest door-to-door time.",
      ].join("\n"),
    );
    process.exit(fromRaw && toRaw ? 0 : 1);
  }

  const graph = new CampusGraph(loadJson<GraphData>("graph.json"));
  const buildings = loadJson<Building[]>("buildings.json");
  const indoor = loadJson<IndoorData>("indoor.json");
  const places = loadJson<PlacesData>("places.json");
  const transit = new TransitNetwork(loadJson<TransitData>("transit.json"), graph);
  const search = new CampusSearch({ buildings, indoor, places: places.places as Place[] });

  const from = resolveEndpoint(fromRaw, "Current location", search, buildings);
  const to = resolveEndpoint(toRaw, "Destination", search, buildings);
  if ("error" in from) {
    console.error(from.error);
    if (from.suggestions?.length) console.error("Did you mean:", from.suggestions.join(", "));
    process.exit(1);
  }
  if ("error" in to) {
    console.error(to.error);
    if (to.suggestions?.length) console.error("Did you mean:", to.suggestions.join(", "));
    process.exit(1);
  }

  const modes: ModeId[] = modeArg ? [modeArg] : TIME_MODES;
  const unknown = modes.find((id) => !(id in MODES));
  if (unknown) {
    console.error(`Unknown mode "${unknown}". Use walk, bike, bus, or accessible.`);
    process.exit(1);
  }

  const compared = modes.map((id) => {
    const spec = MODES[id];
    const plan = planRoute(graph, from.endpoint, to.endpoint, {
      profile: spec.profile,
      transit: spec.transit ? transit : null,
      walkWeight: 1,
      departAt: new Date(),
    });
    return { id, label: spec.label, plan };
  });

  const ok = compared.filter((c) => c.plan.ok);
  const failed = compared.filter((c) => !c.plan.ok);
  if (ok.length === 0) {
    const reasons = failed.map((c) => `${c.label}: ${c.plan.ok ? "" : c.plan.error}`).join("\n");
    console.error(`No route from ${from.matched} to ${to.matched}.\n${reasons}`);
    process.exit(1);
  }

  ok.sort((a, b) => (a.plan.ok ? a.plan.route.seconds : Infinity) - (b.plan.ok ? b.plan.route.seconds : Infinity));
  const best = ok[0];
  if (!best.plan.ok) process.exit(1);
  const { route } = best.plan;
  const leaving = from.endpoint.kind === "building" ? from.endpoint.building : from.endpoint.kind === "point" ? from.endpoint.building : undefined;
  const steps = buildSteps(graph, route, to.matched, { leaving });

  const payload = {
    from: from.matched,
    to: to.matched,
    best: {
      mode: best.label,
      minutes: route.minutes,
      seconds: route.seconds,
      meters: route.meters,
      stairs: route.stairSegments,
      usesTransit: route.usesTransit,
      leaveAt: route.leaveAt.toISOString(),
      arriveAt: route.arriveAt.toISOString(),
    },
    compared: compared.map((c) =>
      c.plan.ok
        ? { mode: c.label, minutes: c.plan.route.minutes, seconds: c.plan.route.seconds, meters: c.plan.route.meters }
        : { mode: c.label, error: c.plan.error },
    ),
    steps: steps.map((s) => ({ text: s.text, meters: Math.round(s.distance) })),
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`Fastest: ${best.label} · ${fmtMin(route.seconds)} · ${fmtMeters(route.meters)}`);
  console.log(`From: ${from.matched}`);
  console.log(`To:   ${to.matched}`);
  if (ok.length > 1) {
    console.log("Compared:");
    for (const c of ok) {
      if (!c.plan.ok) continue;
      const mark = c.id === best.id ? " ← fastest" : "";
      console.log(`  ${c.label}: ${fmtMin(c.plan.route.seconds)} (${fmtMeters(c.plan.route.meters)})${mark}`);
    }
    for (const c of failed) {
      if (c.plan.ok) continue;
      console.log(`  ${c.label}: ${c.plan.error}`);
    }
  }
  console.log("Directions:");
  for (const step of steps) {
    const d = step.distance >= 8 ? ` (${fmtMeters(step.distance)})` : "";
    console.log(`  • ${step.text}${d}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
