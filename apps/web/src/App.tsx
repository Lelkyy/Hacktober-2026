import {
  CampusSearch,
  campusMapPlaces,
  bearing,
  haversine,
  MODES,
  PROFILES,
  rideRuns,
  buildSteps,
  doorWalks,
  buildingAt,
  buildingCentre,
  type IndoorData,
  formatFare,
  routeLabel,
  transitOptions,
  tripFare,
  insideHints,
  endpointLabel,
  endpointPosition,
  planRoute,
  type ClassMeeting,
  type Endpoint,
  type LngLat,
  type ModeId,
  type Plan,
  type Route,
  type SharedBike,
  type LiveVehicle,
  type TransitStop,
  linesAtStops,
  stopsOnLinesThrough,
  shapesAtStops,
  spreadOverlappingLines,
  clusterSameNameStops,
  clusteredStop,
  sameNameCluster,
  approachBearings,
  sharedApproach,
  planScooterTrip,
  parkingSpots,
  scooterProfile,
  zoneLimits,
  type RideZone,
  type ScooterTrip,
  BikeDir,
} from "@campus/core";
import { importClasses, Location, type ChatCampus, type ChatView } from "@campus/chat";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { BuildingSearch } from "./BuildingSearch.tsx";
import { ChatBar, type ChatHandle } from "./ChatBar.tsx";
import { MyClasses } from "./MyClasses.tsx";
import { loadCampus, storage, type CampusData } from "./data.ts";
import { Itinerary, formatDistance, formatTime } from "./Itinerary.tsx";
import { PALETTE } from "./palette.ts";
import { MapLayersMenu } from "./MapLayersMenu.tsx";
import { SpinButton } from "./SpinButton.tsx";
import { fetchSpinVehicles, fetchSpinZones, SPIN_REFRESH_MS } from "./spin.ts";
import { LiveTransitButton, StopsButton } from "./LiveTransitButton.tsx";
import { fetchLiveVehicles, MTS_LIVE, LIVE_REFRESH_MS } from "./mts.ts";
import { MapView, type BaseMap, type CampusPlaces, type RouteLine } from "./MapView.tsx";
import { lineBadges, lineColor } from "./lineColor.ts";
import { StopPanel } from "./StopPanel.tsx";
import {
  BikeIcon,
  BusIcon,
  ChevronIcon,
  CloseIcon,
  FlagIcon,
  HomeIcon,
  StarIcon,
  LocateIcon,
  ScooterIcon,
  StepFreeIcon,
  SwapIcon,
  WalkIcon,
} from "./Icons.tsx";
import { InsideCard } from "./InsideCard.tsx";
import { DiningMenu } from "./DiningMenu.tsx";
import { FoodPanel } from "./FoodPanel.tsx";
import { findDining, hallPinName, nameKey, type DiningMenus } from "./diningMenu.ts";
import { NavigationView } from "./NavigationView.tsx";
import { TimingControl, type TimingState } from "./TimingControl.tsx";
import { TransitPanel } from "./TransitPanel.tsx";
import { PlaceNamer } from "./PlaceNamer.tsx";
import { ReportPanel, type RouteContext } from "./ReportPanel.tsx";
import { HOME_ID, useSavedPlaces } from "./useSavedPlaces.ts";

/** Suggest transit while walking only when it saves at least this much time. */
const SUGGEST_MIN_FASTER = 3;
/** Inside a building, or this close to its walls (GPS wanders by buildings), you're in it. */
const PIN_TO_BUILDING_M = 10;
type PointEndpoint = Extract<Endpoint, { kind: "point" }>;
const BIKE_COLOR = PALETTE.sageDeep;
const MODE_ICONS: Record<ModeId, () => JSX.Element> = { walk: WalkIcon, accessible: StepFreeIcon, bike: BikeIcon, scooter: ScooterIcon, bus: BusIcon };
/** Spin's orange, for scooter rides on the map. */
const SPIN_COLOR = "#FF5A1F";

type Tab = "go" | "food" | "report";

export function App() {
  const [data, setData] = useState<CampusData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("go");
  /** Hall expanded on the Food view, including one opened from a map pin. */
  const [foodHall, setFoodHall] = useState<string | null>(null);
  const saved = useSavedPlaces();
  // The old Schedule tab's classes become the chat's, once: your lectures live in the chat now.
  useEffect(() => {
    if (storage.get("campus-nav:schedule-moved-to-chat", false)) return;
    importClasses(storage.get<ClassMeeting[]>("campus-nav:schedule:v2", []));
    storage.set("campus-nav:schedule-moved-to-chat", true);
  }, []);
  /** Camera moves ("Show it on the map"). */
  const [focus, setFocus] = useState<{ at: LngLat; zoom: number; key: number } | null>(null);
  /** The "Save place" form under a route is open. */
  const [naming, setNaming] = useState(false);
  /** The Advanced section (manual trip planning, map layers) is open. */
  const [advanced, setAdvanced] = useState<boolean>(() => storage.get("campus-nav:advanced", false));
  useEffect(() => storage.set("campus-nav:advanced", advanced), [advanced]);
  /** Saving your home: which field asked (it gets Home once you tap the map). */
  const [settingHome, setSettingHome] = useState<"from" | "to" | null>(null);
  /** Rooms mapped indoors (CSE, Cala), for floors and room spots. */
  const indoor = useMemo<IndoorData>(() => data?.indoor ?? {}, [data]);
  /** Live turn-by-turn navigation, and your position while it's running. */
  const [navigating, setNavigating] = useState(false);
  /** Navigating a scooter trip, and you've reached the scooter: re-plans ride it from where you are. */
  const [onScooter, setOnScooter] = useState(false);
  const [userPos, setUserPos] = useState<LngLat | null>(null);

  const [from, setFromRaw] = useState<Endpoint | null>(null);
  const [to, setToRaw] = useState<Endpoint | null>(null);
  /** Leave now, depart at a time, or arrive by a time (e.g. a class start). */
  const [timing, setTiming] = useState<TimingState>({ kind: "now" });
  const arriveBy = timing.kind === "arrive" ? { at: timing.at, label: timing.label } : null;
  const departAt = timing.kind === "depart" ? timing.at : undefined;
  const setArriveBy = (a: { at: Date; label?: string } | null) => setTiming(a ? { kind: "arrive", ...a } : { kind: "now" });
  /** Transit choices: step-free, and which option is selected. */
  const [transitStepFree, setTransitStepFree] = useState<boolean>(() => storage.get("campus-nav:transit-stepfree", false));
  const [selectedOption, setSelectedOption] = useState(0);
  const [clickTarget, setClickTarget] = useState<"from" | "to">("from");
  /** UC San Diego students ride MTS free with the U-Pass; assume a student unless told otherwise. */
  const [upass, setUpass] = useState<boolean>(() => storage.get("campus-nav:upass", true));
  const [mode, setMode] = useState<ModeId>(() => {
    const saved = storage.get<string>("campus-nav:mode", "walk");
    return saved in MODES ? (saved as ModeId) : "walk";
  });
  const [myLocation, setMyLocationRaw] = useState<LngLat | null>(null);
  /** Spin e-bikes and scooters: shown while the Spin button is on, refreshed as often as the feed changes. */
  const [spinOn, setSpinOn] = useState(false);
  const [spinBikes, setSpinBikes] = useState<SharedBike[] | null>(null);
  const [spinLoading, setSpinLoading] = useState(false);
  /** Live trolleys and buses: shown while their buttons are on, refreshed every ~20 s (one request for both). */
  const [liveModes, setLiveModes] = useState<{ trolley: boolean; bus: boolean }>({ trolley: false, bus: false });
  const [live, setLive] = useState<{ vehicles: LiveVehicle[]; at: number } | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const liveOn = liveModes.trolley || liveModes.bus;
  const toggleLive = (mode: "trolley" | "bus") =>
    MTS_LIVE
      ? setLiveModes((m) => ({ ...m, [mode]: !m[mode] }))
      : setHint("Live trolleys and buses need an MTS real-time API key: request one at sdmts.com, then set VITE_MTS_KEY in apps/web/.env.local.");
  const [openStop, setOpenStop] = useState<TransitStop | null>(null);
  /** One line at the open stop, when a route chip in the panel is selected. */
  const [openRouteId, setOpenRouteId] = useState<string | null>(null);
  const [showTransitStops, setShowTransitStops] = useState(false);
  // Small GPS jitter would re-plan everything that starts from your location; move the dot every ~10 m.
  const setMyLocation = useCallback(
    (p: LngLat) => setMyLocationRaw((cur) => (cur && haversine(cur[0], cur[1], p[0], p[1]) < 10 ? cur : p)),
    [],
  );
  /** Which way you face (compass) or move (GPS), for the cone on your dot. */
  const [compassHeading, setCompassHeading] = useState<number | null>(null);
  const [gpsHeading, setGpsHeading] = useState<number | null>(null);
  useEffect(() => {
    const onTurn = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      // iOS reports the compass heading directly; elsewhere an absolute alpha counts anticlockwise.
      const h = e.webkitCompassHeading ?? (e.absolute && e.alpha !== null ? 360 - e.alpha : null);
      if (h === null || h === undefined || Number.isNaN(h)) return;
      setCompassHeading((cur) => (cur !== null && Math.abs(((h - cur + 540) % 360) - 180) < 4 ? cur : h));
    };
    const absolute = "ondeviceorientationabsolute" in window;
    const type = absolute ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(type, onTurn as EventListener);
    return () => window.removeEventListener(type, onTurn as EventListener);
  }, []);

  // Where you are, on the map whenever the browser already allows it (never asks by itself:
  // the locate buttons do that). Follows you, and starts as soon as permission is given.
  useEffect(() => {
    if (!navigator.geolocation || !navigator.permissions) return;
    let watch: number | null = null;
    let status: PermissionStatus | null = null;
    const follow = (on: boolean) => {
      if (on && watch === null) {
        watch = navigator.geolocation.watchPosition(
          (pos) => {
            setMyLocation([pos.coords.longitude, pos.coords.latitude]);
            // The direction you're moving, while you're moving.
            const h = pos.coords.heading;
            setGpsHeading(h !== null && !Number.isNaN(h) && (pos.coords.speed ?? 0) > 0.5 ? h : null);
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 15_000 },
        );
      } else if (!on && watch !== null) {
        navigator.geolocation.clearWatch(watch);
        watch = null;
      }
    };
    navigator.permissions
      .query({ name: "geolocation" })
      .then((s) => {
        status = s;
        follow(s.state === "granted");
        s.onchange = () => follow(s.state === "granted");
      })
      .catch(() => {});
    return () => {
      follow(false);
      if (status) status.onchange = null;
    };
  }, [setMyLocation]);
  const [locating, setLocating] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  /** Phones: the panel is a bottom sheet that can be pulled up. */
  const [sheetOpen, setSheetOpen] = useState(false);
  // Campus or illustrated (anything saved from before those were the only two is campus).
  const [baseMap, setBaseMap] = useState<BaseMap>(() => (storage.get<string>("campus-nav:base-map", "campus") === "illustrated" ? "illustrated" : "campus"));
  useEffect(() => storage.set("campus-nav:base-map", baseMap), [baseMap]);
  const [placeCategories, setPlaceCategories] = useState<string[]>(() => storage.get<string[]>("campus-nav:place-categories", ["food"]));
  useEffect(() => storage.set("campus-nav:place-categories", placeCategories), [placeCategories]);
  // UCSD's places (restrooms, food, water...), fetched when first shown.
  const [campusPlaces, setCampusPlaces] = useState<CampusPlaces | null>(null);
  useEffect(() => {
    fetch("/data/campus-places.json")
      .then((r) => (r.ok ? (r.json() as Promise<CampusPlaces>) : null))
      .then(setCampusPlaces)
      .catch(() => setCampusPlaces(null));
  }, []);
  const [menus, setMenus] = useState<DiningMenus | null>(null);
  useEffect(() => {
    fetch("/data/menus.json")
      .then((r) => (r.ok ? (r.json() as Promise<DiningMenus>) : null))
      .then(setMenus)
      .catch(() => setMenus(null));
  }, []);

  /** Report tab: the spot tapped on the map, and the route the report is about (if any). */
  const [reportPin, setReportPin] = useState<LngLat | null>(null);
  const [reportRoute, setReportRoute] = useState<RouteContext | null>(null);

  // Picking a new start or destination by hand means "leave now" again.
  const setFrom = (e: Endpoint | null) => {
    setFromRaw(e);
    setArriveBy(null);
  };
  const setTo = (e: Endpoint | null) => {
    setToRaw(e);
    setArriveBy(null);
  };

  const reload = useCallback(async (bust: boolean) => {
    try {
      const d = await loadCampus(bust);
      setData(d);
      // Building objects are replaced on reload; keep endpoints pointing at fresh ones.
      const refresh = (e: Endpoint | null): Endpoint | null =>
        e?.kind === "building" ? { ...e, building: d.buildingById.get(e.building.id) ?? e.building } : e;
      setFromRaw(refresh);
      setToRaw(refresh);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    reload(false);
  }, [reload]);

  useEffect(() => storage.set("campus-nav:mode", mode), [mode]);
  useEffect(() => storage.set("campus-nav:upass", upass), [upass]);

  useEffect(() => storage.set("campus-nav:transit-stepfree", transitStepFree), [transitStepFree]);

  const planFor = useCallback(
    (m: ModeId, a: Endpoint, b: Endpoint, when: Date | undefined, leaveAt?: Date): Plan | null =>
      data
        ? planRoute(data.graph, a, b, {
            profile: MODES[m].profile,
            transit: MODES[m].transit ? data.transit : null,
            walkWeight: MODES[m].walkWeight,
            arriveBy: when,
            departAt: leaveAt,
          })
        : null,
    [data],
  );

  /** Google-Maps-style transit choices for a trip (walking included when it's competitive). */
  const transitFor = useCallback(
    (a: Endpoint, b: Endpoint, t: { arriveBy?: Date; departAt?: Date }) =>
      data
        ? transitOptions(data.graph, a, b, { transit: data.transit, timing: t, stepFree: transitStepFree })
        : null,
    [data, transitStepFree],
  );
  const transitResult = useMemo(
    () => (from && to ? transitFor(from, to, { arriveBy: arriveBy?.at, departAt }) : null),
    [transitFor, from, to, arriveBy?.at, departAt],
  );
  // A new trip, time or setting starts from the top option.
  useEffect(() => setSelectedOption(0), [transitResult]);
  const transitOpts = transitResult?.options ?? [];
  const bestTransit = transitOpts.find((o) => !o.walkOnly) ?? null;
  const busUnavailable = transitResult && !bestTransit ? "No shuttle, bus or trolley route found for this trip." : null;
  const transitPlan: Plan | null = transitOpts[selectedOption]
    ? {
        ok: true,
        route: transitOpts[selectedOption].route,
        connectors: [...transitResult!.connectors, ...doorWalks(from!, to!, transitOpts[selectedOption].route)],
      }
    : transitResult?.error
      ? { ok: false, error: transitResult.error }
      : null;

  const walkPlan = useMemo(
    () => (from && to ? planFor("walk", from, to, arriveBy?.at, departAt) : null),
    [planFor, from, to, arriveBy?.at, departAt],
  );
  // "No stairs" is only offered when a step-free route exists.
  const stepFreePlan = useMemo(
    () => (from && to ? planFor("accessible", from, to, arriveBy?.at, departAt) : null),
    [planFor, from, to, arriveBy?.at, departAt],
  );
  const noStairsUnavailable = stepFreePlan && !stepFreePlan.ok ? "Every route there has stairs." : null;
  const bikePlan = useMemo(
    () => (from && to ? planFor("bike", from, to, arriveBy?.at, departAt) : null),
    [planFor, from, to, arriveBy?.at, departAt],
  );

  // Spin's fleet: while the Spin button is on, and while a trip is planned (for the scooter option).
  const spinWanted = spinOn || (!!from && !!to);
  useEffect(() => {
    if (!spinWanted) {
      setSpinBikes(null);
      return;
    }
    let stopped = false;
    let first = true;
    let busy = false;
    let lastLoad = 0;
    const load = () => {
      // Hidden tab, a request still out, or fresh enough already: skip.
      if (document.visibilityState === "hidden" || busy || Date.now() - lastLoad < SPIN_REFRESH_MS - 500) return;
      busy = true;
      lastLoad = Date.now();
      setSpinLoading(true);
      fetchSpinVehicles()
        .then((bikes) => {
          if (stopped) return;
          setSpinBikes(bikes);
          if (first && !bikes.length && spinOn) setHint("No Spin e-bikes or scooters are free to ride right now.");
          first = false;
        })
        .catch(() => !stopped && first && spinOn && setHint("Couldn't load Spin vehicles. Try again in a moment."))
        .finally(() => {
          busy = false;
          if (!stopped) setSpinLoading(false);
        });
    };
    load();
    const timer = setInterval(load, SPIN_REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [spinWanted, spinOn]);
  // Spin's zones (no riding, no parking, speed limits): loaded once, when first wanted.
  const [spinZones, setSpinZones] = useState<RideZone[] | null>(null);
  useEffect(() => {
    if (!spinWanted || spinZones) return;
    fetchSpinZones()
      .then(setSpinZones)
      .catch(() => setSpinZones([]));
  }, [spinWanted, spinZones]);
  const zoneSpeeds = useMemo(() => (data && spinZones ? zoneLimits(data.graph, spinZones) : undefined), [data, spinZones]);
  const parking = useMemo(() => (campusPlaces ? parkingSpots(campusPlaces.points) : []), [campusPlaces]);
  /** The scooter trip: walk to a free Spin scooter, ride, park at a hub or rack, walk on. */
  const scooterResult = useMemo(
    () =>
      data && from && to && spinBikes && spinZones && !arriveBy
        ? planScooterTrip(data.graph, from, to, { scooters: spinBikes, parking, zones: spinZones, limits: zoneSpeeds, departAt, riding: onScooter })
        : null,
    [data, from, to, spinBikes, spinZones, zoneSpeeds, parking, departAt, arriveBy, onScooter],
  );
  const scooterTrip: ScooterTrip | null = scooterResult?.ok ? scooterResult.trip : null;
  // Once you're at the scooter (within GPS reach), you're riding it.
  useEffect(() => {
    if (!navigating) return setOnScooter(false);
    const at = scooterTrip?.scooter.lngLat;
    if (mode === "scooter" && at && userPos && !onScooter && haversine(at[0], at[1], userPos[0], userPos[1]) < 25) setOnScooter(true);
  }, [navigating, mode, scooterTrip, userPos, onScooter]);
  // UCSD's no-scooter walks, from the map data.
  const noScooterWalks = useMemo(() => {
    if (!data) return [];
    const g = data.graph;
    const lines: LngLat[][] = [];
    for (let e = 0; e < g.edgeCount; e++) if (g.edgeBikeDir[e] & BikeDir.NoScooter) lines.push([g.coord(g.edgeFrom[e]), g.coord(g.edgeTo[e])]);
    return lines;
  }, [data]);
  /** The rules on the map while scooters are chosen, or the Spin layer is on. */
  const scooterRules = useMemo(
    () => ((mode === "scooter" && from && to) || spinOn ? { zones: spinZones ?? [], noScooter: noScooterWalks, parking } : null),
    [mode, from, to, spinOn, spinZones, noScooterWalks, parking],
  );
  const scooterPlan: Plan | null = scooterResult
    ? scooterResult.ok
      ? { ok: true, route: scooterResult.trip.route, connectors: scooterResult.trip.connectors }
      : scooterResult
    : null;
  const scooterUnavailable = arriveBy ? "Scooters are planned for leaving now, not arriving by a time." : scooterResult && !scooterResult.ok ? scooterResult.error : null;

  /** Each mode's option for this trip: its plan, or why it isn't offered. */
  const options: Record<ModeId, { plan: Plan | null; unavailable: string | null }> = {
    walk: { plan: walkPlan, unavailable: null },
    accessible: { plan: stepFreePlan, unavailable: noStairsUnavailable },
    bike: { plan: bikePlan, unavailable: null },
    scooter: { plan: scooterPlan, unavailable: scooterUnavailable },
    bus: { plan: bestTransit ? { ok: true, route: bestTransit.route, connectors: [] } : null, unavailable: busUnavailable },
  };

  const plan = useMemo(() => {
    if (!from || !to) return null;
    // Transit with no transit route at all: show the walk instead (and say why).
    if (mode === "bus") return busUnavailable ? walkPlan : transitPlan;
    // Likewise "No stairs" with no step-free route: show the walk, with a note.
    if (mode === "accessible") return noStairsUnavailable ? walkPlan : stepFreePlan;
    if (mode === "walk") return walkPlan;
    // No scooter trip (none free nearby, no parking...): the walk, with the reason.
    if (mode === "scooter") return scooterUnavailable ? walkPlan : scooterPlan;
    return bikePlan;
  }, [from, to, mode, busUnavailable, walkPlan, transitPlan, noStairsUnavailable, stepFreePlan, bikePlan, scooterUnavailable, scooterPlan]);
  const route = plan?.ok ? plan.route : null;
  const routeLiveShorts = useMemo(() => {
    const shorts = new Set<string>();
    for (const l of route?.legs ?? []) {
      if (l.mode === "bus" && l.route.feed === "mts" && l.route.short) shorts.add(l.route.short);
    }
    return [...shorts];
  }, [route]);
  const fetchLive = liveOn || (MTS_LIVE && routeLiveShorts.length > 0);
  const shownLive = useMemo(() => {
    if (!live) return null;
    const vehicles = live.vehicles
      .filter((v) => liveModes[v.mode] || routeLiveShorts.includes(v.route))
      .map((v) => ({ ...v, color: lineColor({ short: v.route, color: v.color, mode: v.mode }) }));
    return { at: live.at, vehicles };
  }, [live, liveModes, routeLiveShorts]);
  const openStopIds = useMemo(() => {
    if (!data || !openStop) return [];
    const members = sameNameCluster(data.transit.data.stops, openStop);
    return (members.length ? members : [openStop]).map((s) => s.id);
  }, [data, openStop]);
  const routeStopIds = useMemo(() => {
    if (!data || !openStop) return new Set<string>();
    return new Set(stopsOnLinesThrough(data.transit, openStopIds.length ? openStopIds : [openStop.id]));
  }, [data, openStop, openStopIds]);
  const logoStops = useMemo(() => {
    if (!data) return [];
    return clusterSameNameStops(data.transit.data.stops)
      .filter((members) => members.length > 0)
      .flatMap((members) => {
        const ids = members.map((s) => s.id);
        const routes = linesAtStops(data.transit, ids).map((x) => x.route);
        if (!routes.length) return [];
        const approach = sharedApproach(ids.flatMap((id) => approachBearings(data.transit, id)));
        return [
          {
            stop: clusteredStop(members),
            ids,
            lines: lineBadges(routes),
            onRoute: ids.some((id) => routeStopIds.has(id)),
            ...(approach !== null ? { approach } : {}),
          },
        ];
      });
  }, [data, routeStopIds]);
  const stopRoutes = useMemo(() => {
    if (!data || !openStop) return [];
    const raw = shapesAtStops(data.transit, openStopIds.length ? openStopIds : [openStop.id]).filter(
      (s) => !openRouteId || s.route.id === openRouteId,
    );
    const spread = spreadOverlappingLines(raw.map((s) => s.shape));
    return raw.map((s, i) => ({ coordinates: spread[i], color: lineColor(s.route) }));
  }, [data, openStop, openStopIds, openRouteId]);
  useEffect(() => setOpenStop(null), [route]);
  useEffect(() => setOpenRouteId(null), [openStop?.id]);

  // Walking: point out transit when it's clearly faster.
  const busSuggestion = useMemo(() => {
    if ((mode !== "walk" && mode !== "accessible") || !bestTransit || !route) return null;
    const saved = arriveBy
      ? (bestTransit.route.leaveAt.getTime() - route.leaveAt.getTime()) / 60_000
      : (route.arriveAt.getTime() - bestTransit.route.arriveAt.getTime()) / 60_000;
    return saved >= SUGGEST_MIN_FASTER ? { route: bestTransit.route, savedMin: Math.round(saved) } : null;
  }, [mode, bestTransit, route, arriveBy]);


  useEffect(() => {
    if (!fetchLive) {
      setLive(null);
      return;
    }
    let stopped = false;
    let first = true;
    // The last answer, by vehicle: headings come from how each one moved since.
    let before = new Map<string, LiveVehicle>();
    // One request at a time, and none sooner than the refresh interval after the last.
    let busy = false;
    let lastLoad = 0;
    const load = () => {
      // Nothing to show in a hidden tab: don't download.
      if (document.visibilityState === "hidden" || busy || Date.now() - lastLoad < LIVE_REFRESH_MS - 500) return;
      busy = true;
      lastLoad = Date.now();
      setLiveLoading(true);
      fetchLiveVehicles(before)
        .then((t) => {
          if (stopped) return;
          before = new Map(t.vehicles.map((v) => [v.id, v]));
          setLive(t);
          if (first && !t.vehicles.length) setHint("No trolleys or buses are running right now.");
          first = false;
        })
        .catch(() => !stopped && first && setHint("Couldn't load live trolleys and buses from MTS. Try again in a moment."))
        .finally(() => {
          busy = false;
          if (!stopped) setLiveLoading(false);
        });
    };
    load();
    const timer = setInterval(load, LIVE_REFRESH_MS);
    // Browsers slow timers in a background tab: catch up as soon as it's back in view.
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchLive]);

  /** "My location" as a trip start: pinned to the building you're in (or right beside), when you are. */
  const meAt = useCallback(
    (p: LngLat): PointEndpoint => {
      const building = data ? buildingAt(data.buildings, p, PIN_TO_BUILDING_M) : null;
      return building
        ? { kind: "point", lngLat: buildingCentre(building), label: "My location", building }
        : { kind: "point", lngLat: p, label: "My location" };
    },
    [data],
  );
  /** Where your dot goes: in the middle of the building you're in, else where the GPS says. */
  const here = useMemo(() => (myLocation ? meAt(myLocation).lngLat : null), [myLocation, meAt]);


  // Saved places, student names and stops, then food, courts and pools from the campus map and dining lists.
  const allPlaces = useMemo(
    () => [...saved.places, ...(data?.places.places ?? []), ...campusMapPlaces(campusPlaces)],
    [saved.places, data, campusPlaces],
  );
  const placeById = useMemo(() => new Map(allPlaces.map((p) => [p.id, p])), [allPlaces]);
  const campusSearch = useMemo(
    () => (data ? new CampusSearch({ buildings: data.buildings, places: allPlaces, courses: data.sections?.courses, indoor }) : null),
    [data, allPlaces, indoor],
  );
  // The chat bar: the campus as the chat sees it, your location, and what it does to the map.
  const campusPlacesRef = useRef(campusPlaces);
  campusPlacesRef.current = campusPlaces;
  const liveRef = useRef(live);
  liveRef.current = live;
  const chatCampus = useMemo<ChatCampus | null>(
    () =>
      data && campusSearch
        ? {
            graph: data.graph,
            transit: data.transit,
            search: campusSearch,
            sections: data.sections,
            buildingByCode: data.buildingByCode,
            indoor: data.indoor,
            // Fetched separately (and maybe later): read when asked.
            get mapPoints() {
              return campusPlacesRef.current;
            },
          }
        : null,
    // Once per load: a new search object (saved places) needn't restart the conversation.
    [data],
  );
  const chat = useRef<ChatHandle>(null);
  const chatLocation = useMemo(() => (data ? new Location(data.graph.data.bbox, setMyLocation) : null), [data, setMyLocation]);
  const chatView: ChatView = {
    trip: (trip) => {
      if (!trip) return;
      setNavigating(false);
      setOpenStop(null);
      setTab("go");
      setSelectedOption(0);
      setMode(trip.mode);
      setFromRaw(trip.from);
      setToRaw(trip.to);
      setTiming(trip.arriveBy ? { kind: "arrive", at: trip.arriveBy, label: trip.name } : { kind: "now" });
    },
    markers: (_points, category) => setPlaceCategories((on) => (on.includes(category) ? on : [...on, category])),
    stop: (ids, at) => {
      const stop = data?.transit.data.stops.find((s) => s.id === ids[0]);
      if (!stop) return;
      setOpenStop(stop);
      setSheetOpen(true);
      setFocus({ at, zoom: 17.2, key: Date.now() });
    },
  };

  const steps = useMemo(
    () => (data && route && to ? buildSteps(data.graph, route, endpointLabel(to), { leaving: from?.kind === "point" ? from.building : undefined }) : []),
    [data, route, to, from],
  );
  const destBuilding = to?.kind === "building" ? to.building : null;
  const dining = useMemo(() => {
    if (!menus || !to) return null;
    const names =
      to.kind === "place" ? [to.place.name, ...to.place.aliases] : to.kind === "building" ? [to.building.name, ...to.building.aliases] : to.kind === "point" ? [to.label] : [];
    for (const name of names) {
      const hit = findDining(menus, name);
      if (hit) return hit;
    }
    return null;
  }, [menus, to]);
  // A dining hall's menu and prices need room: open the panel when one appears (from the chat as well as a pin).
  const diningHall = dining?.hall.name;
  useEffect(() => {
    if (diningHall) setSheetOpen(true);
  }, [diningHall]);
  const inside = useMemo(
    () =>
      data && destBuilding && route
        ? insideHints(destBuilding, to?.kind === "building" ? to.room : undefined, indoor[destBuilding.id], route)
        : null,
    [data, destBuilding, to, route, indoor],
  );

  const tips = useMemo(() => {
    if (!data || !destBuilding) return [];
    const codes = destBuilding.aliases.filter((a) => /^[A-Z0-9-]{2,6}$/.test(a));
    const room = to?.kind === "building" ? to.room : undefined;
    return codes.flatMap((c) => [data.places.tips[c], room ? data.places.tips[`${c} ${room}`] : undefined]).filter((t): t is string => !!t);
  }, [data, destBuilding, to]);
  const insideCard =
    destBuilding && inside ? (
      <InsideCard
        buildingName={destBuilding.name}
        hints={inside}
        stepFree={mode === "accessible"}
        tips={tips}
        onShowRoom={inside.roomAt ? () => setFocus({ at: inside.roomAt!, zoom: 19.4, key: Date.now() }) : undefined}
      />
    ) : null;

  const routeLines: RouteLine[] | null =
    route && data
      ? route.legs.flatMap((l): RouteLine[] =>
          l.mode === "bike"
            ? // On roads the ride is drawn on the right-hand side, where you ride.
              rideRuns(data.graph, l.vehicle === "scooter" ? scooterProfile(zoneSpeeds) : PROFILES.bike, l).map((r) => ({
                coordinates: r.coordinates,
                kind: "bike",
                color: l.vehicle === "scooter" ? SPIN_COLOR : BIKE_COLOR,
                keepRight: r.keepRight,
              }))
            : [{ coordinates: l.coordinates, kind: l.mode, color: l.mode === "bus" ? l.route.color : "" }],
        )
      : null;

  const locate = () => {
    if (!navigator.geolocation) return setHint("Location isn't available in this browser.");
    // iOS asks separately for the compass, and only from a tap.
    const orientation = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    orientation?.requestPermission?.().catch(() => {});
    const startHere = (p: LngLat) => {
      setFrom(meAt(p));
      setClickTarget("to");
      setHint(null);
    };
    // Where we already know you are (the app follows you when allowed): use it right away.
    if (myLocation) startHere(myLocation);
    else setLocating(true);
    const got = (pos: GeolocationPosition) => {
      const p: LngLat = [pos.coords.longitude, pos.coords.latitude];
      setMyLocation(p);
      if (!myLocation) startHere(p);
      setLocating(false);
    };
    const failed = (err: GeolocationPositionError) => {
      setLocating(false);
      if (!myLocation) setHint(`Couldn't get your location: ${err.message}`);
    };
    // A precise fix, or (laptops are often slow or unable to give one) any recent one.
    navigator.geolocation.getCurrentPosition(
      got,
      (err) =>
        err.code === err.PERMISSION_DENIED
          ? failed(err)
          : navigator.geolocation.getCurrentPosition(got, failed, { enableHighAccuracy: false, maximumAge: 120_000, timeout: 15_000 }),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 8_000 },
    );
  };


  /** The trip starts from where you are: the start follows you, and shows as your dot. */
  const fromIsMe = from?.kind === "point" && from.label === "My location";
  useEffect(() => {
    if (!fromIsMe || navigating || !myLocation || from?.kind !== "point") return;
    const me = meAt(myLocation);
    if (from.lngLat[0] !== me.lngLat[0] || from.lngLat[1] !== me.lngLat[1] || from.building !== me.building) setFromRaw(me);
  }, [myLocation, fromIsMe, navigating, meAt]);
  // The cone: your compass, else the way you're moving, else the way the route sets off.
  const routeBearing = useMemo(() => {
    const c = fromIsMe ? route?.coordinates : undefined;
    if (!c || c.length < 2) return null;
    const far = c.find((p) => haversine(c[0][0], c[0][1], p[0], p[1]) > 15) ?? c[c.length - 1];
    return bearing(c[0], far);
  }, [route, fromIsMe]);
  const heading = compassHeading ?? gpsHeading ?? routeBearing;

  /** Whether a destination is where your saved home is. */
  const isHome = (e: Endpoint) => {
    if (e.kind === "place" && e.place.id === HOME_ID) return true;
    const h = saved.home?.points[0];
    const p = endpointPosition(e);
    return !!h && h[0] === p[0] && h[1] === p[1];
  };
  useEffect(() => setNaming(false), [to]);

  /** Save your home and put it in the field that asked for it. */
  const saveHome = (points: LngLat[]) => {
    const home = saved.setHome(points);
    if (settingHome === "from") setFrom({ kind: "place", place: home });
    else if (settingHome === "to") setTo({ kind: "place", place: home });
    setSettingHome(null);
    setHint(null);
  };
  const startSettingHome = (field: "from" | "to") => {
    setTab("go");
    setSettingHome(field);
    setHint(null);
  };
  const homeFromLocation = () => {
    if (!navigator.geolocation) return setHint("Location isn't available in this browser.");
    navigator.geolocation.getCurrentPosition(
      (pos) => saveHome([[pos.coords.longitude, pos.coords.latitude]]),
      (err) => setHint(`Couldn't get your location: ${err.message}`),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const onMapClick = (p: LngLat) => {
    if (!data) return;
    if (tab === "report") return setReportPin(p);
    if (settingHome) return saveHome([p]);
    // A pin inside a building is reached, or left, by its doors.
    const inside = buildingAt(data.buildings, p, 0);
    const pin: Endpoint = { kind: "point", lngLat: p, label: "Dropped pin", ...(inside ? { building: inside } : {}) };
    if (clickTarget === "from") {
      setFrom(pin);
      setClickTarget("to");
    } else {
      setTo(pin);
    }
    setHint(null);
  };


  /** Directions to a dining hall from the Food tab. */
  const goToHall = (hallName: string) => {
    const pin = nameKey(hallPinName(hallName));
    const hallKey = nameKey(hallName);
    const place = allPlaces.find(
      (p) => nameKey(p.name) === pin || nameKey(p.name) === hallKey || p.aliases.some((a) => nameKey(a) === hallKey || nameKey(a) === pin),
    );
    if (place) {
      setTo({ kind: "place", place });
      setFocus({ at: place.points[0], zoom: 17.2, key: Date.now() });
    } else {
      const point = campusPlaces?.points.find((p) => nameKey(p[3]) === pin || nameKey(p[3]) === hallKey);
      if (!point) return setHint(`Couldn't find ${hallName} on the map.`);
      const at: LngLat = [point[0], point[1]];
      setTo({ kind: "point", lngLat: at, label: hallName });
      setFocus({ at, zoom: 17.2, key: Date.now() });
    }
    if (!from && myLocation) setFrom(meAt(myLocation));
    setTab("go");
    setSheetOpen(true);
    setHint(null);
  };

  /** Open the Report tab, optionally about the route on screen. */
  const openReport = (aboutRoute: boolean) => {
    setReportRoute(
      aboutRoute && route && from && to
        ? {
            from: endpointLabel(from),
            to: endpointLabel(to),
            mode: MODES[mode].label,
            summary: `${Math.ceil(route.minutes)} min, ${formatDistance(route.meters)}`,
          }
        : null,
    );
    if (aboutRoute && to) setReportPin(endpointPosition(to));
    setTab("report");
  };

  if (loadError) return <div className="fatal">Couldn't load campus data. {loadError}</div>;

  return (
    <div className="shell">
    <div
      className={`app ${navigating ? "navigating" : ""}`}
    >
      {data && (
        <MapView
          graph={data.graph}
          routeLines={routeLines}
          connectors={plan?.ok ? plan.connectors : []}
          stops={[]}
          showStops={false}
          from={from ? endpointPosition(from) : null}
          fromIsMe={fromIsMe}
          heading={heading}
          to={to ? endpointPosition(to) : null}
          baseMap={baseMap}
          places={campusPlaces}
          placeCategories={placeCategories}
          menus={menus}
          spinBikes={spinOn ? spinBikes : null}
          scooterRules={scooterRules}
          scooterTrip={mode === "scooter" && scooterTrip ? { scooter: scooterTrip.scooter.lngLat, parking: scooterTrip.parking } : null}
          live={shownLive}
          showTransitStops={showTransitStops}
          logoStops={logoStops}
          stopRoutes={stopRoutes}
          onStopClick={(s) => {
            if (openStop?.id === s.id) {
              setOpenRouteId(null);
              setOpenStop(null);
              return;
            }
            setOpenRouteId(null);
            setOpenStop(s);
            setTab("go");
            setSheetOpen(true);
            setFocus({ at: s.lngLat, zoom: 17.2, key: Date.now() });
          }}
          onClearOverlay={() => setOpenStop(null)}
          selectedStopId={openStop?.id ?? null}
          onPlaceDirections={(p) => {
            const hit = menus ? findDining(menus, p.name) : null;
            if (hit) {
              setFoodHall(hit.hall.name);
              setTab("food");
              setSheetOpen(true);
              setFocus({ at: p.lngLat, zoom: 17.2, key: Date.now() });
              setHint(null);
              return;
            }
            setTab("go");
            setTo({ kind: "point", lngLat: p.lngLat, label: p.name });
            setHint(null);
          }}
          reportPin={tab === "report" ? reportPin : null}
          pickingSpot={tab === "report"}
          focus={focus}
          userPos={navigating ? userPos : here}
          follow={navigating}
          doors={(destBuilding?.entrances ?? []).map((d) => ({ lngLat: d.lngLat, used: d === inside?.entrance }))}
          room={
            inside?.roomAt && to?.kind === "building" ? { lngLat: inside.roomAt, label: `${to.room} · ${inside.floor?.label ?? ""}` } : null
          }
          onMapClick={onMapClick}
          onLocate={setMyLocation}
        />
      )}

      <aside className={`sheet ${sheetOpen ? "open" : ""}`} aria-label="Directions">
        <button className="sheet-handle" aria-label={sheetOpen ? "Collapse panel" : "Expand panel"} onClick={() => setSheetOpen((v) => !v)}>
          <span />
          <ChevronIcon up={!sheetOpen} />
        </button>
        <header className="sheet-head">
          <h1 className="brand">
            <img src="/logo-mark.png" alt="" className="brand-mark" width="26" height="32" />
            Triton Trails
          </h1>
          {!navigating && (
            <button
              className={`food-tab ${tab === "food" ? "on" : ""}`}
              aria-pressed={tab === "food"}
              onClick={() => {
                setTab(tab === "food" ? "go" : "food");
                setSheetOpen(true);
              }}
            >
              Food
            </button>
          )}
        </header>

        <div className="sheet-body">
          {!data ? (
            <p className="muted">Loading campus paths…</p>
          ) : navigating && route && to ? (
            <NavigationView
              route={route}
              steps={steps}
              destination={endpointLabel(to)}
              arrival={insideCard}
              onPosition={setUserPos}
              onReroute={(p) => {
                setFromRaw({ kind: "point", lngLat: p, label: "My location" });
                setArriveBy(null);
              }}
              onEnd={() => {
                setNavigating(false);
                setUserPos(null);
              }}
            />
          ) : tab === "go" ? (
            <>
              {chatCampus && (
                <MyClasses campus={chatCampus} onGo={(course) => chat.current?.run(`Take me to ${course}`, (a) => a.goToCourse(course))} />
              )}
              {hint && <p className="note warn-note">{hint}</p>}
              {openStop && (
                <StopPanel
                  stop={openStop}
                  stopIds={openStopIds}
                  transit={data.transit}
                  routeId={openRouteId}
                  onRoute={setOpenRouteId}
                  onBack={() => {
                    setOpenRouteId(null);
                    setOpenStop(null);
                  }}
                />
              )}
              {/* The trip the chat (or Advanced) set up: how to get there, and Start. */}
              {from && to && !openStop && (
                <section className="trip-result" aria-label="Your trip">
                  <p className="trip-route">
                    <span className="muted">From</span> {endpointLabel(from)} <span className="muted">to</span> <strong>{endpointLabel(to)}</strong>
                  </p>
                  {arriveBy?.label && (
                    <p className="note">
                      Arriving by <strong>{formatTime(arriveBy.at)}</strong> for {arriveBy.label}.{" "}
                      <button className="link" onClick={() => setArriveBy(null)}>
                        Leave now instead
                      </button>
                    </p>
                  )}
                  <div className="modes" role="radiogroup" aria-label="How are you getting there?">
                    {(Object.keys(MODES) as ModeId[]).map((id) => {
                      const Icon = MODE_ICONS[id];
                      const option = options[id];
                      const eta = option.unavailable || !option.plan?.ok ? null : Math.max(1, Math.ceil(option.plan.route.minutes));
                      const fare =
                        id === "bus" && eta !== null && option.plan?.ok
                          ? tripFare(option.plan.route, data.transit.data.fares, { upass })
                          : null;
                      return (
                        <button
                          key={id}
                          role="radio"
                          aria-checked={mode === id}
                          className={mode === id ? "on" : ""}
                          disabled={!!option.unavailable}
                          title={option.unavailable ?? undefined}
                          onClick={() => setMode(id)}
                        >
                          <Icon />
                          <span className="mode-label">{MODES[id].label}</span>
                          {from && to && <span className="mode-eta">{eta === null ? "—" : `${eta} min`}</span>}
                          {fare && <span className="mode-fare">{formatFare(fare.total)}</span>}
                        </button>
                      );
                    })}
                  </div>
                  {mode === "bus" && busUnavailable && <p className="note warn-note">{busUnavailable} Showing the walk.</p>}
                  {mode === "bus" && !busUnavailable && transitOpts.length > 0 && data && (
                    <TransitPanel
                      options={transitOpts}
                      selected={selectedOption}
                      onSelect={setSelectedOption}
                      stepFree={transitStepFree}
                      onStepFree={setTransitStepFree}
                      transit={data.transit}
                      fares={data.transit.data.fares}
                      upass={upass}
                      arriving={!!arriveBy}
                    />
                  )}
                  {mode === "accessible" && noStairsUnavailable && (
                    <p className="note warn-note">There's no step-free route to this destination. Showing the route with stairs.</p>
                  )}
                  {mode === "scooter" && scooterUnavailable && (
                    <p className="note warn-note">{scooterUnavailable} Showing the walk.</p>
                  )}
                  {mode === "scooter" && !scooterUnavailable && !scooterResult && from && to && <p className="note">Finding a free Spin scooter…</p>}
                  {mode === "scooter" && scooterTrip && walkPlan?.ok && walkPlan.route.seconds <= scooterTrip.route.seconds && (
                    <p className="note">
                      Walking is quicker here ({Math.max(1, Math.ceil(walkPlan.route.minutes))} min).{" "}
                      <button className="link" onClick={() => setMode("walk")}>
                        Walk instead
                      </button>
                    </p>
                  )}
                  {plan && !plan.ok && !busSuggestion && <p className="note warn-note">{plan.error}</p>}
                  {busSuggestion && (
                    <div className="suggest">
                      <BusIcon />
                      <span>
                        {busSuggestion.savedMin === null
                          ? "Only reachable by transit from here."
                          : arriveBy
                            ? `Transit lets you leave ${busSuggestion.savedMin} min later`
                            : `Transit gets you there ${busSuggestion.savedMin} min sooner`}
                        <span className="muted"> · {busName(busSuggestion.route)}</span>
                      </span>
                      <button onClick={() => setMode("bus")}>Take it</button>
                    </div>
                  )}
                  {route && (
                    <>
                      <Itinerary
                        route={route}
                        destination={endpointLabel(to)}
                        showLeave={timing.kind !== "now"}
                        fare={tripFare(route, data.transit.data.fares, { upass })}
                        upass={upass}
                        onUpass={setUpass}
                        scooter={mode === "scooter" ? scooterTrip : null}
                        onStopClick={(s) => {
                          setOpenStop(s);
                          setSheetOpen(true);
                          setFocus({ at: s.lngLat, zoom: 17.2, key: Date.now() });
                        }}
                      />
                      {dining && menus && <DiningMenu menus={menus} match={dining} />}
                      <button
                        className="primary start"
                        onClick={() => {
                          setNavigating(true);
                          setSheetOpen(false);
                        }}
                      >
                        Start
                      </button>
                      {insideCard}
                    </>
                  )}
                </section>
              )}

              {/* Everything you'd do by hand: hidden until you want it. */}
              <details className="advanced" open={advanced} onToggle={(e) => setAdvanced(e.currentTarget.open)}>
                <summary>Advanced</summary>
                <div className="advanced-body">
                  <h3>Plan a trip by hand</h3>
                  <div className="trip">
                    <div className="trip-rail" aria-hidden>
                      <span className="dot start" />
                      <span className="line" />
                      <span className="dot end" />
                    </div>
                    <div className="trip-fields">
                      <BuildingSearch
                        label="From"
                        hideLabel
                        placeholder="Start: search or tap the map"
                        search={campusSearch!}
                        buildingById={data.buildingById}
                        placeById={placeById}
                        onMyLocation={locate}
                        home={saved.home}
                        onSetHome={() => startSettingHome("from")}
                        value={from}
                        active={clickTarget === "from"}
                        onFocus={() => {
                          setClickTarget("from");
                          // Phones: open the panel so the suggestions have room.
                          setSheetOpen(true);
                        }}
                        onSelect={(e) => {
                          setFrom(e);
                          if (e) setClickTarget("to");
                        }}
                      />
                      <BuildingSearch
                        label="To"
                        hideLabel
                        placeholder="Destination: WLH 2001, CSE 11, Geisel…"
                        search={campusSearch!}
                        buildingById={data.buildingById}
                        placeById={placeById}
                        home={saved.home}
                        onSetHome={() => startSettingHome("to")}
                        value={to}
                        active={clickTarget === "to"}
                        onFocus={() => {
                          setClickTarget("to");
                          // Phones: open the panel so the suggestions have room.
                          setSheetOpen(true);
                        }}
                        onSelect={setTo}
                      />
                    </div>
                    <div className="trip-actions">
                      <button
                        className="icon-btn"
                        onClick={locate}
                        disabled={locating}
                        aria-label="Start from my location"
                        title="Start from my location"
                      >
                        <LocateIcon />
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => {
                          setFromRaw(to);
                          setToRaw(from);
                        }}
                        disabled={!from && !to}
                        aria-label="Swap start and destination"
                        title="Swap"
                      >
                        <SwapIcon />
                      </button>
                    </div>
                  </div>
                  {!(from && to) && (
                    <div className="modes" role="radiogroup" aria-label="How are you getting there?">
                      {(Object.keys(MODES) as ModeId[]).map((id) => {
                        const Icon = MODE_ICONS[id];
                        const option = options[id];
                        const eta = option.unavailable || !option.plan?.ok ? null : Math.max(1, Math.ceil(option.plan.route.minutes));
                        const fare =
                          id === "bus" && eta !== null && option.plan?.ok
                            ? tripFare(option.plan.route, data.transit.data.fares, { upass })
                            : null;
                        return (
                          <button
                            key={id}
                            role="radio"
                            aria-checked={mode === id}
                            className={mode === id ? "on" : ""}
                            disabled={!!option.unavailable}
                            title={option.unavailable ?? undefined}
                            onClick={() => setMode(id)}
                          >
                            <Icon />
                            <span className="mode-label">{MODES[id].label}</span>
                            {from && to && <span className="mode-eta">{eta === null ? "—" : `${eta} min`}</span>}
                            {fare && <span className="mode-fare">{formatFare(fare.total)}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <TimingControl value={timing} onChange={setTiming} />
                  {settingHome && (
                    <div className="set-home" role="status" ref={(el) => el?.scrollIntoView({ block: "nearest" })}>
                      <span>
                        <strong>Set your home:</strong> tap it on the map.
                      </span>
                      <span className="form-row">
                        <button onClick={homeFromLocation}>Use my location</button>
                        <button className="link" onClick={() => setSettingHome(null)}>
                          Cancel
                        </button>
                      </span>
                    </div>
                  )}
                  {!to && (saved.places.length > 0 || !saved.home) && (
                    <div className="saved-places" aria-label="Your places">
                      {!saved.home && (
                        <span className="place-chip">
                          <button onClick={() => startSettingHome("to")}>
                            <HomeIcon /> Set home
                          </button>
                        </span>
                      )}
                      {saved.places.map((p) => (
                        <span key={p.id} className="place-chip">
                          <button onClick={() => setTo({ kind: "place", place: p })}>
                            {p.id === HOME_ID && <HomeIcon />} {p.name}
                          </button>
                          <button className="icon-btn" aria-label={`Forget ${p.name}`} onClick={() => saved.remove(p.id)}>
                            <CloseIcon />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {route && to && (
                    <>
                      <h3>This destination</h3>
                      <div className="route-actions">
                        <button onClick={() => setNaming((v) => !v)} aria-expanded={naming}>
                          <StarIcon /> Save place
                        </button>
                        <button
                          disabled={isHome(to)}
                          onClick={() => saved.setHome(to.kind === "place" ? to.place.points : [endpointPosition(to)])}
                        >
                          <HomeIcon /> {isHome(to) ? "Your home" : "Set as home"}
                        </button>
                        <button onClick={() => openReport(true)}>
                          <FlagIcon /> Report
                        </button>
                      </div>
                      {naming && (
                        <PlaceNamer
                          key={endpointLabel(to)}
                          at={endpointPosition(to)}
                          defaultName={to.kind === "point" ? "" : endpointLabel(to)}
                          onSave={(name, note) => saved.add(name, to.kind === "place" ? to.place.points : [endpointPosition(to)], note)}
                          onClose={() => setNaming(false)}
                        />
                      )}
                    </>
                  )}
                  <h3>On the map</h3>
                  <div className="map-toggles">
                    <MapLayersMenu
                      baseMap={baseMap}
                      onBaseMap={setBaseMap}
                      places={campusPlaces}
                      categories={placeCategories}
                      onCategories={setPlaceCategories}
                      nearYou={!!here}
                    />
                    <SpinButton on={spinOn} loading={spinLoading} onToggle={() => setSpinOn((v) => !v)} />
                    <StopsButton
                      on={showTransitStops}
                      onToggle={() =>
                        setShowTransitStops((v) => {
                          if (v) setOpenStop(null);
                          return !v;
                        })
                      }
                    />
                    <LiveTransitButton mode="trolley" on={liveModes.trolley} loading={liveLoading && liveModes.trolley} onToggle={() => toggleLive("trolley")} />
                    <LiveTransitButton mode="bus" on={liveModes.bus} loading={liveLoading && liveModes.bus} onToggle={() => toggleLive("bus")} />
                  </div>
                  <p className="credits">
                    © OpenStreetMap, UC San Diego Campus Map, Triton Transit and MTS schedules. Unofficial.{" "}
                    <button className="link" onClick={() => openReport(false)}>
                      Report a problem
                    </button>
                  </p>
                </div>
              </details>
            </>
          ) : tab === "food" ? (
            <FoodPanel menus={menus} selected={foodHall} onSelect={setFoodHall} onDirections={goToHall} />
          ) : (
            <>
              <button className="link back-link" onClick={() => setTab("go")}>
                ‹ Back to directions
              </button>
              <ReportPanel
                buildings={data.buildings}
                pin={reportPin}
                onClearPin={() => setReportPin(null)}
                route={reportRoute}
                dataDate={data.graph.data.generatedAt.slice(0, 10)}
              />
            </>
          )}
        </div>

      </aside>
    </div>
    {/* Hidden, not removed, while navigating: the conversation stays. */}
    <div className="chatbar-slot" hidden={navigating}>
      <ChatBar ref={chat} campus={chatCampus} location={chatLocation} vehicles={() => liveRef.current?.vehicles ?? []} view={chatView} />
    </div>
    </div>
  );
}

function busName(route: Route): string {
  const bus = route.legs.find((l) => l.mode === "bus");
  return bus?.mode === "bus" ? `${routeLabel(bus.route)} from ${bus.from.name}` : "";
}
