import { describe, expect, it } from "vitest";
import { agentPrompt, intentFromAgent, modelSize } from "./agent.ts";
import { parseLocally } from "./intent.ts";
import { CAMPUS_SKILLS, pickSkills } from "./skills.ts";

describe("agent tool call", () => {
  it("maps a trip tool onto a route", () => {
    const intent = intentFromAgent({ tool: "trip", to: "Geisel" }, { action: "other" }, "how do I get to the library", () => false);
    expect(intent?.action).toBe("route");
    expect(intent?.place).toBe("Geisel");
  });

  it("keeps a budget the model skipped and drops a price it read as a clock", () => {
    const message = "im goign to mur from pepper canyon, anything I can get near this rout that's under 10 $?";
    const local = parseLocally(message, () => false);
    const intent = intentFromAgent(
      { tool: "food", to: "Muir", from: "Pepper Canyon", along: true, at: "10:00" },
      local,
      message,
      () => false,
    );
    expect(intent?.action).toBe("order");
    expect(intent?.to).toBe("Muir");
    expect(intent?.from).toBe("Pepper Canyon");
    expect(intent?.along).toBe(true);
    expect(intent?.maxPrice).toBe(10);
    expect(intent?.maxInclusive).toBe(false);
    expect(intent?.item).toBeUndefined();
    expect(intent?.at).toBeUndefined();
  });

  it("turns a classes tool with no course into the next class", () => {
    const intent = intentFromAgent({ tool: "classes" }, { action: "other" }, "where am I supposed to be", () => false);
    expect(intent?.action).toBe("next");
  });

  it("ranks a 4B model ahead of a 12B one", () => {
    expect(modelSize("qwen/qwen3.5-9b")).toBe(9);
    expect(modelSize("google/gemma-4-e4b")).toBeLessThan(modelSize("gemma-4-12b-qat"));
  });
});

describe("model skills", () => {
  it("always hands Gemma campus-chat, campus-sources, and campus-answer", () => {
    const food = pickSkills("what's good under $10");
    expect(food.map((s) => s.name)).toEqual(["campus-chat", "campus-sources", "campus-answer"]);
    expect(CAMPUS_SKILLS.map((s) => s.name)).toEqual(["campus-chat", "campus-sources", "shortest-route", "campus-talk", "campus-answer"]);
  });

  it("adds shortest-route when they need to get somewhere, and on a hard line", () => {
    const trip = pickSkills("how do I get to geisel", { action: "route", place: "geisel" });
    expect(trip.map((s) => s.name)).toContain("shortest-route");
    const hard = pickSkills("that thing from earlier but cheaper", { action: "other" });
    expect(hard.map((s) => s.name)).toEqual(["campus-chat", "campus-sources", "shortest-route", "campus-talk", "campus-answer"]);
  });

  it("adds campus-talk on slang, near/far, or several places", () => {
    expect(pickSkills("hit up geisel").map((s) => s.name)).toContain("campus-talk");
    expect(pickSkills("how far is pines").map((s) => s.name)).toContain("campus-talk");
    expect(pickSkills("geisel then pines", { action: "route", place: "pines", via: ["geisel"] }).map((s) => s.name)).toContain(
      "campus-talk",
    );
  });

  it("puts every skill name in the prompt and the bodies this line needs", () => {
    const now = new Date("2026-10-25T17:18:00");
    const food = agentPrompt(now, [], "what's good under $10", { action: "order", maxPrice: 10 });
    expect(food).toContain("campus-chat");
    expect(food).toContain("campus-sources");
    expect(food).toContain("shortest-route");
    expect(food).toMatch(/## campus-chat/);
    expect(food).toMatch(/## campus-sources/);
    expect(food).toMatch(/## campus-answer/);
    expect(food).not.toMatch(/## shortest-route/);
    expect(food).not.toMatch(/## campus-talk/);
    expect(food).toMatch(/under 10 is maxPrice/);
    expect(food).toMatch(/Hours and dishes come from today's menus/);
    expect(food).toMatch(/trip.to is shortest-route --to/);

    const trip = agentPrompt(now, ["Usually bikes"], "take me to geisel", { action: "route", place: "geisel" });
    expect(trip).toMatch(/## shortest-route/);
    expect(trip).toMatch(/## campus-answer/);
    expect(trip).toMatch(/Do not guess a start/);
    expect(trip).toMatch(/Usually bikes/);
  });
});
