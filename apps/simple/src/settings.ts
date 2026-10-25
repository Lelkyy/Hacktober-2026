/**
 * Knobs. Change these instead of hunting through the app.
 * The MTS key still comes from apps/web/.env.local (VITE_MTS_KEY).
 */
export const settings = {
  /** How often to ask MTS where vehicles are. Their GPS updates about every 30–40s. */
  livePollMs: 10_000,
  /** Leave empty to call MTS from the browser. Set this to your own server later, e.g. "/api/vehicles". */
  livePositionsUrl: "",
  /** Campus map starts here (zoom and limits as in the full app, apps/web). */
  center: [-117.2376, 32.8801] as [number, number],
  zoom: 15.6,
  /** Campus and the coast on a laptop screen; no further out. */
  minZoom: 13.5,
  /** Room around the campus data's bounding box the map can pan to: enough to see the shore. */
  boundsPaddingDeg: 0.006,
  /** "auto": Gemma in LM Studio, else Chrome's built-in AI, else Gemma through Ollama, else simple patterns. "off": patterns only (also ?gemma=off in the URL). */
  gemma: "auto" as "auto" | "off",
  /** LM Studio model id (`lms ls`). Load it and start the local server on port 1234. */
  lmStudioModel: "google/gemma-4-e4b",
  /** The Ollama model to use when LM Studio isn't running. Any "gemma…" model Ollama has works too. */
  ollamaModel: "gemma3:4b",
  /** Aim to reach class this many minutes before it starts. */
  arriveEarlyMin: 2,
};
