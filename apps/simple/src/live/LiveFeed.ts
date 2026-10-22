import { decodeVehiclePositions, liveVehicles, type LiveRoute, type LiveVehicle } from "@campus/core";
import { settings } from "../settings.ts";

const MTS = "https://realtime.sdmts.com/api/api";
const KEY: string | undefined = import.meta.env.VITE_MTS_KEY || undefined;

/**
 * Asks MTS for every bus and trolley, then calls you with the list.
 * One method does the request. The timer only repeats it.
 */
export class LiveFeed {
  private timer = 0;
  private previous = new Map<string, LiveVehicle>();
  private routes: Map<string, LiveRoute> | null = null;

  constructor(private readonly onVehicles: (vehicles: LiveVehicle[]) => void, private readonly onError: (message: string) => void) {}

  start(): void {
    if (!KEY && !settings.livePositionsUrl) {
      this.onError("No MTS key. Put VITE_MTS_KEY in apps/web/.env.local.");
      return;
    }
    void this.tick();
    this.timer = window.setInterval(() => void this.tick(), settings.livePollMs);
  }

  stop(): void {
    window.clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    try {
      const vehicles = await this.fetchVehicles();
      this.previous = new Map(vehicles.map((v) => [v.id, v]));
      this.onVehicles(vehicles);
    } catch (err) {
      this.onError(err instanceof Error ? err.message : "Live feed failed");
    }
  }

  private async fetchVehicles(): Promise<LiveVehicle[]> {
    const url = settings.livePositionsUrl || `${MTS}/gtfs_realtime/vehicle-positions-for-agency/MTS.pb?key=${encodeURIComponent(KEY!)}`;
    const [routes, res] = await Promise.all([this.routeList(), fetch(url)]);
    if (!res.ok) throw new Error(`MTS HTTP ${res.status}`);
    const feed = decodeVehiclePositions(new Uint8Array(await res.arrayBuffer()));
    return liveVehicles(feed.fixes, routes, { before: this.previous });
  }

  /** Route names and colors. Downloaded once. */
  private async routeList(): Promise<Map<string, LiveRoute>> {
    if (this.routes) return this.routes;
    if (settings.livePositionsUrl) return (this.routes = new Map());
    const res = await fetch(`${MTS}/where/routes-for-agency/MTS.json?key=${encodeURIComponent(KEY!)}`);
    if (!res.ok) throw new Error(`MTS routes HTTP ${res.status}`);
    const json = (await res.json()) as { data?: { list?: LiveRoute[] } };
    this.routes = new Map((json.data?.list ?? []).map((r) => [r.id, r]));
    return this.routes;
  }
}
