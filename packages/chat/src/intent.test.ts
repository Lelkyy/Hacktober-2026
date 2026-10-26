import { describe, expect, it } from "vitest";
import { ChatModel } from "./ChatModel.ts";
import { carryOver, isLocalSure, needsModel, parseLocally } from "./intent.ts";

const course = (code: string) => code === "MATH 20C" || code === "CSE 12";

describe("messy chat lines", () => {
  it("repairs a mistyped route", () => {
    const intent = parseLocally("hw do i gt to geisle", () => false);
    expect(intent.action).toBe("route");
    expect(intent.place).toBe("geisel");
    expect(intent.heard).toMatch(/geisel/);
    expect(needsModel("hw do i gt to geisle", intent)).toBe(false);
  });

  it("reads a bathroom typo as nearby", () => {
    const intent = parseLocally("wheres the nearest bathrom", () => false);
    expect(intent.action).toBe("nearby");
    expect(intent.what).toBe("restroom");
  });

  it("treats a bare place as a route, and a bare amenity as nearby", () => {
    expect(parseLocally("geisel?", () => false)).toMatchObject({ action: "route", place: "geisel" });
    expect(parseLocally("yo geisle", () => false)).toMatchObject({ action: "route", place: "geisel" });
    expect(parseLocally("bathroom", () => false)).toMatchObject({ action: "nearby", what: "restroom" });
    expect(parseLocally("take me to the bathroom", () => false)).toMatchObject({ action: "nearby", what: "restroom" });
    expect(parseLocally("coffee at geisel", () => false)).toMatchObject({ action: "nearby", what: "coffee", place: "geisel" });
  });

  it("keeps Geisel Library as a place, not a study spot", () => {
    const intent = parseLocally("geisel library", () => false);
    expect(intent.action).toBe("route");
    expect(intent.place).toMatch(/geisel library/);
  });

  it("takes a bus to a place instead of opening a stop board", () => {
    const toGeisel = parseLocally("next bus to geisel", () => false);
    expect(toGeisel.action).toBe("route");
    expect(toGeisel.mode).toBe("bus");
    expect(toGeisel.place).toBe("geisel");
    const atGilman = parseLocally("next bus at gilman", () => false);
    expect(atGilman.action).toBe("stop");
    expect(atGilman.place).toBe("gilman");
    expect(atGilman.mode).toBeUndefined();
  });

  it("reads a class time with no unit, and a class with no code", () => {
    expect(parseLocally("class in 20", course)).toMatchObject({ action: "next", inMinutes: 20 });
    expect(parseLocally("geisel in 20", () => false)).toMatchObject({ action: "route", place: "geisel", inMinutes: 20 });
    expect(parseLocally("i have math 20c in 20", course)).toMatchObject({ action: "class", course: "MATH 20C", inMinutes: 20 });
  });

  it("keeps food on a class trip", () => {
    const intent = parseLocally("i have math 20c in 30 and i'm hungry", course);
    expect(intent.action).toBe("class");
    expect(intent.course).toBe("MATH 20C");
    expect(intent.inMinutes).toBe(30);
    expect(intent.along).toBe(true);
  });

  it("sends food along a non-hall destination", () => {
    const intent = parseLocally("heading toward geisel, i'm starving", () => false);
    expect(intent.action).toBe("order");
    expect(intent.to).toBe("geisel");
    expect(intent.along).toBe(true);
  });

  it("answers help and garbage without a model", () => {
    const help = parseLocally("help", () => false);
    expect(help.action).toBe("other");
    expect(help.reply).toMatch(/Geisel/);
    expect(isLocalSure(help, "help")).toBe(true);
    const junk = parseLocally("asdf", () => false);
    expect(junk.reply).toBeTruthy();
    expect(needsModel("asdf", junk)).toBe(false);
  });

  it("still reads the messy food-along sentence", () => {
    const intent = parseLocally("im goign to mur from pepper canyon, anything I can get near this rout that's under 10 $?", () => false);
    expect(intent.action).toBe("order");
    expect(intent.from).toBe("pepper canyon");
    expect(intent.to).toBe("muir");
    expect(intent.along).toBe(true);
    expect(intent.maxPrice).toBe(10);
    expect(intent.item).toBeUndefined();
    expect(intent.quantity).toBeUndefined();
  });

  it("reads everyday food, class, and nearby lines without a model", () => {
    const isCourse = (code: string) => /^(MATH 20C|CSE 12|PHYS 2A)$/.test(code);
    expect(parseLocally("two matcha boba at pines", () => false)).toMatchObject({
      action: "order",
      place: "Pines",
      item: "matcha boba",
      quantity: 2,
    });
    expect(parseLocally("i'm hungry", () => false)).toMatchObject({ action: "order" });
    expect(parseLocally("i'm hungry", () => false).item).toBeUndefined();
    expect(parseLocally("what's for lunch", () => false)).toMatchObject({ action: "order" });
    expect(parseLocally("cheapest burrito", () => false)).toMatchObject({ action: "order", item: "burrito", maxPrice: 10 });
    expect(parseLocally("eat at pines", () => false)).toMatchObject({ action: "order", place: "Pines" });
    expect(parseLocally("is pines open", () => false)).toMatchObject({ action: "order", place: "Pines" });
    expect(parseLocally("something to eat under ten dollars", () => false)).toMatchObject({ action: "order", maxPrice: 10 });
    expect(parseLocally("something to eat under ten dollars", () => false).to).toBeUndefined();
    expect(parseLocally("anything under 10 on the way to muir", () => false)).toMatchObject({
      action: "order",
      to: "muir",
      along: true,
      maxPrice: 10,
    });
    expect(parseLocally("anything under 10 on the way to muir", () => false).quantity).toBeUndefined();
    expect(parseLocally("between 5 and 12 at foodworx", () => false)).toMatchObject({
      action: "order",
      place: "Foodworx",
      minPrice: 5,
      maxPrice: 12,
    });
    expect(parseLocally("between 5 and 12 at foodworx", () => false).quantity).toBeUndefined();
    expect(parseLocally("i'm broke get me food near rimac", () => false)).toMatchObject({ action: "order", from: "rimac", maxPrice: 10 });
    expect(parseLocally("what's good under $10 from price center", () => false).quantity).toBeUndefined();
    expect(parseLocally("can i get a sandwich at 64 on the way to class", () => false)).toMatchObject({
      action: "next",
      along: true,
      place: "64 Degrees",
      item: "sandwich",
    });
    expect(parseLocally("half an hour until my class", isCourse)).toMatchObject({ action: "next", inMinutes: 30 });
    expect(parseLocally("i'm not taking phys 2a anymore", isCourse)).toMatchObject({ action: "drop", course: "PHYS 2A" });
    expect(parseLocally("lock my bike", () => false)).toMatchObject({ action: "nearby", what: "bike" });
    expect(parseLocally("when does the shuttle leave gilman", () => false)).toMatchObject({ action: "stop", place: "gilman" });
    expect(parseLocally("i usually bike", () => false)).toMatchObject({ action: "other", mode: "bike" });
    expect(parseLocally("heading to ventanas from geisel", () => false)).toMatchObject({ action: "route", place: "ventanas", from: "geisel" });
    expect(parseLocally("directions from muir to wlh", () => false)).toMatchObject({ action: "route", place: "wlh", from: "muir" });
    expect(parseLocally("i live in sixth, usually bike", () => false)).toMatchObject({ action: "other", mode: "bike", from: "sixth" });
    expect(parseLocally("starving, heading toward sixth from the price center, and i've only got seven bucks", () => false).item).toBeUndefined();
    expect(needsModel("two matcha boba at pines", parseLocally("two matcha boba at pines", () => false))).toBe(false);
    expect(needsModel("half an hour until my class", parseLocally("half an hour until my class", isCourse))).toBe(false);
  });

  it("reads slang, near/far, and several places without a model", () => {
    expect(parseLocally("hit up geisel", () => false)).toMatchObject({ action: "route", place: "geisel" });
    expect(parseLocally("how far is pines from price center", () => false)).toMatchObject({
      action: "route",
      place: "pines",
      from: "price center",
    });
    expect(parseLocally("is geisel far", () => false)).toMatchObject({ action: "route", place: "geisel" });
    expect(parseLocally("i'm far from geisel", () => false)).toMatchObject({ action: "route", place: "geisel" });
    expect(parseLocally("coffee close to geisel", () => false)).toMatchObject({
      action: "nearby",
      what: "coffee",
      place: "geisel",
    });
    expect(parseLocally("bathroom not far from pines", () => false)).toMatchObject({
      action: "nearby",
      what: "restroom",
      place: "pines",
    });
    expect(parseLocally("swing by pines then geisel", () => false)).toMatchObject({
      action: "route",
      place: "geisel",
      via: ["pines"],
    });
    expect(parseLocally("from pc to geisel via pines", () => false)).toMatchObject({
      action: "route",
      from: "price center",
      place: "geisel",
      via: ["pines"],
    });
    expect(parseLocally("geisel then pines then wlh", () => false)).toMatchObject({
      action: "route",
      place: "wlh",
      via: ["geisel", "pines"],
    });
    expect(parseLocally("stop at pines on the way to geisel", () => false)).toMatchObject({
      action: "route",
      place: "geisel",
      via: ["pines"],
    });
    expect(needsModel("swing by pines then geisel", parseLocally("swing by pines then geisel", () => false))).toBe(false);
    expect(needsModel("how far is pines", parseLocally("how far is pines", () => false))).toBe(false);
  });

  it("estimates a place a few letters off, and refuses nonsense", () => {
    const guessed = parseLocally("Gisewel", () => false);
    expect(guessed).toMatchObject({ action: "route", place: "geisel" });
    expect(guessed.heard).toMatch(/geisel/);
    expect(needsModel("Gisewel", guessed)).toBe(false);
    const junk = parseLocally("giberish giberish fheirfhoferhfieh", () => false);
    expect(junk.action).toBe("other");
    expect(junk.reply).toMatch(/No way to understand/);
    expect(junk.place).toBeUndefined();
    expect(needsModel("giberish giberish fheirfhoferhfieh", junk)).toBe(false);
    expect(parseLocally("else", () => false).place).not.toBe("geisel");
  });

  it("changes the last request when they reject it", () => {
    const coffee = parseLocally("not coffe", () => false);
    expect(coffee).toMatchObject({ action: "change", again: true, avoid: "coffee" });
    expect(coffee.heard).toMatch(/coffee/);
    const previous = parseLocally("coffee at geisel", () => false);
    const changed = carryOver(coffee, previous, "not coffe");
    expect(changed).toMatchObject({ action: "nearby", what: "coffee", place: "geisel", again: true, avoid: "coffee" });
    expect(needsModel("not coffe", changed)).toBe(false);

    const elsewise = carryOver(parseLocally("i want something else", () => false), previous, "i want something else");
    expect(elsewise).toMatchObject({ action: "nearby", what: "coffee", again: true });
    expect(elsewise.avoid).toBeUndefined();

    for (const line of ["not that", "anything but coffee", "try again", "none of those", "show me something else"]) {
      expect(parseLocally(line, () => false).again).toBe(true);
    }
    expect(carryOver(parseLocally("something else", () => false), null, "something else").reply).toMatch(/what to change/);
    expect(parseLocally("nah forget geisel i wanna go to rimac actually", () => false).place).toBe("rimac");
    expect(parseLocally("bathroom not far from pines", () => false)).toMatchObject({ action: "nearby", what: "restroom", place: "pines" });
    expect(parseLocally("i'm not taking phys 2a anymore", (code) => code === "PHYS 2A")).toMatchObject({ action: "drop", course: "PHYS 2A" });
    expect(parseLocally("spin bike to geisel", () => false)).toMatchObject({ action: "route", place: "geisel", mode: "scooter" });
    expect(parseLocally("take transit to price center", () => false)).toMatchObject({ action: "route", place: "price center", mode: "bus" });
    expect(parseLocally("bike to geisel", () => false)).toMatchObject({ action: "route", place: "geisel", mode: "bike" });
    expect(parseLocally("nearest spin bike", () => false)).toMatchObject({ action: "nearby", what: "spin" });
    expect(parseLocally("nearest spin bike", () => false).mode).toBeUndefined();
    expect(parseLocally("geisel", () => false).mode).toBeUndefined();
  });
});

describe("casual lines", () => {
  it("pulls a campus request out of a messy sentence", () => {
    expect(parseLocally("yo where tf is geisel im lost lol", () => false)).toMatchObject({ action: "route", place: "geisel" });
    expect(parseLocally("bruh i gotta piss", () => false)).toMatchObject({ action: "nearby", what: "restroom" });
    expect(parseLocally("gimme a burrito im broke", () => false)).toMatchObject({ action: "order", item: "burrito", maxPrice: 10 });
    expect(parseLocally("dude pines or whatever is that open", () => false)).toMatchObject({ action: "order", place: "Pines" });
    expect(parseLocally("dude pines or whatever is that open", () => false).item).toBeUndefined();
    expect(parseLocally("lol whats good to eat rn", () => false).item).toBeUndefined();
    const hungry = parseLocally("ok so basically im at sixth and i need to get to geisel but also im hungry", () => false);
    expect(hungry).toMatchObject({ action: "order", from: "sixth", to: "geisel", along: true });
    expect(hungry.place).toBeUndefined();
    expect(hungry.item).toBeUndefined();
    expect(parseLocally("bro take me 2 the libary from pc im boutta be late", () => false)).toMatchObject({
      action: "route",
      place: "library",
      from: "price center",
    });
    expect(parseLocally("can u help me find muir college i think im by price center or something idk", () => false)).toMatchObject({
      action: "route",
      place: "muir college",
      from: "price center",
    });
    expect(parseLocally("my phone is dead where do i charge it", () => false)).toMatchObject({ action: "nearby", what: "charge" });
    expect(parseLocally("something quiet to study", () => false)).toMatchObject({ action: "nearby", what: "study" });
    expect(parseLocally("whats the deal with the shuttle", () => false)).toMatchObject({ action: "stop" });
    expect(parseLocally("can you just talk to me", () => false).place).toBeUndefined();
    expect(parseLocally("its so hot outside", () => false).action).toBe("other");
    expect(parseLocally("nah forget geisel i wanna go to rimac actually", () => false).place).toBe("rimac");
    expect(parseLocally("i usually walk but today im biking to class", () => false)).toMatchObject({ action: "next", mode: "bike" });
    expect(parseLocally("i usually walk but today im biking to class", () => false).remember).toBeUndefined();
  });

  it("answers the sentence instead of dumping the help text", () => {
    expect(parseLocally("im lost", () => false).reply).toMatch(/Where do you want/);
    expect(parseLocally("who are you", () => false).reply).toMatch(/campus guide/);
    expect(parseLocally("what time is it", () => false).reply).toMatch(/^It's /);
    expect(parseLocally("tell me a joke", () => false).reply).toMatch(/Geisel/);
    expect(parseLocally("why is the bus always late", () => false).reply).toMatch(/delays/);
    expect(parseLocally("ok but its still stupid like i cant ask it random things", () => false).reply).toMatch(/where's geisel/);
    const messy = "ok but its still stupid like i cant ask it random things";
    expect(needsModel(messy, parseLocally(messy, () => false))).toBe(false);
    const night = "could you figure out whether the night shuttle still runs past the gliderport after the last final ends";
    expect(needsModel(night, parseLocally(night, () => false))).toBe(true);
  });
});

describe("chat speed", () => {
  it("answers a typo locally without waiting on a model", async () => {
    const model = new ChatModel({ gemma: "off", lmStudioModel: "x", ollamaModel: "gemma3:4b", arriveEarlyMin: 2 }, () => false, () => {});
    const started = Date.now();
    const intent = await model.read("hw do i gt to geisle", null);
    expect(intent.action).toBe("route");
    expect(intent.place).toBe("geisel");
    expect(Date.now() - started).toBeLessThan(100);
  });
});
