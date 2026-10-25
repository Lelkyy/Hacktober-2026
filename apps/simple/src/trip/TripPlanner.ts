import { MODES, planRoute, transitOptions, type Endpoint, type ModeId, type Route } from "@campus/core";
import type { Campus } from "../campus/loadCampus.ts";

export type Planned =
  | { ok: true; route: Route; minutes: number; /** Transit only: walking is as fast. */ walkInstead?: boolean }
  | { ok: false; error: string };

/** Turns a start and an end into one route. The map just draws whatever this returns. */
export class TripPlanner {
  constructor(private readonly campus: Campus) {}

  /** `arriveBy`: transit picks the buses that get there in time (walking and biking take the same time whenever). */
  plan(from: Endpoint, to: Endpoint, mode: ModeId, arriveBy?: Date): Planned {
    if (mode === "bus") {
      const timing = arriveBy && arriveBy.getTime() > Date.now() ? { arriveBy } : {};
      const found = transitOptions(this.campus.graph, from, to, { transit: this.campus.transit, timing });
      const best = found.options.find((o) => !o.walkOnly) ?? found.options[0];
      if (!best) return { ok: false, error: found.error ?? "No transit route." };
      return { ok: true, route: best.route, minutes: best.route.minutes, walkInstead: best.walkOnly };
    }
    const planned = planRoute(this.campus.graph, from, to, { profile: MODES[mode].profile });
    if (!planned.ok) return { ok: false, error: planned.error };
    return { ok: true, route: planned.route, minutes: planned.route.minutes };
  }
}
