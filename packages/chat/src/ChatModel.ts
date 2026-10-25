import type { ChatSettings } from "./types.ts";
import { cleanIntent, INTENT_SCHEMA, parseLocally, systemPrompt, type Intent } from "./intent.ts";

/** Chrome's built-in model (the Prompt API). Not in TypeScript's DOM types yet. */
interface ChromeModel {
  availability(options?: object): Promise<"unavailable" | "downloadable" | "downloading" | "available">;
  create(options?: object): Promise<ChromeSession>;
}
interface ChromeSession {
  prompt(input: string, options?: { responseConstraint?: object }): Promise<string>;
  destroy(): void;
}
declare global {
  // eslint-disable-next-line no-var
  var LanguageModel: ChromeModel | undefined;
}

type Brain =
  /** ready: the model is downloaded. Until then the patterns answer while Chrome downloads it. */
  | { kind: "chrome"; model: ChromeModel; ready: boolean; downloading?: boolean }
  | { kind: "lmstudio"; model: string }
  | { kind: "ollama"; model: string }
  | { kind: "patterns" };

/**
 * Reads chat messages into an Intent with a language model on this computer:
 * Gemma through LM Studio (the dev server's /lmstudio proxy), else Chrome's
 * built-in model, else Gemma through Ollama. Otherwise, and whenever the model
 * fails, the pattern parser, so the chat always answers.
 */
export class ChatModel {
  private brain: Brain = { kind: "patterns" };

  constructor(
    private readonly settings: Pick<ChatSettings, "gemma" | "lmStudioModel" | "ollamaModel">,
    private readonly isCourse: (code: string) => boolean,
    private readonly onStatus: (message: string) => void,
  ) {}

  /** Find a model. Resolves quickly; never throws. */
  async connect(): Promise<void> {
    if (this.settings.gemma === "off" || new URLSearchParams(location.search).get("gemma") === "off") {
      this.onStatus("The language model is off. Using simple patterns.");
      return;
    }
    if (await this.connectLmStudio()) return;
    const chrome = globalThis.LanguageModel;
    if (chrome) {
      try {
        const state = await chrome.availability(LANGUAGES);
        if (state !== "unavailable") {
          this.brain = { kind: "chrome", model: chrome, ready: state === "available" };
          this.onStatus(state === "available" ? "Chrome's built-in AI is ready." : "Chrome will download its built-in AI (once) when you send your first message.");
          return;
        }
      } catch {
        // Fall through to Ollama.
      }
    }
    try {
      const res = await fetch("/ollama/api/tags", { signal: AbortSignal.timeout(1500) });
      const { models } = (await res.json()) as { models: { name: string }[] };
      const names = models.map((m) => m.name);
      const model = names.find((n) => n === this.settings.ollamaModel) ?? names.find((n) => n.startsWith("gemma"));
      if (model) {
        this.brain = { kind: "ollama", model };
        this.onStatus(`Gemma (${model}, through Ollama) is ready.`);
        return;
      }
      this.onStatus(`Ollama has no Gemma model. Run "ollama pull ${this.settings.ollamaModel}". Using simple patterns for now.`);
    } catch {
      this.onStatus(
        `No language model found. In LM Studio, load ${this.settings.lmStudioModel} and start the local server (port 1234). Using simple patterns.`,
      );
    }
  }

  get name(): string {
    if (this.brain.kind === "chrome") return "Chrome built-in AI";
    if (this.brain.kind === "lmstudio") return `Gemma (${this.brain.model})`;
    if (this.brain.kind === "ollama") return `Gemma (${this.brain.model})`;
    return "patterns";
  }

  /** `previous`: the request being changed, so "by bike instead" makes sense. */
  async read(message: string, previous: Intent | null): Promise<Intent> {
    const fallback = parseLocally(message, this.isCourse);
    const input = previous ? `Previous request: ${JSON.stringify(previous)}\nNew message: ${message}` : message;
    try {
      const answer = await this.ask(input);
      const intent = answer === null ? null : cleanIntent(JSON.parse(jsonObject(answer)));
      if (!intent) return fallback;
      // The model reads sentences better; the patterns know which course codes exist.
      if (intent.course && !this.isCourse(intent.course)) intent.course = fallback.course;
      if (!intent.course && fallback.course && intent.action !== "route") {
        intent.action = "class";
        intent.course = fallback.course;
      }
      return intent;
    } catch (err) {
      console.warn("[chat] The model failed, using patterns:", err);
      return fallback;
    }
  }

  /** Gemma 4 in LM Studio, via the Vite `/lmstudio` proxy to http://127.0.0.1:1234. */
  private async connectLmStudio(): Promise<boolean> {
    try {
      const res = await fetch("/lmstudio/v1/models", { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return false;
      const { data } = (await res.json()) as { data?: { id: string }[] };
      const names = (data ?? []).map((m) => m.id);
      const wanted = this.settings.lmStudioModel;
      const model =
        names.find((n) => n === wanted) ??
        names.find((n) => /gemma-?4/i.test(n)) ??
        names.find((n) => /gemma/i.test(n)) ??
        (names.length === 0 ? wanted : undefined);
      if (!model) return false;
      this.brain = { kind: "lmstudio", model };
      this.onStatus(`Gemma (${model}, through LM Studio) is ready.`);
      return true;
    } catch {
      return false;
    }
  }

  /** The model's raw JSON answer, or null when there's no model to ask. */
  private async ask(input: string): Promise<string | null> {
    const now = new Date();
    if (this.brain.kind === "chrome") {
      if (!this.brain.ready) {
        this.download(this.brain);
        return null;
      }
      // A fresh session each time: the date and time in the instructions stay current.
      const session = await this.brain.model.create({ ...LANGUAGES, initialPrompts: [{ role: "system", content: systemPrompt(now) }] });
      try {
        return await session.prompt(input, { responseConstraint: INTENT_SCHEMA });
      } finally {
        session.destroy();
      }
    }
    if (this.brain.kind === "lmstudio") {
      const res = await fetch("/lmstudio/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.brain.model,
          temperature: 0,
          messages: [
            { role: "system", content: systemPrompt(now) },
            { role: "user", content: input },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "intent", schema: INTENT_SCHEMA },
          },
        }),
      });
      if (!res.ok) throw new Error(`LM Studio ${res.status}`);
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return body.choices?.[0]?.message?.content ?? null;
    }
    if (this.brain.kind === "ollama") {
      const res = await fetch("/ollama/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.brain.model,
          stream: false,
          format: INTENT_SCHEMA,
          options: { temperature: 0 },
          messages: [
            { role: "system", content: systemPrompt(now) },
            { role: "user", content: input },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}`);
      const body = (await res.json()) as { message?: { content?: string } };
      return body.message?.content ?? null;
    }
    return null;
  }

  /**
   * Start Chrome's model download (it needs the click or Enter that sent a message).
   * Messages keep working with the patterns meanwhile.
   */
  private download(brain: Extract<Brain, { kind: "chrome" }>): void {
    if (brain.downloading) return;
    brain.downloading = true;
    brain.model
      .create({
        ...LANGUAGES,
        monitor: (m: EventTarget) =>
          m.addEventListener("downloadprogress", (e) => {
            const loaded = (e as Event & { loaded: number }).loaded;
            this.onStatus(`Downloading Chrome's built-in AI… ${Math.round(loaded * 100)}% (simple patterns until then)`);
          }),
      })
      .then((session) => {
        session.destroy();
        brain.ready = true;
        this.onStatus("Chrome's built-in AI is ready.");
      })
      .catch((err: unknown) => {
        brain.downloading = false;
        console.warn("[chat] Chrome couldn't download its model:", err);
        this.onStatus("Chrome couldn't download its built-in AI. Using simple patterns.");
      });
  }
}

/** The JSON object in a model reply, even if it wrapped it in prose or fences. */
function jsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = (fenced?.[1] ?? raw).trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

const LANGUAGES = { expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] };
