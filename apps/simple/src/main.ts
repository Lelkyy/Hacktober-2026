import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "./styles.css";
import { App } from "./App.ts";

setWorkerUrl(workerUrl);

const status = document.querySelector<HTMLElement>("#status")!;
const app = new App(status);

app.start().catch((err: unknown) => {
  status.textContent = err instanceof Error ? err.message : "Could not start.";
});
