import { CampusGraph, CampusSearch, TransitNetwork, type Building, type GraphData, type PlacesData, type TransitData } from "@campus/core";

/** Everything the map and the search box need. Loaded once at startup. */
export class Campus {
  readonly graph: CampusGraph;
  readonly transit: TransitNetwork;
  readonly search: CampusSearch;

  private constructor(graph: CampusGraph, transit: TransitNetwork, buildings: Building[], places: PlacesData) {
    this.graph = graph;
    this.transit = transit;
    this.search = new CampusSearch({ buildings, places: places.places });
  }

  static async load(): Promise<Campus> {
    const [graph, buildings, transit, places] = await Promise.all([
      getJson<GraphData>("/data/graph.json"),
      getJson<Building[]>("/data/buildings.json"),
      getJson<TransitData>("/data/transit.json"),
      getJson<PlacesData>("/data/places.json").catch(() => ({ places: [], tips: {} })),
    ]);
    const campusGraph = new CampusGraph(graph);
    return new Campus(campusGraph, new TransitNetwork(transit, campusGraph), buildings, places);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} failed (${res.status})`);
  return res.json() as Promise<T>;
}
