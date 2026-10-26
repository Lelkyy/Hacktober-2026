import { AGENT_SCHEMA, agentPrompt, intentFromAgent, modelSize } from "./agent.ts";
import type { ChatSettings } from "./types.ts";
import { carryOver, needsModel, parseLocally, type Intent } from "./intent.ts";

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
 * Reads a chat line into an Intent.
 * A clear request stays on the local reader. A hard one is one tool call
 * (Qwen in LM Studio, else Ollama, else Chrome), with thinking off.
 * That call gets the campus skills the line needs (`skillPrompt`).
 * If that call fails, the local reader answers.
 */
export class ChatModel {
  private brain: Brain = { kind: "patterns" };
  /** Last time we peeked at LM Studio without blocking the reply. */
  private lookedAt = 0;

  constructor(
    private readonly settings: Pick<ChatSettings, "gemma" | "lmStudioModel" | "ollamaModel">,
    private readonly isCourse: (code: string) => boolean,
    private readonly onStatus: (message: string) => void,
  ) {}

  /** Find a model: Qwen in LM Studio, else Ollama, else Chrome's built-in one. Never throws. */
  async connect(): Promise<void> {
    if (this.settings.gemma === "off" || new URLSearchParams(location.search).get("gemma") === "off") {
      this.onStatus("The language model is off. Using simple patterns.");
      return;
    }
    if (await this.connectLmStudio()) return;
    const installed = await this.installedModel();
    if (installed) {
      this.brain = { kind: "ollama", model: installed };
      this.onStatus(`${installed} is ready.`);
      return;
    }
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
        // No built-in model either.
      }
    }
    this.onStatus(
      `No language model found. In LM Studio, load ${this.settings.lmStudioModel} and start the local server (port 1234), or run "ollama pull ${this.settings.ollamaModel}". Using simple patterns for now.`,
    );
  }

  /** The configured model, if Ollama already has it. Ollama can be slow to wake, so this waits and tries twice. */
  private async installedModel(): Promise<string | null> {
    const want = this.settings.ollamaModel.split(":")[0].toLowerCase();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch("/ollama/api/tags", { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        const { models } = (await res.json()) as { models?: { name: string }[] };
        const names = (models ?? []).map((m) => m.name).filter(isChatModel);
        return pickModel(names, this.settings.ollamaModel) ?? names.find((n) => n.toLowerCase().startsWith(want)) ?? null;
      } catch {
        // Cold start: one more try.
      }
    }
    return null;
  }

  /** Qwen in LM Studio, via the Vite `/lmstudio` proxy to http://127.0.0.1:1234. */
  private async connectLmStudio(): Promise<boolean> {
    try {
      const res = await fetch("/lmstudio/v1/models", { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return false;
      const { data } = (await res.json()) as { data?: { id: string }[] };
      const names = (data ?? []).map((m) => m.id).filter(isChatModel);
      const wanted = this.settings.lmStudioModel;
      const model = pickModel(names, wanted) ?? (names.length === 0 ? wanted : undefined);
      if (!model) return false;
      this.brain = { kind: "lmstudio", model };
      const slow = modelSize(model) >= 12 && model !== wanted;
      this.onStatus(slow ? `${model} is ready. Load ${wanted} if you want faster replies.` : `${model} is ready.`);
      return true;
    } catch {
      return false;
    }
  }

  get name(): string {
    if (this.brain.kind === "chrome") return "Chrome built-in AI";
    if (this.brain.kind === "lmstudio" || this.brain.kind === "ollama") return this.brain.model;
    return "patterns";
  }

  /** `previous`: the request being changed, so "by bike instead" makes sense. `facts`: details already remembered. */
  async read(message: string, previous: Intent | null, facts: string[] = []): Promise<Intent> {
    const local = carryOver(parseLocally(message, this.isCourse), previous, message);
    // A clear request never waits on a model. A hard one gets one tool call.
    if (!needsModel(message, local)) return local;
    if (this.brain.kind === "patterns") {
      this.lookForModel();
      return local;
    }
    const input = previous ? `Previous request: ${JSON.stringify(previous)}\nNew message: ${message}` : message;
    try {
      const answer = await withTimeout(this.ask(input, facts, message, local), 5_000);
      const intent = answer === null ? null : intentFromAgent(JSON.parse(jsonObject(answer)), local, message, this.isCourse);
      return intent ?? local;
    } catch (err) {
      console.warn("[chat] The model failed, using patterns:", err);
      return local;
    }
  }

  /** The model's raw JSON answer, or null when there's no model to ask. */
  private async ask(input: string, facts: string[], message: string, local: Intent): Promise<string | null> {
    const now = new Date();
    const prompt = agentPrompt(now, facts, message, local);
    if (this.brain.kind === "chrome") {
      if (!this.brain.ready) {
        this.download(this.brain);
        return null;
      }
      // A fresh session each time: the date, time, and skills for this line stay current.
      const session = await this.brain.model.create({ ...LANGUAGES, initialPrompts: [{ role: "system", content: prompt }] });
      try {
        return await session.prompt(input, { responseConstraint: AGENT_SCHEMA });
      } finally {
        session.destroy();
      }
    }
    if (this.brain.kind === "lmstudio") {
      const res = await fetch("/lmstudio/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5_000),
        body: JSON.stringify({
          model: this.brain.model,
          temperature: 0,
          max_tokens: 120,
          // Qwen and Gemma think before they answer. A tool call has nothing to think about.
          reasoning_effort: "none",
          chat_template_kwargs: { enable_thinking: false },
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: input },
          ],
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
        signal: AbortSignal.timeout(5_000),
        body: JSON.stringify({
          model: this.brain.model,
          stream: false,
          think: false,
          format: AGENT_SCHEMA,
          options: { temperature: 0, num_predict: 120 },
          messages: [
            { role: "system", content: prompt },
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

  /** Look for LM Studio without making this reply wait. */
  private lookForModel(): void {
    const now = Date.now();
    if (now - this.lookedAt < 4_000) return;
    this.lookedAt = now;
    void this.connectLmStudio();
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

/** Embeddings and speech models are not the chat model. */
function isChatModel(id: string): boolean {
  return !/embed|phonon|whisper/i.test(id);
}

/** The configured id, else the smallest model of that family, else the smallest loaded chat model. */
function pickModel(names: string[], wanted: string): string | undefined {
  const exact = names.find((name) => name.toLowerCase() === wanted.toLowerCase());
  if (exact) return exact;
  const family = /qwen/i.test(wanted) ? "qwen" : /gemma/i.test(wanted) ? "gemma" : wanted.split(/[/:]/)[0].toLowerCase();
  const same = names.filter((name) => name.toLowerCase().includes(family)).sort((a, b) => modelSize(a) - modelSize(b));
  if (same.length) return same[0];
  // A loaded Gemma is the model we moved off of. Don't pick it when another family was asked for.
  if (/gemma/i.test(wanted)) return [...names].sort((a, b) => modelSize(a) - modelSize(b))[0];
  const other = names.filter((name) => !/gemma/i.test(name));
  return [...other].sort((a, b) => modelSize(a) - modelSize(b))[0];
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("model timeout")), ms);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
