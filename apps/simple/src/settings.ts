/**
 * Knobs. Change these instead of hunting through the app.
 * The MTS key still comes from apps/web/.env.local (VITE_MTS_KEY).
 */
export const settings = {
  /** How often to ask MTS where vehicles are. Their GPS updates about every 30–40s. */
  livePollMs: 10_000,
  /** Leave empty to call MTS from the browser. Set this to your own server later, e.g. "/api/vehicles". */
  livePositionsUrl: "",
  /** Campus map starts here. */
  center: [-117.2376, 32.8801] as [number, number],
  zoom: 15,
};
