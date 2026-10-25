import {
  campusMapPlaces,
  CampusGraph,
  CampusSearch,
  TransitNetwork,
  type Building,
  type CampusMapPoints,
  type GraphData,
  type Place,
  type PlacesData,
  type TransitData,
} from "@campus/core";

/** Everything the map and the search box need. Loaded once at startup. */
export class Campus {
  readonly graph: CampusGraph;
  readonly transit: TransitNetwork;
  readonly search: CampusSearch;

  private constructor(graph: CampusGraph, transit: TransitNetwork, buildings: Building[], places: Place[]) {
    this.graph = graph;
    this.transit = transit;
    this.search = new CampusSearch({ buildings, places });
  }

  static async load(): Promise<Campus> {
    const [graph, buildings, transit, places, campusMap] = await Promise.all([
      getJson<GraphData>("/data/graph.json"),
      getJson<Building[]>("/data/buildings.json"),
      getJson<TransitData>("/data/transit.json"),
      getJson<PlacesData>("/data/places.json").catch(() => ({ places: [], tips: {} })),
      getJson<CampusMapPoints>("/data/campus-places.json").catch(() => null),
    ]);
    const campusGraph = new CampusGraph(graph);
    // Student place names and stops, then food, courts and pools from the campus map and dining lists.
    return new Campus(campusGraph, new TransitNetwork(transit, campusGraph), buildings, [...places.places, ...campusMapPlaces(campusMap)]);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} failed (${res.status})`);
  return res.json() as Promise<T>;
}
