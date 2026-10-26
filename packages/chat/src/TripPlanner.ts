import type { Endpoint } from "@campus/core";
import { compareModes, planMode, type ModePlan, type Planned } from "../../../.cursor/skills/shortest-route/scripts/router.ts";
import type { TravelMode } from "./intent.ts";
import type { ChatCampus } from "./types.ts";

export type { ModePlan, Planned };

/** Walk, bike, transit, and step-free. The fastest is first. */
const COMPARE: TravelMode[] = ["walk", "bike", "bus", "accessible"];

/**
 * Turns a start and an end into one route, with the shortest-route skill's router
 * (.cursor/skills/shortest-route), the same one coding agents run. The map just draws whatever this returns.
 */
export class TripPlanner {
  constructor(private readonly campus: ChatCampus) {}

  /** `arriveBy`: transit picks the buses that get there in time (walking and biking take the same time whenever). */
  plan(from: Endpoint, to: Endpoint, mode: TravelMode, arriveBy?: Date): Planned {
    return planMode(this.campus, from, to, mode, arriveBy);
  }

  /** Every way that works, fastest first. A transit option that is really just walking is left out. */
  compare(from: Endpoint, to: Endpoint, arriveBy?: Date): ModePlan[] {
    return compareModes(this.campus, from, to, COMPARE, arriveBy).plans;
  }
}
