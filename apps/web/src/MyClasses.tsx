import { CLASSES_CHANGED, ClassFinder, clock, forgetCourse, myClasses, type ChatCampus } from "@campus/chat";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { CloseIcon } from "./Icons.tsx";

/** Your classes as the chat keeps them ("add MATH 20C"), following every change. */
function useMyClasses(): Record<string, string> {
  const raw = useSyncExternalStore(
    (changed) => {
      window.addEventListener(CLASSES_CHANGED, changed);
      window.addEventListener("storage", changed);
      return () => {
        window.removeEventListener(CLASSES_CHANGED, changed);
        window.removeEventListener("storage", changed);
      };
    },
    () => JSON.stringify(myClasses()),
  );
  return useMemo(() => JSON.parse(raw) as Record<string, string>, [raw]);
}

/**
 * Your classes, each with its next meeting: tap one for directions (the chat
 * answers), × to drop it. Adding happens in the chat.
 */
export function MyClasses({ campus, onGo }: { campus: ChatCampus; onGo: (course: string) => void }) {
  const mine = useMyClasses();
  const finder = useMemo(() => new ClassFinder(campus), [campus]);
  // "Next" moves on as classes pass.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const rows = Object.entries(mine)
    .map(([code, section]) => {
      const course = finder.course(code);
      return { code, title: course?.title ?? "", next: course ? finder.next(course, section, now) : null };
    })
    .sort((a, b) => (a.next?.startsAt?.getTime() ?? Infinity) - (b.next?.startsAt?.getTime() ?? Infinity));

  if (!rows.length) {
    return <p className="muted small my-classes-empty">Tell the chat your classes (“add MATH 20C”) and they'll show here.</p>;
  }
  return (
    <section className="my-classes" aria-label="Your classes">
      <h2>Your classes</h2>
      <ul>
        {rows.map(({ code, title, next }) => (
          <li key={code}>
            <button className="my-class" onClick={() => onGo(code)} disabled={!next} title={title}>
              <strong>{code}</strong>
              <span>
                {next
                  ? `${dayLabel(next.startsAt!, now)} ${clock(next.startsAt!)}, ${next.building.name} ${next.meeting.room ?? ""}`
                  : "Nothing this week"}
              </span>
            </button>
            <button className="icon-btn" aria-label={`Drop ${code}`} title={`Drop ${code}`} onClick={() => forgetCourse(code)}>
              <CloseIcon />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Today", "Tomorrow", "Wed" */
function dayLabel(at: Date, now: Date): string {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (at.toDateString() === now.toDateString()) return "Today";
  if (at.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return at.toLocaleDateString([], { weekday: "short" });
}
