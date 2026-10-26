import {
  buildSteps,
  type CourseSections,
  type SectionMeeting,
  endpointPosition,
  floorPhrase,
  diningPin,
  haversine,
  insideHints,
  MODES,
  type Building,
  type Endpoint,
  type LiveVehicle,
  type LngLat,
  type Route,
  type SearchHit,
} from "@campus/core";
import type { ChatCampus, ChatSettings } from "./types.ts";
import type { TripPlanner } from "./TripPlanner.ts";
import { ClassFinder, clock, dayFor, describe, type ClassOption, type SectionGroup } from "./classes.ts";
import { forgetCourse, myClasses, rememberSection } from "./myClasses.ts";
import type { ChatModel } from "./ChatModel.ts";
import { parseLocally, replyTo, type Intent, type TravelMode } from "./intent.ts";
import type { Location } from "./Location.ts";
import { explainStatus, findItems, hallNamed, loadMenu, prepMinutes, quote } from "./dining.ts";
import { money } from "./diningMenu.ts";
import { pricePhrase, recommend, resolveHall, type FoodPick, type ScrapedMenus } from "./menus.ts";
import { loadMemory, noteFact, saveMemory, type Memory } from "./memory.ts";
import { nearbyKind, nearest } from "./nearby.ts";
import { groupOf, nearestStop, stopNamed, stopSummary } from "./stops.ts";

/** The bot's answer: text, optional step-by-step directions, and buttons when it needs the user to pick. */
export interface Reply {
  text: string;
  steps?: string[];
  choices?: { label: string; pick: () => Promise<Reply> }[];
}

/** A trip the chat planned: enough for an app to plan and show it its own way. */
export interface ChatTrip {
  from: Endpoint;
  to: Endpoint;
  mode: TravelMode;
  /** Be there by this (a class's start), if there's a time. */
  arriveBy: Date | null;
  /** "MATH 20C lecture, Mosaic 0114 at 11:00 AM" */
  title: string;
  /** What you're going to, without the time: "MATH 20C lecture, Mosaic 0114" */
  name: string;
  route: Route;
}

/** What the assistant shows on the map. */
export interface ChatView {
  /** A planned trip, or null to clear the last one. */
  trip(trip: ChatTrip | null): void;
  /** Labelled dots (the nearest restrooms, say), and the campus map category they're from. */
  markers(points: { lngLat: LngLat; label: string }[], category: string): void;
  /** A stop's lines, and the map moved to it. */
  stop(ids: string[], at: LngLat): void;
  /** The dining hall a food answer is about, so the menu can open on it. */
  food?(hall: string): void;
}

export interface AssistantDeps {
  campus: ChatCampus;
  planner: TripPlanner;
  model: ChatModel;
  location: Location;
  /** Live buses and trolleys right now (empty when the feed is off). */
  vehicles: () => LiveVehicle[];
  view: ChatView;
  settings: Pick<ChatSettings, "arriveEarlyMin">;
}

interface Place {
  endpoint: Endpoint;
  label: string;
}

/** Where to go and by when: what "by bike instead" or "I'm at Geisel" re-plans. */
interface Trip {
  to: Place;
  /** Extra stops before `to`, in the order they named them. */
  via?: Place[];
  /** Be there by this (a class's start), if there's a time. */
  arriveBy: Date | null;
  /** "MATH 20C lecture, Mosaic 0114 at 11:00 AM" */
  title: string;
  /** Without the time: "MATH 20C lecture, Mosaic 0114" */
  name: string;
  /** Extra lines for the answer: exams coming up, other nearby options. */
  notes?: string[];
}

/** Starting points offered when the app doesn't know where you are. */
const START_PICKS = ["Geisel Library", "Price Center", "Warren Lecture Hall", "RIMAC"];

/**
 * The conversation. Gemma reads each message; everything said back (rooms,
 * times, routes, buses) comes from the campus data, your location and the live feed.
 */
export class Assistant {
  private readonly classes: ClassFinder;
  private readonly campus: ChatCampus;
  private readonly planner: TripPlanner;
  private readonly model: ChatModel;
  private readonly location: Location;
  private readonly vehicles: () => LiveVehicle[];
  private readonly view: ChatView;
  private readonly arriveEarlyMin: number;
  /** A start named for this request ("from Price Center"). Otherwise trips start where you are. */
  private from: Place | null = null;
  /** The last start named, for when there's no location: better than asking every time. */
  private lastStart: Place | null = null;
  private mode: TravelMode = "walk";
  /** Set only when this request names a way to travel. Otherwise the fastest way is used. */
  private explicit: TravelMode | null = null;
  private trip: Trip | null = null;
  /** Coordinates of the route just planned, so a class-plus-food question can list halls on the way. */
  private lastCoords: LngLat[] | null = null;
  private last: Intent | null = null;
  /** Names already shown, so "something else" can skip them. */
  private offered: string[] = [];
  private readonly memory: Memory;
  /** The last reply asked "where are you?": this runs once it's answered. */
  private pending: ((at: Place) => Promise<Reply>) | null = null;

  constructor(deps: AssistantDeps) {
    this.campus = deps.campus;
    this.planner = deps.planner;
    this.model = deps.model;
    this.location = deps.location;
    this.vehicles = deps.vehicles;
    this.view = deps.view;
    this.arriveEarlyMin = deps.settings.arriveEarlyMin;
    this.classes = new ClassFinder(this.campus);
    this.memory = loadMemory();
    if (this.memory.mode) this.mode = this.memory.mode;
  }

  /** A sentence for the greeting, when something from an earlier chat is still kept. */
  known(): string {
    if (!this.memory.facts.length) return "";
    return ` I remember: ${this.memory.facts.join("; ")}.`;
  }

  async handle(message: string): Promise<Reply> {
    // A trip needs a GPS fix. Ask while the agent is still reading the sentence.
    const preview = parseLocally(message, (code) => this.classes.course(code) != null);
    if (needsFix(preview)) void this.location.get();
    const intent = await this.model.read(message, this.last, this.memory.facts);
    console.info("[chat]", this.model.name, intent);
    this.last = intent;
    if (!intent.again) this.offered = [];
    const noted = this.keep(intent);
    if (intent.mode && intent.action !== "stop") this.explicit = intent.mode;
    else if (intent.action === "class" || intent.action === "route" || intent.action === "nearby" || intent.action === "next" || intent.action === "order") this.explicit = null;
    const finish = (reply: Reply): Reply => {
      let text = reply.text;
      if (intent.heard) text = `${text}\n(I read that as “${intent.heard}”.)`;
      if (noted.length) text = `${text}\nI'll remember: ${noted.join("; ")}.`;
      return text === reply.text ? reply : { ...reply, text };
    };

    // An answer to "where are you?", unless it's a whole new request.
    const pending = this.pending;
    if (pending && this.answersWhere(intent, message)) {
      const place = this.find(intent.from ?? intent.place ?? message);
      if (!place) return finish(this.askWhere(`I couldn't find "${intent.from ?? intent.place ?? message}". Where are you?`, pending));
      this.startAt(place);
      this.pending = null;
      return Promise.resolve(pending(place)).then(finish);
    }
    this.pending = null;

    if (intent.from && /^(here|me|my location|where i am)$/i.test(intent.from)) this.from = null;
    else if (intent.from) {
      const place = this.find(intent.from);
      if (!place) return finish(this.askWhere(`I couldn't find "${intent.from}". Where are you?`, () => this.go()));
      this.startAt(place);
    } else if (intent.action !== "change") {
      // A new request starts from where you are again.
      this.from = null;
    }

    switch (intent.action) {
      case "class":
        if (this.rejected(intent)) return finish({ text: `Not ${intent.avoid ?? intent.course ?? "that class"}. Which class instead?` });
        return Promise.resolve(this.toClass(intent)).then((reply) => this.withFood(intent, reply)).then(finish);
      case "next":
        if (intent.again) return finish({ text: "Not that class. Name the course, or tell me what you want instead." });
        return Promise.resolve(this.nextClass()).then((reply) => this.withFood(intent, reply)).then(finish);
      case "add":
        return Promise.resolve(this.addCourse(intent.course)).then(finish);
      case "drop":
        return Promise.resolve(this.dropCourse(intent.course)).then(finish);
      case "classes":
        return Promise.resolve(this.listClasses()).then(finish);
      case "day":
        return Promise.resolve(this.dayPlan(intent.day)).then(finish);
      case "route":
        if (intent.again && this.rejected(intent)) return finish({ text: `Not ${intent.place ?? intent.avoid ?? "that"}. Where to instead?` });
        if (intent.place || intent.to) return Promise.resolve(this.toPlace(intent.place ?? intent.to!, this.target(intent), intent.via)).then(finish);
        break;
      case "nearby":
        return this.nearby(intent.what ?? message, intent.place, intent).then(finish);
      case "stop":
        if (intent.again) return finish({ text: `Not ${intent.place ?? "that stop"}. Which stop instead?` });
        return this.stopTimes(intent.place).then(finish);
      case "order":
        return this.orderFood(intent, message).then(finish);
      case "change":
        if (this.trip) {
          const target = this.target(intent);
          if (target) this.trip = { ...this.trip, arriveBy: target };
          return this.go().then(finish);
        }
        if (this.from) return finish({ text: `Starting from ${this.from.label}. Where to?` });
        break;
    }
    return finish({
      text:
        intent.reply ??
        (noted.length
          ? "Got it. I'll use that the next time you ask for directions."
          : replyTo(message)),
    });
  }

  /** Save lasting facts from this message. One-off trips (no `remember`) change nothing. */
  private keep(intent: Intent): string[] {
    const facts = intent.remember ?? [];
    if (!facts.length) return [];
    for (const fact of facts) noteFact(this.memory, fact);
    if (intent.mode) this.memory.mode = intent.mode;
    if (intent.from && !/^(here|me|my location|where i am)$/i.test(intent.from)) this.memory.start = intent.from;
    saveMemory(this.memory);
    return facts;
  }

  /** The time a message gives: "in 30 minutes" or "at 3pm" (on its day). */
  private target(intent: Intent): Date | null {
    const now = new Date();
    if (intent.inMinutes !== undefined) return new Date(now.getTime() + intent.inMinutes * 60_000);
    if (!intent.at) return null;
    const [h, m] = intent.at.split(":").map(Number);
    const at = dayFor(intent.day, now);
    at.setHours(h, m, 0, 0);
    return at;
  }

  private toClass(intent: Intent): Reply | Promise<Reply> {
    if (!this.classes.term) return { text: "I don't have this term's class schedule, so I can't look up rooms. Ask me for a building instead." };
    const course = this.classes.course(intent.course ?? "");
    if (!course) return { text: `I couldn't find ${intent.course} in the ${this.classes.term} schedule.` };
    const target = this.target(intent);
    const day = target ?? dayFor(intent.day, new Date());
    const saved = myClasses()[course.code];
    const answer = this.classes.find(course, day, target, intent.meeting, saved);
    if (answer.pick) {
      // A time that matches one section is a good sign it's theirs.
      if (target) rememberSection(course.code, answer.pick.meeting.section);
      return this.toOption(answer.pick, target);
    }
    return {
      text: answer.note ?? `Which ${course.code}?`,
      choices: answer.choices.slice(0, 8).map((option) => ({
        label: `${describe(option)}${option.startsAt && !target ? ` · ${clock(option.startsAt)}` : ""}`,
        pick: async () => {
          rememberSection(course.code, option.meeting.section);
          return this.toOption(option, target);
        },
      })),
    };
  }

  /** The first thing the chat says: what it can do, and your next class with a button to go. */
  greeting(examples: string[]): Reply {
    const term = this.classes.term;
    const next = this.upcoming()[0];
    const text = `${
      next ? `Next up: ${describe(next)}, ${when(next.startsAt!)}.` : `Tell me where you need to be${term ? `, or add a class ("add MATH 20C")` : ""}.`
    }${this.known()}`;
    return {
      text,
      choices: [
        ...(next ? [{ label: `Take me to ${next.course.code}`, pick: () => this.toOption(next, null) }] : []),
        ...examples.map((example) => ({ label: example, pick: () => this.handle(example) })),
      ].slice(0, 4),
    };
  }

  /** "Where's my next class": the soonest meeting of your classes. */
  private nextClass(): Reply | Promise<Reply> {
    const next = this.upcoming()[0];
    if (next) return this.toOption(next, null);
    return {
      text: Object.keys(myClasses()).length
        ? "None of your classes meet in the next week."
        : `I don't know your classes yet. Add one with "add MATH 20C", or tell me "I have MATH 20C at 11".`,
    };
  }

  /** Directions to `code`'s next meeting (the Go button by a class in the app's list). */
  goToCourse(code: string): Reply | Promise<Reply> {
    const course = this.classes.course(code);
    const section = myClasses()[course?.code ?? code];
    const next = course && section ? this.classes.next(course, section) : null;
    return next ? this.toOption(next, null) : { text: `${code} doesn't meet in the next week.` };
  }

  /** Each of your classes' next meeting, soonest first. */
  private upcoming(): ClassOption[] {
    return Object.entries(myClasses())
      .flatMap(([code, section]) => {
        const course = this.classes.course(code);
        const next = course && this.classes.next(course, section);
        return next ? [next] : [];
      })
      .sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime());
  }

  /** "Add MATH 20C": pick the lecture, then the discussion or lab, and remember them. */
  private addCourse(code: string | undefined): Reply {
    if (!this.classes.term) return { text: "I don't have this term's class schedule, so I can't add classes." };
    const course = code ? this.classes.course(code) : undefined;
    if (!course) return { text: `I couldn't find ${code ?? "that course"} in the ${this.classes.term} schedule.` };
    const groups = this.classes.groups(course);
    if (groups.length === 1) return this.pickSub(course, groups[0]);
    return {
      text: `Which ${course.code} lecture are you in?`,
      choices: groups.map((g) => ({
        label: `${g.group}: ${g.lecture.map((m) => this.classes.meetingLine(m)).join("; ") || "no lecture listed"}`,
        pick: async () => this.pickSub(course, g),
      })),
    };
  }

  private pickSub(course: CourseSections, group: SectionGroup): Reply {
    const subs = [...group.subs];
    if (subs.length <= 1) return this.added(course, subs[0]?.[0] ?? `${group.group}-000`);
    return {
      text: `And which discussion or lab?`,
      choices: subs.map(([section, meetings]) => ({
        label: meetings.map((m) => `${meetingType(m)} ${this.classes.meetingLine(m)}`).join("; "),
        pick: async () => this.added(course, section),
      })),
    };
  }

  private added(course: CourseSections, section: string): Reply {
    forgetCourse(course.code);
    rememberSection(course.code, section);
    return {
      text: `Added ${course.code} (${course.title}).\n${this.sectionLines(course, section).join("\n")}`,
      choices: [
        { label: "My next class", pick: async () => this.nextClass() },
        { label: "My classes", pick: async () => this.listClasses() },
      ],
    };
  }

  private dropCourse(code: string | undefined): Reply {
    const course = code ? this.classes.course(code) : undefined;
    const name = course?.code ?? code ?? "";
    return { text: forgetCourse(name) ? `Dropped ${name}.` : `${name || "That course"} isn't in your classes.` };
  }

  /** Every class you've added: when and where it meets, and exams coming up. */
  private listClasses(): Reply {
    const mine = Object.entries(myClasses());
    if (!mine.length) return { text: `You haven't added any classes. Try "add MATH 20C".` };
    const blocks = mine.flatMap(([code, section]) => {
      const course = this.classes.course(code);
      return course ? [`${course.code}: ${course.title}\n${this.sectionLines(course, section).join("\n")}`] : [];
    });
    return {
      text: `Your ${this.classes.term ?? ""} classes:\n\n${blocks.join("\n\n")}`,
      choices: [
        { label: "What do I have today?", pick: async () => this.dayPlan("today") },
        { label: "Tomorrow?", pick: async () => this.dayPlan("tomorrow") },
      ],
    };
  }

  /** "What do I have tomorrow": that day's classes in order, each with a button to go. */
  private dayPlan(dayWord: string | undefined): Reply {
    const mine = Object.entries(myClasses());
    if (!mine.length) return { text: `Add your classes first, like "add MATH 20C", and I'll tell you your day.` };
    const day = dayFor(dayWord, new Date());
    const name = dayWord === "tomorrow" ? "Tomorrow" : !dayWord || dayWord === "today" ? "Today" : day.toLocaleDateString([], { weekday: "long" });
    const items = mine
      .flatMap(([code, section]) => {
        const course = this.classes.course(code);
        return course ? this.classes.onDay(course, section, day) : [];
      })
      .sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime());
    if (!items.length) return { text: `${name}: no classes.` };
    return {
      text: `${name}:\n${items.map((o) => `${clock(o.startsAt!)}: ${describe(o)}`).join("\n")}`,
      choices: items.map((o) => ({ label: `Go to ${o.course.code} (${clock(o.startsAt!)})`, pick: () => this.toOption(o, null) })),
    };
  }

  /** "Lecture: MWF 11:00 AM, Mosaic 0114", the discussion, and exams still to come. */
  private sectionLines(course: CourseSections, section: string): string[] {
    const [group, sub] = section.split("-");
    const g = this.classes.groups(course).find((x) => x.group === group);
    const meetings = [...(g?.lecture ?? []), ...(g?.subs.get(`${group}-${sub}`) ?? [])];
    // One line per exam: big ones are split across rooms ("Center Hall 101 or Mosaic 0114").
    const exams = new Map<string, { label: string; rooms: string[] }>();
    for (const e of this.classes.exams(course, section, new Date(), 120)) {
      const label = `${meetingType(e.meeting)}: ${when(e.startsAt!)}`;
      const exam = exams.get(label) ?? exams.set(label, { label, rooms: [] }).get(label)!;
      exam.rooms.push(`${e.building.name} ${e.meeting.room ?? ""}`.trim());
    }
    return [
      ...meetings.map((m) => `${meetingType(m)}: ${this.classes.meetingLine(m)}`),
      ...[...exams.values()].map((e) => `${e.label}, ${e.rooms.join(" or ")}`),
    ];
  }

  private toOption(option: ClassOption, target: Date | null): Promise<Reply> {
    const arriveBy = option.startsAt ?? target;
    const exams = this.classes
      .exams(option.course, myClasses()[option.course.code] ?? option.meeting.section)
      .filter((e) => e.startsAt?.getTime() !== arriveBy?.getTime())
      .slice(0, 2)
      .map((e) => `Heads-up: ${describe(e)} on ${e.startsAt!.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} at ${clock(e.startsAt!)}.`);
    this.trip = {
      to: { endpoint: { kind: "building", building: option.building, room: option.meeting.room }, label: option.building.name },
      arriveBy,
      title: `${describe(option)}${arriveBy ? `, ${when(arriveBy)}` : ""}`,
      name: describe(option),
      notes: exams,
    };
    return this.go();
  }

  private toPlace(query: string, arriveBy: Date | null, viaNames: string[] = []): Reply | Promise<Reply> {
    const via: Place[] = [];
    for (const name of viaNames) {
      const stop = this.find(name);
      if (!stop) return this.miss(name, (fixed) => this.toPlace(query, arriveBy, viaNames.map((hop) => (hop === name ? fixed : hop))));
      via.push(stop);
    }
    const place = this.find(query);
    if (!place) return this.miss(query, (name) => this.toPlace(name, arriveBy, viaNames));
    const hops = [...via.map((stop) => stop.label), place.label];
    const title = `${hops.join(", then ")}${arriveBy ? `, by ${when(arriveBy)}` : ""}`;
    this.trip = {
      to: place,
      via: via.length ? via : undefined,
      arriveBy,
      title,
      name: place.label,
      notes: via.length ? [`Stops in order: ${hops.join(" → ")}.`] : undefined,
    };
    return this.go();
  }

  /** True when they threw out this destination, course, or the whole last answer. */
  private rejected(intent: Intent): boolean {
    if (!intent.again) return false;
    if (!intent.avoid) return true;
    const avoid = intent.avoid.toLowerCase();
    const named = `${intent.place ?? ""} ${intent.to ?? ""} ${intent.course ?? ""} ${intent.what ?? ""} ${intent.item ?? ""}`.toLowerCase();
    return named.includes(avoid);
  }

  /** A result already shown, or the thing they just said they don't want. */
  private blocked(name: string, intent?: Intent): boolean {
    const n = name.toLowerCase();
    if (intent?.avoid && n.includes(intent.avoid.toLowerCase())) return true;
    return !!intent?.again && this.offered.some((shown) => shown.toLowerCase() === n);
  }

  private noteOffered(names: string[]): void {
    const seen = new Set(this.offered.map((name) => name.toLowerCase()));
    for (const name of names) if (!seen.has(name.toLowerCase())) this.offered.push(name);
  }

  /** The nearest restroom, water, coffee… to you (or to the place named), and the way there. */
  private async nearby(what: string, near: string | undefined, intent?: Intent): Promise<Reply> {
    const kind = nearbyKind(what);
    if (!kind) return { text: `I don't know where to find "${what}" yet. Try restrooms, water, coffee, food, printers, parking, bike racks or ATMs.` };
    let center: LngLat | null = null;
    let around = "you";
    if (near) {
      const place = this.find(near);
      if (!place) return this.miss(near, (name) => this.nearby(what, name));
      center = endpointPosition(place.endpoint);
      around = place.label;
    } else {
      const start = await this.start();
      center = start ? endpointPosition(start.endpoint) : null;
      if (start) around = start.label;
    }
    if (!center) return this.askWhere(`Where are you? I'll find the nearest ${kind.label}.`, () => this.nearby(what, near, intent));
    if (intent?.avoid && (kind.id === intent.avoid.toLowerCase() || kind.words.test(intent.avoid))) {
      return { text: `Not ${kind.label}. What do you want instead?` };
    }
    const found = nearest(this.campus.mapPoints, kind, center, 12).filter((point) => !this.blocked(point.name, intent)).slice(0, 3);
    if (!found.length) return { text: `Not ${intent?.avoid ?? "that"}. What do you want instead?` };
    this.noteOffered(found.map((point) => point.name));
    this.view.markers(
      found.map((p) => ({ lngLat: p.lngLat, label: p.name })),
      kind.category,
    );
    const [best, ...others] = found;
    const name = (p: (typeof found)[number]) => `${p.name}${p.building && !p.name.includes(p.building) ? ` (${p.building})` : ""}`;
    this.trip = {
      to: { endpoint: { kind: "point", lngLat: best.lngLat, label: best.name }, label: best.name },
      arriveBy: null,
      title: `Nearest ${kind.label} to ${around}: ${name(best)}`,
      name: best.name,
      notes: others.length ? [`Also close: ${others.map((p) => `${name(p)}, ${distance(p.meters)}`).join("; ")}.`] : [],
    };
    // Near a named place: start from it unless we know where you are.
    if (near && !(await this.start())) this.from = this.find(near);
    return this.go();
  }

  /**
   * A Triton2Go question: today's HDH price times the quantity, the refundable box,
   * and what the app's wait words actually mean. Then the route to that hall.
   */
  private async orderFood(intent: Intent, message: string): Promise<Reply> {
    const status = explainStatus(message);
    const menus = this.campus.menus;
    if (menus?.items.length) return this.orderFromMenus(intent, message, menus, status);
    const hall = hallNamed(intent.place ?? "") ?? hallNamed(message);
    if (!hall) {
      return {
        text:
          status ??
          `Which dining hall? Pines, 64 Degrees, OceanView, Ventanas, the Bistro, Foodworx, Sixth, or Club Med. I can price a dish off today's menu and take you there.`,
      };
    }
    let menu;
    try {
      menu = await loadMenu(hall);
    } catch {
      return {
        text: `${status ? `${status} ` : ""}I couldn't load the ${hall.name} menu just now. A Triton2Go box is a $5 refundable deposit unless the item is a drink, pizza, burrito, wrap, sandwich, or pastry. Only "Pick up" or "Ready now" means it's ready.`,
      };
    }
    const matches = intent.item ? findItems(menu, intent.item) : [];
    const qty = intent.quantity ?? 1;
    let bill: string;
    if (matches.length > 1) {
      const lines = matches.slice(0, 6).map((item) => {
        const each = item.price;
        return each !== undefined ? `${qty} × ${item.name}: ${money(each)} each, ${money(each * qty)}` : item.name;
      });
      const prep = prepMinutes(matches[0].name, hall);
      bill = `${qty} bobas at ${hall.name} (${menu.hours}):\n${lines.join("\n")}\nDrinks skip the $5 Triton2Go box. About ${prep} min once the kitchen has the ticket. Only "Pick up" or "Ready now" means it's ready.`;
    } else if (matches.length === 1) {
      bill = quote(menu, matches[0], qty);
    } else {
      const sample = menu.items
        .filter((i) => i.price !== undefined)
        .slice(0, 4)
        .map((i) => `${i.name} ${money(i.price!)}`)
        .join(", ");
      bill = `${hall.name} is ${menu.hours}.${sample ? ` A few prices: ${sample}.` : ""} ${status ?? `Name a dish and how many, like "2 boba at Pines".`}`;
    }
    if (status) bill = `${bill} ${status}`;
    const place = this.find(hall.place);
    if (!place) return { text: bill };
    this.trip = { to: place, arriveBy: null, title: hall.name, name: hall.name };
    const routed = await this.go();
    return { ...routed, text: `${bill}\n${routed.text}` };
  }

  /** Recommendations and prices from the scraped menu, then a route to that hall. */
  private async orderFromMenus(intent: Intent, message: string, menus: ScrapedMenus, status?: string): Promise<Reply> {
    const namedHall = intent.place ? resolveHall(intent.place) : undefined;
    const hall = intent.along ? namedHall : (namedHall ?? resolveHall(message));
    const droppedItem = intent.avoid && intent.item?.toLowerCase().includes(intent.avoid.toLowerCase());
    const ask = {
      hall,
      item: droppedItem ? undefined : intent.item,
      minPrice: intent.minPrice,
      maxPrice: intent.maxPrice,
      maxInclusive: intent.maxInclusive,
    };
    let picks = recommend(menus, { ...ask, perHall: intent.along ? 8 : undefined }, intent.along ? 200 : 12);
    if (intent.avoid || intent.again) {
      picks = picks.filter((pick) => !this.blocked(pick.name, intent) && !this.blocked(pick.hall, intent));
    }
    if (!picks.length && (intent.again || intent.avoid)) {
      return { text: `Not ${intent.avoid ?? "that"}. What do you want instead?` };
    }
    if (intent.along && intent.to) return this.foodAlong(intent, menus, picks, status);
    if (!picks.length) {
      const range = pricePhrase(intent.minPrice, intent.maxPrice);
      const where = hall ? ` at ${hall}` : "";
      const dish = intent.item ? ` matching “${intent.item}”` : "";
      return {
        text: `Nothing on today's menu${where}${dish}${range ? ` ${range}` : ""}. Try another hall, or a wider price.`,
      };
    }
    const from = await this.start();
    if (!from) {
      const preview = this.foodBill(picks, intent, hall);
      return this.askWhere(`${preview}\nWhere are you? I'll take you to the closest hall that has it.`, () =>
        this.orderFromMenus(intent, message, menus, status),
      );
    }
    const chosen = this.closestHall(picks, from);
    const here = picks.filter((p) => p.hall === chosen);
    const shown = (here.length ? here : picks).slice(0, 4);
    this.noteOffered(shown.map((pick) => pick.name));
    const elsewhere = [...new Set(picks.filter((p) => p.hall !== chosen).map((p) => p.hall))];
    let bill = this.foodBill(shown, intent, chosen);
    if (elsewhere.length) bill += `\nAlso in range: ${elsewhere.slice(0, 3).join(", ")}.`;
    if (status) bill += ` ${status}`;
    if (/triton2\s?go|\bbox\b/i.test(message)) {
      bill += ` A Triton2Go box is a $5 refundable deposit unless it's a drink, pizza, burrito, wrap, sandwich, or pastry. Only "Pick up" or "Ready now" means it's ready.`;
    }
    const place = this.placeFor(chosen);
    this.view.food?.(chosen);
    if (!place) return { text: bill };
    this.trip = { to: place, arriveBy: null, title: chosen, name: chosen, notes: [] };
    const routed = await this.go();
    return { ...routed, text: `${bill}\n${routed.text}` };
  }

  /** Dishes under the budget at halls near the walk, then the route they asked for. */
  private async foodAlong(intent: Intent, menus: ScrapedMenus, picks: FoodPick[], status?: string): Promise<Reply> {
    const dest = intent.to ? this.find(intent.to) : null;
    if (!dest) return { text: `I couldn't find "${intent.to}" on campus, so I can't tell which dining halls are on the way.` };
    const from = await this.start();
    if (!from) {
      return this.askWhere(`Anything ${pricePhrase(intent.minPrice, intent.maxPrice) || "to eat"} on the way to ${dest.label}. Where are you starting?`, () =>
        this.orderFromMenus(intent, intent.to ?? "", menus, status),
      );
    }
    const via = (intent.via ?? []).map((name) => this.find(name)).filter((stop): stop is Place => !!stop);
    const options = this.planner.compare(
      from.endpoint,
      dest.endpoint,
      undefined,
      via.map((stop) => stop.endpoint),
    );
    const wanted = this.explicit ? options.find((o) => o.mode === this.explicit) : undefined;
    let coordinates = (wanted ?? options[0])?.planned.route.coordinates;
    if (!coordinates) {
      const failed = this.planner.plan(from.endpoint, dest.endpoint, this.explicit ?? "walk", undefined, via.map((stop) => stop.endpoint));
      if (!failed.ok) return { text: `No route to ${dest.label} from ${from.label}. ${failed.error}` };
      coordinates = failed.route.coordinates;
    }
    const near = this.hallsNearRoute(coordinates, menus);
    const close = near.filter((hall) => hall.meters <= 280);
    const keep = new Set((close.length ? close : near.slice(0, 1)).map((hall) => hall.name));
    const shown = picks.filter((pick) => keep.has(pick.hall)).slice(0, 6);
    this.noteOffered(shown.map((pick) => pick.name));
    const range = pricePhrase(intent.minPrice, intent.maxPrice);
    let bill: string;
    if (!shown.length) {
      bill = `Nothing on today's menu${range ? ` ${range}` : ""} is open along the way to ${dest.label}.`;
    } else {
      const lines = shown.map((pick) => {
        const off = near.find((hall) => hall.name === pick.hall);
        const aside = off && off.meters > 45 ? `, ${distance(off.meters)} off the path` : ", on the way";
        const price = pick.price != null ? money(pick.price) : "no price listed";
        const when = pick.open && pick.hours && pick.hours !== "Closed" ? `open ${pick.hours}` : "closed now";
        return `• ${pick.name} — ${pick.station} at ${pick.hall}, ${price}, ${when}${aside}`;
      });
      bill = `On the way to ${dest.label}${range ? `, ${range}` : ""}:\n${lines.join("\n")}`;
    }
    if (status) bill += ` ${status}`;
    if (shown[0]) this.view.food?.(shown[0].hall);
    this.trip = { to: dest, arriveBy: null, title: dest.label, name: dest.label, notes: [] };
    const routed = await this.go();
    return { ...routed, text: `${bill}\n${routed.text}` };
  }

  /** How far each dining hall sits from the path. Closest first. */
  private hallsNearRoute(coordinates: LngLat[], menus: ScrapedMenus): { name: string; meters: number }[] {
    const step = Math.max(1, Math.floor(coordinates.length / 80));
    const sampled = coordinates.filter((_, index) => index % step === 0);
    const found: { name: string; meters: number }[] = [];
    for (const hall of menus.halls) {
      const place = this.placeFor(hall.name);
      if (!place) continue;
      const at = endpointPosition(place.endpoint);
      let best = Number.POSITIVE_INFINITY;
      for (const point of sampled) {
        const meters = haversine(at[0], at[1], point[0], point[1]);
        if (meters < best) best = meters;
      }
      found.push({ name: hall.name, meters: best });
    }
    return found.sort((a, b) => a.meters - b.meters);
  }

  private foodBill(picks: FoodPick[], intent: Intent, hall?: string): string {
    const range = pricePhrase(intent.minPrice, intent.maxPrice);
    const open = picks.some((p) => p.open);
    const head = hall && picks.every((p) => p.hall === hall) ? hall : "Dining";
    const lines = picks.map((p) => {
      const price = p.price != null ? money(p.price) : "no price listed";
      const when = p.open && p.hours && p.hours !== "Closed" ? `open ${p.hours}` : "closed now";
      const where = hall && p.hall === hall ? p.station : `${p.station} at ${p.hall}`;
      return `• ${p.name} — ${where}, ${price}, ${when}`;
    });
    const lead = `${head}${range ? `, ${range}` : ""}${open ? ", open now" : ""}:`;
    return `${lead}\n${lines.join("\n")}`;
  }

  /** The hall in `picks` closest to where the trip starts. One hall stays that hall. */
  private closestHall(picks: FoodPick[], from: Place): string {
    const halls = [...new Set(picks.map((p) => p.hall))];
    if (halls.length === 1) return halls[0];
    const open = [...new Set(picks.filter((p) => p.open).map((p) => p.hall))];
    const pool = open.length ? open : halls;
    const origin = endpointPosition(from.endpoint);
    let best = pool[0];
    let bestMeters = Number.POSITIVE_INFINITY;
    for (const hall of pool) {
      const place = this.placeFor(hall);
      if (!place) continue;
      const at = endpointPosition(place.endpoint);
      const meters = haversine(origin[0], origin[1], at[0], at[1]);
      if (meters < bestMeters) {
        best = hall;
        bestMeters = meters;
      }
    }
    return best;
  }

  private placeFor(hall: string): Place | null {
    const pin = diningPin(hall);
    for (const query of pin === hall ? [hall] : [pin, hall]) {
      const place = this.find(query);
      if (place) return place;
    }
    return null;
  }

  /** "Next bus at Gilman": the stop's timetable and live buses; the stop nearest you if none is named. */
  private async stopTimes(name: string | undefined): Promise<Reply> {
    let stop = name ? stopNamed(this.campus, name) : undefined;
    if (name && !stop) {
      const place = this.find(name);
      stop = place ? nearestStop(this.campus, endpointPosition(place.endpoint)) : undefined;
    }
    if (!stop) {
      const start = await this.start();
      const at = start && endpointPosition(start.endpoint);
      if (!at) return this.askWhere("Which stop? Or tell me where you are.", (place) => this.stopTimes(place.label));
      stop = nearestStop(this.campus, at);
    }
    if (!stop) return { text: "I couldn't find that stop." };
    const group = groupOf(this.campus, stop);
    this.view.stop(group.ids, stop.lngLat);
    return {
      text: stopSummary(this.campus, group, this.vehicles()),
      choices: [
        {
          label: `Walk to ${stop.name}`,
          pick: () => {
            this.explicit = "walk";
            this.trip = { to: { endpoint: { kind: "point", lngLat: stop.lngLat, label: stop.name }, label: stop.name }, arriveBy: null, title: stop.name, name: stop.name };
            return this.go();
          },
        },
      ],
    };
  }

  /** A short place name while we're asking "where are you?" is the start, not a new trip. */
  private answersWhere(intent: Intent, message: string): boolean {
    if (["class", "order", "nearby", "stop", "next", "add", "drop", "day", "classes"].includes(intent.action)) return false;
    if (intent.course || intent.to || intent.item) return false;
    const words = message.trim().split(/\s+/).length;
    if (intent.action === "route" && words > 5) return false;
    if (intent.action === "route" && /\b(?:from|to|via|then)\b/i.test(message) && words > 3) return false;
    if (intent.via?.length) return false;
    return intent.action === "change" || intent.action === "other" || intent.action === "route";
  }

  /** Search hits for a name we couldn't place, so a typo can be picked instead of a dead end. */
  private miss(query: string, go: (name: string) => Reply | Promise<Reply>): Reply {
    const seen = new Set<string>();
    const choices: NonNullable<Reply["choices"]> = [];
    const seeds = [query, ...query.split(/\s+/).filter((word) => word.length > 3)];
    for (const seed of seeds) {
      for (const hit of this.campus.search.search(seed, { limit: 3 })) {
        const name = label(hit);
        if (seen.has(name)) continue;
        seen.add(name);
        choices.push({ label: name, pick: async () => go(name) });
        if (choices.length >= 4) break;
      }
      if (choices.length >= 4) break;
    }
    if (!choices.length) return { text: `I couldn't find "${query}" on campus. Try Geisel, Price Center, or a room like "WLH 2001".` };
    return { text: `I couldn't find "${query}". Did you mean one of these?`, choices };
  }

  /** Food along a class route, when the same message also asked what to eat. */
  private withFood(intent: Intent, reply: Reply): Reply {
    if (!reply.steps?.length || !intent.along) return reply;
    const menus = this.campus.menus;
    const coords = this.lastCoords;
    if (!menus?.items.length || !coords?.length) return reply;
    const picks = recommend(menus, {
      hall: intent.place ? resolveHall(intent.place) : undefined,
      item: intent.item,
      minPrice: intent.minPrice,
      maxPrice: intent.maxPrice,
      maxInclusive: intent.maxInclusive,
    }, 40);
    const near = this.hallsNearRoute(coords, menus);
    const close = near.filter((hall) => hall.meters <= 280);
    const keep = new Set((close.length ? close : near.slice(0, 1)).map((hall) => hall.name));
    const shown = picks.filter((pick) => keep.has(pick.hall)).slice(0, 4);
    if (!shown.length) return reply;
    const range = pricePhrase(intent.minPrice, intent.maxPrice);
    const lines = shown.map((pick) => {
      const off = near.find((hall) => hall.name === pick.hall);
      const aside = off && off.meters > 45 ? `, ${distance(off.meters)} off the path` : ", on the way";
      const price = pick.price != null ? money(pick.price) : "no price listed";
      return `• ${pick.name} at ${pick.hall}, ${price}${aside}`;
    });
    if (shown[0]) this.view.food?.(shown[0].hall);
    return { ...reply, text: `On the way${range ? `, ${range}` : ""}:\n${lines.join("\n")}\n${reply.text}` };
  }

  /** Plan the current trip from where you are (or the start you named), draw it, and say when to leave. */
  private async go(): Promise<Reply> {
    const trip = this.trip;
    this.lastCoords = null;
    if (!trip) return { text: "Where do you want to go?" };
    const from = await this.start();
    if (!from) return this.askWhere(`${trip.title}. Where are you starting from?`, () => this.go());
    // The start kept from an earlier message is where they're going now: ask instead of routing nowhere.
    if (from.label === trip.to.label && !trip.via?.length) {
      this.from = null;
      this.lastStart = null;
      return this.askWhere(`${trip.title}. Where are you starting from?`, () => this.go());
    }
    const via = (trip.via ?? []).map((stop) => stop.endpoint);
    const options = this.planner.compare(from.endpoint, trip.to.endpoint, trip.arriveBy ?? undefined, via);
    const wanted = this.explicit ? options.find((o) => o.mode === this.explicit) : undefined;
    const picked = wanted ?? options[0];
    if (!picked) {
      this.view.trip(null);
      return { text: `${trip.title}. No route from ${from.label}.` };
    }
    this.mode = picked.mode;
    const planned = picked.planned;
    const route = planned.route;
    this.lastCoords = route.coordinates;
    this.view.trip({ from: from.endpoint, to: trip.to.endpoint, mode: picked.mode, arriveBy: trip.arriveBy, title: trip.title, name: trip.name, route });
    const minutes = Math.max(1, Math.ceil(planned.minutes));
    const fastest = options[0];
    const others = options.filter((o) => o.mode !== picked.mode);
    const how = MODES[picked.mode].label;
    const asked = this.explicit && wanted ? "" : this.explicit && !wanted ? `${MODES[this.explicit].label} isn't possible here. ` : "";
    const choice = !this.explicit || !wanted
      ? `Fastest is ${how.toLowerCase()}`
      : picked.mode === fastest.mode
        ? `${how} is the fastest`
        : `${how}, though ${MODES[fastest.mode].label.toLowerCase()} is faster (${Math.max(1, Math.ceil(fastest.planned.minutes))} min)`;
    const also = others.map((o) => `${MODES[o.mode].label} ${Math.max(1, Math.ceil(o.planned.minutes))} min`).join(" · ");
    const usual = this.memory.mode && this.memory.mode !== picked.mode ? options.find((o) => o.mode === this.memory.mode) : undefined;
    const lines = [
      `${trip.title}.`,
      `${asked}${choice} from ${from.label}: ${minutes} min, ${distance(route.meters)}. ${leaveAdvice(route, picked.mode, minutes, trip.arriveBy, this.arriveEarlyMin)}`.trim(),
      also ? `Also: ${also}.` : "",
      usual && !this.explicit ? `You usually ${MODES[usual.mode].label.toLowerCase()} (${Math.max(1, Math.ceil(usual.planned.minutes))} min). Say so if you want that instead.` : "",
      ...this.transitLines(route),
      ...this.insideLines(trip.to.endpoint, route),
      ...(trip.notes ?? []),
    ].filter(Boolean);
    const leaving = from.endpoint.kind === "building" ? from.endpoint.building : undefined;
    const steps = buildSteps(this.campus.graph, route, trip.to.label, { leaving }).map(
      (s) => `${s.text}${s.distance >= 15 ? ` (${distance(s.distance)})` : ""}`,
    );
    return {
      text: lines.join("\n"),
      steps,
      choices: others.map((o) => ({
        label: `${MODES[o.mode].label} · ${Math.max(1, Math.ceil(o.planned.minutes))} min`,
        pick: () => {
          this.explicit = o.mode;
          return this.go();
        },
      })),
    };
  }

  /** Each bus or trolley ride: where to board, when, how far; and whether that line is live on the map. */
  private transitLines(route: Route): string[] {
    const vehicles = this.vehicles();
    return route.legs.flatMap((leg) => {
      if (leg.mode !== "bus") return [];
      const line = leg.route.mode === "trolley" ? `${leg.route.short} Line trolley` : `${leg.route.short}`;
      const live = vehicles.filter((v) => v.route === leg.route.short).length;
      return [
        `Board the ${line} to ${leg.headsign} at ${leg.from.name}, ${clock(leg.departs)}. Ride ${leg.stopCount} stop${leg.stopCount === 1 ? "" : "s"} to ${leg.to.name} (${clock(leg.arrives)}).${live ? ` ${live} live on the map now.` : ""}`,
      ];
    });
  }

  /** Arriving at a building: which door, which floor, and the elevator when it matters. */
  private insideLines(to: Endpoint, route: Route): string[] {
    if (to.kind !== "building") return [];
    const building: Building = to.building;
    const hints = insideHints(building, to.room, this.campus.indoor[building.id], route);
    const lines: string[] = [];
    if (hints.enterBy) lines.push(`Enter by ${hints.enterBy}.`);
    if (hints.room && hints.floor) lines.push(`Room ${hints.room} is ${floorPhrase(hints.floor)}.`);
    const upstairs = hints.floor && hints.floor.floor !== "1" && hints.floor.floor !== "0";
    if (this.mode === "accessible" || upstairs) {
      lines.push(hints.elevator === "mapped" ? "There's an elevator on the map." : "No elevator is mapped here; check signs inside.");
    }
    return lines;
  }

  private askWhere(text: string, then: (at: Place) => Promise<Reply>): Reply {
    this.pending = then;
    return {
      text,
      choices: START_PICKS.map((name) => ({
        label: name,
        pick: () => {
          const place = this.find(name)!;
          this.startAt(place);
          this.pending = null;
          return then(place);
        },
      })),
    };
  }

  private startAt(place: Place): void {
    this.from = place;
    this.lastStart = place;
  }

  /** Where trips start: the start named for this request, else your location (on campus), else the last start named. */
  private async start(): Promise<Place | null> {
    if (this.from) return this.from;
    const at = await this.location.get();
    // "My location": the label the full app follows your dot by.
    if (at && this.location.onCampus(at)) return { endpoint: { kind: "point", lngLat: at, label: "My location" }, label: "your location" };
    if (this.lastStart) return this.lastStart;
    if (!this.memory.start) return null;
    const usual = this.find(this.memory.start);
    if (usual) this.lastStart = usual;
    return usual;
  }

  private find(query: string): Place | null {
    const hit = this.campus.search.search(query, { limit: 1 })[0];
    return hit ? { endpoint: endpoint(hit), label: label(hit) } : null;
  }
}

/** A trip, a stop, or a follow-up. "What are my classes" does not need a GPS fix. */
function needsFix(intent: Intent): boolean {
  return intent.action === "route" || intent.action === "class" || intent.action === "nearby" || intent.action === "order" || intent.action === "stop" || intent.action === "next" || intent.action === "change";
}

/** "Leave by 10:49 AM (in 17 min).", aiming to arrive `earlyMin` minutes before `arriveBy`. */
function leaveAdvice(route: Route, mode: TravelMode, minutes: number, arriveBy: Date | null, earlyMin: number): string {
  if (!arriveBy) return "";
  const now = Date.now();
  const early = earlyMin * 60_000;
  const leaveAt = mode === "bus" && route.leaveAt.getTime() > now ? route.leaveAt.getTime() : arriveBy.getTime() - early - minutes * 60_000;
  const wait = Math.floor((leaveAt - now) / 60_000);
  if (wait > 90) return `Leave by ${when(new Date(leaveAt))}.`;
  if (wait > 1) return `Leave by ${clock(new Date(leaveAt))} (in ${wait} min).`;
  const late = Math.ceil((now + minutes * 60_000 - arriveBy.getTime()) / 60_000);
  return late > 0 ? `Leave now: you'll be about ${late} min late.` : "Leave now to make it.";
}

/** "3:31 PM" today, "tomorrow 11:00 AM", "Wed 8:00 PM" this week, "Wed, Nov 18, 8:00 PM" later. */
function when(at: Date): string {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (at.toDateString() === today.toDateString()) return clock(at);
  if (at.toDateString() === tomorrow.toDateString()) return `tomorrow ${clock(at)}`;
  if (at.getTime() - today.getTime() < 6 * 86_400_000) return `${at.toLocaleDateString([], { weekday: "short" })} ${clock(at)}`;
  return `${at.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${clock(at)}`;
}

/** Feet up close, miles farther: "350 ft", "0.4 mi". */
function distance(meters: number): string {
  const feet = meters * 3.281;
  return feet < 1000 ? `${Math.max(10, Math.round(feet / 10) * 10)} ft` : `${(meters / 1609.34).toFixed(1)} mi`;
}

function label(hit: SearchHit): string {
  if (hit.kind === "building") return hit.building.name;
  if (hit.kind === "place") return hit.place.name;
  if (hit.kind === "room") return `${hit.building.name} ${hit.room}`;
  if (hit.kind === "class") return hit.meeting.course;
  return hit.course.code;
}

function endpoint(hit: SearchHit): Endpoint {
  if (hit.kind === "place") return { kind: "place", place: hit.place };
  if (hit.kind === "building") return { kind: "building", building: hit.building };
  if (hit.kind === "room") return { kind: "building", building: hit.building, room: hit.room };
  if (hit.kind === "class") return { kind: "building", building: hit.building };
  return { kind: "building", building: hit.building, room: hit.room };
}

/** "Lecture", "Discussion", "Lab", "Midterm", "Final" */
function meetingType(m: SectionMeeting): string {
  if (m.kind !== "class") return m.kind === "midterm" ? "Midterm" : "Final";
  return { LE: "Lecture", DI: "Discussion", LA: "Lab", SE: "Seminar" }[m.type] ?? m.type;
}
