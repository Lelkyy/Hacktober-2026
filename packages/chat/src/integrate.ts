import type { Intent, TravelMode } from "./intent.ts";
import { resolveHall } from "./menus.ts";

/** Same three flags as the shortest-route script. */
export interface TripSlots {
  from?: string;
  to?: string;
  mode?: TravelMode;
  via?: string[];
}

const GOING = /\b(take me|get to|go to|going to|directions|how do i|head(?:ing)? (?:to|toward)|route to|navigate)\b/i;
const INVENTED_PATH =
  /\b(\d+\s*min(?:utes?)?|turn\b|head (?:north|south|east|west)|walk (?:north|south|east|west|to|toward)|via \w+ (?:walk|drive|road|ave)|leave by|arrive(?: at)?)\b/i;

/** Destination the path graph can route to. `trip.to` and `route.place` are the same slot. */
export function tripTo(intent: Intent): string | undefined {
  return intent.place ?? intent.to;
}

/** Bind an intent to shortest-route `--from` `--to` `--mode`. */
export function tripSlots(intent: Intent): TripSlots {
  return { from: intent.from, to: tripTo(intent), mode: intent.mode, via: intent.via };
}

export function inventedReply(reply: string | undefined): boolean {
  return !!reply && INVENTED_PATH.test(reply);
}

/** Copy `to` onto `place` so Assistant can plan the walk. */
export function bindTrip(intent: Intent): Intent {
  const dest = tripTo(intent);
  if (!dest) return intent;
  if (intent.action === "route" || intent.action === "class" || intent.action === "nearby" || intent.action === "next") {
    intent.place ??= dest;
    if (intent.action === "route") intent.to ??= dest;
  }
  return intent;
}

/**
 * After the model picks a tool, recover a campus action it dropped and line
 * the slots up with shortest-route. The app writes the reply from the graph.
 */
export function integrateIntent(intent: Intent, local: Intent, message: string): Intent {
  if (intent.action === "other" && local.action !== "other") {
    const recovered: Intent = { ...local, heard: intent.heard ?? local.heard, via: local.via ?? intent.via };
    delete recovered.reply;
    return bindTrip(recovered);
  }
  if (!intent.via?.length && local.via?.length) intent.via = local.via;
  if (intent.action === "other" && inventedReply(intent.reply)) delete intent.reply;

  // A hall as the destination is a trip, not a menu.
  if (
    intent.action === "order" &&
    !intent.item &&
    !intent.along &&
    intent.minPrice == null &&
    intent.maxPrice == null &&
    GOING.test(message)
  ) {
    const hall = intent.place ?? resolveHall(message);
    if (hall) {
      intent.action = "route";
      intent.place = hall;
      intent.to = hall;
    }
  }

  if (intent.action === "route" && !intent.place) intent.place = local.place ?? local.to ?? intent.to;
  return bindTrip(intent);
}
