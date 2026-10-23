import { haversine } from "./geo.ts";
import type { LngLat } from "./types.ts";

/**
 * Shared vehicles from a GBFS feed (General Bikeshare Feed Specification, v2.x): the e-bikes and
 * scooters free to ride now, from `vehicle_types` and `free_bike_status`.
 */
export interface SharedBike {
  id: string;
  kind: "ebike" | "scooter";
  lngLat: LngLat;
  /** Battery charge, 0–1, when the feed says. */
  battery?: number;
  /** How far it can go on its charge, in meters, when the feed says. */
  rangeMeters?: number;
}

interface GbfsVehicleTypes {
  data: { vehicle_types: { vehicle_type_id: string; form_factor: string; propulsion_type?: string }[] };
}
interface GbfsFreeBikeStatus {
  data: {
    bikes: {
      bike_id: string;
      lat: number;
      lon: number;
      is_disabled?: boolean | number;
      is_reserved?: boolean | number;
      vehicle_type_id?: string;
      current_fuel_percent?: number;
      current_range_meters?: number;
    }[];
  };
}

/**
 * The e-bikes (bicycles with any motor) and scooters you could ride now: not reserved, not out of
 * order. Pedal bikes, cars and anything else are left out.
 */
export function freeVehicles(types: GbfsVehicleTypes, status: GbfsFreeBikeStatus): SharedBike[] {
  const kinds = new Map<string, SharedBike["kind"]>();
  for (const t of types.data.vehicle_types) {
    if (t.form_factor === "bicycle" && t.propulsion_type !== "human") kinds.set(t.vehicle_type_id, "ebike");
    else if (t.form_factor.startsWith("scooter")) kinds.set(t.vehicle_type_id, "scooter");
  }
  return status.data.bikes
    .filter((b) => b.vehicle_type_id && kinds.has(b.vehicle_type_id) && !b.is_disabled && !b.is_reserved)
    .map((b) => ({
      id: b.bike_id,
      kind: kinds.get(b.vehicle_type_id!)!,
      lngLat: [b.lon, b.lat] as LngLat,
      battery: b.current_fuel_percent,
      rangeMeters: b.current_range_meters,
    }));
}

/** Scooters this close are one pile: GPS wanders a few meters, so a rack looks like a swarm. */
const CLUSTER_M = 20;

export interface VehicleCluster {
  kind: SharedBike["kind"];
  /** Where the pin sits: the optimal vehicle in the group, not the average of the GPS noise. */
  lngLat: LngLat;
  count: number;
  /** Fullest battery in the group, 0–1. */
  battery?: number;
  /** The one you'd take: fullest battery. */
  vehicle: SharedBike;
}

/**
 * Nearby vehicles of the same kind become one pin. E-bikes and scooters stay separate.
 */
export function clusterVehicles(vehicles: SharedBike[], withinM = CLUSTER_M): VehicleCluster[] {
  const parent = vehicles.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      if (vehicles[i].kind !== vehicles[j].kind) continue;
      if (haversine(vehicles[i].lngLat[0], vehicles[i].lngLat[1], vehicles[j].lngLat[0], vehicles[j].lngLat[1]) <= withinM) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, SharedBike[]>();
  vehicles.forEach((v, i) => {
    const r = find(i);
    const g = groups.get(r) ?? [];
    g.push(v);
    groups.set(r, g);
  });
  return [...groups.values()].map((members) => {
    const vehicle = members.reduce((best, v) => {
      const charge = (v.battery ?? -1) - (best.battery ?? -1);
      if (charge !== 0) return charge > 0 ? v : best;
      return (v.rangeMeters ?? 0) > (best.rangeMeters ?? 0) ? v : best;
    });
    return {
      kind: vehicle.kind,
      lngLat: vehicle.lngLat,
      count: members.length,
      ...(vehicle.battery !== undefined ? { battery: vehicle.battery } : {}),
      vehicle,
    };
  });
}

/** Green, amber, or red from a 0–1 charge. Spin orange when the feed doesn't say. */
export function batteryColor(battery?: number): string {
  if (battery === undefined) return "#FF5A1F";
  if (battery >= 0.5) return "#2F7A3A";
  if (battery >= 0.25) return "#D9732B";
  return "#C2415B";
}
