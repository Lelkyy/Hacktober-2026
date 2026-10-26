import { describe, expect, it } from "vitest";
import { intentFromAgent } from "./agent.ts";
import { integrateIntent, inventedReply, tripSlots } from "./integrate.ts";
import { parseLocally } from "./intent.ts";

describe("campus-answer integration", () => {
  it("recovers a trip when the model said say but the local read had a place", () => {
    const message = "how do I get to the library";
    const intent = intentFromAgent(
      { tool: "say", reply: "Walk 8 minutes north via Library Walk to Geisel." },
      { action: "route", place: "geisel" },
      message,
      () => false,
    );
    expect(intent?.action).toBe("route");
    expect(intent?.place).toBe("geisel");
    expect(intent?.reply).toBeUndefined();
    expect(tripSlots(intent!).to).toBe("geisel");
  });

  it("copies trip.to onto place so Assistant can plan", () => {
    const intent = intentFromAgent({ tool: "trip", to: "Price Center" }, { action: "other" }, "how do I get there", () => false);
    expect(intent?.action).toBe("route");
    expect(intent?.place).toBe("Price Center");
    expect(intent?.to).toBe("Price Center");
  });

  it("turns a hall destination the model called food into a trip", () => {
    const message = "take me to 64 degrees";
    const intent = intentFromAgent({ tool: "food", place: "64 Degrees" }, { action: "other" }, message, () => false);
    expect(intent?.action).toBe("route");
    expect(intent?.place).toBe("64 Degrees");
  });

  it("keeps via hops the model skipped", () => {
    const message = "to geisel via pines";
    const local = parseLocally(message, () => false);
    const intent = intentFromAgent({ tool: "trip", to: "Geisel" }, local, message, () => false);
    expect(intent?.action).toBe("route");
    expect(intent?.place?.toLowerCase()).toBe("geisel");
    expect(intent?.via?.length).toBeGreaterThan(0);
    expect(intent?.via).toEqual(local.via);
  });

  it("drops an invented path in a say reply", () => {
    const next = integrateIntent({ action: "other", reply: "Walk 5 min north and turn left." }, { action: "other" }, "what should I do");
    expect(inventedReply("Walk 5 min north and turn left.")).toBe(true);
    expect(next.reply).toBeUndefined();
  });
});
