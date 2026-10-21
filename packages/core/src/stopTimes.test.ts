import { describe, expect, it } from "vitest";
import { CampusGraph } from "./graph.ts";
import { EdgeKind, type GraphData } from "./types.ts";
import { TransitNetwork, type TransitData } from "./transit.ts";
import { arrivalsAtStop, linesAtStop, shapesAtStop } from "./stopTimes.ts";

const tiny: GraphData = {
  version: 1,
  generatedAt: "",
  attribution: "",
  bbox: [0, 0, 0, 0],
  coords: [0, 0, 0, 0.06],
  edges: [0, 1, EdgeKind.Path],
  components: [0, 0],
  mainComponent: 0,
  bikeComponents: [0, 0],
  mainBikeComponent: 0,
};

const data: TransitData = {
  version: 1,
  generatedAt: "",
  feeds: [],
  stops: [
    { id: "a", name: "Stop A", lngLat: [0, 0], node: 0 },
    { id: "b", name: "Stop B", lngLat: [0, 0.06], node: 1 },
  ],
  routes: [
    { id: "r30", short: "30", long: "Old Town", color: "#000099", feed: "mts", mode: "bus" },
    { id: "r41", short: "41", long: "Fashion Valley", color: "#000099", feed: "mts", mode: "bus" },
  ],
  fares: {},
  services: [{ days: [true, true, true, true, true, false, false], start: "20260901", end: "20261231", added: [], removed: [] }],
  patterns: [
    {
      route: 0,
      headsign: "UTC",
      stops: [0, 1],
      shape: [[0, 0], [0, 0.06]],
      shapeIndex: [0, 1],
      trips: [
        { service: 0, times: [10 * 3600, 10 * 3600 + 600] },
        { service: 0, times: [10.5 * 3600, 10.5 * 3600 + 600] },
      ],
    },
    {
      route: 1,
      headsign: "Fashion Valley",
      stops: [0, 1],
      shape: [[0, 0], [0, 0.06]],
      shapeIndex: [0, 1],
      trips: [{ service: 0, times: [10 * 3600 + 300, 10 * 3600 + 900] }],
    },
  ],
};

const transit = new TransitNetwork(data, new CampusGraph(tiny));

describe("linesAtStop", () => {
  it("lists every line that calls, with its headsigns", () => {
    const lines = linesAtStop(transit, "a");
    expect(lines.map((l) => l.route.short)).toEqual(["30", "41"]);
    expect(lines[0].headsigns).toEqual(["UTC"]);
  });

  it("is empty for an unknown stop", () => {
    expect(linesAtStop(transit, "nope")).toEqual([]);
  });
});

describe("shapesAtStop", () => {
  it("returns each line's shape through the stop", () => {
    const shapes = shapesAtStop(transit, "a");
    expect(shapes.map((s) => s.route.short)).toEqual(["30", "41"]);
    expect(shapes[0].shape).toEqual([
      [0, 0],
      [0, 0.06],
    ]);
  });

  it("is empty for an unknown stop", () => {
    expect(shapesAtStop(transit, "nope")).toEqual([]);
  });
});

describe("arrivalsAtStop", () => {
  it("returns the next scheduled times after `from`, soonest first", () => {
    const next = arrivalsAtStop(transit, "a", new Date(2026, 9, 7, 9, 55), 5);
    expect(next.map((a) => [a.route.short, a.at.getHours(), a.at.getMinutes()])).toEqual([
      ["30", 10, 0],
      ["41", 10, 5],
      ["30", 10, 30],
    ]);
  });

  it("skips departures that have already left", () => {
    const next = arrivalsAtStop(transit, "a", new Date(2026, 9, 7, 10, 10), 5);
    expect(next.map((a) => a.route.short)).toEqual(["30"]);
    expect(next[0].at.getMinutes()).toBe(30);
  });

  it("is empty when nothing runs that day", () => {
    expect(arrivalsAtStop(transit, "a", new Date(2026, 9, 10, 9, 0))).toEqual([]);
  });
});
