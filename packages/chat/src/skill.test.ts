import { describe, expect, it } from "vitest";
import { turnSkill } from "./agent.ts";
import { parseLocally, systemPrompt } from "./intent.ts";
import { parseSkill, SHORTEST_ROUTE } from "./skill.ts";

describe("shortest-route skill", () => {
  it("reads the name, the folded description and the instructions from SKILL.md", () => {
    expect(SHORTEST_ROUTE.name).toBe("shortest-route");
    expect(SHORTEST_ROUTE.description).toMatch(/^Finds the shortest-time campus route/);
    expect(SHORTEST_ROUTE.description).not.toContain("\n");
    expect(SHORTEST_ROUTE.instructions).toMatch(/^# Shortest-time campus route/);
    expect(SHORTEST_ROUTE.instructions).toContain("Do not guess a start");
  });

  it("is in Gemma's instructions", () => {
    const prompt = systemPrompt(new Date(2026, 9, 25, 14, 0));
    expect(prompt).toContain('Skill "shortest-route"');
    expect(prompt).toContain(SHORTEST_ROUTE.instructions);
  });

  it("is in the instructions Gemma gets on every turn", () => {
    expect(turnSkill()).toContain(SHORTEST_ROUTE.instructions);
  });

  it("reads Price Center as a place, not a price question", () => {
    expect(parseLocally("fastest way from Price Center to Geisel", () => false)).toMatchObject({ action: "route", place: "geisel", from: "price center" });
    expect(parseLocally("how do I get to price center", () => false)).toMatchObject({ action: "route", place: "price center" });
    expect(parseLocally("how much is a burrito at price center", () => false).action).toBe("order");
  });

  it("refuses a file without frontmatter", () => {
    expect(() => parseSkill("# Just a heading")).toThrow();
    expect(() => parseSkill("---\nname: x\n---\nbody")).toThrow();
  });
});
