import { describe, expect, it } from "vitest";
import { parseLocally } from "./intent.ts";
import { budgetOf, recommend, resolveHall, type ScrapedMenus } from "./menus.ts";

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
      stations: [{ name: "Pines", hours: [{ day: "SUN", open: "10:00 AM", close: "11:00 PM" }] }],
    },
  ],
  items: [
    { date: "2026-10-25", hall: "64 Degrees", station: "Taqueria", meal: "Dinner", category: "Burritos", name: "Carne Asada Burrito", price: 11.5 },
    { date: "2026-10-25", hall: "64 Degrees", station: "Taqueria", meal: "Dinner", category: "Burritos", name: "Beans and Cheese Burrito", price: 7.5 },
    { date: "2026-10-25", hall: "64 Degrees", station: "Taqueria", meal: "Dinner", category: "Bowls", name: "Birria Bowl", price: 10 },
    { date: "2026-10-25", hall: "64 Degrees", station: "Al Dente", meal: "Dinner", category: "Bowls", name: "Spaghetti Fra Diavolo", price: 9.75 },
    { date: "2026-10-25", hall: "Pines", station: "Pines", meal: "Dinner", category: "Entrees", name: "Salmon Bowl", price: 13 },
    { date: "2026-10-25", hall: "Pines", station: "Pines", meal: "Dinner", category: "Sides", name: "Pico de Gallo", price: null },
  ],
};

const sundayEvening = new Date(2026, 9, 25, 16, 30);

describe("budget and hall words", () => {
  it("reads a price range and the hall", () => {
    expect(budgetOf("what's good under $10")).toEqual({ max: 10 });
    expect(budgetOf("between $5 and $12")).toEqual({ min: 5, max: 12 });
    expect(resolveHall("burrito at 64 degrees")).toBe("64 Degrees");
    expect(resolveHall("from Warren Lecture Hall")).toBeUndefined();
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
});

describe("recommend", () => {
  it("keeps open dishes inside the budget and skips unpriced toppings", () => {
    const picks = recommend(menus, { maxPrice: 10, maxInclusive: false, now: sundayEvening });
    expect(picks.map((p) => p.name)).toEqual(["Spaghetti Fra Diavolo", "Beans and Cheese Burrito"]);
    expect(picks.every((p) => p.open)).toBe(true);
    expect(picks.find((p) => p.name.includes("Burrito"))?.hours).toBe("9:00 AM – 9:00 PM");
  });

  it("filters a named dish at one hall", () => {
    const picks = recommend(menus, { hall: "64 Degrees", item: "burrito", maxPrice: 12, now: sundayEvening });
    expect(picks.map((p) => p.name)).toEqual(["Carne Asada Burrito", "Beans and Cheese Burrito"]);
  });
});
