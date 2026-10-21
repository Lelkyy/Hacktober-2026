import { arrivalsAtStop, linesAtStop, routeLabel, type TransitNetwork, type TransitStop } from "@campus/core";
import { useMemo } from "react";
import { formatTime } from "./Itinerary.tsx";
import { lineColor, lineMark, stopLogoColors } from "./lineColor.ts";
import { StopBadge } from "./StopBadge.tsx";

/** Scheduled arrivals at a stop, from the published timetable already in transit.json. */
export function StopPanel({
  stop,
  transit,
  onBack,
}: {
  stop: TransitStop;
  transit: TransitNetwork;
  onBack: () => void;
}) {
  const lines = useMemo(() => linesAtStop(transit, stop.id), [transit, stop.id]);
  const arrivals = useMemo(() => arrivalsAtStop(transit, stop.id, new Date(), 14), [transit, stop.id]);
  const colors = stopLogoColors(lines.map((l) => l.route));
  const now = Date.now();

  return (
    <section className="stop-panel" aria-label={`Times at ${stop.name}`}>
      <button className="link back-link" onClick={onBack}>
        ‹ Back to directions
      </button>
      <header className="stop-panel-head">
        <StopBadge colors={colors} label={lines.length === 1 ? lineMark(lines[0].route) : undefined} size={40} />
        <div>
          <h2>{stop.name}</h2>
          <p className="muted small">Scheduled times from the published timetable</p>
        </div>
      </header>
      <div className="stop-lines" aria-label="Lines">
        {lines.map((l) => (
          <span key={l.route.id} className="route-badge" style={{ ["--route" as string]: lineColor(l.route) }}>
            {l.route.mode === "trolley" ? `${l.route.short} Line` : l.route.short || routeLabel(l.route)}
          </span>
        ))}
      </div>
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
                <span className={`stop-arrival-in ${min <= 2 ? "late" : ""}`}>{min <= 0 ? "due" : `in ${min} min`}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
