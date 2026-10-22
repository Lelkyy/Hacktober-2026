import { MODES, planRoute, transitOptions, type Endpoint, type ModeId, type Route } from "@campus/core";
import type { Campus } from "../campus/loadCampus.ts";

/** Turns a start and an end into one route. The map just draws whatever this returns. */
export class TripPlanner {
  constructor(private readonly campus: Campus) {}

  plan(from: Endpoint, to: Endpoint, mode: ModeId): { route: Route | null; note: string } {
    if (mode === "bus") {
      const found = transitOptions(this.campus.graph, from, to, { transit: this.campus.transit, timing: {} });
      const best = found.options.find((o) => !o.walkOnly) ?? found.options[0];
      if (!best) return { route: null, note: found.error ?? "No transit route." };
      const note = best.walkOnly ? "Walking is as fast as the bus." : `Transit, about ${Math.ceil(best.route.minutes)} min.`;
      return { route: best.route, note };
    }
    const planned = planRoute(this.campus.graph, from, to, { profile: MODES[mode].profile });
    if (!planned.ok) return { route: null, note: planned.error };
    return { route: planned.route, note: `${MODES[mode].label}, about ${Math.ceil(planned.route.minutes)} min.` };
  }
}
