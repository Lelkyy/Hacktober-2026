import type { ModeId } from "@campus/core";
import { budgetOf, dishOf, resolveHall } from "./menus.ts";
import { nearbyKind } from "./nearby.ts";
import { isGibberish, repair } from "./repair.ts";

/**
 * What a chat message asks for, as the language model (or the fallback parser) reads it.
 * Only words from the message: the app looks up rooms, times and routes itself.
 */
export interface Intent {
  /**
   * class: get to a class ("I have math 20C in 30 minutes").
   * route: get to a place ("take me to Geisel").
   * nearby: the nearest restroom, water, coffee, printer… ("where's the closest bathroom").
   * stop: when the next buses leave a stop ("next bus at Gilman").
   * next: their next class, from the classes they've added.
   * add: add a course to their classes ("I'm taking MATH 20C").
   * drop: remove a course ("drop CSE 12").
   * classes: list their classes ("what are my classes").
   * day: what they have on a day ("what do I have tomorrow").
   * change: change the last trip ("by bike instead", "I'm at Price Center").
   * order: a Triton2Go price, wait, or quantity ("two boba at Pines").
   * other: anything else.
   */
  action: "class" | "route" | "nearby" | "stop" | "next" | "add" | "drop" | "classes" | "day" | "change" | "order" | "other";
  /** Course code as typed: "MATH 20C", "cse12". */
  course?: string;
  /** lecture, discussion, lab, midterm or final, when said. */
  meeting?: "lecture" | "discussion" | "lab" | "midterm" | "final";
  /** Where to go, for "route"; the stop, for "stop"; "near X", for "nearby". */
  place?: string;
  /** What to find, for "nearby": restroom, water, coffee, food, print, study, parking, bike, atm… */
  what?: string;
  /** Where they're starting, when said ("from Geisel", "I'm at Price Center"). */
  from?: string;
  mode?: TravelMode;
  /** A dish, for "order": "matcha boba". */
  item?: string;
  /** How many of that dish. */
  quantity?: number;
  /** "under $10" -> 10. Dollars. */
  maxPrice?: number;
  /** False when the cap was "under" or "less than", so the cap itself is too much. */
  maxInclusive?: boolean;
  /** "at least $5" -> 5. Dollars. */
  minPrice?: number;
  /** Where the trip is headed, when food is asked along the way ("Muir"). */
  to?: string;
  /** Food near the path, not only at the closest hall to the start. */
  along?: boolean;
  /** Extra stops before the last place, in the order they named them. */
  via?: string[];
  /** "in 30 minutes" -> 30. */
  inMinutes?: number;
  /** "at 3pm" -> "15:00" (24h). */
  at?: string;
  /** "today", "tomorrow" or a weekday ("monday"). */
  day?: string;
  /** A short friendly answer for "other". */
  reply?: string;
  /** The line after typo repair, when a real word changed. The reply can show it. */
  heard?: string;
  /** They rejected the last answer ("not coffee", "something else"). Answer that request again, without this. */
  again?: boolean;
  /** The thing to leave out: "coffee", "geisel", a dish. */
  avoid?: string;
  /**
   * Lasting facts from this message only ("Usually bikes", "Usually starts at Sixth").
   * Left out for a one-off trip.
   */
  remember?: string[];
}

export type TravelMode = Extract<ModeId, "walk" | "accessible" | "bike" | "bus">;

export const TRAVEL_MODES: TravelMode[] = ["walk", "accessible", "bike", "bus"];

const ACTIONS = ["class", "route", "nearby", "stop", "next", "add", "drop", "classes", "day", "change", "order", "other"];

/** The JSON Schema the model's answer must match (Chrome's responseConstraint, Ollama's format). */
export const INTENT_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ACTIONS },
    item: { type: "string" },
    quantity: { type: "number" },
    minPrice: { type: "number" },
    maxPrice: { type: "number" },
    to: { type: "string" },
    along: { type: "boolean" },
    via: { type: "array", items: { type: "string" } },
    course: { type: "string" },
    meeting: { type: "string", enum: ["lecture", "discussion", "lab", "midterm", "final"] },
    place: { type: "string" },
    what: { type: "string" },
    from: { type: "string" },
    mode: { type: "string", enum: TRAVEL_MODES },
    inMinutes: { type: "number" },
    at: { type: "string", pattern: "^[0-2]?[0-9]:[0-5][0-9]$" },
    day: { type: "string" },
    reply: { type: "string" },
    remember: { type: "array", items: { type: "string" } },
  },
  required: ["action"],
} as const;

/** Instructions for the model. `now` so it can turn "at 3" into "15:00" sensibly. `facts` are details already remembered. */
export function systemPrompt(now: Date, facts: string[] = []): string {
  const today = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const known = facts.length
    ? `\nFacts already remembered. Use them when this message doesn't say otherwise: if a fact says how they travel, set mode; if it says where they usually start, set from. Don't put those facts in remember again.\n${facts.map((f) => `- ${f}`).join("\n")}\n`
    : "";
  return `You turn a UC San Diego student's chat message into JSON for a campus navigation app. It is ${today}, ${time}.
Only copy what the message says; never invent rooms, buildings or times. Leave out fields the message doesn't mention.${known}
- action "class": they're going to a class. course = the course code as written ("math 20c" -> "MATH 20C"). meeting = lecture/discussion/lab/midterm/final if said.
- action "route": they want to go somewhere that isn't a class. place = where. via = extra stops before place, in order ("Geisel then Pines" → via Geisel, place Pines).
- action "nearby": they want the closest restroom, water refill, coffee, food, vending machine, printer, study spot, computer lab, parking, EV charger, bike rack, Spin hub, ATM, mailbox, laundry, lactation room, AED or clinic. what = one word for it. place = "near X" if said.
- action "stop": they ask when buses or shuttles leave a stop. place = the stop (leave out for "near me").
- action "next": they ask about their next class without naming it ("where's my next class").
- action "add": they say they take a course, to remember it ("I'm taking MATH 20C", "add CSE 12"). course = the code.
- action "drop": they want a course removed ("drop CSE 12", "I'm not taking PHYS 2A anymore"). course = the code.
- action "classes": they ask which classes they take ("what are my classes", "my schedule").
- action "day": they ask what they have on a day ("what do I have tomorrow", "my classes on Monday"). day = that day.
- action "change": they're changing the last trip without naming a new destination (a new mode, a new start, a new time).
- action "order": they ask what food costs, what to eat, or for dishes in a budget ("what's good under $10", "a burrito at 64 Degrees", "anything under $10 on the way to Muir"). place = a dining hall only when they want that hall. item = the dish if said; omit it when they just want food. quantity = how many. minPrice and maxPrice are dollars ("under 10" or "under 10$" -> maxPrice 10, "between 5 and 12" -> minPrice 5, maxPrice 12, "cheap" -> maxPrice 10). to = where the trip is going, when they also want food. along = true when the food should be near that route. Fix typos in place names ("mur" -> "Muir").
- action "other": anything else; put a one-sentence friendly reply in "reply" saying what you can do (directions to classes and campus places, the nearest restroom/water/food, bus times, dining recommendations in a price range).
- from: where they start ("from Geisel", "I'm at Price Center" -> "Price Center").
- mode: walk, accessible (no stairs, wheelchair), bike, bus (bus, shuttle, trolley, transit).
- inMinutes: "in 30 minutes" -> 30, "in an hour" -> 60, "in half an hour" -> 30.
- at: a clock time in 24h "HH:MM"; "at 3" or "at 3pm" -> "15:00", "at noon" -> "12:00".
- day: "today", "tomorrow" or a weekday name, if said.
- remember: short lasting facts from THIS message only ("Usually bikes", "Usually starts at Sixth College", "Needs a step-free route", "Takes CSE 11"). Leave it out for a one-off trip, a time, or a question. If the fact is how they travel, also set mode. If it is where they usually start, also set from.
Examples:
"I have math 20C today in 30 minutes" -> {"action":"class","course":"MATH 20C","day":"today","inMinutes":30}
"cse 12 discussion at 4, biking from the price center" -> {"action":"class","course":"CSE 12","meeting":"discussion","at":"16:00","mode":"bike","from":"Price Center"}
"how do I get to geisel" -> {"action":"route","place":"Geisel"}
"swing by pines then geisel" -> {"action":"route","place":"Geisel","via":["Pines"]}
"where's the nearest bathroom" -> {"action":"nearby","what":"restroom"}
"I need coffee near WLH" -> {"action":"nearby","what":"coffee","place":"WLH"}
"when's the next bus at Gilman" -> {"action":"stop","place":"Gilman"}
"where's my next class" -> {"action":"next"}
"I'm taking math 20c and want to add it" -> {"action":"add","course":"MATH 20C"}
"drop cse 12" -> {"action":"drop","course":"CSE 12"}
"what do I have tomorrow" -> {"action":"day","day":"tomorrow"}
"actually I'll take the bus" -> {"action":"change","mode":"bus"}
"I'm at the Warren Lecture Hall" -> {"action":"change","from":"Warren Lecture Hall"}
"I usually bike and I live at Sixth College" -> {"action":"other","mode":"bike","from":"Sixth College","remember":["Usually bikes","Usually starts at Sixth College"],"reply":"I'll bike from Sixth College unless you say otherwise."}
"I use a wheelchair" -> {"action":"other","mode":"accessible","remember":["Needs a step-free route"],"reply":"I'll keep your routes step-free."}
"two matcha boba at Pines, how much and how long" -> {"action":"order","place":"Pines","item":"matcha boba","quantity":2}
"what's good under $10" -> {"action":"order","maxPrice":10}
"burrito at 64 degrees under 12, from Price Center" -> {"action":"order","place":"64 Degrees","item":"burrito","maxPrice":12,"from":"Price Center"}
"im going to muir from pepper canyon, anything under $10 along the route" -> {"action":"order","to":"Muir","from":"Pepper Canyon","maxPrice":10,"along":true}`;
}

/** Make whatever came back safe to use: drop unknown fields and bad values. */
export function cleanIntent(raw: unknown): Intent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const action = r.action;
  if (typeof action !== "string" || !ACTIONS.includes(action)) return null;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const intent: Intent = { action: action as Intent["action"] };
  intent.course = text(r.course);
  intent.item = text(r.item);
  if (typeof r.quantity === "number" && r.quantity >= 1 && r.quantity <= 20) intent.quantity = Math.round(r.quantity);
  const dollars = (v: unknown) => (typeof v === "number" && v >= 0 && v <= 80 ? Math.round(v * 100) / 100 : undefined);
  intent.minPrice = dollars(r.minPrice);
  intent.maxPrice = dollars(r.maxPrice);
  if (typeof r.maxInclusive === "boolean") intent.maxInclusive = r.maxInclusive;
  intent.to = text(r.to);
  if (typeof r.along === "boolean") intent.along = r.along;
  if (Array.isArray(r.via)) {
    const hops = r.via
      .filter((hop): hop is string => typeof hop === "string")
      .map((hop) => hop.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 6);
    if (hops.length) intent.via = hops;
  }
  if (intent.item && !isDish(intent.item)) delete intent.item;
  if (intent.minPrice != null && intent.maxPrice != null && intent.minPrice > intent.maxPrice) {
    const swap = intent.minPrice;
    intent.minPrice = intent.maxPrice;
    intent.maxPrice = swap;
  }
  intent.place = text(r.place);
  intent.what = text(r.what)?.toLowerCase();
  intent.from = text(r.from);
  intent.day = text(r.day)?.toLowerCase();
  intent.reply = text(r.reply);
  if (typeof r.meeting === "string" && ["lecture", "discussion", "lab", "midterm", "final"].includes(r.meeting)) {
    intent.meeting = r.meeting as Intent["meeting"];
  }
  if (typeof r.mode === "string" && (TRAVEL_MODES as string[]).includes(r.mode)) intent.mode = r.mode as TravelMode;
  if (typeof r.inMinutes === "number" && r.inMinutes >= 0 && r.inMinutes < 24 * 60) intent.inMinutes = Math.round(r.inMinutes);
  if (Array.isArray(r.remember)) {
    const facts = r.remember
      .filter((f): f is string => typeof f === "string")
      .map((f) => f.replace(/\s+/g, " ").trim())
      .filter((f) => f.length > 2 && f.length <= 140 && isLastingFact(f))
      .slice(0, 3);
    if (facts.length) intent.remember = facts;
  }
  const at = text(r.at)?.match(/^([0-2]?\d):([0-5]\d)$/);
  if (at && Number(at[1]) < 24) intent.at = `${at[1].padStart(2, "0")}:${at[2]}`;
  return intent;
}

/**
 * True only when the local read has nothing to act on.
 * A parsed place, class, food order, or nearby search does not wait on a model, however long the sentence is.
 */
export function needsModel(message: string, intent: Intent): boolean {
  if (intent.action === "other") return !intent.reply && !intent.remember?.length;
  if (intent.action === "route") return !intent.place || intent.place.length >= 60;
  if (intent.action === "class" || intent.action === "add" || intent.action === "drop") return !intent.course;
  if (intent.action === "nearby") return !intent.what;
  if (intent.action === "change") {
    if (/\b(same place|same spot|there again|do that again|same trip)\b/i.test(message)) return false;
    const words = message.trim().split(/\s+/).filter(Boolean).length;
    const slotted = !!(intent.mode || intent.from || intent.inMinutes != null || intent.at || intent.day);
    if (!slotted) return true;
    return words > 16 && !/\b(instead|actually|rather|switch)\b/i.test(message);
  }
  return false;
}

/** "By bike instead" or "make it under $8" keeps the trip they were just planning. "Not coffee" drops that part and asks again. */
export function carryOver(parsed: Intent, previous: Intent | null, message: string): Intent {
  if (parsed.again) {
    const trip = previous && ["order", "route", "class", "nearby", "stop", "next"].includes(previous.action);
    if (!previous || !trip) {
      return { action: "other", reply: "Tell me what to change. A place, food, or something nearby.", heard: parsed.heard };
    }
    return { ...previous, again: true, avoid: parsed.avoid, heard: parsed.heard ?? previous.heard, reply: undefined };
  }
  if (!previous) return parsed;
  const tweak = parsed.action === "change" || /\b(instead|actually|rather|make it|make that|keep it)\b/i.test(message);
  const trip = previous.action === "order" || previous.action === "route" || previous.action === "class" || previous.action === "nearby";
  if (parsed.action === "change" && trip) {
    return {
      ...previous,
      action: previous.action,
      mode: parsed.mode ?? previous.mode,
      from: parsed.from ?? previous.from,
      at: parsed.at ?? previous.at,
      inMinutes: parsed.inMinutes ?? previous.inMinutes,
      day: parsed.day ?? previous.day,
    };
  }
  if (tweak && parsed.action === previous.action) {
    const next: Intent = { ...previous, action: previous.action };
    for (const key of ["item", "quantity", "minPrice", "maxPrice", "maxInclusive", "to", "along", "via", "place", "from", "mode", "what", "course", "meeting", "inMinutes", "at", "day"] as const) {
      const value = parsed[key];
      if (value !== undefined) (next as Intent)[key] = value as never;
    }
    return next;
  }
  return parsed;
}

/** A budget or a schema field the model echoed ("maxPrice: 10") is not something to remember. */
export function isLastingFact(fact: string): boolean {
  return !/^(action|to|from|place|item|max\s*price|min\s*price|along|mode|quantity|reply|what|course|day|at|in\s*minutes|meeting)\b\s*[:=]/i.test(fact);
}

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45, fifty: 50,
};

/** What to say when a message isn't a trip, a class, food, or a nearby search. */
export const CHAT_HELP = `Tell me a place ("Geisel" or "WLH 2001"), a class ("MATH 20C in 30 minutes"), food ("what's good under $10"), or something nearby ("nearest bathroom").`;

/** A reply when no model is connected. Answers the line, and does not invent a place or a time. */
export function replyTo(message: string, now = new Date()): string {
  const text = repair(message).text;
  return answerTalk(text, now) ?? heardYou(text);
}

/**
 * True when the local read is enough to answer. ChatModel skips the language
 * model in that case, so typos and ordinary requests stay instant.
 */
export function isLocalSure(intent: Intent, message: string): boolean {
  return !needsModel(message, intent);
}

/** A short dish name, not a whole sentence about a trip. */
export function isDish(item: string | undefined): item is string {
  if (!item) return false;
  const words = item.trim().split(/\s+/);
  if (words.length === 0 || words.length > 4) return false;
  return !/\b(going|heading|toward|towards|route|directions|from|anything|pepper|canyon|under|dollar|near|this|make|cheapest|hungry|usually|lol|dude|whatever|gimme|lowkey|ngl|basically|bro|bruh)\b/i.test(item);
}

/**
 * Reads a chat line without a model. Typos are repaired first.
 * `isCourse` says whether a code like "MATH 20C" is a real course, so "in 30" never is one.
 */
export function parseLocally(message: string, isCourse: (code: string) => boolean): Intent {
  const repaired = repair(message);
  const text = repaired.text;
  const intent: Intent = { action: "other" };

  for (const m of text.matchAll(/\b([a-z]{2,5})\s?-?(\d{1,3}[a-z]{0,2})\b/g)) {
    const code = `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
    if (isCourse(code)) {
      intent.course = code;
      break;
    }
  }

  if (/\b(no stairs|wheelchair|accessible|step-free|elevator)\b/.test(text)) intent.mode = "accessible";
  else if (/\b(bike|biking|bicycle|cycle|cycling|ride my bike)\b/.test(text) && !/\b(bike racks?|bicycle racks?|lock (?:my |the )?bike)\b/.test(text)) intent.mode = "bike";
  else if (/\b(bus|buses|shuttle|trolley|transit)\b/.test(text)) intent.mode = "bus";
  else if (/\b(walk|walking|on foot)\b/.test(text)) intent.mode = "walk";

  const spans = { "half an hour": 30, "an hour and a half": 90, "an hour": 60, "a few minutes": 5 };
  const phrase = text.match(/\bin (?:about |like )?(half an hour|an hour and a half|an hour|a few minutes)\b/);
  const until = text.match(/\b(half an hour|an hour and a half|an hour|a few minutes)\s+(?:until|till|til|before)\b/);
  const inTime = text.match(/\bin (?:about |like )?(\d+(?:\.\d+)?|[a-z-]+) ?(minutes?|mins?|hours?|hrs?)\b/);
  if (phrase) intent.inMinutes = spans[phrase[1] as keyof typeof spans];
  else if (until) intent.inMinutes = spans[until[1] as keyof typeof spans];
  else if (inTime) {
    const amount = Number(inTime[1]) || NUMBER_WORDS[inTime[1]];
    if (amount) intent.inMinutes = Math.round(/^h/.test(inTime[2]) ? amount * 60 : amount);
  }
  // "in 20" with no unit is minutes. A room number ("in 2001") is too big to be a wait.
  if (intent.inMinutes == null) {
    const bareTime = text.match(/\bin (?:about |like |around )?(\d{1,3})\b(?!\s*(?:am|pm|a\.m|p\.m|dollars?|bucks?|\$|degrees?))/);
    if (bareTime) {
      const n = Number(bareTime[1]);
      if (n >= 1 && n <= 180) intent.inMinutes = n;
    }
  }
  const at = text.match(/\bat (noon|midnight|(\d{1,2})(?::(\d{2}))? ?(am|pm|a\.m\.|p\.m\.)?)(?![\d:])/);
  if (at && !/^\d{3,}/.test(at[1])) {
    if (at[1] === "noon") intent.at = "12:00";
    else if (at[1] !== "midnight") {
      let hour = Number(at[2]);
      const minute = at[3] ?? "00";
      const half = at[4]?.[0];
      if (half === "p" && hour < 12) hour += 12;
      if (half === "a" && hour === 12) hour = 0;
      // No am/pm: classes run 8am-10pm, so "at 3" is 3pm and "at 9" is 9am.
      if (!half && hour >= 1 && hour <= 7) hour += 12;
      if (hour < 24 && Number(minute) < 60) intent.at = `${String(hour).padStart(2, "0")}:${minute}`;
    }
  }

  if (/\btoday\b|\btonight\b/.test(text)) intent.day = "today";
  else if (/\btomorrow\b/.test(text)) intent.day = "tomorrow";
  else intent.day = WEEKDAY_NAMES.find((d) => new RegExp(`\\b${d}\\b`).test(text));

  // Where they are: "from X", "I'm at X", "I'm in X". Stops at the next part of the sentence.
  const stopWords = String.raw`(?=,|\.|\?|!| to | by | at \d| at noon| in \d| in an?\b| in half| on | and | but | also | i'm | i am | because | so i | please | actually | or something | or whatever | i think | i don't know | using | via | then | after that |$)`;
  const from = text.match(new RegExp(String.raw`\b(?:(?<!far )from|i'm at|i am at|im at|i'm in|i am in|im in|i'm near|im near|i'm by|i am by|i think i'm at|i think i'm near|i think i'm by|currently at|leaving|i live at|i live in|my dorm is at|my dorm is)\s+(?:the\s+)?(.+?)${stopWords}`));
  if (from && !/^(here|home|my place)$/.test(from[1])) intent.from = from[1].trim();

  // Lecture, lab… but not from a place's name ("I'm at Warren Lecture Hall").
  const rest = from ? text.replace(from[0], " ") : text;
  if (/\bmidterm\b/.test(rest)) intent.meeting = "midterm";
  else if (/\bfinal\b/.test(rest)) intent.meeting = "final";
  else if (/\b(discussion|disc|section)\b/.test(rest)) intent.meeting = "discussion";
  else if (/\blab\b/.test(rest)) intent.meeting = "lab";
  else if (/\blecture\b/.test(rest)) intent.meeting = "lecture";

  const searched = from ? text.replace(from[0], " ") : text;
  const to = searched.match(
    new RegExp(
      String.raw`\b(?:get to|go to|going to(?!\s+(?:be|get|have|do|just)\b)|take me to|directions to|route to|navigate to|head to|heading to|heading towards?|headed to|headed towards?|on my way to|on the way to|toward|towards|walk to|bike to|help me find|find me|looking for|want to go to|need to get to|need to go to|where(?:'s| is)|how do i get to|directions(?!\s+to\b)|navigate(?!\s+to\b)|route(?!\s+to\b)|to(?!\s+(?:get|go|be|find|head|walk|bike|ride|take|make|eat|order|grab|buy|have)\b))\s+(?:the\s+)?(.+?)${stopWords}`,
    ),
  );
  const along = /\b(?:along|near|on) (?:this |the |my )?(?:route|way|path)\b/.test(text);

  const nearMatch = text.match(new RegExp(String.raw`\b(?:near|by|around|close to|next to|at)\s+(?:the\s+)?(.+?)${stopWords}`));
  const near = nearMatch && !/^(noon|midnight|\d)/.test(nearMatch[1]) ? nearMatch : null;
  const kind = /\b(nearest|closest|nearby|near|where can i|where do i|where's a|where is a|i need (?!to\b)|find (?:a|me)|any)\b/.test(text) ? nearbyKind(text) : undefined;
  const budget = budgetOf(text);
  const hallNow = resolveHall(text);
  const dishNow = dishOf(from ? text.replace(from[0], " ") : text, hallNow);
  const asksMeal = /\b(?:what(?:'s| is) for|for|eat|eating|grab|get)\s+(?:lunch|dinner|breakfast)\b|\b(?:lunch|dinner|breakfast)\s+(?:at|near|under)\b|\bcheapest\b|\b(?:eat|eating)\s+at\b/.test(text);
  const foodNoun = /\b(?:burritos?|bobas?|matcha|sandwiches|sandwich|salads?|pizzas?|tacos?|burgers?|bowls?|noodles?|pastas?|sushi|latte|fries|ramen|pho|curry|chicken|bagels?|pastr(?:y|ies)|wraps?)\b/.test(text);
  const wantsFood =
    budget.min != null ||
    budget.max != null ||
    asksMeal ||
    /\b(best|recommend|suggestion|what should i (?:eat|get|order)|what(?:'s| is) good|something to eat|cheap food|hungry|starving|broke|looking for food)\b/.test(text) ||
    /\b(?:food|dining)\b.*\bopen\b|\bopen\b.*\b(?:food|dining)\b/.test(text);
  const ordering =
    /\b(how much|price(?!\s+center\b)|cost|costs|order|menu|triton2\s?go|waiting for release|ready now|working on it)\b/.test(text) ||
    (!!hallNow && /\b(how long|wait|open|closed|hours)\b/.test(text)) ||
    (!!hallNow && foodNoun) ||
    wantsFood;
  const myDay = /\b(what do i have|what is on|what's on|my day|my classes (today|tomorrow|on)|(classes|schedule) (today|tomorrow|on \w+))\b/.test(text);
  const askedDest =
    to?.[1]?.trim() ||
    searched.match(/\bis\s+(?:the\s+)?(.+?)\s+(?:far|close|nearby)\b/)?.[1]?.trim() ||
    searched.match(new RegExp(String.raw`\bfar from\s+(?:the\s+)?(.+?)${stopWords}`))?.[1]?.trim();
  const toward = !!(askedDest && /\bto\b/.test(searched) && !/^(?:my |the )?class$/.test(askedDest) && !/^(class|my class|my next class)$/.test(askedDest));
  const classDest = !!askedDest && /^(?:(?:my|the)\s+)?class$/.test(askedDest);
  const preference = /\b(i usually|i always|i prefer|from now on|remember that|i live|my dorm|i use a wheelchair|i can't (?:do|take) stairs)\b/.test(text);
  if (intent.course && /\b(drop|dropped|remove|delete|forget|not taking|no longer|don't take|dont take)\b/.test(text)) intent.action = "drop";
  else if (intent.course && /\b(add|taking|i take|enroll(ed)?( in)?|register(ed)?( for)?|sign me up)\b/.test(text)) intent.action = "add";
  else if (intent.course) intent.action = "class";
  else if (ordering) {
    intent.action = "order";
    const hall = resolveHall(text);
    const dest = to?.[1]?.trim();
    const destIsClass = !!dest && /^(?:(?:my|the)\s+)?class$/.test(dest);
    const destHall = dest && !destIsClass ? resolveHall(dest) : undefined;
    if (destIsClass || along || (intent.from && dest) || (wantsFood && !!dest && !destHall)) {
      intent.along = true;
      if (dest && !destIsClass) intent.to = dest;
      if (hall && hall !== destHall && hall !== resolveHall(intent.from ?? "")) intent.place = hall;
    } else if (hall) intent.place = hall;
    if (!intent.from && !intent.to && !intent.along && near) {
      const spot = near[1].trim();
      if (spot && !/^(me|here|my location)$/.test(spot) && !resolveHall(spot) && !/\b(?:route|way|path)\b/.test(spot)) intent.from = spot;
    }
    if (budget.min != null) intent.minPrice = budget.min;
    if (budget.max != null) intent.maxPrice = budget.max;
    if (budget.max != null && /\b(?:under|below|less than|cheaper than)\b/.test(text)) intent.maxInclusive = false;
    const qty = quantityOf(text);
    if (qty) intent.quantity = qty;
    let dishText = from ? text.replace(from[0], " ") : text;
    if (dest && !destIsClass) dishText = dishText.replace(dest, " ");
    const dish = dishOf(dishText, hall);
    if (isDish(dish)) intent.item = dish;
  } else if (myDay) {
    intent.action = "day";
    intent.day ??= "today";
  } else if (/\b(my classes|my courses|my schedule|what classes|which classes|what am i taking)\b/.test(text)) intent.action = "classes";
  else if (kind) {
    intent.action = "nearby";
    intent.what = kind.id;
    if (near && !/^(me|here|my location)$/.test(near[1])) intent.place = near[1];
  } else if (!toward && /\b(next|when is|when does|when'?s)\b.*\b(bus|buses|shuttle|trolley)\b|\b(bus|shuttle|trolley) times?\b/.test(text)) {
    intent.action = "stop";
    // "bus" here is what they're asking about, not how they're travelling.
    delete intent.mode;
    const atStop = text.match(new RegExp(String.raw`\b(?:at|from|near|leave|leaves|leaving|depart|departs|departing)\s+(?:the\s+)?(.+?)${stopWords}`));
    if (atStop && !/^(me|here|noon|midnight|\d)/.test(atStop[1])) intent.place = atStop[1].trim();
  } else if (
    /\b(my )?next class\b|\bwhere(?:'s| is) my class\b|\bwhat class do i have\b|\btake me to (?:my |the )?class\b|\bon (?:the |my )?way to (?:my |the )?class\b|\bto (?:my |the )?class\b/.test(text) ||
    (/\bclass\b/.test(text) && !intent.course && (intent.inMinutes != null || !!intent.at))
  ) {
    intent.action = "next";
  } else if (askedDest && !/^(?:(?:my|the)\s+)?class$/.test(askedDest)) {
    intent.action = "route";
    intent.place = askedDest;
  } else if (!intent.course && (intent.inMinutes != null || intent.at)) {
    const stripped = text
      .replace(/\bin\s+(?:about |like |around )?(?:\d{1,3}|an hour|half an hour|a few minutes)\b/g, " ")
      .replace(/\bat\s+(?:noon|midnight|\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)\b/g, " ");
    const bare = barePlace(stripped);
    const amenityId = bare ? onlyAmenity(bare) : undefined;
    if (amenityId) {
      intent.action = "nearby";
      intent.what = amenityId;
    } else if (bare) {
      intent.action = "route";
      intent.place = bare;
    } else intent.action = "change";
  } else if (!preference && (intent.mode || intent.from || intent.inMinutes !== undefined || intent.at)) intent.action = "change";

  // A class plus food in one line: get them to class, and keep the food ask on the trip.
  if (intent.action === "class" && (along || wantsFood || budget.min != null || budget.max != null)) {
    intent.along = true;
    if (budget.min != null) intent.minPrice = budget.min;
    if (budget.max != null) intent.maxPrice = budget.max;
    if (budget.max != null && /\b(?:under|below|less than|cheaper than)\b/.test(text)) intent.maxInclusive = false;
    if (!intent.place && hallNow) intent.place = hallNow;
    if (!intent.item && isDish(dishNow)) intent.item = dishNow;
  }

  // "a sandwich on the way to class" is the next class, with food listed on that walk.
  if (classDest && (intent.action === "order" || intent.along) && !intent.course) {
    intent.action = "next";
    intent.along = true;
    delete intent.to;
  }

  // "bathroom", "coffee at geisel", "i need to pee": an amenity, not a building name.
  if ((intent.action === "route" || intent.action === "other") && !intent.course) {
    const body = near ? text.replace(near[0], " ") : text;
    const amenityId = onlyAmenity(body);
    if (amenityId) {
      const spot = near?.[1]?.trim();
      intent.action = "nearby";
      intent.what = amenityId;
      if (spot && !/^(me|here|my location)$/.test(spot) && !onlyAmenity(spot)) intent.place = spot;
      else delete intent.place;
    }
  }

  if (intent.place) {
    const place = clipPlace(intent.place);
    if (place) intent.place = place;
    else delete intent.place;
  }
  if (intent.from) {
    const fromPlace = clipPlace(intent.from);
    if (fromPlace) intent.from = fromPlace;
    else delete intent.from;
  }
  if (intent.to) {
    const toPlace = clipPlace(intent.to);
    if (toPlace) intent.to = toPlace;
    else delete intent.to;
  }
  applyRouteHops(intent, text);
  if (intent.action === "route" && intent.place) {
    const named = onlyAmenity(intent.place);
    if (named) {
      intent.action = "nearby";
      intent.what = named;
      delete intent.place;
    }
  }
  if (intent.action === "route" && !intent.place) intent.action = "other";

  // "i'm gonna be late to math" is the next class. A real building stays a route.
  if (!intent.course && /\blate\b/.test(text) && /\b(?:class|math|cse|phys|chem|econ|biol)\b/.test(text)) {
    const solid = intent.place && !/^(?:math|cse|phys|chem|econ|biol|cogs|help|math help)$/.test(intent.place);
    if (!solid && (intent.action === "route" || intent.action === "other" || intent.action === "change")) {
      intent.action = "next";
      delete intent.place;
    }
  }

  if ((intent.action === "other" || (intent.action === "route" && !intent.place)) && /\b(?:nap|sleep|sit down|somewhere to sit|place to sit|somewhere quiet|quiet place|quiet to study|somewhere to study|study spot)\b/.test(text)) {
    intent.action = "nearby";
    intent.what = "study";
    delete intent.place;
  }

  // "the shuttle" with nowhere to go is the stop board. A long question stays for the model.
  const busMention = intent.action === "change" && intent.mode === "bus" && !intent.from && intent.inMinutes == null && !intent.at;
  const busTrip = /\b(?:instead|actually|rather|switch|by|via)\b/.test(text) || /\b(?:take|taking|catch|ride) (?:the |a )?(?:bus|shuttle|trolley)\b/.test(text);
  if (busMention && !busTrip) {
    delete intent.mode;
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words > 14) intent.action = "other";
    else if (/\b(?:why|late|always|never|delay)\b/.test(text)) {
      intent.action = "other";
      intent.reply = "I don't get live delays. Name a stop and I'll show the next scheduled bus, or I'll use the nearest.";
    } else intent.action = "stop";
  }

  // A lasting detail, not a one-off trip: "I usually bike", "I live at Sixth", "I use a wheelchair".
  const oneOff = intent.action === "class" || intent.action === "next" || intent.action === "route" || intent.action === "order" || intent.action === "nearby" || /\b(?:today|tonight|right now)\b/.test(text);
  if (!oneOff && /\b(i usually|i always|i prefer|from now on|remember that|i live|my dorm|i use a wheelchair|i can't (?:do|take) stairs)\b/.test(text)) {
    intent.remember = [message.trim().replace(/\s+/g, " ").slice(0, 140)];
    if (intent.action === "other") intent.reply = "I'll remember that.";
  }

  if ((intent.action === "route" || intent.action === "other") && intent.place?.startsWith("not ")) {
    const rejected = rejectionOf(text);
    if (rejected) {
      intent.action = "change";
      intent.again = true;
      if (rejected.avoid) intent.avoid = rejected.avoid;
      delete intent.place;
      delete intent.reply;
    }
  }

  if (intent.action === "other" && !intent.reply) {
    const rejected = rejectionOf(text);
    if (rejected) {
      intent.action = "change";
      intent.again = true;
      if (rejected.avoid) intent.avoid = rejected.avoid;
    } else if (isGibberish(text)) {
      intent.reply = "No way to understand that.";
    } else {
    const talk = smallTalk(text) ?? answerTalk(text, new Date());
    if (talk) intent.reply = talk;
    else if (/\b(same place|same spot|there again|do that again|same trip)\b/.test(text)) intent.action = "change";
    else {
      const hops = listedHops(text);
      if (hops.place) {
        intent.action = "route";
        intent.place = hops.place;
        if (hops.via?.length) intent.via = hops.via;
      } else {
      const bare = barePlace(text);
      const amenityId = bare ? onlyAmenity(bare) : undefined;
      if (amenityId) {
        intent.action = "nearby";
        intent.what = amenityId;
      } else if (bare) {
        intent.action = "route";
        intent.place = bare;
      } else if (isGibberish(text)) intent.reply = "No way to understand that.";
      else if (text.split(/\s+/).filter(Boolean).length <= 14) intent.reply = answerTalk(text, new Date()) ?? heardYou(text);
      }
    }
    }
  }

  if (intent.action === "other" && !intent.reply && isGibberish(text)) intent.reply = "No way to understand that.";

  const rejected = rejectionOf(text);
  const keptRoute = intent.action === "route" && !!intent.place && !intent.place.startsWith("not ") && intent.place !== rejected?.avoid;
  if (rejected && !keptRoute && intent.action !== "drop" && intent.action !== "add" && intent.action !== "class" && intent.action !== "next") {
    intent.action = "change";
    intent.again = true;
    if (rejected.avoid) intent.avoid = rejected.avoid;
    delete intent.place;
    delete intent.what;
    delete intent.item;
    delete intent.reply;
  }

  if (repaired.heard) intent.heard = repaired.heard;
  return intent;
}

/**
 * A follow-up that throws out the last answer.
 * "Not coffee", "anything but a burrito", "I want something else", "not that", "try again".
 * A new destination in the same line ("nah, take me to rimac") is not one of these.
 */
function rejectionOf(text: string): { avoid?: string } | null {
  const plain = text.replace(/[?.!,]+/g, " ").replace(/\s+/g, " ").trim();
  if (!plain || /^(?:sorry|oops|my bad|that is wrong|not what i meant)$/.test(plain)) return null;
  if (/\b(?:want to go|take me|go to|get to|heading|headed)\b/.test(plain) && !/^(?:not|no|nah|nope|don't|dont)\b/.test(plain)) return null;

  const swap =
    /\b(?:something|anything|somewhere)\s+else\b|\b(?:something|anything)\s+different\b|\b(?:a )?different (?:one|place|spot|thing)\b|\banother (?:one|place|option|thing)\b|\bnot (?:that|this|it|those|the one)\b|\btry again\b|\bchange it\b|\brather not\b|\b(?:do not|don't|dont) want (?:that|this|it)\b|\bwhat else\b|\bnext one\b|\bnone of (?:that|those|these|them)\b|\b(?:give me|get me|show me|how about|can i (?:get|have))\s+(?:something|anything|another)\b/.test(
      plain,
    );
  if (swap) {
    const named = plain.match(/\b(?:not|without|except|but)\s+(?:the\s+|a\s+|an\s+)?([a-z][a-z ]{1,24})$/);
    const avoid = named?.[1]?.replace(/\b(?:please|thanks|though)\b/g, "").trim();
    if (!avoid || /^(?:that|this|it|one|those|these)$/.test(avoid)) return {};
    return { avoid };
  }

  const lead = plain.match(
    /^(?:please\s+)?(?:nah|nope|no more|no|not|anything but|other than|except|without|don't want|dont want|do not want|i don't want|i dont want)\s+(?:the\s+|a\s+|an\s+|any\s+|more\s+)?([a-z0-9][a-z0-9' -]{0,40})$/,
  );
  if (!lead) return null;
  let thing = lead[1].replace(/\b(?:please|thanks|though|tho|anymore|actually|right now)\b/g, " ").replace(/\s+/g, " ").trim();
  thing = thing.replace(/^(?:more|any)\s+/, "");
  if (!thing || /^(?:that|this|it|one|those)$/.test(thing)) return {};
  if (/^(?:taking|far|to|what i meant)\b/.test(thing)) return null;
  return { avoid: thing };
}

/** Extra stops before the last place. `then` is sequential; `via` is a waypoint before the dest. */
function hopsOf(text: string, firstDest: string | undefined): { via?: string[]; place?: string } {
  const stopOnWay = text.match(
    /\b(?:stop (?:at|by)|go to)\s+(?:the\s+)?(.+?)\s+on (?:the |my )?way to\s+(?:the\s+)?(.+?)(?=,|\.|\?|!|$)/,
  );
  if (stopOnWay) {
    const via = clipPlace(stopOnWay[1]);
    const place = clipPlace(stopOnWay[2]);
    if (via && place) return { via: [via], place };
  }
  const onWay = text.match(/\bon (?:the |my )?way to\s+(?:the\s+)?(.+?)(?=,|\.|\?|!|$)/);
  const onWayPlace = onWay ? clipPlace(onWay[1]) : undefined;
  if (onWayPlace && firstDest && onWayPlace !== firstDest) return { via: [firstDest], place: onWayPlace };

  const hopStop = String.raw`(?=,|\.|\?|!| to | then | and then | after that | from | by | in \d| using | via | through | on | and |$)`;
  const vias = [...text.matchAll(new RegExp(String.raw`\b(?:via|through)\s+(?:the\s+)?(.+?)${hopStop}`, "g"))]
    .map((m) => clipPlace(m[1]))
    .filter((p): p is string => !!p);
  const thens = [...text.matchAll(new RegExp(String.raw`\b(?:and then|then|after that)\s+(?:the\s+)?(.+?)${hopStop}`, "g"))]
    .map((m) => clipPlace(m[1]))
    .filter((p): p is string => !!p);
  const chain: string[] = [];
  const seen = new Set<string>();
  const add = (place: string | undefined) => {
    if (!place || seen.has(place)) return;
    seen.add(place);
    chain.push(place);
  };
  vias.forEach(add);
  add(firstDest ? clipPlace(firstDest) : undefined);
  thens.forEach(add);
  if (chain.length === 0) return {};
  if (chain.length === 1) return { place: chain[0] };
  return { via: chain.slice(0, -1), place: chain[chain.length - 1] };
}

/** "Geisel then Pines then WLH" with no "to" verb. */
function listedHops(text: string): { via?: string[]; place?: string } {
  if (!/\b(?:then|via|through|and then|after that)\b/.test(text)) return {};
  const parts = text
    .split(/\s+(?:and then|then|after that|via|through)\s+/)
    .map((part) => clipPlace(part))
    .filter((part): part is string => !!part);
  if (parts.length < 2) return parts[0] ? { place: parts[0] } : {};
  return { via: parts.slice(0, -1), place: parts[parts.length - 1] };
}

function applyRouteHops(intent: Intent, text: string): void {
  if (intent.action !== "route" && !(intent.action === "order" && intent.along)) return;
  const first = intent.action === "order" ? intent.to : intent.place;
  const hops = hopsOf(text, first);
  if (hops.place) {
    if (intent.action === "order") intent.to = hops.place;
    else intent.place = hops.place;
  }
  if (hops.via?.length) {
    intent.via = hops.via.filter((stop) => stop !== intent.from && stop !== hops.place);
    if (!intent.via.length) delete intent.via;
  }
}

const QTY_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 };

/** "two boba", not the "10" in "under 10 on the way" or the "5" in "between 5 and 12". */
function quantityOf(text: string): number | undefined {
  const amount = String.raw`(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)`;
  const stripped = text
    .replace(new RegExp(String.raw`\bbetween\s+\$?${amount}\s+and\s+\$?${amount}`, "g"), " ")
    .replace(new RegExp(String.raw`\b(?:under|below|less than|cheaper than|up to|at most|over|above|more than|at least|max(?:imum)?(?:\s+price)?)\s+\$?\s*${amount}\b\s*\$?`, "g"), " ");
  const qty = stripped.match(/\b(\d{1,2}|two|three|four|five|six)\s+(?!am\b|pm\b|dollars?\b|bucks?\b|on\b|at\b|from\b|to\b|near\b|and\b|the\b|for\b|in\b|with\b|of\b|a\b|an\b)[a-z]/);
  if (!qty) return undefined;
  const n = QTY_WORDS[qty[1]] ?? Number(qty[1]);
  return n >= 1 && n <= 20 ? n : undefined;
}

/** The phrase is only an amenity ("bathroom", "coffee"), not "Geisel Library". Study spots stay buildings. */
function onlyAmenity(phrase: string): string | undefined {
  const kind = nearbyKind(phrase);
  if (!kind || kind.id === "study" || kind.id === "food") return undefined;
  const flags = kind.words.flags.includes("g") ? kind.words.flags : `${kind.words.flags}g`;
  const left = phrase
    .replace(new RegExp(kind.words.source, flags), " ")
    .replace(/\b(?:i|i'm|im|me|my|need|to|a|an|the|got|go|going|please|now|asap|where|is|find|want|some|just|can|you|for|get|take|nearest|closest|nearby|hey|yo|ok|okay|um|gotta|wanna|bruh|bro|dude|man|ugh|lol|really|so|looking)\b/g, " ")
    .replace(/[?.!,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return left ? undefined : kind.id;
}

/** A message that is just a place: "Geisel", "WLH 2001", "yo geisel?". */
function barePlace(text: string): string | undefined {
  const cleaned = text
    .replace(/[?.!,]+/g, " ")
    .replace(/^(?:please|hey|yo|hi|hello|ok|okay|um|uh|so|like|can you|could you)\s+/g, "")
    .replace(/\b(?:please|thanks|thank you|now|asap)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return undefined;
  if (cleaned.split(" ").length > 5) return undefined;
  if (/^(?:what|how|why|who|when|help|thanks|thank|sorry|lol|lmao|idk|test|wtf|where|from|at|by|to|via|using|it|it's|its|this|that|so|tell|can|i|i'm)\b/.test(cleaned)) return undefined;
  if (/\b(?:hot|cold|outside|stupid|hate|bored|lost|joke|tired|dead|talk|home|weather)\b/.test(cleaned)) return undefined;
  if (/^(?:walk|walking|bike|biking|bus|shuttle|trolley|transit)$/.test(cleaned)) return undefined;
  if (/\b(?:do|does|did|can|could|would|should|is|are|was|have|has|i|i'm|me|my|you|your)\b/.test(cleaned)) return undefined;
  return cleaned;
}

const JUNK_PLACE = /^(?:me|you|it|this|that|there|here|home|somewhere|anywhere|something|nothing|someone|be|late|nap|sleep|sit|down|outside|hot|cold|help|talk|walk|study|quiet|shit|piss|poop|pee|pooping|pissing|whatever|dude|bro|bruh|lol|hey|yo|ok|okay|please|now|then|also|just|thing|stuff|place|spot|food|eat|actually|right)$/;

/** Drop filler stuck on a place ("rimac actually", "geisel please") and reject words that are not a place. */
function clipPlace(value: string): string | undefined {
  const clipped = value
    .split(/\b(?:but|also|i'm|i am|because|or something|or whatever|i think|i don't know)\b/)[0]
    .replace(/\b(?:please|thanks|thank you|actually|though|tho|lol|lmao|right now|asap|btw|basically)\b/g, " ")
    .replace(/^(?:the|a|an|to|my|at|near|by|ok|okay|so|just|hey|yo|um|uh)\s+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clipped || JUNK_PLACE.test(clipped)) return undefined;
  return clipped;
}

/** A sentence that isn't a trip still gets an answer about what was said. */
function answerTalk(text: string, now: Date): string | undefined {
  const plain = text.replace(/[?.!,]+/g, "").replace(/\s+/g, " ").trim();
  if (/\bwhat(?: is|'s)? (?:the )?time\b|\btime is it\b/.test(text)) {
    return `It's ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`;
  }
  if (/\bwho are you\b|\bwhat are you\b|\byour name\b/.test(text)) {
    return "I'm the campus guide. A place, a class, food, a bus, or something nearby — say it however it comes out.";
  }
  const sum = text.match(/\bwhat is (\d{1,4})\s*\+\s*(\d{1,4})\b/);
  if (sum && plain.split(" ").length <= 6) {
    return `${Number(sum[1]) + Number(sum[2])}. I'm better with campus than homework. Where do you need to be?`;
  }
  if (/\b(?:joke|funny|make me laugh)\b/.test(text)) {
    return "Why did they put Geisel on a hill? So the walk back counts as a workout. Where are you headed?";
  }
  if (/\b(?:i'm lost|i am lost|where am i|no idea where)\b/.test(text)) {
    return "Where do you want to end up? Name a building, a class, or say nearest bathroom.";
  }
  if (/\b(?:home|my dorm|my room|my place)\b/.test(text) && /\b(?:get|go|back|take|to|leave)\b/.test(text)) {
    return "Home isn't on the campus map. Name the college — Sixth, Muir, Revelle — and I'll route you.";
  }
  if (/\b(?:hot|cold|weather|raining|rain|sunny)\b/.test(text)) {
    return "I don't have the weather. I can get you inside: a library, food, or the nearest lounge.";
  }
  if (/\b(?:stupid|dumb|sucks|useless|hate this|hate it|random things|can't ask)\b/.test(text)) {
    return "Say it messy. “where's geisel”, “i gotta pee”, “food under 10”, or “take me to class” all work.";
  }
  if (/\b(?:talk to me|chat with me|i'm bored|i am bored|what is the move|what is poppin|what is popping|wyd|just talk)\b/.test(text)) {
    return "I'm here. Hungry, headed somewhere, or looking for a bathroom?";
  }
  if (/\b(?:tired|sleepy|exhausted)\b/.test(text)) {
    return "The nearest lounge is the place to sit. Say “somewhere to sit”, or name a building.";
  }
  if (/\b(?:somewhere|anywhere)\b/.test(text)) {
    return "Where to? A building, your next class, or food.";
  }
  return undefined;
}

/** Short lines that aren't a request still quote what was said. */
function heardYou(text: string): string {
  const plain = text.replace(/[?.!,]+/g, "").replace(/\s+/g, " ").trim();
  const clip = plain.length > 90 ? `${plain.slice(0, 87)}…` : plain;
  if (!clip) return "Say a place, a class, food, a bus stop, or something nearby. Messy is fine.";
  return `I heard “${clip}”. Name a place, a class, food, a bus stop, or something nearby and I’ll do that.`;
}

function smallTalk(text: string): string | undefined {
  const plain = text.replace(/[?.!]+/g, "").trim();
  if (/^(?:hey|hi|hello|yo|sup|hiya|howdy|good (?:morning|afternoon|evening))(?: there| you)?$/.test(plain)) return `Hey. ${CHAT_HELP}`;
  if (/^(?:help|commands|options|\?+)$/.test(plain) || /\b(?:what can you do|what do you do|how do you work|how does this work)\b/.test(text)) return CHAT_HELP;
  if (/^(?:thanks|thank you|thx|ty)$/.test(plain)) return "Anytime.";
  if (/^(?:nevermind|never mind|nvm|cancel|forget it)$/.test(plain)) return "No problem. Ask whenever you're ready.";
  if (/^(?:sorry|oops|my bad|that is wrong|not what i meant)$/.test(plain)) return `All good. ${CHAT_HELP}`;
  if (/^(?:lol|lmao|haha|omg|wtf|wth|bruh|ugh|hmm+|ok|okay|k|yes|no|yeah|yep|nope|idk|i don't know|test|asdf+|foo)$/.test(plain) || plain.length <= 2) {
    return `I can help with campus directions. ${CHAT_HELP}`;
  }
  return undefined;
}
