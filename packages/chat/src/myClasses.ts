/**
 * Your classes: one section per course ("MATH 20C" -> "002-003": lecture group
 * 002 with its discussion 003), saved in this browser. The chat adds to it
 * ("add MATH 20C", or picking a room for a class) and reads it ("my next class").
 */
const KEY = "chat.sections";
/** Fired on `window` whenever your classes change, so a list of them can follow along. */
export const CLASSES_CHANGED = "chat:classes-changed";

export function myClasses(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Remember `section` of `course`. A lecture ("002-000-LE") never replaces a
 * discussion or lab already saved in the same group ("002-003"): that one is more exact.
 */
export function rememberSection(course: string, section: string): void {
  const [group, sub = "000"] = section.split("-");
  const [oldGroup, oldSub = "000"] = (myClasses()[course] ?? "").split("-");
  if (sub === "000" && oldGroup === group && oldSub !== "000") return;
  save({ ...myClasses(), [course]: `${group}-${sub}` });
}

/** Forget a course. False if it wasn't saved. */
export function forgetCourse(course: string): boolean {
  const all = myClasses();
  if (!(course in all)) return false;
  delete all[course];
  save(all);
  return true;
}

/**
 * Bring in classes from the app's old schedule (one meeting per row, each with
 * its course and Schedule of Classes section). Courses already saved are kept.
 * Returns how many courses were added.
 */
export function importClasses(meetings: { course: string; section?: string }[]): number {
  const all = myClasses();
  let added = 0;
  for (const m of meetings) {
    if (!m.section || m.course in all) continue;
    const [group, sub = "000"] = m.section.split("-");
    all[m.course] = `${group}-${sub}`;
    added++;
  }
  // A discussion row after its lecture row: keep the more exact one.
  for (const m of meetings) {
    const [group, sub = "000"] = (m.section ?? "").split("-");
    if (sub !== "000" && all[m.course] === `${group}-000`) all[m.course] = `${group}-${sub}`;
  }
  save(all);
  return added;
}

function save(all: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Private window or blocked storage: the chat asks again next time.
  }
  window.dispatchEvent(new Event(CLASSES_CHANGED));
}
