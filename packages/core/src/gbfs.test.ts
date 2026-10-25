import { describe, expect, it } from "vitest";
import { clusterVehicles, freeVehicles } from "./gbfs.ts";

describe("GBFS vehicles", () => {
  const types = {
    data: {
      vehicle_types: [
        { vehicle_type_id: "scooter", form_factor: "scooter", propulsion_type: "electric" },
        { vehicle_type_id: "ebike", form_factor: "bicycle", propulsion_type: "electric_assist" },
        { vehicle_type_id: "pedal", form_factor: "bicycle", propulsion_type: "human" },
      ],
    },
  };
  const bike = (id: string, type: string, extra = {}) => ({ bike_id: id, lat: 32.88, lon: -117.24, vehicle_type_id: type, ...extra });

  it("keeps e-bikes and scooters free to ride, not pedal bikes, reserved or broken ones", () => {
    const status = {
      data: {
        bikes: [
          bike("a", "ebike", { current_fuel_percent: 0.7, current_range_meters: 40000 }),
          bike("b", "scooter"),
          bike("c", "pedal"),
          bike("d", "ebike", { is_reserved: true }),
          bike("e", "ebike", { is_disabled: 1 }),
        ],
      },
    };
    expect(freeVehicles(types, status)).toEqual([
      { id: "a", kind: "ebike", lngLat: [-117.24, 32.88], battery: 0.7, rangeMeters: 40000 },
      { id: "b", kind: "scooter", lngLat: [-117.24, 32.88], battery: undefined, rangeMeters: undefined },
    ]);
  });

  it("groups scooters a few meters apart and keeps the fullest battery", () => {
    const here: [number, number] = [-117.24, 32.88];
    const beside: [number, number] = [-117.24 + 8 / 93000, 32.88];
    const far: [number, number] = [-117.24 + 80 / 93000, 32.88];
    const groups = clusterVehicles([
      { id: "low", kind: "scooter", lngLat: here, battery: 0.2 },
      { id: "full", kind: "scooter", lngLat: beside, battery: 0.9 },
      { id: "other", kind: "scooter", lngLat: far, battery: 0.4 },
      { id: "bike", kind: "ebike", lngLat: here, battery: 0.5 },
    ]);
    const pile = groups.find((g) => g.count === 2);
    expect(pile?.vehicle.id).toBe("full");
    expect(pile?.battery).toBe(0.9);
    expect(groups.filter((g) => g.kind === "scooter")).toHaveLength(2);
    expect(groups.find((g) => g.kind === "ebike")?.count).toBe(1);
  });
});
