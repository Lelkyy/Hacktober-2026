import { describe, expect, it } from "vitest";
import { CampusGraph } from "./graph.ts";
import { EdgeKind, type GraphData } from "./types.ts";
import { TransitNetwork, type TransitData } from "./transit.ts";
import { approachBearings, arrivalsAtStop, clusterSameNameStops, linesAtStop, routesPassing, shapesAtStop, sharedApproach, stopsOnLinesThrough } from "./stopTimes.ts";

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

describe("routesPassing", () => {
  it("picks the lines whose shape runs past an unscheduled stop", () => {
    const lines = routesPassing(transit, [0, 0.03]);
    expect(lines.map((l) => l.route.short).sort()).toEqual(["30", "41"]);
  });

  it("is empty far from every line", () => {
    expect(routesPassing(transit, [5, 5])).toEqual([]);
  });
});

describe("stopsOnLinesThrough", () => {
  it("includes every stop on the lines that call here", () => {
    expect(stopsOnLinesThrough(transit, ["a"]).sort()).toEqual(["a", "b"]);
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

describe("shapesAtStop opposite directions", () => {
  it("keeps one shape when both ways of a line share the track", () => {
    const bothWays: TransitData = {
      ...data,
      patterns: [
        ...data.patterns,
        {
          route: 0,
          headsign: "Old Town",
          stops: [1, 0],
          shape: [
            [0, 0.06],
            [0, 0],
          ],
          shapeIndex: [0, 1],
          trips: [{ service: 0, times: [11 * 3600, 11 * 3600 + 600] }],
        },
      ],
    };
    const net = new TransitNetwork(bothWays, new CampusGraph(tiny));
    const shapes = shapesAtStop(net, "a");
    expect(shapes.filter((s) => s.route.short === "30")).toHaveLength(1);
    expect(shapes.map((s) => s.route.short)).toEqual(["30", "41"]);
  });
});

describe("approachBearings", () => {
  it("is north for a northbound shape", () => {
    const [heading] = approachBearings(transit, "a");
    expect(heading).toBeCloseTo(0, 0);
  });

  it("hides the arrow when the two directions disagree", () => {
    const bothWays: TransitData = {
      ...data,
      patterns: [
        ...data.patterns,
        {
          route: 0,
          headsign: "Old Town",
          stops: [1, 0],
          shape: [
            [0, 0.06],
            [0, 0],
          ],
          shapeIndex: [0, 1],
          trips: [{ service: 0, times: [11 * 3600, 11 * 3600 + 600] }],
        },
      ],
    };
    const net = new TransitNetwork(bothWays, new CampusGraph(tiny));
    expect(sharedApproach(approachBearings(net, "a"))).toBeNull();
  });

  it("keeps one heading when every line agrees", () => {
    expect(sharedApproach([2, 8, 355])).toBeCloseTo(1.7, 0);
    expect(sharedApproach([])).toBeNull();
  });
});

describe("clusterSameNameStops", () => {
  it("groups two platforms of the same station", () => {
    const a = { id: "a", name: "UTC", lngLat: [-117.235, 32.877] as [number, number], node: 0 };
    const b = { id: "b", name: "UTC", lngLat: [-117.2351, 32.8771] as [number, number], node: 0 };
    const far = { id: "c", name: "UTC", lngLat: [-117.21, 32.86] as [number, number], node: 1 };
    const other = { id: "d", name: "Nobel", lngLat: [-117.23505, 32.87705] as [number, number], node: 0 };
    const groups = clusterSameNameStops([a, b, far, other]);
    const utc = groups.filter((g) => g[0].name === "UTC");
    expect(utc).toHaveLength(2);
    expect(utc.find((g) => g.length === 2)?.map((s) => s.id).sort()).toEqual(["a", "b"]);
    expect(utc.find((g) => g.length === 1)?.[0].id).toBe("c");
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
