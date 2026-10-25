import { courseKey, shapesAtStops, type LiveVehicle, type LngLat, type Route } from "@campus/core";
import { Assistant, ChatModel, groupOf, Location, stopSummary, TripPlanner, type Reply } from "@campus/chat";
import { Campus } from "./campus/loadCampus.ts";
import { LiveFeed } from "./live/LiveFeed.ts";
import { CampusMap } from "./map/CampusMap.ts";
import { settings } from "./settings.ts";

/**
 * Starts the pieces and connects them.
 * Read this file top to bottom: load campus, draw it, poll buses, find Gemma, then listen to the chat.
 */
export class App {
  private campus!: Campus;
  private map!: CampusMap;
  private assistant!: Assistant;
  private readonly messages = document.querySelector<HTMLOListElement>("#messages")!;
  private readonly form = document.querySelector<HTMLFormElement>("#ask")!;
  private readonly prompt = document.querySelector<HTMLInputElement>("#prompt")!;
  private busy = false;
  private vehicles: LiveVehicle[] = [];

  constructor(private readonly status: HTMLElement) {
    // Never a page load, even before the chat is ready.
    this.form.addEventListener("submit", (event) => event.preventDefault());
  }

  async start(): Promise<void> {
    this.campus = await Campus.load();
    this.map = new CampusMap(document.querySelector("#map")!, {
      onStop: (id) => this.openStop(id),
      onVehicle: (vehicle) => this.openVehicle(vehicle),
      onEmpty: () => void this.map.showHighlight([]),
    }, this.campus.graph.data.bbox);
    await this.map.showTransit(this.campus.transit);
    new LiveFeed(
      (vehicles) => {
        this.vehicles = vehicles;
        void this.map.showVehicles(vehicles);
      },
      () => {}, // Live-feed problems stay out of the chat; the map just shows no buses.
    ).start();
    const location = new Location(this.campus.graph.data.bbox, (at) => void this.map.showMe(at));
    void location.start();

    const courses = new Set(this.campus.sections?.courses.map((c) => courseKey(c.code)));
    const isCourse = (code: string) => courses.has(courseKey(code));
    const model = new ChatModel(settings, isCourse, (message) => (this.status.textContent = message));
    await model.connect();
    this.assistant = new Assistant({
      campus: this.campus,
      planner: new TripPlanner(this.campus),
      model,
      location,
      vehicles: () => this.vehicles,
      view: {
        trip: (trip) => this.drawTrip(trip?.route ?? null),
        markers: (points) => void this.map.showMarkers(points),
        stop: (ids, at) => this.showStop(ids, at),
      },
      settings,
    });

    const term = this.campus.sections?.term;
    this.say("bot", {
      text: `Hi! Tell me where you need to be and I'll route you there.${term ? ` I know every ${term} class.` : ""}`,
      choices: ["I have MATH 20C tomorrow at 11", "Nearest restroom", "Next bus at Gilman", "Take me to Geisel by bike"].map((example) => ({
        label: example,
        pick: () => this.assistant.handle(example),
      })),
    });
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = this.prompt.value.trim();
      if (!text || this.busy) return;
      this.prompt.value = "";
      void this.ask(text);
    });
    this.prompt.disabled = false;
    this.form.querySelector("button")!.disabled = false;
    this.prompt.focus();
  }

  private ask(text: string): Promise<void> {
    this.say("user", { text });
    return this.answer(() => this.assistant.handle(text));
  }

  /** Show "Thinking…" while `work` runs, then its reply. */
  private async answer(work: () => Promise<Reply>): Promise<void> {
    this.busy = true;
    const thinking = this.say("bot", { text: "Thinking…" });
    thinking.classList.add("thinking");
    let reply: Reply;
    try {
      reply = await work();
    } catch (err) {
      console.error(err);
      reply = { text: "Something went wrong planning that. Try saying it another way." };
    }
    thinking.remove();
    this.say("bot", reply);
    this.busy = false;
  }

  private say(who: "user" | "bot", reply: Reply): HTMLLIElement {
    const item = document.createElement("li");
    item.className = `msg ${who}`;
    item.textContent = reply.text;
    if (reply.steps?.length) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = `Directions (${reply.steps.length} steps)`;
      const list = document.createElement("ol");
      list.append(...reply.steps.map((step) => Object.assign(document.createElement("li"), { textContent: step })));
      details.append(summary, list);
      item.append(details);
    }
    if (reply.choices?.length) {
      const row = document.createElement("div");
      row.className = "choices";
      for (const choice of reply.choices) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = choice.label;
        button.onclick = () => {
          if (this.busy) return;
          // A choice is used once: the conversation has moved on.
          row.querySelectorAll("button").forEach((b) => (b.disabled = true));
          this.say("user", { text: choice.label });
          void this.answer(choice.pick);
        };
        row.append(button);
      }
      item.append(row);
    }
    this.messages.append(item);
    item.scrollIntoView({ block: "end", behavior: "smooth" });
    return item;
  }

  private drawTrip(route: Route | null): void {
    // The bus and trolley lines this trip rides: shown with the trip, hidden otherwise.
    const { patterns } = this.campus.transit.data;
    const lines = (route?.legs ?? []).flatMap((leg) =>
      leg.mode === "bus" ? [{ color: leg.route.color, route: patterns[leg.pattern]?.shape ?? [], ridden: leg.coordinates }] : [],
    );
    void this.map.showHighlight([]);
    void this.map.showTrip(route?.coordinates ?? [], lines);
    // After the chat bar has grown with the new message, so the trip fits what's left.
    requestAnimationFrame(() => this.map.fitTrip(route?.coordinates ?? []));
  }

  /** A tapped stop: its lines on the map, its next departures in the chat. */
  private openStop(id: string): void {
    const stop = this.campus.transit.data.stops.find((s) => s.id === id);
    if (!stop) return;
    const group = groupOf(this.campus, stop);
    this.showStop(group.ids, stop.lngLat);
    this.say("bot", { text: stopSummary(this.campus, group, this.vehicles) });
  }

  private showStop(ids: string[], at: LngLat): void {
    const shapes = shapesAtStops(this.campus.transit, ids);
    void this.map.showHighlight(shapes.map((s) => ({ color: s.route.color, coordinates: s.shape })));
    this.map.focus(at);
  }

  private openVehicle(vehicle: LiveVehicle): void {
    const shapes = this.campus.transit.data.patterns.flatMap((pattern) => {
      const route = this.campus.transit.data.routes[pattern.route];
      if (!route || route.short !== vehicle.route || pattern.shape.length < 2) return [];
      return [{ color: vehicle.color, coordinates: pattern.shape }];
    });
    void this.map.showHighlight(shapes);
    this.map.focus(vehicle.lngLat);
    this.say("bot", { text: `${vehicle.mode === "trolley" ? vehicle.line : `Route ${vehicle.line}`} · last GPS ${age(vehicle.fixAt)}` });
  }
}

function age(fixAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - fixAt) / 1000));
  return seconds < 90 ? `${seconds}s ago` : `${Math.round(seconds / 60)} min ago`;
}
