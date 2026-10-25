/** App-wide settings that aren't secret. */

/** Where "Report a problem" emails go. Override with VITE_REPORT_EMAIL. */
export const REPORT_EMAIL: string = import.meta.env.VITE_REPORT_EMAIL || "Elkyy831@gmail.com";

/** The chat bar's language model and timing (see @campus/chat). */
export const CHAT = {
  /** "auto": Gemma in LM Studio, else Ollama, else Chrome's built-in AI, else simple patterns. "off": patterns only (also ?gemma=off). */
  gemma: "auto",
  /** LM Studio model id (`lms ls`). Load it and start the local server on port 1234. */
  lmStudioModel: "google/gemma-4-e4b",
  /** The Ollama model to use when LM Studio isn't running; any "gemma…" model Ollama has works too. */
  ollamaModel: "gemma3:4b",
  /** Aim to reach class this many minutes before it starts. */
  arriveEarlyMin: 2,
} as const;
