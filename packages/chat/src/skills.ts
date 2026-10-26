import type { Intent } from "./intent.ts";

/**
 * Model-facing campus skills. Cursor keeps the long copies in `.cursor/skills`;
 * Gemma only sees these, and only the ones this message needs.
 */
export interface CampusSkill {
  name: string;
  /** One line: when this skill applies. Always shown in the catalog. */
  when: string;
  body: string;
}

export const CAMPUS_SKILLS: CampusSkill[] = [
  {
    name: "campus-chat",
    when: "Read the line: typos, bare places, food vs a trip, a class vs next class, a follow-up.",
    body: `Repair typos (geisle→Geisel, mur→Muir, bathrom→restroom). Quiet fixes (gonna, im, pc→Price Center, 2 as "to") stay invisible.
Bare place ("Geisel", "yo geisle?", "WLH 2001", "geisel in 20") is trip.to. "in 20" is 20 minutes.
"next bus to Geisel" is trip, mode bus. "next bus at Gilman" or "bus times" is stop; leave place empty for the nearest stop; do not set mode.
bathroom / coffee at Geisel / i need to pee is nearby. at/near is place (search center), not the destination. "geisel library" is trip, not a study spot.
MATH 20C in 20 is trip with course and inMinutes. "class in 20" / "take me to class" / "where's my next class" is classes, action next. Real course codes only.
Class plus food ("math 20c in 30 and i'm hungry"): classes, along true.
heading toward Geisel i'm starving / anything under $10 on the way to Muir: food, along true. A dining hall as the destination is place, not to.
"under 10" is maxPrice 10, exclusive, not a dish and not a time.
add / drop / what are my classes / what do I have tomorrow: classes (action add, drop, classes, or day).
by bike instead / by transit / spin bike / no stairs: set that mode and use it. I'm at Price Center / same place: only change that slot on the previous request. No mode named: the app picks the faster of walk or transit.
I usually bike / I use a wheelchair: remember. One-off trips are not remembered.
help / hey / thanks: say. A long line with no place, class, food, or amenity: say.
not coffee / not that / something else / anything but a burrito / I want something else / try again / none of those: change the last request. Leave that thing out and answer again. Do not repeat it. No earlier request: ask what to change.
Gisewel is Geisel. A close place spelling, same first letter, is still that place. heard shows the fix. Do not "fix" a real word.
giberish with no campus word: say there is no way to understand. Do not guess a place.
hit up / how far / close / then / via: campus-talk. Last place is to; earlier stops are via.`,
  },
  {
    name: "campus-sources",
    when: "Pick the tool that names the campus file. Hours are not pins. A hall as a dest is a trip.",
    body: `You only pick a tool. The app reads the file and writes the reply. Do not invent hours, rooms, or a path.
food: open, closed, hours, a dish, a price ("64 Degrees close", "burrito under $12", "what's good under $10"). Hours and dishes come from today's menus, not place pins. under 10 is maxPrice, not a time and not a dish.
nearby: nearest restroom, water, coffee, printer, parking, bike rack, ATM, or a thing near a place ("coffee at Geisel"). Menus have no restrooms. at/near is where to search.
trip: how to get somewhere, including a dining hall as the destination ("take me to 64 Degrees", "Geisel"). A hall name is a place to route to, not a menu and not "nearest food".
food + along: food on the way ("anything under $10 on the way to Muir"). Menus for dishes, then halls near that path. Not a nearby search for the word "under".
stop: next bus at a stop ("next bus at Gilman", "bus times"). No stop name means the nearest stop. "next bus to Geisel" is trip, mode bus.
classes: class, next class, add or drop. in 20 is minutes until they must be there, not a food time.
say: anything else. One short sentence about directions, food, buses, or classes. No invented room, time, or path.
Wait times are not on the menu. A Triton2Go clock is when the kitchen may see the ticket, not when food is ready.`,
  },
  {
    name: "shortest-route",
    when: "They want to get somewhere, including a class or a dining hall as the dest.",
    body: `Set to (building, room like WLH 2001, or a place). Set from only if they named a start or gave coordinates. Do not guess a start; the app will ask.
mode is walk, bike, scooter (Spin bike or scooter), bus (transit), or accessible only if they asked. Leave mode out and the app takes whichever is faster, walk or transit.
via is extra stops before to, in the order they said ("Geisel then Pines" → via Geisel, to Pines; "to Geisel via Pines" → via Pines, to Geisel). Path every named stop. Do not skip one.
No stairs / wheelchair / step-free is accessible.
People say lat,lng. A follow-up only changes the last trip.
Do not invent streets or a path. The app runs the campus graph. The reply is campus-answer.`,
  },
  {
    name: "campus-talk",
    when: "Messy human talk: near, far, close, slang verbs, or more than one place.",
    body: `near / nearby / close / close by / next to / around / right by / not far from = that place (nearby if they also named an amenity).
how far is X / how close is X / is X far / distance to X / I'm far from X = trip to X.
hit up / swing by / drop by / pop over / head over / pull up = go to.
lib = library. thru = through. then / via / through / on the way = extra stops.
Several places: keep them in order. Last is to. Earlier ones are via. "and I'm hungry" is food, not a stop.
A leftover slang verb is still a trip if a campus place is in the line.`,
  },
  {
    name: "campus-answer",
    when: "After a tool is picked: bind trip slots to the path graph and let the app write the reply.",
    body: `You only pick a tool. The app reads the campus file and runs the path graph. Never write minutes, turns, hours, or a room in reply.
trip.to is shortest-route --to. trip.from is --from. trip.mode is --mode. trip.via is each --via, in order.
A dining hall as the destination is trip, not food.
food + along: menus first, then the same graph for halls on that walk. nearby: pins first, then the graph to the closest one.
If you are unsure, still pick the closest tool and leave extra fields out. Do not say a path.`,
  },
];

const ROUTE_HINT =
  /\b(get to|go to|going to|take me|directions|route|fastest|quickest|walk|bike|bus|from |to |class|lecture|how do i|heading|toward|towards|geisel|wlh|price center|muir|rimac)\b/i;
const TALK_HINT =
  /\b(near|far|close|around|then|via|through|hit up|swing|drop by|pop over|how far|how close|stop at|head over|right by|not far|pull up)\b/i;

/**
 * Skills this line needs. campus-chat, campus-sources, and campus-answer always run.
 * shortest-route joins a trip, a class, or a line the local read could not place.
 * campus-talk joins slang, near/far, or more than one place.
 */
export function pickSkills(message: string, local?: Intent): CampusSkill[] {
  const names = new Set<string>(["campus-chat", "campus-sources", "campus-answer"]);
  const trip =
    local?.action === "other" ||
    local?.action === "route" ||
    local?.action === "class" ||
    local?.action === "next" ||
    local?.action === "change" ||
    local?.action === "nearby" ||
    ROUTE_HINT.test(message);
  if (trip) names.add("shortest-route");
  if (TALK_HINT.test(message) || local?.via?.length || local?.action === "other") names.add("campus-talk");
  return CAMPUS_SKILLS.filter((skill) => names.has(skill.name));
}

/** Catalog of every skill, then the full text of the ones this message needs. */
export function skillPrompt(message: string, local?: Intent): string {
  const needed = pickSkills(message, local);
  const catalog = CAMPUS_SKILLS.map((skill) => `- ${skill.name}: ${skill.when}`).join("\n");
  const bodies = needed.map((skill) => `## ${skill.name}\n${skill.body}`).join("\n");
  return `Skills (use each that applies; the ones below are the ones this message needs):\n${catalog}\n${bodies}`;
}
