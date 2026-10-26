import { diningPin } from "@campus/core";
import { describe, expect, it } from "vitest";
import { carryOver, cleanIntent, needsModel, parseLocally } from "./intent.ts";
import { budgetOf, foodKind, recommend, resolveHall, type ScrapedMenus } from "./menus.ts";

const menus: ScrapedMenus = {
  days: [{ date: "2026-10-25" }],
  halls: [
    {
      name: "64 Degrees",
      stations: [
        { name: "Taqueria", hours: [{ day: "SUN", open: "9:00 AM", close: "9:00 PM" }] },
        { name: "Al Dente", hours: [{ day: "SUN", open: "12:00 PM", close: "9:00 PM" }] },
      ],
    },
    {
      name: "Pines",
      stations: [
        { name: "Pines", hours: [{ day: "SUN", open: "10:00 AM", close: "11:00 PM" }] },
        { name: "Slice at Pines", hours: [{ day: "SUN", open: "10:00 AM", close: "11:00 PM" }] },
      ],
    },
  ],
  items: [
    { date: "2026-10-25", hall: "64 Degrees", station: "Taqueria", meal: "Dinner", category: "Burritos", name: "Carne Asada Burrito", price: 11.5 },
    { date: "2026-10-25", hall: "64 Degrees", station: "Taqueria", meal: "Dinner", category: "Burritos", name: "Beans and Cheese Burrito", price: 7.5 },
    { date: "2026-10-25", hall: "64 Degrees", station: "Taqueria", meal: "Dinner", category: "Bowls", name: "Birria Bowl", price: 10 },
    { date: "2026-10-25", hall: "64 Degrees", station: "Al Dente", meal: "Dinner", category: "Bowls", name: "Spaghetti Fra Diavolo", price: 9.75 },
    { date: "2026-10-25", hall: "Pines", station: "Pines", meal: "Dinner", category: "Entrees", name: "Salmon Bowl", price: 13 },
    { date: "2026-10-25", hall: "Pines", station: "Pines", meal: "Dinner", category: "Sides", name: "Pico de Gallo", price: null },
    { date: "2026-10-25", hall: "Pines", station: "Slice at Pines", meal: "Dinner", category: "Sauces", name: "Buttermilk Ranch", price: 0.5 },
    { date: "2026-10-25", hall: "Pines", station: "Slice at Pines", meal: "Dinner", category: "Pizza Slices", name: "Pepperoni Pizza Slice", price: 3.5 },
  ],
};

const sundayEvening = new Date(2026, 9, 25, 16, 30);

describe("budget and hall words", () => {
  it("reads a price range and the hall", () => {
    expect(budgetOf("under 10 $")).toEqual({ max: 10 });
    expect(budgetOf("under ten dollars")).toEqual({ max: 10 });
    expect(budgetOf("cheapest burrito")).toEqual({ max: 10 });
    expect(budgetOf("i've only got seven bucks")).toEqual({ max: 7 });
    expect(budgetOf("what's good under $10")).toEqual({ max: 10 });
    expect(budgetOf("between $5 and $12")).toEqual({ min: 5, max: 12 });
    expect(resolveHall("burrito at 64 degrees")).toBe("64 Degrees");
    expect(resolveHall("from Warren Lecture Hall")).toBeUndefined();
    expect(resolveHall("at the strand")).toBe("Bistro");
    expect(diningPin(resolveHall("bistro")!)).toBe("The Bistro at the Strand");
    expect(resolveHall("sixth")).toBe("Restaurants at Sixth College");
    expect(diningPin("Restaurants at Sixth College")).toBe("Crave");
  });

  it("turns a budget question into an order", () => {
    const intent = parseLocally("burrito at 64 degrees under 12", () => false);
    expect(intent.action).toBe("order");
    expect(intent.place).toBe("64 Degrees");
    expect(intent.item).toBe("burrito");
    expect(intent.maxPrice).toBe(12);
    expect(intent.maxInclusive).toBe(false);
    expect(intent.quantity).toBeUndefined();
  });

  it("reads a messy trip with a budget as food along the route, not a dish name", () => {
    const intent = parseLocally("im goign to mur from pepper canyon, anything I can get near this rout that's under 10 $?", () => false);
    expect(intent.action).toBe("order");
    expect(intent.from).toBe("pepper canyon");
    expect(intent.to).toBe("muir");
    expect(intent.along).toBe(true);
    expect(intent.maxPrice).toBe(10);
    expect(intent.maxInclusive).toBe(false);
    expect(intent.item).toBeUndefined();
    expect(intent.place).toBeUndefined();
  });

  it("answers a messy food trip without the model, and keeps a tweak on that trip", () => {
    const message = "im goign to mur from pepper canyon, anything I can get near this rout that's under 10 $?";
    const intent = parseLocally(message, () => false);
    expect(needsModel(message, intent)).toBe(false);
    expect(needsModel("take me to geisel", parseLocally("take me to geisel", () => false))).toBe(false);
    expect(needsModel("hey", parseLocally("hey", () => false))).toBe(false);
    const puzzling = "could you figure out whether the night shuttle still runs past the gliderport after the last final ends";
    expect(needsModel(puzzling, parseLocally(puzzling, () => false))).toBe(true);
    const broke = "I'm starving, heading toward sixth from the price center, and I've only got seven bucks";
    const along = parseLocally(broke, () => false);
    expect(along.action).toBe("order");
    expect(along.from).toBe("price center");
    expect(along.to).toBe("sixth");
    expect(along.along).toBe(true);
    expect(along.maxPrice).toBe(7);
    expect(along.place).toBeUndefined();
    expect(needsModel(broke, along)).toBe(false);
    expect(parseLocally("take me to the price center", () => false).action).toBe("route");
    const cheaper = carryOver(parseLocally("make it under $8", () => false), intent, "make it under $8");
    expect(cheaper.action).toBe("order");
    expect(cheaper.to).toBe("muir");
    expect(cheaper.along).toBe(true);
    expect(cheaper.maxPrice).toBe(8);
    const bike = carryOver(parseLocally("by bike instead", () => false), intent, "by bike instead");
    expect(bike.action).toBe("order");
    expect(bike.mode).toBe("bike");
    expect(bike.maxPrice).toBe(10);
    expect(parseLocally("make it under $8", () => false).item).toBeUndefined();
  });

  it("drops a budget the model tried to remember", () => {
    const intent = cleanIntent({ action: "order", maxPrice: 10, along: true, to: "Muir", remember: ["maxPrice: 10", "Usually bikes"] });
    expect(intent?.remember).toEqual(["Usually bikes"]);
  });
});

describe("recommend", () => {
  it("keeps open dishes inside the budget and skips unpriced toppings", () => {
    const picks = recommend(menus, { maxPrice: 10, maxInclusive: false, now: sundayEvening });
    expect(picks.map((p) => p.name)).toEqual(["Spaghetti Fra Diavolo", "Beans and Cheese Burrito", "Pepperoni Pizza Slice"]);
    expect(picks.every((p) => p.open)).toBe(true);
    expect(picks.find((p) => p.name.includes("Burrito"))?.hours).toBe("9:00 AM – 9:00 PM");
  });

  it("filters a named dish at one hall", () => {
    const picks = recommend(menus, { hall: "64 Degrees", item: "burrito", maxPrice: 12, now: sundayEvening });
    expect(picks.map((p) => p.name)).toEqual(["Carne Asada Burrito", "Beans and Cheese Burrito"]);
  });

  it("skips ranch and other add-ons unless that dish was named", () => {
    expect(foodKind("Sauces")).toBe("addon");
    expect(foodKind("Burritos")).toBe("meal");
    const open = recommend(menus, { now: sundayEvening });
    expect(open.map((p) => p.name)).toContain("Pepperoni Pizza Slice");
    expect(open.map((p) => p.name)).not.toContain("Buttermilk Ranch");
    const named = recommend(menus, { item: "ranch", now: sundayEvening });
    expect(named.map((p) => p.name)).toEqual(["Buttermilk Ranch"]);
  });
});
