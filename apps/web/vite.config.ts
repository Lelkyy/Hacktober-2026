import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // The chat's Gemma through Ollama: same origin, so no CORS setup.
      "/ollama": { target: "http://127.0.0.1:11434", rewrite: (path) => path.replace(/^\/ollama/, "") },
      // HDH dining pages, for the chat's Triton2Go prices.
      "/hdh": { target: "https://hdh-web.ucsd.edu", changeOrigin: true, rewrite: (path) => path.replace(/^\/hdh/, "") },
    },
  },
});
