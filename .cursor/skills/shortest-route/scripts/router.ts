/**
 * The shortest-route skill's router: plans each way to make a trip and puts the
 * fastest first. The command line (shortest-route.ts) and the app's Gemma chat
 * (@campus/chat's TripPlanner) both route with this, so they always agree.
 */
import {
  MODES,
  planRoute,
  transitOptions,
  type CampusGraph,
  type Endpoint,
  type Route,
  type TransitNetwork,
} from "@campus/core";

/** Ways a person can name. The default trip is only walk and transit. */
export type SkillMode = "walk" | "accessible" | "bike" | "bus";

export const SKILL_MODES: SkillMode[] = ["walk", "accessible", "bike", "bus"];
/** No mode named: walk or transit, whichever is faster. */
export const DEFAULT_MODES: SkillMode[] = ["walk", "bus"];

/** What routing needs: the path graph and the bus and trolley timetables. */
export interface RouterData {
  graph: CampusGraph;
  transit: TransitNetwork;
}

export type Planned =
  | { ok: true; route: Route; minutes: number; /** Transit only: walking is as fast. */ walkInstead?: boolean }
  | { ok: false; error: string };

/** One way to make the trip, with its door-to-door time. */
export interface ModePlan {
  mode: SkillMode;
  planned: Extract<Planned, { ok: true }>;
}

export interface Compared {
  /** Every way that works, fastest first. */
  plans: ModePlan[];
  /** The ways that don't, and why. */
  failed: { mode: SkillMode; error: string }[];
}

/** One way to make the trip. `arriveBy`: transit picks the buses that get there in time. */
export function planMode(data: RouterData, from: Endpoint, to: Endpoint, mode: SkillMode, arriveBy?: Date): Planned {
  if (mode === "bus") {
    const timing = arriveBy && arriveBy.getTime() > Date.now() ? { arriveBy } : {};
    const found = transitOptions(data.graph, from, to, { transit: data.transit, timing });
    const best = found.options.find((o) => !o.walkOnly) ?? found.options[0];
    if (!best) return { ok: false, error: found.error ?? "No transit route." };
    return { ok: true, route: best.route, minutes: best.route.minutes, walkInstead: best.walkOnly };
  }
  const planned = planRoute(data.graph, from, to, { profile: MODES[mode].profile, arriveBy });
  if (!planned.ok) return { ok: false, error: planned.error };
  return { ok: true, route: planned.route, minutes: planned.route.minutes };
}

/**
 * Each of `modes`, fastest door-to-door time first. Transit that is really just
 * walking is left out when walking is compared too, because the walk is already listed.
 */
export function compareModes(
  data: RouterData,
  from: Endpoint,
  to: Endpoint,
  modes: SkillMode[] = DEFAULT_MODES,
  arriveBy?: Date,
): Compared {
  const plans: ModePlan[] = [];
  const failed: Compared["failed"] = [];
  for (const mode of modes) {
    const planned = planMode(data, from, to, mode, arriveBy);
    if (!planned.ok) failed.push({ mode, error: planned.error });
    else if (mode === "bus" && planned.walkInstead && modes.includes("walk")) failed.push({ mode, error: "Walking is as fast." });
    else plans.push({ mode, planned });
  }
  plans.sort((a, b) => a.planned.route.seconds - b.planned.route.seconds);
  return { plans, failed };
}
