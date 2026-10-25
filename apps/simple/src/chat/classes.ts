import { courseKey, expandMeeting, WEEKDAYS, type Building, type CourseSections, type SectionMeeting } from "@campus/core";
import type { Campus } from "../campus/loadCampus.ts";
import type { Intent } from "./intent.ts";

/** One room a class might be in, at one time. */
export interface ClassOption {
  course: CourseSections;
  meeting: SectionMeeting;
  building: Building;
  /** When it starts on the day asked about; null when it doesn't meet that day. */
  startsAt: Date | null;
}

export interface ClassAnswer {
  /** Exactly one fits. */
  pick?: ClassOption;
  /** Several fit (or none on that day): the user chooses. */
  choices: ClassOption[];
  /** Why there was no single answer, when there wasn't. */
  note?: string;
}

/** Start-time slack: "in 30 minutes" said at 10:32 still means the 11:00 class. */
const NEAR_MS = 20 * 60_000;
/** Still treat a class as upcoming for a few minutes after it starts (running late). */
const GRACE_MS = 10 * 60_000;
const TYPE_FOR: Record<NonNullable<Intent["meeting"]>, (m: SectionMeeting) => boolean> = {
  lecture: (m) => m.kind === "class" && m.type === "LE",
  discussion: (m) => m.kind === "class" && m.type === "DI",
  lab: (m) => m.kind === "class" && m.type === "LA",
  midterm: (m) => m.kind === "midterm",
  final: (m) => m.kind === "final",
};

export class ClassFinder {
  private readonly byKey = new Map<string, CourseSections>();

  constructor(private readonly campus: Campus) {
    for (const c of campus.sections?.courses ?? []) this.byKey.set(courseKey(c.code), c);
  }

  get term(): string | null {
    return this.campus.sections?.term ?? null;
  }

  course(code: string): CourseSections | undefined {
    return this.byKey.get(courseKey(code));
  }

  /**
   * Which room to go to for `course` on `day`, near `target` if a time was given.
   * `section`: the section the user picked before ("002-003-DI"), preferred when it fits.
   */
  find(course: CourseSections, day: Date, target: Date | null, kind: Intent["meeting"], section?: string): ClassAnswer {
    const all = course.meetings
      .map(expandMeeting)
      .flatMap((meeting) => {
        const building = meeting.building ? this.campus.buildingByCode.get(meeting.building) : undefined;
        return building ? [{ course, meeting, building, startsAt: startOn(meeting, day) }] : [];
      })
      .filter((o) => (kind ? TYPE_FOR[kind](o.meeting) : true));
    const thatDay = all.filter((o) => o.startsAt !== null);
    const dayName = day.toLocaleDateString("en-US", { weekday: "long" });

    let fits: ClassOption[];
    if (target) {
      fits = thatDay.filter((o) => Math.abs(o.startsAt!.getTime() - target.getTime()) <= NEAR_MS);
    } else {
      // No time given: the next one that day.
      const from = sameDay(day, new Date()) ? Date.now() - GRACE_MS : 0;
      const upcoming = thatDay.filter((o) => o.startsAt!.getTime() >= from).sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime());
      fits = upcoming.filter((o) => o.startsAt!.getTime() === upcoming[0]?.startsAt!.getTime());
    }
    if (section) {
      const mine = fits.filter((o) => sameSection(o.meeting.section, section));
      if (mine.length) fits = mine;
    }
    fits = distinctRooms(fits);
    if (fits.length === 1) return { pick: fits[0], choices: [] };
    if (fits.length > 1) return { choices: fits, note: `${course.code} meets in ${fits.length} rooms then. Which one is yours?` };

    // Nothing fits the day and time: offer the course's lectures (or the kind asked for), at the time they gave.
    const kinds = kind ? all : all.filter((o) => o.meeting.kind === "class" && o.meeting.type === "LE");
    const choices = distinctRooms(kinds.length ? kinds : all).map((o) => ({ ...o, startsAt: target }));
    const when = target ? `${dayName} around ${clock(target)}` : `${dayName}`;
    const note = choices.length
      ? `I don't see ${course.code}${kind ? ` (${kind})` : ""} on ${when} in the ${this.term} schedule. Which room is it in?`
      : `${course.code} has no rooms on the map in the ${this.term} schedule.`;
    return { choices, note };
  }

  /** The next time `section` of `course` meets (class or exam), within a week. */
  next(course: CourseSections, section: string, now = new Date()): ClassOption | null {
    for (let offset = 0; offset < 7; offset++) {
      const day = new Date(now);
      day.setDate(now.getDate() + offset);
      const options = this.options(course, day)
        .filter((o) => sameSection(o.meeting.section, section) && o.startsAt!.getTime() >= now.getTime() - GRACE_MS)
        .sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime());
      if (options[0]) return options[0];
    }
    return null;
  }

  /** Midterms and finals in the next `days` days (for `section`'s group, when known). */
  exams(course: CourseSections, section: string | undefined, now = new Date(), days = 14): ClassOption[] {
    const found: ClassOption[] = [];
    for (let offset = 0; offset <= days; offset++) {
      const day = new Date(now);
      day.setDate(now.getDate() + offset);
      for (const o of this.options(course, day)) {
        if (o.meeting.kind === "class" || o.startsAt!.getTime() < now.getTime()) continue;
        if (section && !sameSection(o.meeting.section, section)) continue;
        found.push(o);
      }
    }
    return distinctRooms(found);
  }

  /** Every meeting of `course` on `day`, with its building on the map. */
  private options(course: CourseSections, day: Date): ClassOption[] {
    return course.meetings.map(expandMeeting).flatMap((meeting) => {
      const building = meeting.building ? this.campus.buildingByCode.get(meeting.building) : undefined;
      const startsAt = startOn(meeting, day);
      return building && startsAt ? [{ course, meeting, building, startsAt }] : [];
    });
  }
}

/** "MATH 20C lecture, Mosaic 0114" */
export function describe(o: ClassOption): string {
  const what = o.meeting.kind === "class" ? { LE: "lecture", DI: "discussion", LA: "lab", SE: "seminar" }[o.meeting.type] ?? o.meeting.type : o.meeting.kind;
  return `${o.course.code} ${what}, ${o.building.name} ${o.meeting.room ?? ""}`.trim();
}

export function clock(at: Date): string {
  return at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** The day a message means: "today", "tomorrow", "monday" (the next one, today included). */
export function dayFor(day: string | undefined, now: Date): Date {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  if (day === "tomorrow") date.setDate(date.getDate() + 1);
  const weekday = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(day ?? "");
  if (weekday >= 0) date.setDate(date.getDate() + ((weekday - date.getDay() + 7) % 7));
  return date;
}

function startOn(m: SectionMeeting, day: Date): Date | null {
  const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const meets = m.kind === "class" ? m.days.includes(WEEKDAYS[day.getDay()]) : m.date === iso;
  if (!meets) return null;
  const [h, min] = m.start.split(":").map(Number);
  const at = new Date(day);
  at.setHours(h, min, 0, 0);
  return at;
}

/** A lecture "002-000-LE" belongs to every "002-…" pick; a discussion only to itself. */
function sameSection(a: string, b: string): boolean {
  const [ga, sa] = a.split("-");
  const [gb, sb] = b.split("-");
  return ga === gb && (sa === "000" || sb === "000" || sa === sb);
}

function distinctRooms(options: ClassOption[]): ClassOption[] {
  const seen = new Set<string>();
  return options.filter((o) => {
    const key = `${o.building.id} ${o.meeting.room} ${o.startsAt?.getTime()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}
