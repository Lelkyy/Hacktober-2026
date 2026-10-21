import { formatFare, type Leg, type Route, type ScooterTrip, type TransitStop, type TripFare } from "@campus/core";
import { BikeIcon, BusIcon, ScooterIcon, TrolleyIcon, WalkIcon } from "./Icons.tsx";

/** Door-to-door summary: total time, leave/arrive, and each walking, riding or shuttle leg. */
export function Itinerary({
  route,
  destination,
  showLeave,
  fare,
  upass,
  onUpass,
  scooter,
  onStopClick,
}: {
  route: Route;
  destination: string;
  showLeave?: boolean;
  /** Transit fare, when the route rides MTS/shuttles. */
  fare?: TripFare | null;
  upass?: boolean;
  onUpass?: (v: boolean) => void;
  /** A shared scooter trip: the scooter it rides. */
  scooter?: ScooterTrip | null;
  onStopClick?: (stop: TransitStop) => void;
}) {
  const showTimes = route.usesTransit || showLeave;
  const byBike = route.legs.some((l) => l.mode === "bike");
  const byScooter = route.legs.some((l) => l.mode === "bike" && l.vehicle === "scooter");
  const ridden = byScooter ? "scooter" : "bike";
  const push = route.legs.reduce((s, l) => s + (l.mode === "bike" ? l.pushMeters : 0), 0);
  return (
    <section className="itinerary" aria-label="Route">
      <div className="itin-head">
        <span className="itin-time">
          {Math.max(1, Math.ceil(route.minutes))}
          <small> min</small>
        </span>
        <span className="itin-meta">
          {showTimes ? `${formatTime(route.leaveAt)} → ${formatTime(route.arriveAt)}` : `Arrive ${formatTime(route.arriveAt)}`}
          <span className="muted">
            {formatDistance(route.meters)} {byScooter ? "by Spin scooter and on foot" : byBike ? "by bike" : "on foot"}
            {route.stairSegments > 0 && ` · ${route.stairSegments} stair${route.stairSegments > 1 ? "s" : ""}`}
          </span>
        </span>
      </div>
      {byBike && push > 20 && (
        <p className="muted small">
          Includes {formatDistance(push)} walking your {ridden} {byScooter ? "where scooters can't ride" : "on footpaths"}.
        </p>
      )}
      {byScooter && (
        <p className="muted small">
          Unlock and pay in the Spin app. Scooters ride on roads and bike paths, never sidewalks; at most 8 mph on shared paths, and
          walked on Library Walk, Warren Mall and Price Center Plaza. Park only at a Spin hub or bike rack.
        </p>
      )}
      {fare && (
        <div className="fare">
          <span>
            Fare <strong>{formatFare(fare.total)}</strong>
            {fare.coveredByPass && <span className="muted"> with your U-Pass ({formatFare(fare.withoutPass)} otherwise)</span>}
            {!fare.coveredByPass && fare.total > 0 && <span className="muted"> on {fare.paidOn.join(" + ")} · one fare covers 2 hours of transfers</span>}
            {fare.withoutPass === 0 && <span className="muted"> · campus shuttles are free</span>}
          </span>
          {fare.withoutPass > 0 && onUpass && (
            <label className="toggle small">
              <input type="checkbox" checked={!!upass} onChange={(e) => onUpass(e.target.checked)} />
              I have a UCSD U-Pass
            </label>
          )}
        </div>
      )}
      {route.legs.length > 1 && (
        <ol className="legs">
          {route.legs.map((leg, i) => (
            <LegRow key={i} leg={leg} next={route.legs[i + 1]} destination={destination} scooter={scooter} onStopClick={onStopClick} />
          ))}
        </ol>
      )}
    </section>
  );
}

function LegRow({
  leg,
  next,
  destination,
  scooter,
  onStopClick,
}: {
  leg: Leg;
  next?: Leg;
  destination: string;
  scooter?: ScooterTrip | null;
  onStopClick?: (stop: TransitStop) => void;
}) {
  if (leg.mode !== "bus") {
    const shared = leg.mode === "bike" && leg.parkAt !== undefined;
    const toScooter = next?.mode === "bike" && next.parkAt !== undefined;
    const battery = scooter?.scooter.battery !== undefined ? ` (${Math.round(scooter.scooter.battery * 100)}% charged)` : "";
    const to = next?.mode === "bus" ? next.from.name : toScooter ? `a Spin scooter${battery}` : shared ? leg.parkAt : destination;
    return (
      <li className={`leg ${leg.mode}${shared ? " scooter" : ""}`}>
        <span className="leg-icon">{shared ? <ScooterIcon /> : leg.mode === "bike" ? <BikeIcon /> : <WalkIcon />}</span>
        <span>
          {leg.mode === "bike" ? "Ride" : "Walk"} {Math.max(1, Math.ceil(leg.seconds / 60))} min
          <span className="muted"> to {to}</span>
          {shared && <span className="leg-detail">Park there and end the ride in the app</span>}
        </span>
      </li>
    );
  }
  const name = leg.route.mode === "trolley" ? `${leg.route.short} Line` : leg.route.short;
  return (
    <li className="leg bus" style={{ ["--route" as string]: leg.route.color }}>
      <span className="leg-icon">{leg.route.mode === "trolley" ? <TrolleyIcon /> : <BusIcon />}</span>
      <span>
        <span className="leg-coming">
          <span className="route-badge">{name}</span>
          <span className="leg-coming-time">{formatTime(leg.departs)}</span>
        </span>
        <span className="route-badge">{leg.route.mode === "trolley" ? `${leg.route.short} Line` : leg.route.short}</span>{" "}
        {leg.route.mode === "trolley" ? "Trolley" : leg.route.mode === "bus" ? "MTS bus" : leg.route.long}
        {leg.headsign && leg.headsign !== leg.route.long && <span className="muted"> toward {leg.headsign}</span>}
        <span className="leg-detail">
          {formatTime(leg.departs)} at{" "}
          {onStopClick ? (
            <button type="button" className="link stop-link-inline" onClick={() => onStopClick(leg.from)}>
              {leg.from.name}
            </button>
          ) : (
            leg.from.name
          )}{" "}
          · {leg.stopCount} stop{leg.stopCount > 1 ? "s" : ""} · off at {leg.to.name}, {formatTime(leg.arrives)}
        </span>
      </span>
    </li>
  );
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatDistance(meters: number): string {
  const feet = meters * 3.28084;
  return feet < 1000 ? `${Math.round(feet / 10) * 10} ft` : `${(meters / 1609.344).toFixed(2)} mi`;
}
