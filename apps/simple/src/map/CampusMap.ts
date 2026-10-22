import { EdgeKind, type CampusGraph, type LiveVehicle, type LngLat, type TransitNetwork } from "@campus/core";
import { Map as MlMap, NavigationControl, type GeoJSONSource } from "maplibre-gl";
import { settings } from "../settings.ts";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const PATH_COLOR: Record<number, string> = {
  [EdgeKind.Path]: "#2F5A2E",
  [EdgeKind.Steps]: "#9C7058",
  [EdgeKind.Bike]: "#1F6B4A",
  [EdgeKind.Custom]: "#2F5A2E",
  [EdgeKind.Road]: "#6E675C",
  [EdgeKind.BikeOnly]: "#1F6B4A",
  [EdgeKind.Shared]: "#3D8F62",
  [EdgeKind.Sidewalk]: "#5D8A35",
  [EdgeKind.Gap]: "#8AAF6A",
  [EdgeKind.Lot]: "#8A8478",
};

export interface MapClicks {
  onStop: (stopId: string) => void;
  onVehicle: (vehicle: LiveVehicle) => void;
}

/**
 * Owns the map. The rest of the app never talks to MapLibre directly.
 * Call the set* methods when data changes. Click handlers are the only events that leave.
 */
export class CampusMap {
  private readonly map: MlMap;
  private ready: Promise<void>;
  private vehicles: LiveVehicle[] = [];

  constructor(container: HTMLElement, clicks: MapClicks) {
    this.map = new MlMap({
      container,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: settings.center,
      zoom: settings.zoom,
    });
    this.map.addControl(new NavigationControl(), "top-right");
    this.ready = new Promise((resolve) => this.map.on("load", () => {
      this.addLayers();
      resolve();
    }));
    this.map.on("click", (event) => {
      const stop = this.map.queryRenderedFeatures(event.point, { layers: ["stops"] })[0];
      if (stop?.properties?.id) {
        clicks.onStop(String(stop.properties.id));
        return;
      }
      const dot = this.map.queryRenderedFeatures(event.point, { layers: ["vehicles"] })[0];
      const vehicle = dot ? this.vehicles.find((v) => v.id === dot.properties?.id) : undefined;
      if (vehicle) clicks.onVehicle(vehicle);
    });
  }

  async showNetwork(graph: CampusGraph): Promise<void> {
    await this.ready;
    const groups = new Map<number, LngLat[][]>();
    for (let edge = 0; edge < graph.edgeCount; edge++) {
      const kind = graph.edgeKind[edge];
      const line: LngLat[] = [
        [graph.lon[graph.edgeFrom[edge]], graph.lat[graph.edgeFrom[edge]]],
        [graph.lon[graph.edgeTo[edge]], graph.lat[graph.edgeTo[edge]]],
      ];
      const list = groups.get(kind) ?? [];
      list.push(line);
      groups.set(kind, list);
    }
    this.source("network").setData({
      type: "FeatureCollection",
      features: [...groups].map(([kind, coordinates]) => ({
        type: "Feature",
        properties: { color: PATH_COLOR[kind] ?? "#2F5A2E" },
        geometry: { type: "MultiLineString", coordinates },
      })),
    });
  }

  async showTransit(transit: TransitNetwork): Promise<void> {
    await this.ready;
    const { routes, patterns, stops } = transit.data;
    this.source("lines").setData({
      type: "FeatureCollection",
      features: patterns.flatMap((pattern) =>
        pattern.shape.length > 1
          ? [{
              type: "Feature" as const,
              properties: { color: routes[pattern.route]?.color ?? "#4A6497" },
              geometry: { type: "LineString" as const, coordinates: pattern.shape },
            }]
          : [],
      ),
    });
    this.source("stops").setData({
      type: "FeatureCollection",
      features: stops.map((stop) => ({
        type: "Feature" as const,
        properties: { id: stop.id, name: stop.name },
        geometry: { type: "Point" as const, coordinates: stop.lngLat },
      })),
    });
  }

  async showVehicles(vehicles: LiveVehicle[]): Promise<void> {
    await this.ready;
    this.vehicles = vehicles;
    this.source("vehicles").setData({
      type: "FeatureCollection",
      features: vehicles.map((v) => ({
        type: "Feature" as const,
        properties: { id: v.id, label: v.route, color: v.color },
        geometry: { type: "Point" as const, coordinates: v.lngLat },
      })),
    });
  }

  /** The line the user asked to see (a stop's routes, or the route they are planning). */
  async showHighlight(lines: { color: string; coordinates: LngLat[] }[]): Promise<void> {
    await this.ready;
    this.source("highlight").setData({
      type: "FeatureCollection",
      features: lines.filter((l) => l.coordinates.length > 1).map((l) => ({
        type: "Feature" as const,
        properties: { color: l.color },
        geometry: { type: "LineString" as const, coordinates: l.coordinates },
      })),
    });
  }

  async showTrip(coordinates: LngLat[]): Promise<void> {
    await this.ready;
    this.source("trip").setData(
      coordinates.length > 1
        ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }] }
        : EMPTY,
    );
  }

  focus(at: LngLat): void {
    this.map.flyTo({ center: at, zoom: Math.max(this.map.getZoom(), 16) });
  }

  private source(id: string): GeoJSONSource {
    return this.map.getSource(id) as GeoJSONSource;
  }

  private addLayers(): void {
    for (const id of ["network", "lines", "highlight", "trip", "stops", "vehicles"]) {
      this.map.addSource(id, { type: "geojson", data: EMPTY });
    }
    this.map.addLayer({
      id: "network",
      type: "line",
      source: "network",
      paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.85 },
    });
    this.map.addLayer({
      id: "lines",
      type: "line",
      source: "lines",
      paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.75 },
    });
    this.map.addLayer({
      id: "highlight",
      type: "line",
      source: "highlight",
      paint: { "line-color": ["get", "color"], "line-width": 6 },
    });
    this.map.addLayer({
      id: "trip",
      type: "line",
      source: "trip",
      paint: { "line-color": "#17301b", "line-width": 5 },
    });
    this.map.addLayer({
      id: "stops",
      type: "circle",
      source: "stops",
      paint: { "circle-radius": 5, "circle-color": "#fff", "circle-stroke-color": "#17301b", "circle-stroke-width": 2 },
    });
    this.map.addLayer({
      id: "vehicles",
      type: "circle",
      source: "vehicles",
      paint: { "circle-radius": 8, "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
    });
    this.map.addLayer({
      id: "vehicle-labels",
      type: "symbol",
      source: "vehicles",
      layout: { "text-field": ["get", "label"], "text-size": 11, "text-font": ["Noto Sans Regular"] },
      paint: { "text-color": "#fff" },
    });
  }
}
