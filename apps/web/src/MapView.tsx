import {
  batteryColor,
  clusterVehicles,
  haversine,
  type CampusGraph,
  type LiveVehicle,
  type LngLat,
  type ParkingSpot,
  type RideZone,
  type SharedBike,
  type VehicleCluster,
  type TransitStop,
  type TripAhead,
} from "@campus/core";
import { fetchTripAhead } from "./mts.ts";
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
import { formatDistance, formatLead } from "./Itinerary.tsx";
import type { LineBadge } from "./lineColor.ts";
import { stopBadgeElement } from "./StopBadge.tsx";
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

/** Updates in a row a followed vehicle can be missing from before its popup and route close. */
const MISSING_UPDATES = 4;

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
  /** Stop logos. The Stops button shows the thinned set; an open route shows every stop on it. */
  showTransitStops?: boolean;
  logoStops?: { stop: TransitStop; lines: LineBadge[]; onRoute?: boolean; approach?: number }[];
  onStopClick?: (stop: TransitStop) => void;
  /** Lines through the selected stop (one per route / direction). */
  stopRoutes?: { coordinates: LngLat[]; color: string }[];
  /** Clicked away from a stop or live vehicle: hide that overlay. */
  onClearOverlay?: () => void;
  selectedStopId?: string | null;
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
  /** Route number of the bus or trolley whose popup is open, so every stop on that route stays drawn. */
  const [focusRoute, setFocusRoute] = useState<string | null>(null);
  const setFocusRouteRef = useRef(setFocusRoute);
  setFocusRouteRef.current = setFocusRoute;
  /** The middle of the map, for the nearest places when we don't know where you are. */
  const [mapCentre, setMapCentre] = useState<LngLat | null>(null);
  const lastTrip = useRef<string | null>(null);
  const popup = useRef<Popup | null>(null);
  const osmLayers = useRef<{ id: string; type: string }[]>([]);
  /** The trolley or bus whose route is shown (its popup is open). */
  const selected = useRef<string | null>(null);
  /** The followed vehicle's route from its fix (its stops and MTS's times). */
  const ahead = useRef<{ vehicle: LiveVehicle; trip: TripAhead } | null>(null);
  /** Updates in a row the followed vehicle has been missing from. */
  const missing = useRef(0);

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
      for (const layer of UCSD_LAYERS) map.addLayer({ ...layer, layout: { ...layer.layout, visibility: "none" } } as unknown as LayerSpecification);

      for (const id of ["route", "connectors", "stops", "doors", "day", "places", "spin", "vehicle-ahead", "stop-routes", "scooter-rules", "scooter-trip"]) {
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
      // A tapped trolley or bus: the trail it has already run (dashed), the rest of its route
      // (solid, with arrows the way it's going), and its stops.
      if (!map.hasImage("route-arrow")) map.addImage("route-arrow", routeArrowImage());
      map.addLayer({
        id: "vehicle-behind-casing",
        type: "line",
        source: "vehicle-ahead",
        filter: ["==", ["get", "kind"], "behind"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": PALETTE.white, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 4, 17, 8], "line-opacity": 0.55 },
      });
      map.addLayer({
        id: "vehicle-behind",
        type: "line",
        source: "vehicle-ahead",
        filter: ["==", ["get", "kind"], "behind"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 17, 4.5],
          "line-opacity": 0.45,
          "line-dasharray": [1.2, 1.4],
        },
      });
      map.addLayer({
        id: "vehicle-ahead-casing",
        type: "line",
        source: "vehicle-ahead",
        filter: ["==", ["get", "kind"], "ahead"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": PALETTE.white, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 5, 17, 10], "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "vehicle-ahead",
        type: "line",
        source: "vehicle-ahead",
        filter: ["==", ["get", "kind"], "ahead"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2.5, 17, 6] },
      });
      map.addLayer({
        id: "vehicle-ahead-arrows",
        type: "symbol",
        source: "vehicle-ahead",
        filter: ["==", ["get", "kind"], "ahead"],
        minzoom: 13,
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 70,
          "icon-image": "route-arrow",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 13, 0.45, 17, 0.7],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });
      map.addLayer({
        id: "vehicle-ahead-stops",
        type: "circle",
        source: "vehicle-ahead",
        filter: ["==", ["get", "kind"], "stop"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3, 17, 6],
          "circle-color": PALETTE.white,
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 17, 2.5],
        },
      });
      map.addLayer({
        id: "vehicle-passed-stops",
        type: "circle",
        source: "vehicle-ahead",
        filter: ["==", ["get", "kind"], "passed"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2, 17, 4],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.35,
          "circle-stroke-color": PALETTE.white,
          "circle-stroke-width": 1.2,
        },
      });
      map.addLayer({
        id: "vehicle-ahead-times",
        type: "symbol",
        source: "vehicle-ahead",
        filter: ["==", ["get", "kind"], "stop"],
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
      map.addLayer({
        id: "stop-routes-casing",
        type: "line",
        source: "stop-routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": PALETTE.white, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 5, 17, 9], "line-opacity": 0.85 },
      });
      map.addLayer({
        id: "stop-routes",
        type: "line",
        source: "stop-routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2.5, 17, 5.5] },
      });
      map.addLayer({
        id: "stop-routes-arrows",
        type: "symbol",
        source: "stop-routes",
        minzoom: 13,
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 70,
          "icon-image": "route-arrow",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 13, 0.45, 17, 0.7],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
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
      // A place: what it is, and directions to it; anywhere else drops a pin as before.
      const hit = map.getLayer("places")
        ? map.queryRenderedFeatures([
            [e.point.x - 6, e.point.y - 6],
            [e.point.x + 6, e.point.y + 6],
          ], { layers: ["places"] })[0]
        : undefined;
      if (hit && hit.geometry.type === "Point") {
        selected.current = null;
        ahead.current = null;
        setFocusRouteRef.current(null);
        if (map.getSource("vehicle-ahead")) source(map, "vehicle-ahead").setData(EMPTY);
        callbacks.current.onClearOverlay?.();
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
      // Clicking the empty map hides the selected stop or bus route (without dropping a pin).
      if (selected.current || callbacks.current.selectedStopId) {
        selected.current = null;
        ahead.current = null;
        setFocusRouteRef.current(null);
        popup.current?.remove();
        if (map.getSource("vehicle-ahead")) source(map, "vehicle-ahead").setData(EMPTY);
        callbacks.current.onClearOverlay?.();
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

  // Live trolleys and buses: a marker for each one in or near view, exactly at its last GPS fix,
  // in its line's color, with an arrow the way it last moved and how long ago the fix was taken.
  // Nothing is estimated in between: a marker moves when a new fix comes.
  const vehicleMarkers = useRef(new Map<string, { marker: Marker; vehicle: LiveVehicle }>());
  /** Bumped when the map stops moving: which vehicles are in view changes. */
  const [viewMoved, setViewMoved] = useState(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const moved = () => setViewMoved((n) => n + 1);
    map.on("moveend", moved);
    return () => {
      map.off("moveend", moved);
    };
  }, [ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const markers = vehicleMarkers.current;
    // In view, with a margin of half the view on each side (so panning a little finds them there).
    const b = map.getBounds();
    const [dx, dy] = [(b.getEast() - b.getWest()) / 2, (b.getNorth() - b.getSouth()) / 2];
    const inView = (v: LiveVehicle) =>
      v.lngLat[0] > b.getWest() - dx && v.lngLat[0] < b.getEast() + dx && v.lngLat[1] > b.getSouth() - dy && v.lngLat[1] < b.getNorth() + dy;
    const all = props.live?.vehicles ?? [];
    const shown = new Map(all.filter((v) => inView(v) || v.id === selected.current).map((v) => [v.id, v]));
    for (const [id, m] of markers) if (!shown.has(id)) (m.marker.remove(), markers.delete(id));
    for (const v of shown.values()) {
      let m = markers.get(v.id);
      if (!m) {
        const el = vehicleElement(v);
        m = { marker: new Marker({ element: el }).setLngLat(v.lngLat).addTo(map), vehicle: v };
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          const { vehicle } = markers.get(v.id)!;
          const same = selected.current === vehicle.id;
          callbacks.current.onClearOverlay?.();
          selected.current = null;
          ahead.current = null;
          setFocusRoute(null);
          popup.current?.remove();
          showAhead(null);
          if (same) return;
          const beside = popupBeside(vehicle.heading);
          const card = new Popup({ closeButton: true, maxWidth: "220px", className: "place-popup vehicle-popup", anchor: beside.anchor, offset: beside.offset })
            .setLngLat(vehicle.lngLat)
            .setDOMContent(vehicleCard(vehicle, null))
            .addTo(map);
          popup.current = card;
          // Follow this vehicle: its route ahead, until its popup closes.
          selected.current = vehicle.id;
          setFocusRoute(vehicle.route);
          card.on("close", () => {
            if (selected.current !== vehicle.id) return;
            selected.current = null;
            setFocusRoute(null);
            showAhead(null);
          });
          void loadAhead(vehicle);
        });
        markers.set(v.id, m);
      } else if (m.vehicle.fixAt !== v.fixAt) {
        m.marker.setLngLat(v.lngLat);
      }
      m.vehicle = v;
      const el = m.marker.getElement();
      el.style.setProperty("--line", v.color);
      el.title = v.mode === "bus" ? `Route ${v.line}` : v.line;
      const heading = v.heading ?? (v.id === selected.current ? ahead.current?.trip.heading : undefined);
      el.classList.toggle("has-heading", heading !== undefined);
      el.dataset.heading = String(heading ?? 0);
    }
    turnArrows();
    showAges();
    // The followed vehicle: to its new fix, with its route ahead from there.
    const followed = selected.current ? all.find((v) => v.id === selected.current) : undefined;
    missing.current = selected.current && !followed ? missing.current + 1 : 0;
    if (selected.current && !followed && missing.current >= MISSING_UPDATES) {
      // Gone for a while (trip over, or out of service): stop following it.
      selected.current = null;
      setFocusRoute(null);
      popup.current?.remove();
      showAhead(null);
    } else if (followed && popup.current) {
      popup.current.setLngLat(followed.lngLat);
      const trip = ahead.current?.vehicle.id === followed.id ? ahead.current.trip : undefined;
      if (trip) placePopupClear(map, popup.current, followed.lngLat, [trip.path, trip.behind], stopLngLats(trip), followed.heading);
      else placePopupBeside(popup.current, followed.heading);
      if (!ahead.current || ahead.current.vehicle.fixAt !== followed.fixAt || ahead.current.vehicle.tripId !== followed.tripId) void loadAhead(followed);
    }
  }, [ready, props.live, viewMoved]);

  // How long ago each fix was taken, counting up every second (on the markers and the open card).
  const showAges = () => {
    const now = Date.now();
    for (const { marker, vehicle } of vehicleMarkers.current.values()) {
      const age = marker.getElement().querySelector(".trolley-age");
      if (age) age.textContent = fixAge(now - vehicle.fixAt, true);
    }
    const open = selected.current ? vehicleMarkers.current.get(selected.current) : undefined;
    const line = popup.current?.getElement()?.querySelector(".vehicle-fix");
    if (open && line) line.textContent = `GPS position from ${fixAge(now - open.vehicle.fixAt)}`;
    if (ahead.current) drawAhead();
  };
  useEffect(() => {
    if (!props.live) return;
    const timer = setInterval(showAges, 1000);
    return () => clearInterval(timer);
  }, [props.live]);

  /** Show (or clear) a vehicle's route ahead, and what its card says about it. */
  const showAhead = (next: { vehicle: LiveVehicle; trip: TripAhead } | null) => {
    ahead.current = next;
    if (next && selected.current === next.vehicle.id) popup.current?.setDOMContent(vehicleCard(next.vehicle, next.trip));
    drawAhead();
  };
  /** The tapped vehicle's whole trip: the trail already run, the path still ahead, and its stops. */
  const drawAhead = () => {
    const map = mapRef.current;
    if (!map) return;
    const a = ahead.current;
    if (!a) return source(map, "vehicle-ahead").setData(EMPTY);
    const clock = Date.now();
    const color = a.vehicle.color;
    source(map, "vehicle-ahead").setData({
      type: "FeatureCollection",
      features: [
        ...(a.trip.behind.length > 1 ? [{ ...lineFeature(a.trip.behind), properties: { color, kind: "behind" } }] : []),
        ...(a.trip.path.length > 1 ? [{ ...lineFeature(a.trip.path), properties: { color, kind: "ahead" } }] : []),
        ...a.trip.passed.map((s) => ({
          type: "Feature" as const,
          properties: { color, name: s.name, kind: "passed" },
          geometry: { type: "Point" as const, coordinates: s.lngLat },
        })),
        ...a.trip.stops.map((s) => {
          const min = Math.round((s.at - clock) / 60_000);
          return {
            type: "Feature" as const,
            properties: {
              color,
              name: s.name,
              kind: "stop",
              when: min <= 0 ? "now" : min < 60 ? `${min} min` : new Date(s.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
            },
            geometry: { type: "Point" as const, coordinates: s.lngLat },
          };
        }),
      ],
    });
    if (popup.current && selected.current === a.vehicle.id) {
      placePopupClear(map, popup.current, a.vehicle.lngLat, [a.trip.path, a.trip.behind], stopLngLats(a.trip), a.vehicle.heading);
    }
  };
  const loadAhead = async (vehicle: LiveVehicle) => {
    if (!vehicle.tripId) return;
    try {
      const trip = await fetchTripAhead(vehicle.tripId, vehicle.lngLat);
      // Still following the same vehicle?
      if (selected.current === vehicle.id) showAhead({ vehicle, trip });
    } catch {
      // Keep whatever's drawn; its next fix tries again.
    }
  };
  // A selected stop takes the overlay: hide any bus/trolley route still drawn.
  useEffect(() => {
    if (!props.selectedStopId || !selected.current) return;
    selected.current = null;
    setFocusRoute(null);
    popup.current?.remove();
    showAhead(null);
  }, [props.selectedStopId]);
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current!;
    if (!map.getSource("stop-routes")) return;
    const routes = props.stopRoutes ?? [];
    source(map, "stop-routes").setData({
      type: "FeatureCollection",
      features: routes
        .filter((r) => r.coordinates.length > 1)
        .map((r) => ({ ...lineFeature(r.coordinates), properties: { color: r.color } })),
    });
  }, [ready, props.stopRoutes]);
  // Arrows point the way on the map: allow for the map being rotated.
  const turnArrows = () => {
    const bearing = mapRef.current?.getBearing() ?? 0;
    for (const { marker } of vehicleMarkers.current.values()) {
      const el = marker.getElement();
      el.style.setProperty("--heading", `${Number(el.dataset.heading) - bearing}deg`);
    }
    mapRef.current?.getContainer().querySelectorAll<HTMLElement>(".stop-mark[data-approach]").forEach((el) => {
      const heading = `${Number(el.dataset.approach) - bearing}deg`;
      el.style.setProperty("--heading", heading);
      el.querySelector<HTMLElement>(".stop-approach")?.style.setProperty("--heading", heading);
    });
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
  const tripMarkers = useRef<Marker[]>([]);
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current!;
    for (const m of tripMarkers.current) m.remove();
    tripMarkers.current = [];
    source(map, "scooter-trip").setData(EMPTY);
    const t = props.scooterTrip;
    if (!t) return;
    const close = haversine(t.scooter[0], t.scooter[1], t.parking.lngLat[0], t.parking.lngLat[1]) < 22;
    const park = document.createElement("button");
    park.type = "button";
    park.className = "spin-park";
    park.textContent = "P";
    park.title = "Park here";
    park.setAttribute("aria-label", "Park the scooter here");
    const parked = new Marker({ element: park, anchor: "center", offset: close ? [22, -16] : [0, 0] }).setLngLat(t.parking.lngLat).addTo(map);
    // The fleet pins already show the scooter. A second icon on the same spot covers the P.
    if (props.spinBikes) {
      tripMarkers.current = [parked];
      return;
    }
    const pickup = spinMarkerElement({
      kind: "scooter",
      lngLat: t.scooter,
      count: 1,
      vehicle: { id: "trip", kind: "scooter", lngLat: t.scooter },
    });
    pickup.title = "Spin scooter";
    tripMarkers.current = [parked, new Marker({ element: pickup, anchor: "center" }).setLngLat(t.scooter).addTo(map)];
  }, [ready, props.scooterTrip, props.spinBikes]);

  // Spin vehicles: ones a few meters apart share one pin (GPS spread), colored by the fullest battery.
  const spinMarkers = useRef(new Map<string, Marker>());
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    source(map, "spin").setData(EMPTY);
    const markers = spinMarkers.current;
    if (!props.spinBikes) {
      for (const m of markers.values()) m.remove();
      markers.clear();
      return;
    }
    const clusters = clusterVehicles(props.spinBikes).filter((c) => {
      const p = map.project(c.lngLat);
      const canvas = map.getCanvas();
      return p.x >= -40 && p.y >= -40 && p.x <= canvas.clientWidth + 40 && p.y <= canvas.clientHeight + 40;
    });
    const keep = new Set(clusters.map((c) => c.vehicle.id));
    for (const [id, m] of markers) if (!keep.has(id)) (m.remove(), markers.delete(id));
    for (const cluster of clusters) {
      markers.get(cluster.vehicle.id)?.remove();
      const el = spinMarkerElement(cluster);
      const away = anchor ? haversine(anchor[0], anchor[1], cluster.lngLat[0], cluster.lngLat[1]) : NaN;
      const pct = cluster.battery !== undefined ? `${Math.round(cluster.battery * 100)}% battery` : "";
      const range = cluster.vehicle.rangeMeters !== undefined ? `about ${(cluster.vehicle.rangeMeters / 1609).toFixed(0)} mi of range` : "";
      const where = Number.isFinite(away) ? `${formatDistance(away)} from ${props.userPos ? "you" : "the map's middle"}` : "";
      const noun = cluster.kind === "ebike" ? "e-bike" : "scooter";
      const name = cluster.count > 1 ? `Best Spin ${noun} here` : cluster.kind === "ebike" ? "Spin e-bike" : "Spin scooter";
      const detail = [cluster.count > 1 ? `${cluster.count - 1} more beside it` : "", pct, range, where].filter(Boolean).join(" · ");
      el.title = name;
      el.setAttribute("aria-label", name);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        selected.current = null;
        ahead.current = null;
        setFocusRoute(null);
        if (map.getSource("vehicle-ahead")) source(map, "vehicle-ahead").setData(EMPTY);
        callbacks.current.onClearOverlay?.();
        popup.current?.remove();
        popup.current = new Popup({ closeButton: true, maxWidth: "240px", className: "place-popup" })
          .setLngLat(cluster.lngLat)
          .setDOMContent(placeCard(name, detail, "", () => {
            popup.current?.remove();
            callbacks.current.onPlaceDirections({ lngLat: cluster.vehicle.lngLat, name });
          }))
          .addTo(map);
      });
      markers.set(cluster.vehicle.id, new Marker({ element: el, anchor: "center" }).setLngLat(cluster.lngLat).addTo(map));
    }
  }, [ready, props.spinBikes, anchor?.[0], anchor?.[1], props.userPos, viewMoved]);

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

  const stopLogos = useRef(new Map<string, Marker>());
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const markers = stopLogos.current;
    const onThisRoute = (s: { lines: LineBadge[]; onRoute?: boolean }) =>
      !!s.onRoute || (!!focusRoute && s.lines.some((l) => l.short === focusRoute));
    const pool = (props.logoStops ?? []).filter((s) => props.showTransitStops || onThisRoute(s));
    const shown = stopsInView(map, pool);
    const keep = new Set(shown.map((s) => s.stop.id));
    for (const [id, m] of markers) if (!keep.has(id)) (m.remove(), markers.delete(id));
    const zoom = map.getZoom();
    const size = zoom < 15 ? 18 : zoom < 16.5 ? 22 : 26;
    const arrow = zoom >= 14.5;
    // Line names beside every stop once zoomed in close enough for them to fit.
    const labels = zoom >= 16;
    // Selected stop last so it and its chips paint above anything stacked on the same point.
    const ordered = [...shown].sort((a, b) => (a.stop.id === props.selectedStopId ? 1 : b.stop.id === props.selectedStopId ? -1 : 0));
    for (const s of ordered) {
      markers.get(s.stop.id)?.remove();
      const approach = arrow || s.stop.id === props.selectedStopId ? s.approach : undefined;
      const el = stopBadgeElement(s.lines, s.stop.id === props.selectedStopId, approach, size, labels);
      if (s.approach !== undefined) {
        const heading = `${s.approach - map.getBearing()}deg`;
        el.style.setProperty("--heading", heading);
        el.querySelector<HTMLElement>(".stop-approach")?.style.setProperty("--heading", heading);
      }
      el.title = s.stop.name;
      el.setAttribute("aria-label", s.stop.name);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        setFocusRoute(null);
        callbacks.current.onStopClick?.(s.stop);
      });
      markers.set(s.stop.id, new Marker({ element: el, anchor: "center" }).setLngLat(s.stop.lngLat).addTo(map));
    }
    return () => {
      for (const m of markers.values()) m.remove();
      markers.clear();
    };
  }, [ready, props.logoStops, props.showTransitStops, props.selectedStopId, focusRoute, viewMoved]);

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
 * From UCSD's campus vector style: district and neighborhood names, as on the
 * official ArcGIS campus map (fonts swapped for ones the base map's font
 * server has; names shown a little longer).
 */
const UCSD_LAYERS = [
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
 * gray buildings, clay for the track.
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
    id: "ucsd-construction",
    type: "fill",
    source: "ucsd",
    "source-layer": "Construction Buildings",
    layout: { visibility: "none" },
    paint: { "fill-color": "#e6dfc6" },
  },
];

/**
 * Puts the bus card beside the route and a little behind the bus, so the card grows away from the
 * line instead of sitting on top of it. The anchor is the card's near corner.
 */
function popupBeside(heading?: number): { anchor: "top-left" | "top-right" | "bottom-left" | "bottom-right"; offset: [number, number] } {
  const clear = 46;
  if (heading === undefined || !Number.isFinite(heading)) return { anchor: "bottom-left", offset: [clear, -clear] };
  const rad = ((((heading % 360) + 360) % 360) * Math.PI) / 180;
  // Right of the direction of travel, plus a nudge back along the trail (screen x right, y down).
  let x = Math.cos(rad) - Math.sin(rad) * 0.55;
  let y = Math.sin(rad) + Math.cos(rad) * 0.55;
  const len = Math.hypot(x, y) || 1;
  x /= len;
  y /= len;
  const anchor = x >= 0 ? (y >= 0 ? "top-left" : "bottom-left") : y >= 0 ? "top-right" : "bottom-right";
  return { anchor, offset: [Math.round(x * clear), Math.round(y * clear)] };
}

function placePopupBeside(popup: Popup, heading?: number) {
  const beside = popupBeside(heading);
  popup.options.anchor = beside.anchor;
  popup.setOffset(beside.offset);
}

function stopLngLats(trip: TripAhead): LngLat[] {
  return [...trip.stops.map((s) => s.lngLat), ...trip.passed.map((s) => s.lngLat)];
}

/**
 * Slides the open bus card to whichever side of the vehicle the route does not run through.
 * Keeps the current side when several sides are equally clear, so the card does not hop.
 */
function placePopupClear(map: MlMap, popup: Popup, lngLat: LngLat, paths: LngLat[][], points: LngLat[], heading?: number) {
  const el = popup.getElement();
  const w = el?.offsetWidth || 220;
  const h = el?.offsetHeight || 110;
  const origin = map.project(lngLat);
  const gap = 28;
  const candidates: { anchor: NonNullable<Popup["options"]["anchor"]>; offset: [number, number]; left: number; top: number }[] = [
    { anchor: "top-left", offset: [gap, gap], left: origin.x + gap, top: origin.y + gap },
    { anchor: "top-right", offset: [-gap, gap], left: origin.x - gap - w, top: origin.y + gap },
    { anchor: "bottom-left", offset: [gap, -gap], left: origin.x + gap, top: origin.y - gap - h },
    { anchor: "bottom-right", offset: [-gap, -gap], left: origin.x - gap - w, top: origin.y - gap - h },
    { anchor: "left", offset: [gap, 0], left: origin.x + gap, top: origin.y - h / 2 },
    { anchor: "right", offset: [-gap, 0], left: origin.x - gap - w, top: origin.y - h / 2 },
    { anchor: "top", offset: [0, gap], left: origin.x - w / 2, top: origin.y + gap },
    { anchor: "bottom", offset: [0, -gap], left: origin.x - w / 2, top: origin.y - gap - h },
  ];
  const screen: { x: number; y: number }[] = [];
  const addPoint = (lngLat: LngLat) => {
    const p = map.project(lngLat);
    screen.push(p);
  };
  for (const path of paths) {
    for (let i = 0; i < path.length; i++) {
      addPoint(path[i]);
      if (i === 0) continue;
      const prev = map.project(path[i - 1]);
      const here = screen[screen.length - 1];
      const dist = Math.hypot(here.x - prev.x, here.y - prev.y);
      const steps = Math.min(6, Math.floor(dist / 28));
      for (let s = 1; s <= steps; s++) {
        const t = s / (steps + 1);
        screen.push({ x: prev.x + (here.x - prev.x) * t, y: prev.y + (here.y - prev.y) * t });
      }
    }
  }
  for (const p of points) addPoint(p);
  const hits = (left: number, top: number) => {
    const right = left + w;
    const bottom = top + h;
    let n = 0;
    for (const p of screen) if (p.x >= left - 4 && p.x <= right + 4 && p.y >= top - 4 && p.y <= bottom + 4) n++;
    return n;
  };
  const preferred = popupBeside(heading).anchor;
  let best = candidates.find((c) => c.anchor === popup.options.anchor) ?? candidates.find((c) => c.anchor === preferred) ?? candidates[0];
  let bestHits = hits(best.left, best.top);
  for (const c of candidates) {
    const n = hits(c.left, c.top);
    if (n < bestHits) {
      best = c;
      bestHits = n;
    }
  }
  popup.options.anchor = best.anchor;
  popup.setOffset(best.offset);
}

/** Every stop logo inside the view, at any zoom. A later pass slides ones that overlap out to the side. */
function stopsInView<T extends { stop: TransitStop }>(map: MlMap, stops: T[]): T[] {
  const canvas = map.getCanvas();
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const margin = 64;
  return stops.filter((s) => {
    const p = map.project(s.stop.lngLat);
    return p.x >= -margin && p.y >= -margin && p.x <= w + margin && p.y <= h + margin;
  });
}

/**
 * A trolley or bus on the map: a badge in its line's color (a trolley drawn as one, a bus with its
 * route number), with an arrow for its heading and how long ago its position was taken.
 */
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

/** A Spin scooter (or e-bike) colored by battery, with a count when several share the pin. */
function spinMarkerElement(cluster: VehicleCluster): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "spin-pin";
  const color = batteryColor(cluster.battery);
  const count = cluster.count > 1 ? `<span class="spin-count">${cluster.count}</span>` : "";
  const body = cluster.kind === "scooter" ? scooterSvg(color) : bikeSvg(color);
  el.innerHTML = `${body}${count}`;
  return el;
}

function scooterSvg(color: string): string {
  return `<svg class="spin-glyph" viewBox="0 0 36 22" width="32" height="20" aria-hidden="true">
    <circle cx="8" cy="17" r="3.4" fill="#1c1c1c" stroke="#fff" stroke-width="1.1"/>
    <circle cx="28" cy="17" r="3.4" fill="#1c1c1c" stroke="#fff" stroke-width="1.1"/>
    <path d="M10 16h10l5-9h6" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M20 7h6" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="12" y="13.2" width="9" height="2.4" rx="1" fill="${color}"/>
  </svg>`;
}

function bikeSvg(color: string): string {
  return `<svg class="spin-glyph" viewBox="0 0 36 22" width="32" height="20" aria-hidden="true">
    <circle cx="8" cy="16" r="4.2" fill="none" stroke="${color}" stroke-width="1.8"/>
    <circle cx="28" cy="16" r="4.2" fill="none" stroke="${color}" stroke-width="1.8"/>
    <path d="M8 16 L16 7 H22 L28 16 M16 7 L13 16 H20" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

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
    const label = escapeXml(v.route);
    const font = label.length > 2 ? 8 : 10;
    badge.innerHTML = `<svg width="44" height="30" viewBox="0 0 44 30" aria-hidden="true">
      <rect x="1.5" y="3" width="41" height="18" rx="5" fill="currentColor"/>
      <rect x="4" y="6" width="10" height="6" rx="1.2" fill="#fff"/>
      <rect x="16.5" y="6" width="7" height="6" rx="1.2" fill="#fff" opacity="0.9"/>
      <rect x="25.5" y="6" width="7" height="6" rx="1.2" fill="#fff" opacity="0.9"/>
      <rect x="34.5" y="6" width="5" height="6" rx="1.2" fill="#fff" opacity="0.75"/>
      <text x="22" y="17.5" text-anchor="middle" fill="#fff" font-size="${font}" font-weight="800" font-family="ui-sans-serif, system-ui, sans-serif">${label}</text>
      <circle cx="12" cy="23.5" r="3.1" fill="#1c1c1c" stroke="#fff" stroke-width="1.2"/>
      <circle cx="32" cy="23.5" r="3.1" fill="#1c1c1c" stroke="#fff" stroke-width="1.2"/>
    </svg>`;
  }
  const age = document.createElement("span");
  age.className = "trolley-age";
  el.append(arrow, badge, age);
  return el;
}

/** "38 s ago", "3 min ago" (short: "38s", "3m"). */
function fixAge(ms: number, short = false): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (short) return s < 90 ? `${s}s` : `${Math.round(s / 60)}m`;
  return s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

/** What a tapped trolley or bus says: its line, the way it's going, its next stop, and how old its position is. */
function vehicleCard(v: LiveVehicle, trip: TripAhead | null): HTMLElement {
  const el = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = `${v.mode === "bus" ? `Route ${v.line}` : v.line}${trip?.headsign ? ` to ${trip.headsign}` : ""}`;
  const fix = document.createElement("span");
  fix.className = "place-popup-meta vehicle-fix";
  fix.textContent = `GPS position from ${fixAge(Date.now() - v.fixAt)}`;
  el.append(title, fix);
  if (trip?.headsign) {
    const dir = document.createElement("span");
    dir.className = "place-popup-meta";
    dir.textContent = `Going toward ${trip.headsign}`;
    el.append(dir);
  }
  const next = trip?.stops[0];
  if (next) {
    const meta = document.createElement("span");
    meta.className = "place-popup-meta";
    const min = Math.round((next.at - Date.now()) / 60_000);
    meta.textContent = `Next stop: ${next.name}, ${formatLead(min)} (MTS's estimate)`;
    el.append(meta);
  }
  return el;
}

/** A small white chevron for arrows along a tapped vehicle's route (points along the line). */
function routeArrowImage(): ImageData {
  const size = 16;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(size / 2, size / 2);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-5, -4.5);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-5, 4.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
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

