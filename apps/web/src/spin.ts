import { freeVehicles, geofencingZones, type RideZone, type SharedBike } from "@campus/core";

/**
 * Spin's public GBFS feeds for San Diego (the UCSD fleet), listed in its index at
 * https://mds.bird.co/gbfs/v2/public/provider/spin/san_diego/gbfs.json. The index itself
 * doesn't allow browsers to read it; these feeds do.
 */
const FEED = "https://gbfs.spin.pm/api/gbfs/v2_3/san_diego";
/** How often the feed updates (its `ttl`). */
export const SPIN_REFRESH_MS = 60_000;

const get = async (name: string) => {
  const res = await fetch(`${FEED}/${name}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Spin ${name}: HTTP ${res.status}`);
  return res.json();
};

/** Spin e-bikes and scooters free to ride right now. */
export async function fetchSpinVehicles(): Promise<SharedBike[]> {
  const [types, status] = await Promise.all([get("vehicle_types"), get("free_bike_status")]);
  return freeVehicles(types, status);
}

/**
 * Spin's zones for scooters: where you can't ride (the motor stops), where you can ride through
 * but not end a ride, where rides can end, and any speed limits.
 */
export async function fetchSpinZones(): Promise<RideZone[]> {
  const [types, zones] = await Promise.all([get("vehicle_types"), get("geofencing_zones")]);
  const scooterTypes = (types.data.vehicle_types as { vehicle_type_id: string; form_factor: string }[])
    .filter((t) => t.form_factor.startsWith("scooter"))
    .map((t) => t.vehicle_type_id);
  return geofencingZones(zones, scooterTypes);
}
