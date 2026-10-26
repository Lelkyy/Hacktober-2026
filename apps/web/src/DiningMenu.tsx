import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatMenuDate,
  hoursOn,
  localDate,
  menuDate,
  money,
  nextOpen,
  pickMeal,
  type DiningMatch,
  type DiningMenus,
  type DiningStation,
} from "@campus/chat";

/** One hall: each station's hours, then that station's menu. `date` picks the day; otherwise today (or the saved same weekday). */
export function DiningMenu({ menus, match, date: dateProp, bare }: { menus: DiningMenus; match: DiningMatch; date?: string; bare?: boolean }) {
  const date = dateProp ?? menuDate(menus);
  const today = localDate();
  const saved = !dateProp && date !== today;
  const { hall } = match;
  const root = useRef<HTMLElement>(null);
  const stations = useMemo(() => {
    const wanted = match.stations ? new Set(match.stations.map((s) => s.toLowerCase())) : null;
    const list = hall.stations.filter((s) => !wanted || wanted.has(s.name.toLowerCase()));
    return list.length ? list : hall.stations;
  }, [hall, match.stations]);
  const stationKey = stations.map((s) => s.name).join("|");
  const preferred = useMemo(() => {
    const hasItems = (name: string) => menus.items.some((item) => item.hall === hall.name && item.date === date && item.station === name);
    const clicked = match.stations?.find((name) => hasItems(name));
    const serving = stations.find((s) => hasItems(s.name) && hoursOn(s, date) !== "Closed" && s.name.toLowerCase() !== hall.name.toLowerCase());
    const any = stations.find((s) => hasItems(s.name));
    return clicked ?? serving?.name ?? any?.name ?? stations[0]?.name ?? "";
  }, [menus, hall.name, date, match.stations, stations]);
  const [stationName, setStationName] = useState(preferred);
  const [shownHall, setShownHall] = useState(`${hall.name}|${stationKey}|${date}`);
  const hallKey = `${hall.name}|${stationKey}|${date}`;
  if (shownHall !== hallKey) {
    setShownHall(hallKey);
    setStationName(preferred);
  }
  useEffect(() => {
    root.current?.scrollIntoView({ block: "nearest" });
  }, [hall.name]);

  const station = stations.find((s) => s.name === stationName) ?? stations[0];
  const hallClock = stations.find((s) => s.name.toLowerCase() === hall.name.toLowerCase()) ?? station;
  const clock = stations.length > 1 ? hallClock : station;
  const hours = clock ? hoursOn(clock, date) : null;
  const stationLine = station ? hoursOn(station, date) : null;
  const items = useMemo(
    () => menus.items.filter((item) => item.hall === hall.name && item.date === date && item.station === station?.name),
    [menus, hall.name, date, station?.name],
  );
  const meals = useMemo(() => [...new Set(items.map((item) => item.meal))], [items]);
  const mealKey = meals.join("|");
  const [meal, setMeal] = useState(() => pickMeal(meals));
  useEffect(() => setMeal(pickMeal(meals)), [station?.name, date, mealKey, meals]);
  const showing = items.filter((item) => item.meal === meal);

  return (
    <section className={`dining ${bare ? "bare" : ""}`} aria-label={`Menu at ${hall.name}`} ref={root}>
      {!bare && (
        <>
          <p className="dining-title">{stations.length === 1 ? stations[0].name : hall.name}</p>
          <p className="dining-hours">
            {formatMenuDate(date)}
            {saved ? " (saved menu)" : ""}
            {hours ? ` · ${hours === "Closed" ? "Closed" : `Open ${hours}`}` : ""}
          </p>
        </>
      )}
      {stations.length > 1 && (
        <div className="dining-stations" role="tablist" aria-label="Stations">
          {stations.map((s) => (
            <button key={s.name} role="tab" aria-selected={s.name === station?.name} className={s.name === station?.name ? "on" : ""} onClick={() => setStationName(s.name)}>
              <span>{s.name}</span>
              <span className="dining-station-hours">{stationHours(s, date)}</span>
            </button>
          ))}
        </div>
      )}
      {items.length === 0 ? (
        <p className="dining-hours">
          {stationLine === "Closed" && station && nextOpen(station, date) ? `Closed today. Next open ${nextOpen(station, date)}.` : "Nothing is listed at this station today."}
        </p>
      ) : (
        <>
          <div className="dining-meals" role="tablist" aria-label="Meal">
            {meals.map((name) => (
              <button key={name} role="tab" aria-selected={meal === name} className={meal === name ? "on" : ""} onClick={() => setMeal(name)}>
                {name}
              </button>
            ))}
          </div>
          <ul className="dining-items">
            {showing.map((item, i) => (
              <li key={`${item.category}-${item.name}-${i}`}>
                <span>
                  {item.name}
                  {item.category && item.category !== "Menu Items" ? <span className="muted"> · {item.category}</span> : null}
                </span>
                <span className="dining-meta">
                  {stationLine && <span className="dining-when">{stationLine === "Closed" ? "Closed" : stationLine}</span>}
                  {item.price != null && <span className="dining-price">{money(item.price)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function stationHours(station: DiningStation, date: string): string {
  const line = hoursOn(station, date);
  if (!line || line === "Closed") return "Closed";
  return line;
}
