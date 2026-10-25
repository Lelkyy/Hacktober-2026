import { Assistant, ChatModel, Location, TripPlanner, type ChatCampus, type ChatView, type Reply } from "@campus/chat";
import { courseKey, type LiveVehicle } from "@campus/core";
import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from "react";
import { CHAT } from "./config.ts";
import { ChevronIcon } from "./Icons.tsx";

interface Message {
  id: number;
  who: "user" | "bot";
  reply: Reply;
  /** A choice was picked: its buttons are spent. */
  used?: boolean;
}

/** What the rest of the app can ask the chat to do (the Go button by a class). */
export interface ChatHandle {
  /** Show `label` as if typed, and answer with `work`. */
  run(label: string, work: (assistant: Assistant) => Reply | Promise<Reply>): void;
}

const EXAMPLES = ["What's good under $10?", "Nearest restroom", "Next bus at Gilman"];

/**
 * The chat bar under the map: say where you need to be ("I have MATH 20C in 30
 * minutes") and the trip fills the directions panel. A language model reads the
 * message (see @campus/chat); everything said back comes from the campus data.
 */
export function ChatBar({
  campus,
  location,
  vehicles,
  view,
  ref,
}: {
  /** Null while the campus is loading. */
  campus: ChatCampus | null;
  location: Location | null;
  vehicles: () => LiveVehicle[];
  view: ChatView;
  ref?: Ref<ChatHandle>;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState("Loading campus…");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(true);
  const assistant = useRef<Assistant | null>(null);
  const nextId = useRef(0);
  const list = useRef<HTMLOListElement>(null);
  // The map callbacks change every render; the assistant keeps calling the latest.
  const latest = useRef({ view, vehicles });
  latest.current = { view, vehicles };

  useEffect(() => {
    if (!campus || !location || assistant.current) return;
    let cancelled = false;
    const courses = new Set(campus.sections?.courses.map((c) => courseKey(c.code)));
    const model = new ChatModel(CHAT, (code) => courses.has(courseKey(code)), setStatus);
    void location.start();
    void model.connect().then(() => {
      if (cancelled) return;
      assistant.current = new Assistant({
        campus,
        planner: new TripPlanner(campus),
        model,
        location,
        vehicles: () => latest.current.vehicles(),
        view: {
          trip: (trip) => latest.current.view.trip(trip),
          markers: (points, category) => latest.current.view.markers(points, category),
          stop: (ids, at) => latest.current.view.stop(ids, at),
          food: (hall) => latest.current.view.food?.(hall),
        },
        settings: CHAT,
      });
      say("bot", assistant.current.greeting(EXAMPLES));
    });
    return () => {
      cancelled = true;
    };
  }, [campus, location]);

  useImperativeHandle(ref, () => ({
    run: (label, work) => {
      const a = assistant.current;
      if (a) void ask(label, async () => work(a));
    },
  }));

  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages]);

  function say(who: Message["who"], reply: Reply) {
    setMessages((m) => [...m, { id: nextId.current++, who, reply }]);
  }

  /** Show what was asked, then the answer once `work` has it. */
  async function ask(label: string, work: () => Promise<Reply>) {
    if (busy) return;
    setOpen(true);
    say("user", { text: label });
    setBusy(true);
    try {
      say("bot", await work());
    } catch (err) {
      console.error(err);
      say("bot", { text: "Something went wrong planning that. Try saying it another way." });
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = text.trim();
    if (!message || !assistant.current) return;
    setText("");
    void ask(message, () => assistant.current!.handle(message));
  }

  const ready = !!assistant.current;
  return (
    <section className="chatbar" aria-label="Chat">
      <div className="chatbar-inner">
        {open && messages.length > 0 && (
          <ol className="chat-log" ref={list} aria-live="polite">
            {messages.map((m, i) => (
              <li key={m.id} className={`chat-msg ${m.who}`}>
                {m.reply.text}
                {m.reply.steps && m.reply.steps.length > 0 && (
                  <details>
                    <summary>Directions ({m.reply.steps.length} steps)</summary>
                    <ol>
                      {m.reply.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </details>
                )}
                {/* Only the latest answer's buttons: older ones are spent or stale. A trip's
                    other ways to travel are left out: the panel's mode strip has them. */}
                {i === messages.length - 1 && !m.used && !m.reply.steps && m.reply.choices && m.reply.choices.length > 0 && (
                  <div className="chat-choices">
                    {m.reply.choices.map((choice) => (
                      <button
                        key={choice.label}
                        disabled={busy}
                        onClick={() => {
                          setMessages((all) => all.map((x) => (x.id === m.id ? { ...x, used: true } : x)));
                          void ask(choice.label, choice.pick);
                        }}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
            {busy && <li className="chat-msg bot thinking">Thinking…</li>}
          </ol>
        )}
        {/* Model news worth seeing (a download under way); the rest sits on the input's tooltip. */}
        {status.includes("…") && ready && <p className="chat-status">{status}</p>}
        <form className="chat-ask" onSubmit={submit} title={ready ? status : undefined}>
          {messages.length > 1 && (
            <button
              type="button"
              className="icon-btn chat-toggle"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? "Hide conversation" : "Show conversation"}
              title={open ? "Hide conversation" : "Show conversation"}
            >
              <ChevronIcon up={!open} />
            </button>
          )}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={ready ? "I have MATH 20C today in 30 minutes" : status}
            aria-label="Ask Triton Trails"
            disabled={!ready}
            autoComplete="off"
          />
          <button className="primary" type="submit" disabled={!ready || busy || !text.trim()}>
            Send
          </button>
        </form>
      </div>
    </section>
  );
}
