import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { campusMapPlaces, OFFICIAL_FOOD, type CampusMapPoints } from "./campusPlaces.ts";
import { CampusSearch } from "./campusSearch.ts";
import type { Building } from "./types.ts";

const data = (name: string) => JSON.parse(readFileSync(new URL(`../../../apps/web/public/data/${name}`, import.meta.url), "utf8"));
const campusMap = data("campus-places.json") as CampusMapPoints;
const buildings = data("buildings.json") as Building[];
const places = campusMapPlaces(campusMap);
const search = new CampusSearch({ buildings, places });

/** The top search result's name and other names. */
const top = (query: string) => {
  const hit = search.search(query, { limit: 1 })[0];
  return hit?.kind === "place" ? [hit.place.name, ...hit.place.aliases] : hit?.kind === "building" ? [hit.building.name] : [];
};
const same = (a: string, b: string) => a.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase() === b.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

describe("campusMapPlaces", () => {
  it("places every official food place at a point on the campus map", () => {
    const names = new Set(campusMap.points.map((p) => p[3]));
    expect(OFFICIAL_FOOD.filter((f) => !names.has(f.near)).map((f) => f.near)).toEqual([]);
  });

  it("finds every campus food place by its official name, first", () => {
    const missed = OFFICIAL_FOOD.filter((f) => !top(f.name).some((n) => same(n, f.name))).map((f) => `${f.name} -> ${top(f.name)[0]}`);
    expect(missed).toEqual([]);
  });

  it("finds a station inside a dining hall, and puts it at the hall", () => {
    const slice = places.find((p) => p.name === "Slice at Pines")!;
    const pines = places.find((p) => p.name === "Pines")!;
    expect(slice.points).toEqual([pines.points[0]]);
    expect(top("Breeze")[0]).toBe("Breeze at Pines");
  });

  it("keeps one result for a place under two names", () => {
    expect(places.filter((p) => /^jamba/i.test(p.name)).map((p) => p.name)).toEqual(["Jamba Juice"]);
    expect(places.find((p) => p.name === "Roger's Place and Market")!.aliases).toContain("Rogers Market");
  });

  it("makes same-named points one place, routed to the nearest", () => {
    expect(places.filter((p) => p.name === "Basketball Court")).toHaveLength(1);
    expect(places.find((p) => p.name === "Basketball Court")!.points.length).toBeGreaterThan(1);
  });

  it("finds courts and pools", () => {
    expect(top("tennis")[0]).toMatch(/tennis/i);
    expect(search.search("pool", { limit: 3 }).map((h) => (h.kind === "place" ? h.place.name : ""))).toContain("Canyonview Aquatic Center");
  });
});
