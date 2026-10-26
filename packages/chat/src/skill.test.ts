import { describe, expect, it } from "vitest";
import { systemPrompt } from "./intent.ts";
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

  it("refuses a file without frontmatter", () => {
    expect(() => parseSkill("# Just a heading")).toThrow();
    expect(() => parseSkill("---\nname: x\n---\nbody")).toThrow();
  });
});
