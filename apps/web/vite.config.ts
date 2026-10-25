import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The chat's Gemma through Ollama, when Chrome has no built-in AI: same origin, so no CORS setup.
    proxy: { "/ollama": { target: "http://127.0.0.1:11434", rewrite: (path) => path.replace(/^\/ollama/, "") } },
  },
});
