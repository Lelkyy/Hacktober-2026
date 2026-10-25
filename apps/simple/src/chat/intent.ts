import type { ModeId } from "@campus/core";
import { nearbyKind } from "./nearby.ts";

/**
 * What a chat message asks for, as Gemma (or the fallback parser) reads it.
 * Only words from the message: the app looks up rooms, times and routes itself.
 */
export interface Intent {
  /**
   * class: get to a class ("I have math 20C in 30 minutes").
   * route: get to a place ("take me to Geisel").
   * nearby: the nearest restroom, water, coffee, printer… ("where's the closest bathroom").
   * stop: when the next buses leave a stop ("next bus at Gilman").
   * next: their next class, from the sections they've picked.
   * change: change the last trip ("by bike instead", "I'm at Price Center").
   * other: anything else.
   */
  action: "class" | "route" | "nearby" | "stop" | "next" | "change" | "other";
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
  /** "in 30 minutes" -> 30. */
  inMinutes?: number;
  /** "at 3pm" -> "15:00" (24h). */
  at?: string;
  /** "today", "tomorrow" or a weekday ("monday"). */
  day?: string;
  /** A short friendly answer for "other". */
  reply?: string;
}

export type TravelMode = Extract<ModeId, "walk" | "accessible" | "bike" | "bus">;

export const TRAVEL_MODES: TravelMode[] = ["walk", "accessible", "bike", "bus"];

/** The JSON Schema Gemma's answer must match (Chrome's responseConstraint, Ollama's format). */
export const INTENT_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["class", "route", "nearby", "stop", "next", "change", "other"] },
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
  },
  required: ["action"],
} as const;

/** Instructions for Gemma. `now` so it can turn "at 3" into "15:00" sensibly. */
export function systemPrompt(now: Date): string {
  const today = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `You turn a UC San Diego student's chat message into JSON for a campus navigation app. It is ${today}, ${time}.
Only copy what the message says; never invent rooms, buildings or times. Leave out fields the message doesn't mention.
- action "class": they're going to a class. course = the course code as written ("math 20c" -> "MATH 20C"). meeting = lecture/discussion/lab/midterm/final if said.
- action "route": they want to go somewhere that isn't a class. place = where.
- action "nearby": they want the closest restroom, water refill, coffee, food, vending machine, printer, study spot, computer lab, parking, EV charger, bike rack, Spin hub, ATM, mailbox, laundry, lactation room, AED or clinic. what = one word for it. place = "near X" if said.
- action "stop": they ask when buses or shuttles leave a stop. place = the stop (leave out for "near me").
- action "next": they ask about their next class without naming it ("where's my next class").
- action "change": they're changing the last trip without naming a new destination (a new mode, a new start, a new time).
- action "other": anything else; put a one-sentence friendly reply in "reply" saying what you can do (directions to classes and campus places, the nearest restroom/water/food, bus times).
- from: where they start ("from Geisel", "I'm at Price Center" -> "Price Center").
- mode: walk, accessible (no stairs, wheelchair), bike, bus (bus, shuttle, trolley, transit).
- inMinutes: "in 30 minutes" -> 30, "in an hour" -> 60, "in half an hour" -> 30.
- at: a clock time in 24h "HH:MM"; "at 3" or "at 3pm" -> "15:00", "at noon" -> "12:00".
- day: "today", "tomorrow" or a weekday name, if said.
Examples:
"I have math 20C today in 30 minutes" -> {"action":"class","course":"MATH 20C","day":"today","inMinutes":30}
"cse 12 discussion at 4, biking from the price center" -> {"action":"class","course":"CSE 12","meeting":"discussion","at":"16:00","mode":"bike","from":"Price Center"}
"how do I get to geisel" -> {"action":"route","place":"Geisel"}
"where's the nearest bathroom" -> {"action":"nearby","what":"restroom"}
"I need coffee near WLH" -> {"action":"nearby","what":"coffee","place":"WLH"}
"when's the next bus at Gilman" -> {"action":"stop","place":"Gilman"}
"where's my next class" -> {"action":"next"}
"actually I'll take the bus" -> {"action":"change","mode":"bus"}
"I'm at the Warren Lecture Hall" -> {"action":"change","from":"Warren Lecture Hall"}`;
}

/** Make whatever came back safe to use: drop unknown fields and bad values. */
export function cleanIntent(raw: unknown): Intent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const action = r.action;
  if (typeof action !== "string" || !["class", "route", "nearby", "stop", "next", "change", "other"].includes(action)) return null;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const intent: Intent = { action: action as Intent["action"] };
  intent.course = text(r.course);
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
  const at = text(r.at)?.match(/^([0-2]?\d):([0-5]\d)$/);
  if (at && Number(at[1]) < 24) intent.at = `${at[1].padStart(2, "0")}:${at[2]}`;
  return intent;
}

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45, fifty: 50,
};

/**
 * The fallback when no Gemma is available: reads the same messages with patterns.
 * `isCourse` says whether a code like "MATH 20C" is a real course, so "in 30" never is one.
 */
export function parseLocally(message: string, isCourse: (code: string) => boolean): Intent {
  const text = message.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
  const intent: Intent = { action: "other" };

  for (const m of text.matchAll(/\b([a-z]{2,5})\s?-?(\d{1,3}[a-z]{0,2})\b/g)) {
    const code = `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
    if (isCourse(code)) {
      intent.course = code;
      break;
    }
  }

  if (/\b(no stairs|wheelchair|accessible|step-free|elevator)\b/.test(text)) intent.mode = "accessible";
  else if (/\b(bike|biking|bicycle|cycle|cycling|ride my bike)\b/.test(text)) intent.mode = "bike";
  else if (/\b(bus|buses|shuttle|trolley|transit)\b/.test(text)) intent.mode = "bus";
  else if (/\b(walk|walking|on foot)\b/.test(text)) intent.mode = "walk";

  const phrase = text.match(/\bin (?:about |like )?(half an hour|an hour and a half|an hour|a few minutes)\b/);
  const inTime = text.match(/\bin (?:about |like )?(\d+(?:\.\d+)?|[a-z-]+) ?(minutes?|mins?|hours?|hrs?)\b/);
  if (phrase) intent.inMinutes = { "half an hour": 30, "an hour and a half": 90, "an hour": 60, "a few minutes": 5 }[phrase[1]];
  else if (inTime) {
    const amount = Number(inTime[1]) || NUMBER_WORDS[inTime[1]];
    if (amount) intent.inMinutes = Math.round(/^h/.test(inTime[2]) ? amount * 60 : amount);
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
  const stopWords = String.raw`(?=,|\.|\?|!| to | by | at \d| at noon| in \d| in an?\b| in half| on | and | using | via |$)`;
  const from = text.match(new RegExp(String.raw`\b(?:from|i'm at|i am at|i'm in|i am in|i'm near|currently at|leaving)\s+(?:the\s+)?(.+?)${stopWords}`));
  if (from && !/^(here|home|my place)$/.test(from[1])) intent.from = from[1];

  // Lecture, lab… but not from a place's name ("I'm at Warren Lecture Hall").
  const rest = from ? text.replace(from[0], " ") : text;
  if (/\bmidterm\b/.test(rest)) intent.meeting = "midterm";
  else if (/\bfinal\b/.test(rest)) intent.meeting = "final";
  else if (/\b(discussion|disc|section)\b/.test(rest)) intent.meeting = "discussion";
  else if (/\blab\b/.test(rest)) intent.meeting = "lab";
  else if (/\blecture\b/.test(rest)) intent.meeting = "lecture";

  const to = text.match(
    new RegExp(String.raw`\b(?:get to|go to|going to|take me to|directions to|route to|navigate to|head to|heading to|walk to|bike to|where(?:'s| is)|how do i get to|to(?!\s+(?:get|go|be|find|head|walk|bike|ride|take|make)\b))\s+(?:the\s+)?(.+?)${stopWords}`),
  );

  const near = text.match(new RegExp(String.raw`\b(?:near|by|around|close to|next to)\s+(?:the\s+)?(.+?)${stopWords}`));
  const kind = /\b(nearest|closest|nearby|near|where can i|where's a|where is a|i need (?!to\b)|find (?:a|me)|any)\b/.test(text) ? nearbyKind(text) : undefined;
  if (intent.course) intent.action = "class";
  else if (kind) {
    intent.action = "nearby";
    intent.what = kind.id;
    if (near && !/^(me|here|my location)$/.test(near[1])) intent.place = near[1];
  } else if (/\b(next|when'?s|when is|when does)\b.*\b(bus|buses|shuttle|trolley)\b|\b(bus|shuttle|trolley) times?\b/.test(text)) {
    intent.action = "stop";
    // "bus" here is what they're asking about, not how they're travelling.
    delete intent.mode;
    const at = text.match(new RegExp(String.raw`\b(?:at|from|near)\s+(?:the\s+)?(.+?)${stopWords}`));
    if (at && !/^(me|here)$/.test(at[1])) intent.place = at[1];
  } else if (/\b(my )?next class\b|\bwhere'?s my class\b|\bwhat class do i have\b/.test(text)) intent.action = "next";
  else if (to && !/^(class|my class|my next class)$/.test(to[1])) {
    intent.action = "route";
    intent.place = to[1];
  } else if (intent.mode || intent.from || intent.inMinutes !== undefined || intent.at) intent.action = "change";
  return intent;
}
