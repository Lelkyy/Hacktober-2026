import {
  haversine,
  alongPath,
  measurePath,
  pathFrom,
  pointAlong,
  type CampusGraph,
  type LiveVehicle,
  type LngLat,
  type MeasuredPath,
  type ParkingSpot,
  type RideZone,
  type SharedBike,
  type TransitStop,
  type TripAhead,
} from "@campus/core";
import { fetchTripAhead, getShape, LIVE_REFRESH_MS } from "./mts.ts";
import { ILLUSTRATED_TILES, registerIllustratedTiles } from "./illustratedTiles.ts";
import {
  GeolocateControl,
  LngLatBounds,
  Map as MlMap,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type LayerSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { PALETTE } from "./palette.ts";
import { formatDistance } from "./Itinerary.tsx";
// MapLibre 6 derives its worker URL at runtime, which bundlers can't see; have Vite bundle it.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef, useState } from "react";

const BASE_STYLE = "https://tiles.openfreemap.org/styles/liberty";
/** Esri's topographic map, which the official ArcGIS campus map is drawn on. */
const TOPO_TILES = "https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}";
/** UC San Diego's campus vector tiles, for its district names and campus boundary. */
const UCSD_VECTOR_TILES = "https://tiles.arcgis.com/tiles/mXNwDpiENQiMIzRv/arcgis/rest/services/CampusMapVectorApril2/VectorTileServer/tile/{z}/{y}/{x}.pbf";

/** The map underneath: the official campus map, or UCSD's illustrated one on top of it. */
export type BaseMap = "campus" | "illustrated";

/** Spin's brand orange. */
const SPIN_ORANGE = "#FF5A1F";

/** How many of each kind of place to show: the nearest. */
export const NEAREST_PLACES = 5;

/** Places from UCSD's campus map (apps/web/public/data/campus-places.json). */
export interface CampusPlaces {
  categories: { id: string; label: string; color: string }[];
  /** [lng, lat, category index, name, kind, building] */
  points: [number, number, number, string, string, string][];
}

/** A place tapped on the map. */
export interface PlacePick {
  lngLat: LngLat;
  name: string;
}
const CAMPUS_CENTER: LngLat = [-117.2376, 32.8801];
/** Room around the campus data's bounding box: enough to see the shore and ocean to the west. */
const CAMPUS_PADDING_DEG = 0.006;
/** Campus and the coast on a laptop screen. */
const MIN_ZOOM = 13.5;
const START_ZOOM = 15.6;

/** One drawn piece of a route: walking (dotted blue), riding (green) or a shuttle (its route color). */
export interface RouteLine {
  coordinates: LngLat[];
  kind: "walk" | "bike" | "bus";
  color: string;
  /** A ride along a road: drawn on the right-hand side of it, where cyclists ride. */
  keepRight?: boolean;
}

/** Moves longer than this (a vehicle starting another trip, a gap in the feed) aren't animated. */
const GLIDE_MAX_METERS = 800;
/** Fastest a trolley or bus is taken to go (m/s, ~67 mph): faster is a glitch in the reports. */
const MAX_SPEED = 30;
/** Over its last this-many meters before a stop, a vehicle slows into it. */
const STOP_EASE_METERS = 15;
/** Updates in a row a followed vehicle can be missing from before its popup and route close. */
const MISSING_UPDATES = 4;
/** How long a vehicle keeps moving on its last speed without a new report. */
const KEEP_GOING_MS = 25_000;
/** How long the difference between where a vehicle is drawn and its new report takes to ease out,
 *  and how long a change of speed takes: about the time to the next report. */
const EASE_MS = 10_000;
/** How much one report's speed counts toward a vehicle's speed (the rest is its speed so far). */
const SPEED_DAMPING = 1 / 3;

/** A live vehicle's marker, and how it's moving along its route between reports. */
interface Moving {
  marker: Marker;
  vehicle: LiveVehicle;
  /** Its trip's path, once fetched, and which path that is. */
  path: MeasuredPath | null;
  pathFor?: string;
  /** Distance along the route at the last report (m), when that came (performance.now()), and the
   *  speed it's changing to (m/s), from `speedFrom` at that report. */
  d: number;
  t: number;
  speed: number;
  speedFrom: number;
  /** How far along it was last drawn (it doesn't go back). */
  shown?: number;
  /** Where its next stop is along the route (m): it isn't drawn past it before a report says it's left. */
  stopAlong?: number;
  /** Where it was drawn minus where it was reported (m), being eased out since `offsetAt`. */
  offset: number;
  offsetAt: number;
  /** Straight-line glide, while its path isn't known. */
  glide: { from: LngLat; to: LngLat; start: number };
  /** Whether it's being drawn along its route (rather than gliding). */
  onPath?: boolean;
}

/** Smoothstep: 0 to 1 with no sudden start or stop. */
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** How fast a vehicle is going at `now`: its speed changing evenly from `speedFrom` to `speed` after a report. */
function speedNow(m: Moving, now: number): number {
  return m.speedFrom + (m.speed - m.speedFrom) * Math.min(1, (now - m.t) / EASE_MS);
}

/**
 * Where along its route a vehicle is drawn at `now`: its last report, moved on at its (gradually
 * changing) speed, plus the gap to where it was drawn, eased out smoothly.
 */
function alongNow(m: Moving, now: number): number {
  const tau = Math.min(now - m.t, KEEP_GOING_MS) / 1000;
  const ramp = EASE_MS / 1000;
  const [s0, s1] = [m.speedFrom, m.speed];
  const travelled = tau < ramp ? s0 * tau + ((s1 - s0) * tau * tau) / (2 * ramp) : s0 * ramp + ((s1 - s0) * ramp) / 2 + s1 * (tau - ramp);
  return m.d + travelled + m.offset * (1 - smooth((now - m.offsetAt) / EASE_MS));
}
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Shift for a ride on a road: about 3.5 m to the right of the centre line, at any zoom. */
const KEEP_RIGHT_OFFSET: ExpressionSpecification = [
  "interpolate",
  ["exponential", 2],
  ["zoom"],
  14,
  ["case", ["get", "keepRight"], 0.45, 0],
  20,
  ["case", ["get", "keepRight"], 28, 0],
];

setWorkerUrl(workerUrl);
registerIllustratedTiles();

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** A day's classes on the map: the walks between them, and a numbered pin per class. */
export interface DayOverlay {
  lines: { coordinates: LngLat[]; color: string }[];
  /** One pin per building; `n` lists the class numbers there ("1, 4"), `label` one line per class. */
  stops: { lngLat: LngLat; n: string; label: string; color: string }[];
}

export interface MapViewProps {
  graph: CampusGraph;
  routeLines: RouteLine[] | null;
  /** The day view's walks and classes (drawn instead of a route). */
  day?: DayOverlay | null;
  connectors: [LngLat, LngLat][];
  stops: TransitStop[];
  showStops: boolean;
  from: LngLat | null;
  to: LngLat | null;
  baseMap: BaseMap;
  /** Live trolleys and buses, and the time the feed gave them (its times count from then), or null when off. */
  live: { vehicles: LiveVehicle[]; at: number } | null;
  /** Spin e-bikes and scooters free to ride (all drawn), or null when the Spin button is off. */
  spinBikes: SharedBike[] | null;
  /**
   * Scooter rules, drawn while riding a scooter is on the cards: Spin's zones with no riding or a
   * speed limit, UCSD's walks where scooters are walked, and where they can be parked.
   */
  scooterRules?: { zones: RideZone[]; noScooter: LngLat[][]; parking: ParkingSpot[] } | null;
  /** A scooter trip's scooter and where it's parked. */
  scooterTrip?: { scooter: LngLat; parking: ParkingSpot } | null;
  /** UCSD's places, and the categories to show. */
  places: CampusPlaces | null;
  placeCategories: string[];
  onPlaceDirections: (place: PlacePick) => void;
  /** A spot being reported (orange marker). */
  reportPin: LngLat | null;
  /** The trip starts from where you are: your dot stands in for the start pin. */
  fromIsMe?: boolean;
  /** Which way you face or move (degrees from north), for the cone on your dot. */
  heading?: number | null;
  /** Your position (live while navigating), and whether the map should follow it. */
  userPos: LngLat | null;
  follow: boolean;
  /** Doors of the destination building; `used` is the one the route ends at. */
  doors: { lngLat: LngLat; used: boolean }[];
  /** A mapped indoor room to point at, with its label. */
  room: { lngLat: LngLat; label: string } | null;
  /** One floor of a building's indoor map, with the destination room highlighted. */
  /** Fly the camera here (bump `key` to repeat). */
  focus: { at: LngLat; zoom: number; key: number } | null;
  /** Taps mark a spot rather than set a route endpoint: show a crosshair. */
  pickingSpot: boolean;
  onMapClick: (p: LngLat) => void;
  onLocate: (p: LngLat) => void;
}

export function MapView(props: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef<{ from: Marker; to: Marker; report: Marker; user: Marker; room: Marker } | null>(null);
  const roomLabel = useRef<HTMLSpanElement | null>(null);
  const [ready, setReady] = useState(false);
  /** The middle of the map, for the nearest places when we don't know where you are. */
  const [mapCentre, setMapCentre] = useState<LngLat | null>(null);
  const lastTrip = useRef<string | null>(null);
  const popup = useRef<Popup | null>(null);
  const osmLayers = useRef<{ id: string; type: string }[]>([]);

  // Keep the latest callbacks without re-binding map listeners.
  const callbacks = useRef(props);
  callbacks.current = props;

  useEffect(() => {
    // Keep the map on campus (and its shore), but let every edge be panned out from under the panel.
    const map = new MlMap({
      container: container.current!,
      style: BASE_STYLE,
      center: visibleCenter(CAMPUS_CENTER, START_ZOOM),
      zoom: START_ZOOM,
      maxBounds: campusBounds(props.graph.data.bbox),
      minZoom: MIN_ZOOM,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ visualizePitch: false }), "top-right");
    const geolocate = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      // The app draws you itself (one dot, with the way you face), not a second dot from here.
      showUserLocation: false,
      showAccuracyCircle: false,
    });
    map.addControl(geolocate, "top-right");
    geolocate.on("geolocate", (pos) => callbacks.current.onLocate([pos.coords.longitude, pos.coords.latitude]));
    map.addControl(new ScaleControl({ unit: "imperial" }), "bottom-right");

    markers.current = {
      from: new Marker({ color: PALETTE.sageDeep }),
      to: new Marker({ color: PALETTE.rose }),
      report: new Marker({ color: PALETTE.clay }),
      user: new Marker({ element: viewpointElement(), rotationAlignment: "map", pitchAlignment: "map" }),
      room: new Marker({ element: roomElement(roomLabel), anchor: "bottom" }),
    };

    map.on("load", () => {
      // OpenStreetMap's drawing, recolored like the illustrated map: it's what's around the drawing in
      // Illustrated mode (labels and icons stay off, so nothing lands on the drawing). The campus map
      // covers it in Campus mode.
      osmLayers.current = map.getStyle().layers.map((l) => ({ id: l.id, type: l.type }));
      paintLikeIllustrated(map);
      map.addSource("topo", {
        type: "raster",
        tiles: [TOPO_TILES],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Campus map © UC San Diego, Esri",
      });
      // Esri's topographic tiles, quieted toward gray: campus itself is drawn on them in the app's colors.
      map.addLayer({
        id: "topo",
        type: "raster",
        source: "topo",
        // New tiles swap in at once: cross-fading them lets the pale background flash through.
        paint: { "raster-saturation": -0.45, "raster-brightness-max": 0.97, "raster-fade-duration": 0 },
      });
      // UCSD's own ground-level campus drawing (lawns, walkways, buildings...), in the app's palette.
      map.addSource("ucsd", { type: "vector", tiles: [UCSD_VECTOR_TILES], minzoom: 0, maxzoom: 16 });
      for (const layer of UCSD_GROUND) map.addLayer(layer);
      map.addSource("illustrated", {
        type: "raster",
        // UCSD's drawing, moved onto true positions (see illustratedTiles.ts).
        tiles: [ILLUSTRATED_TILES],
        tileSize: 256,
        minzoom: 13,
        maxzoom: 20,
        bounds: [-117.26, 32.855, -117.2, 32.895],
        attribution: "Illustrated map © UC San Diego",
      });
      map.addLayer({
        id: "illustrated",
        type: "raster",
        source: "illustrated",
        layout: { visibility: "none" },
        // As for the topo tiles: no cross-fade, which flashes the drawing's buildings white while zooming.
        paint: { "raster-fade-duration": 0 },
      });
      // The drawing stops abruptly: a soft band of the surrounding green along its outline (traced
      // from its tiles) blends it into the map around it. ~40 m wide on the ground at every zoom.
      map.addSource("illustrated-edge", { type: "geojson", data: "/data/illustrated-edge.json" });
      map.addLayer({
        id: "illustrated-edge",
        type: "line",
        source: "illustrated-edge",
        layout: { visibility: "none", "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ILLUSTRATED_GROUND,
          "line-width": ["interpolate", ["exponential", 2], ["zoom"], 13, 3, 20, 384],
          "line-blur": ["interpolate", ["exponential", 2], ["zoom"], 13, 3, 20, 384],
        },
      });
      for (const layer of UCSD_LAYERS) map.addLayer({ ...layer, layout: { ...layer.layout, visibility: "none" } } as LayerSpecification);

      for (const id of ["route", "connectors", "stops", "doors", "day", "places", "spin", "vehicle-ahead", "scooter-rules", "scooter-trip"]) {
        map.addSource(id, { type: "geojson", data: EMPTY });
      }
      // UCSD's places, under everything of the app's; names once zoomed in.
      map.addLayer({
        id: "places",
        type: "circle",
        source: "places",
        filter: ["boolean", false],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 3.5, 17, 6, 19, 8],
          "circle-color": ["get", "color"],
          "circle-stroke-color": PALETTE.white,
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 14, 1, 17, 2],
        },
      });
      map.addLayer({
        id: "place-labels",
        type: "symbol",
        source: "places",
        minzoom: 17.5,
        filter: ["boolean", false],
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-offset": [0, 0.9],
          "text-anchor": "top",
          "text-max-width": 8,
          "text-optional": true,
        },
        paint: { "text-color": ["get", "color"], "text-halo-color": PALETTE.white, "text-halo-width": 1.5 },
      });
      // A tapped trolley or bus: the rest of its route in its line's color, and its stops to come
      // with how long until it gets there.
      map.addLayer({
        id: "vehicle-ahead-casing",
        type: "line",
        source: "vehicle-ahead",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": PALETTE.white, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 5, 17, 10], "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "vehicle-ahead",
        type: "line",
        source: "vehicle-ahead",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2.5, 17, 6] },
      });
      map.addLayer({
        id: "vehicle-ahead-stops",
        type: "circle",
        source: "vehicle-ahead",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3, 17, 6],
          "circle-color": PALETTE.white,
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 17, 2.5],
        },
      });
      map.addLayer({
        id: "vehicle-ahead-times",
        type: "symbol",
        source: "vehicle-ahead",
        filter: ["==", ["geometry-type"], "Point"],
        layout: {
          "text-field": ["step", ["zoom"], ["get", "when"], 16, ["concat", ["get", "name"], "\n", ["get", "when"]]],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-offset": [0, 1],
          "text-anchor": "top",
          "text-max-width": 9,
          "text-optional": true,
        },
        paint: { "text-color": ["get", "color"], "text-halo-color": PALETTE.white, "text-halo-width": 1.6 },
      });
      // Spin vehicles in Spin orange: e-bikes solid and larger, scooters white with an orange ring;
      // the battery once zoomed in.
      map.addLayer({
        id: "spin",
        type: "circle",
        source: "spin",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14,
            ["case", ["==", ["get", "kind"], "ebike"], 5, 4],
            17,
            ["case", ["==", ["get", "kind"], "ebike"], 8, 6],
            19,
            ["case", ["==", ["get", "kind"], "ebike"], 10, 8],
          ],
          "circle-color": ["case", ["==", ["get", "kind"], "ebike"], SPIN_ORANGE, PALETTE.white],
          "circle-stroke-color": ["case", ["==", ["get", "kind"], "ebike"], PALETTE.white, SPIN_ORANGE],
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 14, 1.5, 17, 2.5],
        },
      });
      map.addLayer({
        id: "spin-labels",
        type: "symbol",
        source: "spin",
        minzoom: 16,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: { "text-color": SPIN_ORANGE, "text-halo-color": PALETTE.white, "text-halo-width": 1.5 },
      });
      // A scooter trip: the scooter to pick up (solid) and where to park it (ringed, "P").
      map.addLayer({
        id: "scooter-trip",
        type: "circle",
        source: "scooter-trip",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 6, 18, 11],
          "circle-color": ["case", ["==", ["get", "role"], "scooter"], SPIN_ORANGE, PALETTE.white],
          "circle-stroke-color": ["case", ["==", ["get", "role"], "scooter"], PALETTE.white, SPIN_ORANGE],
          "circle-stroke-width": 3,
        },
      });
      map.addLayer({
        id: "scooter-trip-labels",
        type: "symbol",
        source: "scooter-trip",
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
          "text-offset": [0, 1.3],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: { "text-color": SPIN_ORANGE, "text-halo-color": PALETTE.white, "text-halo-width": 1.6 },
      });
      map.addLayer({
        id: "stops",
        type: "circle",
        source: "stops",
        layout: { visibility: "none" },
        paint: { "circle-radius": 5, "circle-color": PALETTE.white, "circle-stroke-color": PALETTE.oliveDeep, "circle-stroke-width": 2.5 },
      });
      map.addLayer({
        id: "stop-labels",
        type: "symbol",
        source: "stops",
        minzoom: 16,
        layout: {
          visibility: "none",
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-max-width": 9,
        },
        paint: { "text-color": PALETTE.oliveDeep, "text-halo-color": PALETTE.white, "text-halo-width": 1.5 },
      });
      // Walking legs are dotted; rides are solid (bike green, shuttle in the route's color).
      // Scooter rules under the route: no-ride zones in red, slow zones in amber, no-scooter walks
      // dashed red, parking as small orange rings once zoomed in.
      map.addLayer({
        id: "scooter-zones",
        type: "fill",
        source: "scooter-rules",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": ["case", ["get", "noRide"], "#D64545", "#E0A526"], "fill-opacity": 0.18 },
      });
      map.addLayer({
        id: "scooter-zone-edges",
        type: "line",
        source: "scooter-rules",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "line-color": ["case", ["get", "noRide"], "#D64545", "#E0A526"], "line-width": 1.5, "line-dasharray": [2, 1.5] },
      });
      map.addLayer({
        id: "no-scooter-walks",
        type: "line",
        source: "scooter-rules",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round" },
        paint: { "line-color": "#D64545", "line-width": ["interpolate", ["linear"], ["zoom"], 15, 2, 19, 5], "line-dasharray": [1, 1.5], "line-opacity": 0.8 },
      });
      map.addLayer({
        id: "scooter-parking",
        type: "circle",
        source: "scooter-rules",
        filter: ["==", ["geometry-type"], "Point"],
        minzoom: 15.5,
        paint: {
          "circle-radius": ["case", ["get", "hub"], 5, 3.5],
          "circle-color": PALETTE.white,
          "circle-stroke-color": SPIN_ORANGE,
          "circle-stroke-width": ["case", ["get", "hub"], 2.5, 1.5],
        },
      });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        filter: ["!=", ["get", "kind"], "walk"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": PALETTE.oliveDeep, "line-width": 11, "line-offset": KEEP_RIGHT_OFFSET },
      });
      // A soft white underlay so the dotted walk stays readable over parks and buildings.
      map.addLayer({
        id: "route-walk-halo",
        type: "line",
        source: "route",
        filter: ["==", ["get", "kind"], "walk"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": PALETTE.white, "line-width": 11, "line-opacity": 0.75 },
      });
      map.addLayer({
        id: "route",
        type: "line",
        source: "route",
        filter: ["==", ["get", "kind"], "walk"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": PALETTE.olive, "line-width": 7, "line-dasharray": [0.01, 1.6] },
      });
      map.addLayer({
        id: "route-ride",
        type: "line",
        source: "route",
        filter: ["!=", ["get", "kind"], "walk"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 7, "line-offset": KEEP_RIGHT_OFFSET },
      });
      // The day view: dotted walks between classes in the next class's color, numbered pins.
      map.addLayer({
        id: "day-line",
        type: "line",
        source: "day",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 6, "line-dasharray": [0.01, 1.6] },
      });
      map.addLayer({
        id: "day-stop",
        type: "circle",
        source: "day",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": ["case", [">", ["length", ["get", "n"]], 1], 15, 11],
          "circle-color": ["get", "color"],
          "circle-stroke-color": PALETTE.white,
          "circle-stroke-width": 2.5,
        },
      });
      map.addLayer({
        id: "day-stop-n",
        type: "symbol",
        source: "day",
        filter: ["==", ["geometry-type"], "Point"],
        layout: { "text-field": ["get", "n"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-allow-overlap": true },
        paint: { "text-color": PALETTE.white },
      });
      map.addLayer({
        id: "day-stop-label",
        type: "symbol",
        source: "day",
        filter: ["==", ["geometry-type"], "Point"],
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-offset": [0, 1.5],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: { "text-color": PALETTE.ink, "text-halo-color": PALETTE.white, "text-halo-width": 1.6 },
      });
      map.addLayer({
        id: "doors",
        type: "circle",
        source: "doors",
        minzoom: 16,
        paint: {
          "circle-radius": ["case", ["get", "used"], 7, 4.5],
          "circle-color": ["case", ["get", "used"], PALETTE.olive, PALETTE.white],
          "circle-stroke-color": ["case", ["get", "used"], PALETTE.white, PALETTE.oliveDeep],
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "connectors",
        type: "line",
        source: "connectors",
        paint: { "line-color": PALETTE.oliveDeep, "line-width": 3, "line-dasharray": [1, 1.5] },
      });
      const centre = () => {
        const c = map.getCenter();
        setMapCentre([c.lng, c.lat]);
      };
      centre();
      map.on("moveend", centre);
      setReady(true);
    });

    map.on("click", (e) => {
      // A Spin e-bike: its battery and range, and directions to it.
      const box: [[number, number], [number, number]] = [
        [e.point.x - 8, e.point.y - 8],
        [e.point.x + 8, e.point.y + 8],
      ];
      const bike = map.getLayer("spin") ? map.queryRenderedFeatures(box, { layers: ["spin"] })[0] : undefined;
      if (bike && bike.geometry.type === "Point") {
        const at = bike.geometry.coordinates as LngLat;
        popup.current?.remove();
        popup.current = new Popup({ closeButton: true, maxWidth: "240px", className: "place-popup" })
          .setLngLat(at)
          .setDOMContent(placeCard((bike.properties as { name: string }).name, (bike.properties as { detail: string }).detail, "", () => {
            popup.current?.remove();
            callbacks.current.onPlaceDirections({ lngLat: at, name: (bike.properties as { name: string }).name });
          }))
          .addTo(map);
        return;
      }
      // A place: what it is, and directions to it; anywhere else drops a pin as before.
      const hit = map.getLayer("places")
        ? map.queryRenderedFeatures([
            [e.point.x - 6, e.point.y - 6],
            [e.point.x + 6, e.point.y + 6],
          ], { layers: ["places"] })[0]
        : undefined;
      if (hit && hit.geometry.type === "Point") {
        const at = hit.geometry.coordinates as LngLat;
        const { name, kind, building } = hit.properties as { name: string; kind: string; building: string };
        popup.current?.remove();
        popup.current = new Popup({ closeButton: true, maxWidth: "240px", className: "place-popup" })
          .setLngLat(at)
          .setDOMContent(placeCard(name, kind, building, () => {
            popup.current?.remove();
            callbacks.current.onPlaceDirections({ lngLat: at, name });
          }))
          .addTo(map);
        return;
      }
      callbacks.current.onMapClick([e.lngLat.lng, e.lngLat.lat]);
    });
    for (const layer of ["places", "spin"]) {
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }

    return () => map.remove();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current!;
    const vis = (on: boolean) => (on ? "visible" : "none");
    const illustrated = props.baseMap === "illustrated";
    // Campus: the topographic campus map over everything of OpenStreetMap's. Illustrated: the drawing,
    // on OpenStreetMap drawn in its colors.
    map.setLayoutProperty("topo", "visibility", vis(!illustrated));
    for (const layer of UCSD_GROUND) map.setLayoutProperty(layer.id, "visibility", vis(!illustrated));
    map.setLayoutProperty("illustrated", "visibility", vis(illustrated));
    map.setLayoutProperty("illustrated-edge", "visibility", vis(illustrated));
    for (const { id, type } of osmLayers.current) {
      if (type !== "background") map.setLayoutProperty(id, "visibility", vis(illustrated && showsUnderDrawing(id, type)));
      // What shows while tiles load: the drawing's green, or the campus map's pale ground.
      else map.setPaintProperty(id, "background-color", illustrated ? ILLUSTRATED_GROUND : "#ece8ef");
    }
    for (const layer of UCSD_LAYERS) map.setLayoutProperty(layer.id, "visibility", vis(props.baseMap === "campus"));
  }, [ready, props.baseMap]);

  // Places: the few nearest of each kind shown, to you (or to the middle of the map), not the whole campus.
  const anchor = props.userPos ?? mapCentre;
  useEffect(() => {
    if (!ready || !props.places) return;
    const { categories, points } = props.places;
    const shown = anchor
      ? props.placeCategories.flatMap((id) => {
          const cat = categories.findIndex((c) => c.id === id);
          return points
            .filter((p) => p[2] === cat)
            .map((p) => ({ p, m: haversine(anchor[0], anchor[1], p[0], p[1]) }))
            .sort((a, b) => a.m - b.m)
            .slice(0, NEAREST_PLACES)
            .map(({ p }) => p);
        })
      : [];
    source(mapRef.current!, "places").setData({
      type: "FeatureCollection",
      features: shown.map(([lng, lat, cat, name, kind, building]) => ({
        type: "Feature",
        properties: { cat: categories[cat].id, color: categories[cat].color, name, kind, building },
        geometry: { type: "Point", coordinates: [lng, lat] },
      })),
    });
  }, [ready, props.places, props.placeCategories, anchor?.[0], anchor?.[1]]);

  // Live trolleys and buses: a marker for each near campus (the map can't go further), in its line's
  // color, with an arrow the way it's heading. Between updates each one keeps moving along its
  // route at the speed it's been going, and eases onto each new report, so it moves smoothly and
  // turns with the road instead of jumping.
  const trolleyMarkers = useRef(new Map<string, Moving>());
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const markers = trolleyMarkers.current;
    const [w, s, e, n] = props.graph.data.bbox;
    const near = (v: LiveVehicle) => v.lngLat[0] > w - 0.03 && v.lngLat[0] < e + 0.03 && v.lngLat[1] > s - 0.03 && v.lngLat[1] < n + 0.03;
    const now = new Map((props.live?.vehicles ?? []).filter(near).map((v) => [v.id, v]));
    for (const [id, m] of markers) if (!now.has(id)) (m.marker.remove(), markers.delete(id));
    const t = performance.now();
    for (const v of now.values()) {
      let m = markers.get(v.id);
      if (!m) {
        const el = vehicleElement(v);
        m = {
          marker: new Marker({ element: el }).setLngLat(v.lngLat).addTo(map),
          vehicle: v,
          path: null,
          d: v.distanceAlong ?? 0,
          t,
          speed: 0,
          speedFrom: 0,
          offset: 0,
          offsetAt: t,
          glide: { from: v.lngLat, to: v.lngLat, start: 0 },
        };
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          const { vehicle, marker } = markers.get(v.id)!;
          popup.current?.remove();
          const shown = new Popup({ closeButton: true, maxWidth: "240px", className: "place-popup", offset: 18 })
            .setLngLat(marker.getLngLat())
            .setDOMContent(vehicleCard(vehicle, trolleysAt.current))
            .addTo(map);
          popup.current = shown;
          // Follow this vehicle: its route ahead, until its popup closes.
          selected.current = vehicle.id;
          shown.on("close", () => {
            if (selected.current !== vehicle.id) return;
            selected.current = null;
            showAhead(null);
          });
          void loadAhead(vehicle);
        });
        markers.set(v.id, m);
        follow(m, v, t, true);
      } else {
        follow(m, v, t, false);
      }
      const el = m.marker.getElement();
      el.style.setProperty("--line", v.color);
      el.title = `${v.line}${v.headsign ? ` to ${v.headsign}` : ""}`;
      el.classList.toggle("has-heading", v.heading !== undefined || !!m.path);
      if (!m.path) el.dataset.heading = String(v.heading ?? 0);
    }
    trolleysAt.current = props.live?.at ?? Date.now();
    turnArrows();
    // The followed vehicle: keep its card and route ahead up to date.
    const followed = selected.current ? now.get(selected.current) : undefined;
    missing.current = selected.current && !followed ? missing.current + 1 : 0;
    if (selected.current && !followed && missing.current >= MISSING_UPDATES) {
      // Gone for a while (trip over, or off the map): stop following it.
      selected.current = null;
      popup.current?.remove();
      showAhead(null);
    } else if (followed) {
      popup.current?.setDOMContent(vehicleCard(followed, trolleysAt.current));
      void loadAhead(followed);
    }
    if (markers.size && !gliding.current) gliding.current = requestAnimationFrame(glide);
  }, [ready, props.live]);

  /** Take a new report for a marker: measure its speed along the route, and ease from where it's drawn. */
  const follow = (m: Moving, v: LiveVehicle, t: number, fresh: boolean) => {
    const sameTrip = !fresh && m.vehicle.tripId === v.tripId;
    m.vehicle = v;
    // Its route's path, once (fetched in the background; until then it glides in a straight line).
    if (v.shapeId && m.pathFor !== v.shapeId) {
      m.path = null;
      m.pathFor = v.shapeId;
      const shapeId = v.shapeId;
      getShape(shapeId)
        .then((points) => m.pathFor === shapeId && (m.path = measurePath(points)))
        .catch(() => m.pathFor === shapeId && (m.pathFor = undefined));
    }
    // Progress along the route: its speed from the last report, and where it is now.
    let shown: number | undefined;
    if (v.distanceAlong !== undefined) {
      shown = m.path && m.onPath && sameTrip ? alongNow(m, t) : undefined;
      if (sameTrip && t - m.t > 2000) {
        const measured = Math.max(0, Math.min(MAX_SPEED, (v.distanceAlong - m.d) / ((t - m.t) / 1000)));
        // Change speed gently: from the speed it's going now, toward a damped new one, over the
        // time to the next report.
        m.speedFrom = speedNow(m, t);
        m.speed = m.speed ? m.speed + (measured - m.speed) * SPEED_DAMPING : measured;
      } else if (!sameTrip) {
        m.speed = m.speedFrom = 0;
      }
      m.d = v.distanceAlong;
      m.t = t;
    }
    if (v.distanceAlong === undefined || !m.path || reducedMotion()) {
      // No route to follow yet (or no progress along it, or no animation wanted): glide, or jump, there.
      const at = m.marker.getLngLat();
      const from: LngLat = [at.lng, at.lat];
      const far = haversine(from[0], from[1], v.lngLat[0], v.lngLat[1]) > GLIDE_MAX_METERS;
      m.glide = far || reducedMotion() ? { from: v.lngLat, to: v.lngLat, start: 0 } : { from, to: v.lngLat, start: t };
      if (far || reducedMotion()) m.marker.setLngLat(v.lngLat);
      m.onPath = false;
      return;
    }
    // Ease out the difference between where it's drawn and where it's reported, unless it's far off
    // (or it's only now starting to follow its route).
    const off = shown === undefined ? 0 : shown - (v.distanceAlong ?? 0);
    m.offset = Math.abs(off) < GLIDE_MAX_METERS ? off : 0;
    m.offsetAt = t;
    if (!m.onPath || !sameTrip) m.shown = undefined;
    m.onPath = true;
    // Where its next stop is along the route: it's drawn stopping there until a report says it's left.
    const stop = v.nextStop?.lngLat;
    m.stopAlong = stop && m.path ? alongPath(m.path, stop, Math.max(0, (v.distanceAlong ?? 0) - 40)) : undefined;
    m.glide = { from: v.lngLat, to: v.lngLat, start: 0 };
  };

  // Each frame: every vehicle a little further along its route (and the open popup with its vehicle).
  const gliding = useRef(0);
  const glide = (now: number) => {
    gliding.current = 0;
    const markers = trolleyMarkers.current;
    const bearing = mapRef.current?.getBearing() ?? 0;
    for (const [id, m] of markers) {
      let at: LngLat | null = null;
      if (m.path && m.onPath && !reducedMotion()) {
        // Not past its next stop (it slows into it and waits for a report that it's left), and never
        // backwards: a vehicle drawn ahead of its report eases off instead of reversing.
        let along = alongNow(m, now);
        if (m.stopAlong !== undefined && along > m.stopAlong - STOP_EASE_METERS) {
          along = m.stopAlong - STOP_EASE_METERS * Math.exp(-(along - (m.stopAlong - STOP_EASE_METERS)) / STOP_EASE_METERS);
        }
        along = Math.max(m.shown ?? -Infinity, along);
        m.shown = along;
        const p = pointAlong(m.path, along);
        at = p.lngLat;
        const el = m.marker.getElement();
        if (Math.abs(Number(el.dataset.heading) - p.heading) > 1) {
          el.dataset.heading = String(p.heading);
          el.style.setProperty("--heading", `${p.heading - bearing}deg`);
        }
      } else if (m.glide.start) {
        const { from, to, start } = m.glide;
        const t = Math.min(1, (now - start) / LIVE_REFRESH_MS);
        at = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
        if (t >= 1) m.glide = { from: to, to, start: 0 };
      }
      if (!at) continue;
      m.marker.setLngLat(at);
      if (id === selected.current) popup.current?.setLngLat(at);
    }
    // The followed vehicle's route ahead, kept starting under it (a few times a second is plenty).
    if (ahead.current && now - lastAheadDraw.current > 200) drawAhead(now);
    if (markers.size) gliding.current = requestAnimationFrame(glide);
  };
  useEffect(() => () => cancelAnimationFrame(gliding.current), []);
  const trolleysAt = useRef(Date.now());
  /** The trolley or bus whose route ahead is shown (its popup is open). */
  const selected = useRef<string | null>(null);
  /** The followed vehicle's route ahead (its stops and times), redrawn as it moves. */
  const ahead = useRef<{ vehicleId: string; color: string; trip: TripAhead } | null>(null);
  /** Updates in a row the followed vehicle has been missing from (MTS's answers are patchy). */
  const missing = useRef(0);
  const lastAheadDraw = useRef(0);
  /** Show (or clear) a vehicle's route ahead. */
  const showAhead = (next: { vehicle: LiveVehicle; trip: TripAhead } | null) => {
    ahead.current = next && { vehicleId: next.vehicle.id, color: next.vehicle.color, trip: next.trip };
    drawAhead(performance.now());
  };
  /**
   * Draw the route ahead from where the vehicle is drawn right now: the line starts under it and
   * shortens as it moves (nothing trails behind), and stops it has passed drop off.
   */
  const drawAhead = (now: number) => {
    const map = mapRef.current;
    if (!map) return;
    lastAheadDraw.current = now;
    const a = ahead.current;
    if (!a) return source(map, "vehicle-ahead").setData(EMPTY);
    const m = trolleyMarkers.current.get(a.vehicleId);
    const at = m?.marker.getLngLat();
    let line = a.trip.path;
    let passed = -Infinity;
    if (m?.path && m.onPath) {
      passed = alongNow(m, now);
      line = pathFrom(m.path, passed);
    } else if (at && line.length > 1) {
      line = [[at.lng, at.lat], ...line.slice(1)];
    }
    const clock = Date.now();
    source(map, "vehicle-ahead").setData({
      type: "FeatureCollection",
      features: [
        ...(line.length > 1 ? [{ ...lineFeature(line), properties: { color: a.color } }] : []),
        ...a.trip.stops
          .filter((s) => s.along > passed)
          .map((s) => {
            const min = Math.round((s.at - clock) / 60_000);
            return {
              type: "Feature" as const,
              properties: {
                color: a.color,
                name: s.name,
                when: min <= 0 ? "now" : min < 60 ? `${min} min` : new Date(s.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
              },
              geometry: { type: "Point" as const, coordinates: s.lngLat },
            };
          }),
      ],
    });
  };
  const loadAhead = async (vehicle: LiveVehicle) => {
    if (!vehicle.tripId) return;
    try {
      const trip = await fetchTripAhead(vehicle.tripId);
      // Still following the same vehicle?
      if (selected.current === vehicle.id) showAhead({ vehicle, trip });
    } catch {
      // Keep whatever's drawn; the next refresh tries again.
    }
  };
  // Arrows point the way on the map: allow for the map being rotated.
  const turnArrows = () => {
    const bearing = mapRef.current?.getBearing() ?? 0;
    for (const { marker } of trolleyMarkers.current.values()) {
      const el = marker.getElement();
      el.style.setProperty("--heading", `${Number(el.dataset.heading) - bearing}deg`);
    }
  };
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.on("rotate", turnArrows);
    return () => {
      map.off("rotate", turnArrows);
    };
  }, [ready]);

  // Scooter rules: Spin's no-ride and slow zones (not the parking-only areas, which cover the city),
  // UCSD's no-scooter walks, and the hubs and racks to park at.
  useEffect(() => {
    if (!ready) return;
    const r = props.scooterRules;
    source(mapRef.current!, "scooter-rules").setData({
      type: "FeatureCollection",
      features: r
        ? [
            ...r.zones
              .filter((z) => !z.through || z.maxKph)
              .flatMap((z) =>
                z.polygons.map((rings) => ({
                  type: "Feature" as const,
                  properties: { noRide: !z.through },
                  geometry: { type: "Polygon" as const, coordinates: rings },
                })),
              ),
            ...r.noScooter.map((line) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: line } })),
            ...r.parking.map((p) => ({ type: "Feature" as const, properties: { hub: p.kind === "hub" }, geometry: { type: "Point" as const, coordinates: p.lngLat } })),
          ]
        : [],
    });
  }, [ready, props.scooterRules]);
  useEffect(() => {
    if (!ready) return;
    const t = props.scooterTrip;
    source(mapRef.current!, "scooter-trip").setData({
      type: "FeatureCollection",
      features: t
        ? [
            { type: "Feature", properties: { role: "scooter", label: "Spin scooter" }, geometry: { type: "Point", coordinates: t.scooter } },
            { type: "Feature", properties: { role: "park", label: "Park here" }, geometry: { type: "Point", coordinates: t.parking.lngLat } },
          ]
        : [],
    });
  }, [ready, props.scooterTrip]);

  // Spin vehicles: every e-bike and scooter free to ride (not just the nearest few, unlike places).
  useEffect(() => {
    if (!ready) return;
    // Scooters first, so e-bikes draw on top.
    const all = [...(props.spinBikes ?? [])].sort((a, b) => Number(a.kind === "ebike") - Number(b.kind === "ebike"));
    source(mapRef.current!, "spin").setData({
      type: "FeatureCollection",
      features: all.map((b) => {
        const m = anchor ? haversine(anchor[0], anchor[1], b.lngLat[0], b.lngLat[1]) : NaN;
        const battery = b.battery !== undefined ? `${Math.round(b.battery * 100)}% battery` : "";
        const range = b.rangeMeters !== undefined ? `about ${(b.rangeMeters / 1609).toFixed(0)} mi of range` : "";
        const away = Number.isFinite(m) ? `${formatDistance(m)} from ${props.userPos ? "you" : "the map's middle"}` : "";
        return {
          type: "Feature",
          properties: {
            kind: b.kind,
            name: b.kind === "ebike" ? "Spin e-bike" : "Spin scooter",
            label: b.battery !== undefined ? `${Math.round(b.battery * 100)}%` : "",
            detail: [battery, range, away].filter(Boolean).join(" · "),
          },
          geometry: { type: "Point", coordinates: b.lngLat },
        };
      }),
    });
    if (!props.spinBikes) popup.current?.remove();
  }, [ready, props.spinBikes, anchor?.[0], anchor?.[1], props.userPos]);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current!;
    const filter: ExpressionSpecification = ["in", ["get", "cat"], ["literal", props.placeCategories]];
    map.setFilter("places", filter);
    map.setFilter("place-labels", filter);
    if (!props.placeCategories.length) popup.current?.remove();
  }, [ready, props.placeCategories]);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current!;
    const vis = (on: boolean) => (on ? "visible" : "none");
    map.setLayoutProperty("stops", "visibility", vis(props.showStops));
    map.setLayoutProperty("stop-labels", "visibility", vis(props.showStops));
  }, [ready, props.showStops]);

  useEffect(() => {
    if (!ready) return;
    source(mapRef.current!, "stops").setData({
      type: "FeatureCollection",
      features: props.stops.map((s) => ({
        type: "Feature",
        properties: { name: s.name },
        geometry: { type: "Point", coordinates: s.lngLat },
      })),
    });
  }, [ready, props.stops]);

  // The day view's walks and pins, framed whenever the day (or the choice of classes) changes.
  const lastDay = useRef("");
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current!;
    const day = props.day;
    source(map, "day").setData({
      type: "FeatureCollection",
      features: [
        ...(day?.lines ?? []).map((l) => ({ ...lineFeature(l.coordinates), properties: { color: l.color } })),
        ...(day?.stops ?? []).map((s) => ({
          type: "Feature" as const,
          properties: { n: s.n, label: s.label, color: s.color },
          geometry: { type: "Point" as const, coordinates: s.lngLat },
        })),
      ],
    });
    const pts = [...(day?.lines ?? []).flatMap((l) => l.coordinates), ...(day?.stops ?? []).map((s) => s.lngLat)];
    const key = JSON.stringify(day?.stops.map((s) => s.lngLat) ?? []);
    if (pts.length && key !== lastDay.current) {
      const bounds = new LngLatBounds(pts[0], pts[0]);
      for (const p of pts) bounds.extend(p);
      map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 17.5, duration: 600 });
    }
    lastDay.current = key;
  }, [ready, props.day]);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current!;
    const lines = props.routeLines ?? [];
    source(map, "route").setData({
      type: "FeatureCollection",
      // Rides last so they draw over the walking legs they meet.
      features: [...lines]
        .sort((a, b) => Number(a.kind !== "walk") - Number(b.kind !== "walk"))
        .map((l) => ({ ...lineFeature(l.coordinates), properties: { kind: l.kind, color: l.color, keepRight: !!l.keepRight } })),
    });
    source(map, "connectors").setData({
      type: "FeatureCollection",
      features: props.connectors.map((c) => lineFeature(c)),
    });
    // Only re-frame when the trip changes, not on every re-render.
    // A start that follows you doesn't count as a new trip.
    const tripKey = JSON.stringify([callbacks.current.fromIsMe ? "me" : callbacks.current.from, callbacks.current.to]);
    const all = lines.flatMap((l) => l.coordinates);
    if (all.length > 1 && tripKey !== lastTrip.current) {
      lastTrip.current = tripKey;
      const bounds = new LngLatBounds(all[0], all[0]);
      const pins = [callbacks.current.from, callbacks.current.to].filter((p): p is LngLat => !!p);
      for (const p of [...all, ...props.connectors.flat(), ...pins]) bounds.extend(p);
      map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 18, duration: 600 });
    }
  }, [ready, props.routeLines, props.connectors]);

  useEffect(() => {
    const map = mapRef.current;
    const m = markers.current;
    if (!map || !m) return;
    for (const [marker, pos] of [
      // Your dot stands in for the start when the trip starts from you.
      [m.from, props.fromIsMe && props.userPos ? null : props.from],
      [m.to, props.to],
      [m.report, props.reportPin],
      [m.user, props.userPos],
      [m.room, props.room?.lngLat ?? null],
    ] as const) {
      if (pos) marker.setLngLat(pos).addTo(map);
      else marker.remove();
    }
    if (roomLabel.current) roomLabel.current.textContent = props.room?.label ?? "";
  }, [props.from, props.fromIsMe, props.to, props.reportPin, props.userPos, props.room]);

  // The cone on your dot: shown when we know which way you face.
  useEffect(() => {
    const m = markers.current;
    if (!m) return;
    const known = props.heading !== null && props.heading !== undefined;
    m.user.getElement().classList.toggle("has-heading", known);
    m.user.setRotation(known ? props.heading! : 0);
  }, [props.heading]);

  // Navigation: keep your position in view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.follow || !props.userPos) return;
    map.easeTo({ center: props.userPos, zoom: Math.max(map.getZoom(), 17.5), duration: 600, padding: fitPadding() });
  }, [props.follow, props.userPos]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.focus) return;
    map.flyTo({ center: props.focus.at, zoom: props.focus.zoom, duration: 900, padding: fitPadding() });
  }, [props.focus]);

  useEffect(() => {
    if (!ready) return;
    source(mapRef.current!, "doors").setData({
      type: "FeatureCollection",
      features: props.doors.map((d) => ({ type: "Feature", properties: { used: d.used }, geometry: { type: "Point", coordinates: d.lngLat } })),
    });
  }, [ready, props.doors]);

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = props.pickingSpot ? "crosshair" : "";
  }, [props.pickingSpot]);

  return <div ref={container} className="map" />;
}

/** Room around a fitted route so it isn't hidden under the panel (desktop) or sheet (phone). */
/** Map pixels per degree of longitude at a zoom level. */
function pxPerDegree(zoom: number): number {
  return (256 * 2 ** zoom) / 360;
}

/**
 * How far the map may pan: the campus data's box plus some coast, plus as much
 * again as the panel covers (on the left on a laptop, the bottom on a phone),
 * so nothing is stuck under the search panel.
 */
function campusBounds([w, s, e, n]: [number, number, number, number]): [[number, number], [number, number]] {
  const pad = fitPadding();
  const perDeg = pxPerDegree(MIN_ZOOM);
  const cos = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const lon = (px: number) => px / perDeg;
  const lat = (px: number) => (px * cos) / perDeg;
  return [
    [w - CAMPUS_PADDING_DEG - lon(pad.left), s - CAMPUS_PADDING_DEG - lat(pad.bottom)],
    [e + CAMPUS_PADDING_DEG + lon(pad.right), n + CAMPUS_PADDING_DEG + lat(pad.top)],
  ];
}

/** The map center that puts `at` in the middle of the part of the map the panel doesn't cover. */
function visibleCenter(at: LngLat, zoom: number): LngLat {
  const pad = fitPadding();
  const perDeg = pxPerDegree(zoom);
  const cos = Math.cos((at[1] * Math.PI) / 180);
  return [at[0] - (pad.left - pad.right) / 2 / perDeg, at[1] - ((pad.bottom - pad.top) / 2) * (cos / perDeg)];
}

function fitPadding() {
  if (window.innerWidth > 760) return { top: 60, right: 70, bottom: 60, left: 440 };
  return { top: 70, right: 40, bottom: Math.round(window.innerHeight * 0.5), left: 40 };
}

/** Your position: a dot with a cone for the way you face (shown once a heading is known). */
function viewpointElement(): HTMLElement {
  const el = document.createElement("div");
  el.className = "viewpoint";
  const cone = document.createElement("div");
  cone.className = "viewpoint-cone";
  const dot = document.createElement("div");
  dot.className = "user-dot";
  el.append(cone, dot);
  return el;
}

/** A small pill pointing at a room ("1202 · Ground level"). */
function roomElement(label: { current: HTMLSpanElement | null }): HTMLElement {
  const el = document.createElement("div");
  el.className = "room-pin";
  const text = document.createElement("span");
  el.appendChild(text);
  label.current = text;
  return el;
}

function source(map: MlMap, id: string): GeoJSONSource {
  return map.getSource(id) as GeoJSONSource;
}

function lineFeature(coords: LngLat[]): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } };
}


/**
 * From UCSD's campus vector style: the campus boundary and the district and
 * neighborhood names, as on the official ArcGIS campus map (fonts swapped for
 * ones the base map's font server has; names shown a little longer).
 */
const UCSD_LAYERS = [
  {
    id: "ucsd-boundary-glow",
    type: "line",
    source: "ucsd",
    "source-layer": "UCSD Boundary Campus Map",
    minzoom: 13,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "rgba(189,206,222,0.25)",
      "line-width": { base: 1, stops: [[0, 2], [14, 5], [19, 8.3]] },
      "line-offset": -2.1,
      "line-translate": [0, 2],
    },
  },
  {
    id: "ucsd-boundary",
    type: "line",
    source: "ucsd",
    "source-layer": "UCSD Boundary Campus Map",
    minzoom: 13,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "rgba(75,117,166,0.73)",
      "line-width": { base: 1, stops: [[0, 1], [14, 2], [19, 4]] },
      "line-dasharray": [2, 2],
      "line-offset": -2.1,
    },
  },
  {
    id: "ucsd-subdistricts",
    type: "symbol",
    source: "ucsd",
    "source-layer": "UCSD Subdistricts/label",
    minzoom: 14.5,
    maxzoom: 17,
    layout: { "text-field": "{_name}", "text-font": ["Noto Sans Bold"], "text-size": 13, "text-line-height": 0.9, "text-optional": true },
    paint: { "text-color": "#4A6497", "text-halo-color": "rgba(255,255,255,0.8)", "text-halo-width": 2.5 },
  },
  {
    id: "ucsd-districts",
    type: "symbol",
    source: "ucsd",
    "source-layer": "UCSD Districts/label",
    minzoom: 13,
    maxzoom: 14.5,
    layout: {
      "text-field": "{_name}",
      "text-font": ["Noto Sans Bold"],
      "text-size": { base: 1, stops: [[13, 12], [14, 15.5]] },
      "text-max-width": 10,
      "text-line-height": 0.95,
      "text-optional": true,
    },
    paint: { "text-color": "#014B75", "text-halo-color": "rgba(255,255,255,0.8)", "text-halo-width": 3 },
  },
] as const;

/**
 * OpenStreetMap in the illustrated map's colors (sampled from its tiles): grass
 * and wooded canyons in greens, gray roads, cream footpaths, pale gray roofs.
 */
/** The drawing's grass green: the ground around it, and its blended edge. */
const ILLUSTRATED_GROUND = "#9cb478";

const ILLUSTRATED_PAINT: [RegExp, "background-color" | "fill-color" | "line-color", string][] = [
  [/^background$/, "background-color", ILLUSTRATED_GROUND],
  [/^landcover_(grass|wetland)$|^landuse_(pitch|track|cemetery)$/, "fill-color", "#9cb878"],
  [/^park$/, "fill-color", "#90b06c"],
  [/^park_outline$/, "line-color", "#7c9c58"],
  [/^landcover_wood$/, "fill-color", "#6c8a44"],
  [/^landuse_residential$|^landuse_(school|hospital|commercial|industrial|retail)$/, "fill-color", "#a8bc88"],
  [/^landcover_sand$/, "fill-color", "#d6cfa6"],
  [/^water$/, "fill-color", "#6aaed6"],
  [/^waterway/, "line-color", "#6aaed6"],
  [/_casing$/, "line-color", "#5a5a5a"],
  [/^(road|bridge|tunnel)_(path|pedestrian)/, "line-color", "#ece8de"],
  [/^(road|bridge|tunnel)_/, "line-color", "#7a7a7a"],
  [/^building$/, "fill-color", "#cdcdcd"],
];

function paintLikeIllustrated(map: MlMap) {
  for (const layer of map.getStyle().layers) {
    const rule = ILLUSTRATED_PAINT.find(([re]) => re.test(layer.id));
    if (!rule) continue;
    try {
      map.setPaintProperty(layer.id, rule[1], rule[2]);
    } catch {
      // A layer of a different type than expected: leave it as the style draws it.
    }
  }
}

/** Which of OpenStreetMap's layers show around the drawing: flat shapes and lines, no labels, 3D or borders. */
function showsUnderDrawing(id: string, type: string): boolean {
  if (type === "symbol" || type === "fill-extrusion" || type === "raster") return false;
  return !/boundary|aeroway|_pattern$|hatching/.test(id);
}

/**
 * UCSD's ground-level campus drawing ("Ground Level Basemap" in its vector
 * tiles, by `_symbol`), in the app's colors: sage lawns, cream walkways, warm
 * gray buildings with a darker edge, clay for the track.
 */
const GROUND_COLORS: [number[], string][] = [
  [[3], "#d3cdbd"], // buildings
  [[10, 16, 1, 21, 23, 24], "#cbd8ad"], // grass, planters, fields, courts
  [[25, 20, 2, 4, 5, 6, 7, 9, 12], "#f8f5ec"], // walkways, sidewalks, bike paths, curbs, piers
  [[22, 29], "#dedbd1"], // streets, service roads
  [[15, 13], "#d4d1c7"], // parking, hardcourt
  [[8, 28, 11], "#e4d9c1"], // dirt, mulch, gravel
  [[18], "#efe5c8"], // sand
  [[17], "#b9d8e2"], // pools and fountains
  [[0], "#d1a995"], // athletic track
  [[14, 19, 26, 27, 30], "#e8e4d8"], // walls, rock, sheds, other structures
];
const UCSD_GROUND: LayerSpecification[] = [
  {
    id: "ucsd-ground",
    type: "fill",
    source: "ucsd",
    "source-layer": "Ground Level Basemap",
    layout: { visibility: "none" },
    paint: {
      "fill-color": ["match", ["get", "_symbol"], ...GROUND_COLORS.flatMap(([ids, c]) => [ids, c]), "#e8e4d8"] as unknown as ExpressionSpecification,
    },
  },
  {
    id: "ucsd-ground-buildings-edge",
    type: "line",
    source: "ucsd",
    "source-layer": "Ground Level Basemap",
    filter: ["==", ["get", "_symbol"], 3],
    layout: { visibility: "none", "line-join": "round" },
    paint: { "line-color": "#9a927e", "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.3, 15, 0.6, 18, 1.4] },
  },
  {
    id: "ucsd-construction",
    type: "fill",
    source: "ucsd",
    "source-layer": "Construction Buildings",
    layout: { visibility: "none" },
    paint: { "fill-color": "#e6dfc6", "fill-outline-color": "#9a927e" },
  },
];

/**
 * A trolley or bus on the map: a badge in its line's color (a trolley drawn as one, a bus with its
 * route number), with an arrow for its heading.
 */
function vehicleElement(v: LiveVehicle): HTMLElement {
  const el = document.createElement("div");
  el.className = `trolley ${v.mode}`;
  const arrow = document.createElement("span");
  arrow.className = "trolley-arrow";
  arrow.setAttribute("aria-hidden", "true");
  const badge = document.createElement("span");
  badge.className = "trolley-badge";
  badge.setAttribute("aria-hidden", "true");
  if (v.mode === "trolley") {
    badge.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5h6M12 2.5V5"/><rect x="5.5" y="5" width="13" height="13" rx="3"/><path d="M5.5 11.5h13"/><path d="M8.5 21l1.5-3M15.5 21L14 18"/></svg>';
  } else {
    badge.textContent = v.route;
  }
  el.append(arrow, badge);
  return el;
}

/** What a tapped trolley or bus says: its line and where it's going, and when it reaches its next stop. */
function vehicleCard(v: LiveVehicle, feedAt: number): HTMLElement {
  const el = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = `${v.mode === "bus" ? `Route ${v.line}` : v.line}${v.headsign ? ` to ${v.headsign}` : ""}`;
  const meta = document.createElement("span");
  meta.className = "place-popup-meta";
  if (v.nextStop) {
    const seconds = v.nextStop.inSeconds - (Date.now() - feedAt) / 1000;
    const when = seconds < 45 ? "arriving now" : `in ${Math.round(seconds / 60)} min`;
    meta.textContent = `Next: ${v.nextStop.name}, ${when}${v.predicted ? "" : " (scheduled)"}`;
  } else {
    meta.textContent = v.predicted ? "Live position" : "Position from the timetable";
  }
  // How fresh the position is: the last real GPS fix, with MTS's estimate along the route since.
  const fix = document.createElement("span");
  fix.className = "place-popup-meta";
  if (v.fixAt) {
    const ago = Math.max(0, Math.round((Date.now() - v.fixAt) / 1000));
    fix.textContent = `GPS fix ${ago < 90 ? `${ago} s` : `${Math.round(ago / 60)} min`} ago; position since estimated by MTS from the timetable`;
  } else {
    fix.textContent = "No GPS fix: position estimated by MTS from the timetable";
  }
  el.append(title, meta, fix);
  return el;
}

/** The popup for a tapped place. */
function placeCard(name: string, kind: string, building: string, onGo: () => void): HTMLElement {
  const el = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = name;
  const meta = document.createElement("span");
  meta.className = "place-popup-meta";
  meta.textContent = [kind === name ? "" : kind, building].filter(Boolean).join(" · ");
  const go = document.createElement("button");
  go.className = "primary small-btn";
  go.textContent = "Directions here";
  go.onclick = onGo;
  el.append(title, meta, go);
  return el;
}

