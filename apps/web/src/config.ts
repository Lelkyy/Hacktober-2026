/** App-wide settings that aren't secret. */

/** Where "Report a problem" emails go. Override with VITE_REPORT_EMAIL. */
export const REPORT_EMAIL: string = import.meta.env.VITE_REPORT_EMAIL || "Elkyy831@gmail.com";

/** The chat bar's language model and timing (see @campus/chat). */
export const CHAT = {
  /** "auto": Chrome's built-in AI, else Gemma through Ollama, else simple patterns. "off": patterns only (also ?gemma=off). */
  gemma: "auto",
  /** The Ollama model to use when Chrome has no built-in AI; any "gemma…" model Ollama has works too. */
  ollamaModel: "gemma3:4b",
  /** Aim to reach class this many minutes before it starts. */
  arriveEarlyMin: 2,
} as const;
