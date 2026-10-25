import type {
  Building,
  CampusGraph,
  CampusMapPoints,
  CampusSearch,
  IndoorData,
  SectionsData,
  TransitNetwork,
} from "@campus/core";
import type { ScrapedMenus } from "./menus.ts";

/** The campus data the chat needs. Each app passes its own (the simple app's Campus, the full app's CampusData). */
export interface ChatCampus {
  graph: CampusGraph;
  transit: TransitNetwork;
  /** Buildings, rooms, places and courses. */
  search: CampusSearch;
  /** This term's course sections; null when the (private) schedule file isn't there. */
  sections: SectionsData | null;
  /** Schedule building code ("WLH", "CENTR") -> map building. */
  buildingByCode: Map<string, Building>;
  /** Rooms mapped indoors, by building id. */
  indoor: IndoorData;
  /** Every point on UCSD's campus map: restrooms, water, food, printers, chargers… */
  mapPoints: CampusMapPoints | null;
  /** Scraped HDH menus, when this app has them. Read when a food question is asked. */
  menus?: ScrapedMenus | null;
}

/** Knobs each app sets. */
export interface ChatSettings {
  /** "auto": Chrome's built-in model, else Gemma through Ollama, else simple patterns. "off": patterns only. */
  gemma: "auto" | "off";
  /** The Ollama model to use; any "gemma…" model Ollama has works too. */
  ollamaModel: string;
  /** Aim to reach class this many minutes before it starts. */
  arriveEarlyMin: number;
}
