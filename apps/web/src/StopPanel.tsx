import { arrivalsAtStop, arrivalsAtStops, linesAtStop, linesAtStops, routeLabel, type TransitNetwork, type TransitStop } from "@campus/core";
import { useMemo } from "react";
import { formatLead, formatTime } from "./Itinerary.tsx";
import { lineBadges, lineColor } from "./lineColor.ts";
import { StopBadge } from "./StopBadge.tsx";

/** Scheduled arrivals at a stop, from the published timetable already in transit.json. */
export function StopPanel({
  stop,
  stopIds,
  transit,
  routeId,
  onRoute,
  onBack,
}: {
  stop: TransitStop;
  /** Other platforms of the same station (both directions of a trolley). */
  stopIds?: string[];
  transit: TransitNetwork;
  /** The line whose path is drawn, when one chip is selected. */
  routeId: string | null;
  onRoute: (routeId: string | null) => void;
  onBack: () => void;
}) {
  const ids = stopIds?.length ? stopIds : [stop.id];
  const lines = useMemo(() => (ids.length > 1 ? linesAtStops(transit, ids) : linesAtStop(transit, ids[0])), [transit, ids.join("|")]);
  const arrivals = useMemo(() => {
    const list = ids.length > 1 ? arrivalsAtStops(transit, ids, new Date(), 14) : arrivalsAtStop(transit, ids[0], new Date(), 14);
    return routeId ? list.filter((a) => a.route.id === routeId) : list;
  }, [transit, ids.join("|"), routeId]);
  const badges = lineBadges(lines.map((l) => l.route));
  const now = Date.now();

  return (
    <section className="stop-panel" aria-label={`Times at ${stop.name}`}>
      <button className="link back-link" onClick={onBack}>
        ‹ Back to directions
      </button>
      <header className="stop-panel-head">
        <StopBadge lines={badges} size={40} />
        <div>
          <h2>{stop.name}</h2>
          <p className="muted small">Scheduled times from the published timetable</p>
        </div>
      </header>
      <div className="stop-lines" aria-label="Lines">
        {lines.length > 1 ? (
          <button type="button" className={`route-badge all ${routeId ? "" : "on"}`} aria-pressed={!routeId} onClick={() => onRoute(null)}>
            All
          </button>
        ) : null}
        {lines.map((l) => {
          const label = l.route.mode === "trolley" ? `${l.route.short} Line` : l.route.short || routeLabel(l.route);
          const on = routeId === l.route.id;
          return (
            <button
              key={l.route.id}
              type="button"
              className={`route-badge ${on ? "on" : ""}`}
              style={{ ["--route" as string]: lineColor(l.route) }}
              aria-pressed={on}
              onClick={() => onRoute(l.route.id)}
            >
              {label}
            </button>
          );
        })}
      </div>
      {lines.length > 1 ? <p className="muted small stop-line-hint">{routeId ? "Showing that line." : "Showing every line from this stop."}</p> : null}
      {arrivals.length === 0 ? (
        <p className="note">No more scheduled trips from here today.</p>
      ) : (
        <ol className="stop-arrivals">
          {arrivals.map((a, i) => {
            const min = Math.round((a.at.getTime() - now) / 60_000);
            return (
              <li key={`${a.route.id}-${a.at.getTime()}-${i}`}>
                <span className="route-badge" style={{ ["--route" as string]: lineColor(a.route) }}>
                  {a.route.mode === "trolley" ? `${a.route.short} Line` : a.route.short}
                </span>
                <span className="stop-arrival-line">
                  {a.headsign ? <span className="muted">to {a.headsign}</span> : null}
                  <strong>{formatTime(a.at)}</strong>
                </span>
                <span className={`stop-arrival-in ${min <= 2 ? "late" : ""}`}>{formatLead(min)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
