import { useEffect, useRef, useState } from "react";
import { DiningMenu } from "./DiningMenu.tsx";
import { ChevronIcon } from "./Icons.tsx";
import {
  addDays,
  formatMenuDate,
  hallClock,
  hallIsOpen,
  hoursOn,
  isOpenAt,
  localDate,
  nextOpen,
  type DiningHall,
  type DiningMenus,
} from "./diningMenu.ts";

/** Every HDH hall: open or closed right now, then the week's hours and that day's menu. */
export function FoodPanel({
  menus,
  selected,
  onSelect,
  onDirections,
}: {
  menus: DiningMenus | null;
  selected: string | null;
  onSelect: (hall: string | null) => void;
  onDirections: (hall: string) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [filter, setFilter] = useState<"open" | "all">("all");
  const [day, setDay] = useState(() => localDate());
  const openRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    openRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!menus) return <p className="muted">Loading dining hours…</p>;
  if (!menus.halls.length) return <p className="muted">Dining hours aren’t loaded yet.</p>;

  const today = localDate(now);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const halls = [...menus.halls].sort((a, b) => {
    const ao = hallIsOpen(a, today, now) ? 0 : 1;
    const bo = hallIsOpen(b, today, now) ? 0 : 1;
    return ao - bo || a.name.localeCompare(b.name);
  });
  const openCount = halls.filter((hall) => hallIsOpen(hall, today, now)).length;
  const shown = halls.filter((hall) => filter === "all" || hall.name === selected || hallIsOpen(hall, today, now));

  return (
    <div className="food">
      <div className="food-head">
        <p className="food-summary">
          <strong>{openCount}</strong> of {halls.length} open now
        </p>
        <div className="segmented food-filter" role="group" aria-label="Which halls">
          <button className={filter === "open" ? "on" : ""} aria-pressed={filter === "open"} onClick={() => setFilter("open")}>
            Open now
          </button>
          <button className={filter === "all" ? "on" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All halls
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="muted">Nothing is open right now.</p>
      ) : (
        <div className="food-list">
          {shown.map((hall) => {
            const open = hall.name === selected;
            const status = statusLine(hall, today, now);
            return (
              <article key={hall.name} className={`food-card ${status.open ? "open-now" : ""}`}>
                <button ref={open ? openRef : undefined} className="food-toggle" aria-expanded={open} onClick={() => onSelect(open ? null : hall.name)}>
                  <span className="food-hall-top">
                    <span className="food-name">{hall.name}</span>
                    <span className={`food-badge ${status.open ? "open" : "closed"}`}>{status.open ? "Open" : "Closed"}</span>
                  </span>
                  <span className="food-line">{status.text}</span>
                  <ChevronIcon up={open} />
                </button>
                {open && (
                  <HallDetail
                    menus={menus}
                    hall={hall}
                    days={days}
                    day={day}
                    today={today}
                    onDay={setDay}
                    onDirections={() => onDirections(hall.name)}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}
      <p className="muted small">Hours and menus from HDH. Updated {fetchedLabel(menus.fetchedAt)}.</p>
    </div>
  );
}

function HallDetail({
  menus,
  hall,
  days,
  day,
  today,
  onDay,
  onDirections,
}: {
  menus: DiningMenus;
  hall: DiningHall;
  days: string[];
  day: string;
  today: string;
  onDay: (day: string) => void;
  onDirections: () => void;
}) {
  const clock = hallClock(hall);
  return (
    <div className="food-detail">
      <ul className="food-week" aria-label={`${hall.name} hours`}>
        {days.map((iso) => {
          const line = clock ? hoursOn(clock, iso) : null;
          return (
            <li key={iso}>
              <button className={iso === day ? "on" : ""} aria-pressed={iso === day} onClick={() => onDay(iso)}>
                <span>{iso === today ? "Today" : shortDay(iso)}</span>
                <span>{!line || line === "Closed" ? "Closed" : line}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button onClick={onDirections}>Directions</button>
      <p className="food-kicker">Menu · {formatMenuDate(day)}</p>
      <DiningMenu menus={menus} match={{ hall, stations: null }} date={day} bare />
    </div>
  );
}

function statusLine(hall: DiningHall, today: string, now: Date): { open: boolean; text: string } {
  const clock = hallClock(hall);
  const open = hallIsOpen(hall, today, now);
  const todayHours = clock ? hoursOn(clock, today) : null;
  if (open) {
    const serving = clock && isOpenAt(clock, today, now) ? clock : hall.stations.find((station) => isOpenAt(station, today, now));
    const line = serving ? hoursOn(serving, today) : null;
    const close = line && line !== "Closed" ? line.split(" – ")[1] : null;
    const whose = serving && clock && serving.name !== clock.name ? `${serving.name} ` : "";
    const when = close ? `until ${close}` : "open";
    return { open: true, text: whose ? `${whose}${when}` : when[0].toUpperCase() + when.slice(1) };
  }
  if (todayHours && todayHours !== "Closed") return { open: false, text: `Today ${todayHours}` };
  const next = clock ? nextOpen(clock, today) : null;
  return { open: false, text: next ? `Opens ${next}` : "Closed" };
}

function shortDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", { weekday: "short" });
}

function fetchedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(/\s+/g, " ").trim();
}
