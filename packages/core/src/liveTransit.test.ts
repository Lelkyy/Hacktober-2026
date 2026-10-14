import { describe, expect, it } from "vitest";
import { alongPath, decodePolyline, liveVehicles, measurePath, pathFrom, pointAlong, tripAhead } from "./liveTransit.ts";

describe("live trolleys and buses (OneBusAway vehicles-for-agency)", () => {
  const response = {
    data: {
      list: [
        {
          vehicleId: "MTS_4012",
          tripStatus: {
            activeTripId: "MTS_t1",
            position: { lat: 32.8711, lon: -117.2235 },
            orientation: 90, // north, in OneBusAway's counterclockwise-from-east degrees
            nextStop: "MTS_s1",
            nextStopTimeOffset: 180,
            predicted: true,
          },
        },
        { vehicleId: "MTS_bus", tripStatus: { activeTripId: "MTS_t2", position: { lat: 32.88, lon: -117.24 } } },
        { vehicleId: "MTS_coaster", tripStatus: { activeTripId: "MTS_t3", position: { lat: 32.9, lon: -117.25 } } },
        { vehicleId: "MTS_idle", tripStatus: { position: { lat: 32.7, lon: -117.1 } } },
      ],
      references: {
        trips: [
          { id: "MTS_t1", routeId: "MTS_510", tripHeadsign: "UTC" },
          { id: "MTS_t2", routeId: "MTS_201", tripHeadsign: "UTC" },
          { id: "MTS_t3", routeId: "NCTD_398", tripHeadsign: "Oceanside" },
        ],
        routes: [
          // As MTS publishes them: trolleys named by color, the long name being the route's ends.
          { id: "MTS_510", shortName: "Blue", longName: "San Ysidro - UTC", type: 0, color: "0000FF" },
          { id: "MTS_201", shortName: "201", type: 3 },
          { id: "NCTD_398", shortName: "398", type: 2 },
        ],
        stops: [{ id: "MTS_s1", name: "Nobel Drive", lat: 32.872, lon: -117.2236 }],
      },
    },
  };

  it("keeps trolleys and buses (not trains or vehicles off a trip), with line, direction and next stop", () => {
    expect(liveVehicles(response)).toEqual([
      {
        id: "MTS_4012",
        tripId: "MTS_t1",
        shapeId: undefined,
        distanceAlong: undefined,
        mode: "trolley",
        route: "Blue",
        lngLat: [-117.2235, 32.8711],
        heading: 0,
        line: "Blue Line",
        color: "#0000FF",
        headsign: "UTC",
        nextStop: { name: "Nobel Drive", lngLat: [-117.2236, 32.872], inSeconds: 180 },
        fixAt: undefined,
        predicted: true,
      },
      {
        id: "MTS_bus",
        tripId: "MTS_t2",
        shapeId: undefined,
        distanceAlong: undefined,
        mode: "bus",
        route: "201",
        lngLat: [-117.24, 32.88],
        heading: undefined,
        line: "201",
        color: "#4A6497",
        headsign: "UTC",
        nextStop: undefined,
        fixAt: undefined,
        predicted: false,
      },
    ]);
  });

  it("turns OneBusAway's orientation into a compass heading", () => {
    const at = (orientation: number) =>
      liveVehicles({ data: { ...response.data, list: [{ ...response.data.list[0], tripStatus: { ...response.data.list[0].tripStatus, orientation } }] } })[0].heading;
    expect(at(0)).toBe(90); // east
    expect(at(180)).toBe(270); // west
    expect(at(270)).toBe(180); // south
  });
});

describe("a vehicle's trip ahead", () => {
  it("decodes encoded polylines", () => {
    // Google's documented example.
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it("gives the path from where the vehicle is to the end, and the stops still to come with their times", () => {
    // A straight north-south trip ~333 m long; the vehicle is 150 m along, 2 minutes late.
    const path: [number, number][] = [
      [0, 0],
      [0, 0.001],
      [0, 0.002],
      [0, 0.003],
    ];
    const day = Date.UTC(2026, 9, 14, 7); // midnight in San Diego
    const ahead = tripAhead(
      {
        data: {
          entry: {
            schedule: {
              stopTimes: [
                { stopId: "a", arrivalTime: 36000, distanceAlongTrip: 0 },
                { stopId: "b", arrivalTime: 36060, distanceAlongTrip: 111 },
                { stopId: "c", arrivalTime: 36120, distanceAlongTrip: 222 },
                { stopId: "d", arrivalTime: 36180, distanceAlongTrip: 333 },
              ],
            },
            status: { distanceAlongTrip: 150, scheduleDeviation: 120, serviceDate: day },
          },
          references: {
            stops: ["a", "b", "c", "d"].map((id, k) => ({ id, name: `Stop ${id.toUpperCase()}`, lat: k * 0.001, lon: 0 })),
          },
        },
      },
      path,
    );
    expect(ahead.stops.map((s) => s.name)).toEqual(["Stop C", "Stop D"]);
    expect(ahead.stops[0].at).toBe(day + (36120 + 120) * 1000);
    expect(ahead.path[0][1]).toBeCloseTo(150 / 111_195 * 1, 4);
    expect(ahead.path.at(-1)).toEqual([0, 0.003]);
    expect(ahead.path.length).toBe(3);
  });
});

describe("moving along a path", () => {
  // North ~111 m, then east ~93 m (at the equator, 0.001° of longitude is ~111 m too).
  const path = measurePath([
    [0, 0],
    [0, 0.001],
    [0.001, 0.001],
  ]);

  it("finds the point a distance along, with the way the path heads there", () => {
    expect(path.length).toBeCloseTo(222.4, 0);
    const halfway = pointAlong(path, 55.6);
    expect(halfway.lngLat[1]).toBeCloseTo(0.0005, 5);
    expect(halfway.heading).toBeCloseTo(0, 0);
    const round = pointAlong(path, 170);
    expect(round.lngLat[1]).toBeCloseTo(0.001, 6);
    expect(round.heading).toBeCloseTo(90, 0);
    // Off the ends: held at them.
    expect(pointAlong(path, 999).lngLat).toEqual([0.001, 0.001]);
    expect(pointAlong(path, -5).lngLat).toEqual([0, 0]);
  });

  it("gives the rest of the path from a point along it (nothing behind)", () => {
    const rest = pathFrom(path, 55.6);
    expect(rest).toHaveLength(3);
    expect(rest[0][1]).toBeCloseTo(0.0005, 5);
    expect(rest.slice(1)).toEqual([
      [0, 0.001],
      [0.001, 0.001],
    ]);
    expect(pathFrom(path, 999)).toHaveLength(1);
  });

  it("finds how far along the path a stop is, from a point on", () => {
    // A stop just east of the first leg's middle, and one beside the second leg.
    expect(alongPath(path, [0.00002, 0.0005])).toBeCloseTo(55.6, 0);
    expect(alongPath(path, [0.0005, 0.00102])).toBeCloseTo(166.8, 0);
    // Looking only from 120 m on, the first one maps to where the path is nearest after that.
    expect(alongPath(path, [0.00002, 0.0005], 120)).toBeGreaterThanOrEqual(120);
  });
});
