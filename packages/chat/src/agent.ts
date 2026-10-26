import { integrateIntent } from "./integrate.ts";
import { cleanIntent, type Intent } from "./intent.ts";
import { skillPrompt } from "./skills.ts";

/** The one tool the model may call. The app runs it; the model does not write the answer. */
export const AGENT_TOOLS = ["trip", "food", "nearby", "classes", "stop", "say"] as const;

export type AgentTool = (typeof AGENT_TOOLS)[number];

/**
 * A small schema on purpose. The long intent schema is about 1,500 tokens of
 * instructions, and a local model spends its time on those tokens.
 */
export const AGENT_SCHEMA = {
  type: "object",
  properties: {
    tool: { type: "string", enum: AGENT_TOOLS },
    to: { type: "string" },
    from: { type: "string" },
    place: { type: "string" },
    item: { type: "string" },
    course: { type: "string" },
    what: { type: "string" },
    mode: { type: "string", enum: ["walk", "accessible", "bike", "scooter", "bus"] },
    maxPrice: { type: "number" },
    minPrice: { type: "number" },
    maxInclusive: { type: "boolean" },
    along: { type: "boolean" },
    via: { type: "array", items: { type: "string" } },
    quantity: { type: "number" },
    inMinutes: { type: "number" },
    at: { type: "string" },
    day: { type: "string" },
    meeting: { type: "string", enum: ["lecture", "discussion", "lab", "midterm", "final"] },
    action: { type: "string", enum: ["next", "add", "drop", "classes", "day", "class", "change"] },
    reply: { type: "string" },
    remember: { type: "array", items: { type: "string" } },
  },
  required: ["tool"],
} as const;

/**
 * One turn:
 * 1. The local reader handles a clear request, with no model call.
 * 2. A hard request gets this prompt, the skills that line needs, and one tool call.
 * 3. The app runs the tool on campus data (places, menus, the path graph).
 */
export function agentPrompt(now: Date, facts: string[], message = "", local?: Intent): string {
  const when = `${now.toLocaleDateString("en-US", { weekday: "long" })} ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  const known = facts.length ? ` Remembered, unless this message says otherwise: ${facts.join("; ")}.` : "";
  return `It is ${when}. Call one campus tool. Return one JSON object and nothing else.${known}
tool is trip, food, nearby, classes, stop, or say.
trip: going somewhere, including to a class ("math 20C in 30 minutes" is a trip, with course and inMinutes). to, from, via (extra stops before to, in order), mode only when they named one (walk, bike, scooter for a Spin bike, bus for transit, or accessible), course, meeting, inMinutes, at (HH:MM), day. Leave mode out to let the app pick the faster of walk or transit.
food: a dish, a price, or food on the way. item is the dish only. maxPrice, minPrice, quantity, place (a dining hall only), to (where they are going), from, along true when the food should be near the route. "under 10" is maxPrice 10, not a dish and not a time.
nearby: the closest restroom, water, coffee, food, printer, parking, bike rack, or ATM. what, place.
classes: their schedule. action is next, add, drop, classes, or day. course, day.
stop: the next bus. place is the stop; leave it out for the nearest stop.
say: anything else. reply answers what they said in one short sentence. If it is not a campus question, say so and name the closest thing you can do. Never invent a room, a time, or a route.
trip.to is the destination (shortest-route --to). trip.from is --from. The app runs the graph and writes the answer.
Fix place typos (mur is Muir). Leave out fields the message does not say. A follow-up only changes the previous request.
${skillPrompt(message, local)}`;
}

/** The model's tool call, with any slot it skipped filled from the local read. */
export function intentFromAgent(raw: unknown, local: Intent, message: string, isCourse: (code: string) => boolean): Intent | null {
  if (!raw || typeof raw !== "object") return null;
  const record = { ...(raw as Record<string, unknown>) };
  const tool = typeof record.tool === "string" ? record.tool : undefined;
  const action = actionForTool(tool, record);
  if (action) record.action = action;
  if (record.action === "route" && typeof record.place !== "string" && typeof record.to === "string") record.place = record.to;
  const cleaned = cleanIntent(record);
  if (!cleaned) return null;
  return integrateIntent(fillFromLocal(cleaned, local, message, isCourse), local, message);
}

/** Smaller models answer faster. `e4b` is 4, `12b` is 12. Unknown sizes sort last. */
export function modelSize(id: string): number {
  const match = id.match(/(\d+(?:\.\d+)?)b/i);
  return match ? Number(match[1]) : 99;
}

function actionForTool(tool: string | undefined, record: Record<string, unknown>): Intent["action"] | undefined {
  if (tool === "food") return "order";
  if (tool === "nearby") return "nearby";
  if (tool === "stop") return "stop";
  if (tool === "say") return "other";
  if (tool === "trip") return typeof record.course === "string" && record.course.trim() ? "class" : "route";
  if (tool === "classes") {
    const action = record.action;
    if (action === "add" || action === "drop" || action === "classes" || action === "day" || action === "next" || action === "class") return action;
    if (typeof record.course === "string" && record.course.trim()) return "class";
    if (typeof record.day === "string" && record.day.trim()) return "day";
    return "next";
  }
  return undefined;
}

const SLOT_KEYS = ["from", "to", "place", "mode", "what", "meeting", "day", "at", "inMinutes", "quantity", "minPrice", "maxPrice", "maxInclusive", "along", "via", "item"] as const;

function fillFromLocal(intent: Intent, local: Intent, message: string, isCourse: (code: string) => boolean): Intent {
  for (const key of SLOT_KEYS) {
    if (intent[key] === undefined && local[key] !== undefined) intent[key] = local[key] as never;
  }
  if (!intent.remember?.length && local.remember?.length) intent.remember = local.remember;
  if (intent.course && !isCourse(intent.course)) intent.course = local.course && isCourse(local.course) ? local.course : undefined;
  if (!intent.course && local.course && isCourse(local.course) && intent.action !== "nearby" && intent.action !== "stop" && intent.action !== "order") {
    intent.course = local.course;
    if (intent.action === "route" || intent.action === "other" || intent.action === "next") intent.action = "class";
  }
  if (!intent.course && intent.action === "class") intent.action = local.place ? "route" : local.action;
  // "under 10" is a price. A clock is the only reason to keep a time.
  if (intent.at && !/\b(?:at|by|around|before|after)\s+\d|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(?:noon|midnight)\b/i.test(message)) delete intent.at;
  const budget = local.minPrice != null || local.maxPrice != null;
  if ((local.along || (budget && local.to)) && (intent.action === "route" || intent.action === "other")) {
    intent.action = "order";
    intent.along = true;
    intent.to ??= local.to;
    intent.from ??= local.from;
    intent.maxPrice ??= local.maxPrice;
    intent.minPrice ??= local.minPrice;
    if (local.maxInclusive === false) intent.maxInclusive = false;
    if (intent.place === intent.to) delete intent.place;
  }
  return intent;
}
