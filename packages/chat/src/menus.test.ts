import { describe, expect, it } from "vitest";
import { answerFood, factCard, foodSkill, formatQuestion, pickHall, turnSkill, usableReply, whereTo } from "./agent.ts";
import { parseLocally } from "./intent.ts";
import { budgetOf, dishOf, recommend, resolveHall, type ScrapedMenus } from "./menus.ts";
import { skillPrompt } from "./skill.ts";

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

  it("sends the model a filled-in question, not the raw sentence", () => {
    expect(dishOf("find me food that's under $0")).toBeUndefined();
    expect(dishOf("find me a place for food that's under $10")).toBeUndefined();
    const intent = parseLocally("Find me food that's under $0", () => false);
    expect(intent.action).toBe("order");
    expect(intent.item).toBeUndefined();
    expect(intent.maxPrice).toBeUndefined();
    const found = answerFood("Find me food that's under $0", menus, sundayEvening);
    expect(found).not.toBeNull();
    expect(found!.ask.maxPrice).toBeUndefined();
    expect(found!.lead).not.toMatch(/\$0/);
    const asked = formatQuestion("Find me food that's under $0", found!);
    expect(asked.startsWith("Fill this JSON in")).toBe(true);
    expect(asked).toContain("item: omit");
    expect(asked).toContain("maxPrice: omit");
    expect(asked).toContain("They did not name a dish or a budget.");
    expect(asked).not.toContain("$0");
    expect(asked).not.toContain("find that");
    expect(asked).toContain("Beans and Cheese Burrito | 64 Degrees | $7.50 | open");
    expect(asked.indexOf("Menu:")).toBeLessThan(asked.indexOf("Student asked"));
    expect(usableReply("Beans and Cheese Burrito at 64 Degrees is $7.50.", found!.picks)).toContain("Beans and Cheese");
    expect(usableReply('Nothing on the menu matching "find that s" under $0.', found!.picks)).toBeUndefined();
  });

  it("takes any go-somewhere sentence to a real place, not a fake dish", () => {
    const asked = whereTo("Map me to a rnadom food place");
    expect(asked?.vagueFood).toBe(true);
    expect(whereTo("map me to taco bell")?.vagueFood).toBe(false);
    expect(whereTo("what's good under $10")).toBeNull();
    expect(whereTo("take me somewhere to eat")?.vagueFood).toBe(true);
    const intent = parseLocally("Map me to a rnadom food place", () => false);
    expect(intent.action).toBe("route");
    expect(intent.item).toBeUndefined();
    expect(intent.maxPrice).toBeUndefined();
    expect(pickHall(menus, sundayEvening)).toBe("64 Degrees");
    const card = factCard(menus, sundayEvening);
    const skill = turnSkill();
    expect(card).toContain("Places:");
    expect(card).toContain("Beans and Cheese Burrito");
    // Short, apart from the shortest-route skill it carries.
    expect(skill.replace(skillPrompt(), "").length).toBeLessThan(800);
    expect(skill).toContain("misspelled");
    expect(skill).not.toMatch(/MATH 20C/);
  });

  it("gives Gemma a short food skill instead of the navigation manual", () => {
    const skill = foodSkill();
    expect(skill.length).toBeLessThan(400);
    expect(skill).toContain("Menu");
    expect(skill).not.toMatch(/MATH|Dining Dollars|wheelchair/);
  });

  it("reads cheapest as a price sort, not a dish and not a made-up cap", () => {
    expect(dishOf("find me cheapest foods")).toBeUndefined();
    const intent = parseLocally("Find me cheapest foods", () => false);
    expect(intent.action).toBe("order");
    expect(intent.item).toBeUndefined();
    expect(intent.maxPrice).toBeUndefined();
    const found = answerFood("Find me cheapest foods", menus, sundayEvening);
    expect(found?.ask.sort).toBe("cheapest");
    expect(found?.ask.item).toBeUndefined();
    expect(found?.ask.maxPrice).toBeUndefined();
    expect(found?.picks[0]?.name).toBe("Beans and Cheese Burrito");
    const withAddons: ScrapedMenus = {
      ...menus,
      items: [
        ...menus.items,
        { date: "2026-10-25", hall: "Pines", station: "Pines", meal: "Dinner", category: "Sauces", name: "Buttermilk Ranch", price: 0.5 },
        { date: "2026-10-25", hall: "64 Degrees", station: "Al Dente", meal: "Dinner", category: "Menu Items", name: "Fruit, Apple Whole", price: 0.75 },
      ],
    };
    const meals = answerFood("Find me cheapest foods", withAddons, sundayEvening);
    expect(meals?.picks.map((p) => p.name)).not.toContain("Buttermilk Ranch");
    expect(meals?.picks.map((p) => p.name)).not.toContain("Fruit, Apple Whole");
    expect(meals?.picks[0]?.name).toBe("Beans and Cheese Burrito");
    expect(found?.lead).not.toMatch(/0\.75|cheapest foods/i);
    const asked = formatQuestion("Find me cheapest foods", found!);
    expect(asked).toContain("Student asked for the cheapest food.");
    expect(asked).toContain("maxPrice: omit");
    expect(asked).not.toContain("0.75");
    expect(asked).not.toContain("cheapest foods");
  });

  it("puts a real cap and only the dishes under it in the question", () => {
    const found = answerFood("what's good under $10", menus, sundayEvening);
    expect(found?.ask.maxPrice).toBe(10);
    expect(found?.ask.maxInclusive).toBe(false);
    const asked = formatQuestion("what's good under $10", found!);
    expect(asked).toContain("maxPrice: 10");
    expect(asked).toContain("Beans and Cheese Burrito");
    expect(asked).not.toContain("Salmon Bowl");
    expect(asked).not.toContain("Birria Bowl");
  });

  it("lists the cheapest open dishes when asked to sort that way", () => {
    const picks = recommend(menus, { sort: "cheapest", now: sundayEvening }, 2);
    expect(picks.map((p) => p.name)).toEqual(["Beans and Cheese Burrito", "Spaghetti Fra Diavolo"]);
  });

  it("filters a named dish at one hall", () => {
    const picks = recommend(menus, { hall: "64 Degrees", item: "burrito", maxPrice: 12, now: sundayEvening });
    expect(picks.map((p) => p.name)).toEqual(["Carne Asada Burrito", "Beans and Cheese Burrito"]);
  });
});
