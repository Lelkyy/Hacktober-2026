import { defineConfig } from "vite";

/** Same campus files and MTS key as the full app. This folder only replaces the UI. */
export default defineConfig({
  publicDir: "../web/public",
  envDir: "../web",
  server: { port: 5173 },
});
