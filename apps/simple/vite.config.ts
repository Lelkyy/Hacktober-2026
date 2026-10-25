import { defineConfig } from "vite";

/** Same campus files and MTS key as the full app. This folder only replaces the UI. */
export default defineConfig({
  publicDir: "../web/public",
  envDir: "../web",
  server: {
    port: 5173,
    // Gemma: LM Studio (OpenAI API) or Ollama. Same origin, so no CORS setup.
    proxy: {
      "/lmstudio": { target: "http://127.0.0.1:1234", rewrite: (path) => path.replace(/^\/lmstudio/, "") },
      "/ollama": { target: "http://127.0.0.1:11434", rewrite: (path) => path.replace(/^\/ollama/, "") },
    },
  },
});
