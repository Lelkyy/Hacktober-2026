import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The chat's Gemma: LM Studio (OpenAI API) or Ollama. Same origin, so no CORS setup.
    proxy: {
      "/lmstudio": { target: "http://127.0.0.1:1234", rewrite: (path) => path.replace(/^\/lmstudio/, "") },
      "/ollama": { target: "http://127.0.0.1:11434", rewrite: (path) => path.replace(/^\/ollama/, "") },
    },
  },
});
