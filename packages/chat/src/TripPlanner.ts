import { MODES, planRoute, primaryTransit, transitOptions, type Endpoint, type ModeId, type Route } from "@campus/core";
import type { TravelMode } from "./intent.ts";
import type { ChatCampus } from "./types.ts";

export type Planned =
  | { ok: true; route: Route; minutes: number; /** Transit only: walking is as fast. */ walkInstead?: boolean }
  | { ok: false; error: string };

/** One way to make the trip, with its door-to-door time. */
export interface ModePlan {
  mode: TravelMode;
  planned: Extract<Planned, { ok: true }>;
}

/** Asked for nothing: walk and transit. Whichever is faster comes first. */
const DEFAULT_MODES: TravelMode[] = ["walk", "bus"];

/** Join hop-by-hop routes. Do not skip a named stop. */
export function stitchRoutes(parts: Route[]): Route {
  if (parts.length === 1) return parts[0];
  const coordinates = parts.flatMap((part, index) => (index === 0 ? part.coordinates : part.coordinates.slice(1)));
  const seconds = parts.reduce((sum, part) => sum + part.seconds, 0);
  return {
    legs: parts.flatMap((part) => part.legs),
    coordinates,
    meters: parts.reduce((sum, part) => sum + part.meters, 0),
    seconds,
    minutes: seconds / 60,
    stairSegments: parts.reduce((sum, part) => sum + part.stairSegments, 0),
    leaveAt: parts[0].leaveAt,
    arriveAt: parts[parts.length - 1].arriveAt,
    usesTransit: parts.some((part) => part.usesTransit),
  };
}

/** Turns a start and an end into one route. The map just draws whatever this returns. */
export class TripPlanner {
  /** The last comparison, so a food detour and the trip itself share one routing pass. */
  private cached: { key: string; plans: ModePlan[] } | null = null;

  constructor(private readonly campus: ChatCampus) {}

  /** `arriveBy`: transit picks the buses that get there in time (walking and biking take the same time whenever). */
  plan(from: Endpoint, to: Endpoint, mode: ModeId, arriveBy?: Date, via: Endpoint[] = []): Planned {
    if (!via.length) return this.leg(from, to, mode, arriveBy);
    const hops = [from, ...via, to];
    const parts: Route[] = [];
    let walkInstead = false;
    for (let i = 0; i < hops.length - 1; i++) {
      const last = i === hops.length - 2;
      const planned = this.leg(hops[i], hops[i + 1], mode, last ? arriveBy : undefined);
      if (!planned.ok) return planned;
      parts.push(planned.route);
      if (planned.walkInstead) walkInstead = true;
    }
    const route = stitchRoutes(parts);
    return { ok: true, route, minutes: route.minutes, walkInstead };
  }

  /**
   * Walk and transit, fastest first, plus `asked` when they named a way (bike, Spin, no stairs).
   * A transit option that is really just walking is left out, because the walk is already listed.
   */
  compare(from: Endpoint, to: Endpoint, arriveBy?: Date, via: Endpoint[] = [], asked?: TravelMode): ModePlan[] {
    const modes = asked && !DEFAULT_MODES.includes(asked) ? [...DEFAULT_MODES, asked] : DEFAULT_MODES;
    const key = `${endpointKey(from)}>${via.map(endpointKey).join(">")}${via.length ? ">" : ""}${endpointKey(to)}@${arriveBy ? Math.floor(arriveBy.getTime() / 60_000) : ""}#${modes.join(",")}`;
    if (this.cached?.key === key) return this.cached.plans;
    const plans: ModePlan[] = [];
    for (const mode of modes) {
      const planned = this.plan(from, to, mode, arriveBy, via);
      if (!planned.ok || (mode === "bus" && planned.walkInstead)) continue;
      plans.push({ mode, planned });
    }
    plans.sort((a, b) => a.planned.route.seconds - b.planned.route.seconds);
    this.cached = { key, plans };
    return plans;
  }

  private leg(from: Endpoint, to: Endpoint, mode: ModeId, arriveBy?: Date): Planned {
    if (mode === "bus") {
      const timing = arriveBy && arriveBy.getTime() > Date.now() ? { arriveBy } : {};
      const found = transitOptions(this.campus.graph, from, to, {
        transit: this.campus.transit,
        timing,
        stepFree: this.campus.transitStepFree,
      });
      const best = primaryTransit(found.options);
      if (!best) return { ok: false, error: found.error ?? "No transit route." };
      return { ok: true, route: best.route, minutes: best.route.minutes, walkInstead: best.walkOnly };
    }
    const planned = planRoute(this.campus.graph, from, to, { profile: MODES[mode].profile, arriveBy });
    if (!planned.ok) return { ok: false, error: planned.error };
    return { ok: true, route: planned.route, minutes: planned.route.minutes };
  }
}

function endpointKey(endpoint: Endpoint): string {
  if (endpoint.kind === "point") return `pt:${endpoint.lngLat[0].toFixed(5)},${endpoint.lngLat[1].toFixed(5)}`;
  if (endpoint.kind === "place") return `pl:${endpoint.place.id}`;
  return `b:${endpoint.building.id}:${endpoint.room ?? ""}`;
}
