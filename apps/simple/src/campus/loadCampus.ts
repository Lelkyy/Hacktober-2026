import {
  campusMapPlaces,
  CampusGraph,
  CampusSearch,
  TransitNetwork,
  type Building,
  type CampusMapPoints,
  type GraphData,
  type IndoorData,
  type Place,
  type PlacesData,
  type SectionsData,
  type TransitData,
} from "@campus/core";

/** Everything the map and the chat need. Loaded once at startup. */
export class Campus {
  readonly graph: CampusGraph;
  readonly transit: TransitNetwork;
  readonly search: CampusSearch;
  /** This term's course sections; null when the (private) schedule file isn't there. */
  readonly sections: SectionsData | null;
  /** Schedule building code ("WLH", "CENTR") -> map building. */
  readonly buildingByCode: Map<string, Building>;
  /** Rooms mapped indoors, by building id (floors, for "it's on the 2nd floor"). */
  readonly indoor: IndoorData;
  /** Every point on UCSD's campus map: restrooms, water, food, printers, chargers… */
  readonly mapPoints: CampusMapPoints | null;

  private constructor(
    graph: CampusGraph,
    transit: TransitNetwork,
    buildings: Building[],
    places: Place[],
    sections: SectionsData | null,
    indoor: IndoorData,
    mapPoints: CampusMapPoints | null,
  ) {
    this.graph = graph;
    this.transit = transit;
    this.sections = sections;
    this.indoor = indoor;
    this.mapPoints = mapPoints;
    this.buildingByCode = new Map();
    // First one wins, as in search.
    for (const b of buildings) {
      for (const a of b.aliases) if (/^[A-Z0-9-]{2,6}$/.test(a) && !this.buildingByCode.has(a)) this.buildingByCode.set(a, b);
    }
    this.search = new CampusSearch({ buildings, places, courses: sections?.courses });
  }

  static async load(): Promise<Campus> {
    const [graph, buildings, transit, places, campusMap, sections, indoor] = await Promise.all([
      getJson<GraphData>("/data/graph.json"),
      getJson<Building[]>("/data/buildings.json"),
      getJson<TransitData>("/data/transit.json"),
      getJson<PlacesData>("/data/places.json").catch(() => ({ places: [], tips: {} })),
      getJson<CampusMapPoints>("/data/campus-places.json").catch(() => null),
      getJson<SectionsData>("/data/sections.json").catch(() => null),
      getJson<IndoorData>("/data/indoor.json").catch(() => ({})),
    ]);
    const campusGraph = new CampusGraph(graph);
    // Student place names and stops, then food, courts and pools from the campus map and dining lists.
    return new Campus(
      campusGraph,
      new TransitNetwork(transit, campusGraph),
      buildings,
      [...places.places, ...campusMapPlaces(campusMap)],
      sections,
      indoor,
      campusMap,
    );
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} failed (${res.status})`);
  return res.json() as Promise<T>;
}
