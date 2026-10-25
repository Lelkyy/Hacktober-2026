import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CampusGraph } from "./graph.ts";
import { buildingCentre } from "./indoor.ts";
import { buildSteps } from "./instructions.ts";
import { edgeTravel, motorFactor, PROFILES } from "./route.ts";
import { canPark, geofencingZones, parkingSpots, type GbfsGeofencing, planScooterTrip, scooterProfile, zoneAt, zoneLimits, type ParkingSpot } from "./scooter.ts";
import { BikeDir, EdgeKind, type Building, type GraphData, type LngLat } from "./types.ts";

const square = (w: number, s: number, e: number, n: number) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
type Rule = GbfsGeofencing["data"]["geofencing_zones"]["features"][number]["properties"]["rules"];
const feed = (zones: { box: number[]; rules: NonNullable<Rule> }[]): GbfsGeofencing => ({
  data: { geofencing_zones: { features: zones.map((z) => ({ geometry: { type: "Polygon", coordinates: square(...(z.box as [number, number, number, number])) }, properties: { rules: z.rules } })) } },
});

describe("Spin geofencing zones", () => {
  const zones = geofencingZones(
    feed([
      { box: [0, 0, 1, 1], rules: [{ vehicle_type_id: ["bike"], ride_allowed: true, ride_through_allowed: true }, { ride_allowed: false, ride_through_allowed: false }] },
      { box: [0, 0, 4, 4], rules: [{ ride_allowed: true, ride_through_allowed: true, maximum_speed_kph: 13 }] },
      { box: [-10, -10, 10, 10], rules: [{ ride_allowed: false, ride_through_allowed: true }] },
    ]),
    ["scooter"],
  );
  it("takes the scooter rules of the first zone a point is in", () => {
    expect(zoneAt(zones, [0.5, 0.5])).toMatchObject({ park: false, through: false });
    expect(zoneAt(zones, [2, 2])).toMatchObject({ park: true, through: true, maxKph: 13 });
    expect(canPark(zones, [2, 2])).toBe(true);
    // Inside the wide zone only: ride through, but don't park; outside them all: out of service.
    expect(canPark(zones, [8, 8])).toBe(false);
    expect(canPark(zones, [20, 20])).toBe(false);
    expect(canPark([], [20, 20])).toBe(true);
  });
});

describe("e-scooter on a slope", () => {
  it("holds its speed up gentle climbs and slows on steep ones", () => {
    expect(motorFactor(-0.1)).toBe(1);
    expect(motorFactor(0.05)).toBe(1);
    expect(motorFactor(0.1)).toBeCloseTo(0.82, 2);
    expect(motorFactor(0.3)).toBe(0.35);
  });
});

describe("scooters on real campus data", () => {
  const dir = new URL("../../../apps/web/public/data/", import.meta.url);
  const read = <T>(n: string): T => JSON.parse(readFileSync(new URL(n, dir), "utf8"));
  const graph = new CampusGraph(read<GraphData>("graph.json"));
  const buildings = read<Building[]>("buildings.json");
  const byName = (n: string) => buildings.find((b) => b.name === n)!;
  const parking = parkingSpots(read<{ points: [number, number, number, string, string, string][] }>("campus-places.json").points);

  it("parks at UCSD's Spin hubs and bike racks, named by their building", () => {
    expect(parking.filter((p) => p.kind === "hub").length).toBeGreaterThan(10);
    expect(parking.filter((p) => p.kind === "rack").length).toBeGreaterThan(100);
    expect(parking.find((p) => p.kind === "hub")!.name).toMatch(/^(the Spin hub by .+|a Spin hub)$/);
  });

  it("walks the scooter on Library Walk, even where bikes ride it", () => {
    const e = Array.from({ length: graph.edgeCount }, (_, i) => i).find(
      (i) => graph.edgeName(i) === "Library Walk" && graph.kind(i) === EdgeKind.Bike && graph.edgeBikeDir[i] & BikeDir.NoScooter,
    )!;
    expect(e).toBeDefined();
    expect(edgeTravel(graph, PROFILES.scooter, e, graph.edgeFrom[e]).push).toBe(true);
    expect(edgeTravel(graph, PROFILES.bike, e, graph.edgeFrom[e]).push).toBe(false);
  });

  it("keeps to a zone's speed limit, and walks where the zone stops the motor", () => {
    const e = Array.from({ length: graph.edgeCount }, (_, i) => i).find((i) => graph.kind(i) === EdgeKind.Road && graph.edgeLength[i] > 20)!;
    const slow = edgeTravel(graph, scooterProfile(new Float32Array(graph.edgeCount).fill(2.5)), e, graph.edgeFrom[e]);
    expect(slow.speed).toBeLessThanOrEqual(2.5);
    expect(slow.limited).toBe(true);
    expect(edgeTravel(graph, scooterProfile(new Float32Array(graph.edgeCount).fill(0)), e, graph.edgeFrom[e]).push).toBe(true);
    const zones = geofencingZones(feed([{ box: [-118, 32, -117, 33], rules: [{ ride_allowed: true, ride_through_allowed: true, maximum_speed_kph: 9 }] }]));
    expect(Math.max(...zoneLimits(graph, zones))).toBeCloseTo(2.5, 5);
  });

  const york = byName("York Hall");
  const center = byName("Center Hall");
  const near = (p: LngLat, east: number, north: number): LngLat => [p[0] + east / 93_000, p[1] + north / 111_000];
  const hub: ParkingSpot = { lngLat: near(center.center, 0, -40), name: "the Spin hub by Center Hall", kind: "hub" };

  it("walks to a free scooter, rides it, parks it and walks on", () => {
    const scooters = [
      { id: "low", kind: "scooter" as const, lngLat: near(york.center, 30, 40), battery: 0.05 },
      { id: "ok", kind: "scooter" as const, lngLat: near(york.center, -40, 60), battery: 0.8 },
      { id: "bike", kind: "ebike" as const, lngLat: near(york.center, 10, 10) },
    ];
    const r = planScooterTrip(graph, { kind: "building", building: york }, { kind: "building", building: center }, { scooters, parking: [hub] });
    if (!r.ok) throw new Error(r.error);
    expect(r.trip.scooter.id).toBe("ok");
    expect(r.trip.parking).toBe(hub);
    expect(r.trip.route.legs.map((l) => (l.mode === "bike" ? `ride${l.pickUp ? "+unlock" : ""}` : l.mode))).toEqual(["walk", "ride+unlock", "walk"]);
    const texts = buildSteps(graph, r.trip.route, "Center Hall").map((s) => s.text);
    expect(texts).toContain("Unlock the Spin scooter");
    expect(texts).toContain("Park at the Spin hub by Center Hall and end the ride");
    expect(r.trip.route.seconds).toBeCloseTo(r.trip.walkTo + 30 + r.trip.ride + 45 + r.trip.walkFrom, 6);
  });

  it("re-plans mid-ride from where you are, without fetching another scooter", () => {
    const from = { kind: "point" as const, lngLat: buildingCentre(york), label: "My location" };
    const r = planScooterTrip(graph, from, { kind: "building", building: center }, { scooters: [], parking: [hub], riding: true });
    if (!r.ok) throw new Error(r.error);
    expect(r.trip.route.legs[0].mode).toBe("bike");
    expect(buildSteps(graph, r.trip.route, "Center Hall").map((s) => s.text)).not.toContain("Unlock the Spin scooter");
  });

  it("says when there's no scooter or no parking in reach", () => {
    const trip = (opts: Parameters<typeof planScooterTrip>[3]) => planScooterTrip(graph, { kind: "building", building: york }, { kind: "building", building: center }, opts);
    expect(trip({ scooters: [], parking: [hub] })).toEqual({ ok: false, error: "No Spin scooter free within a 15-minute walk right now." });
    const scooters = [{ id: "s", kind: "scooter" as const, lngLat: near(york.center, -40, 60) }];
    expect(trip({ scooters, parking: [] })).toEqual({ ok: false, error: "No Spin parking within a 15-minute walk of the destination." });
  });
});
