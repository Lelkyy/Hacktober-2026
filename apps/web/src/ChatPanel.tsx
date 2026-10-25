import { useEffect, useRef, useState } from "react";
import { courseKey, type Endpoint, type LiveVehicle, type LngLat, type ModeId } from "@campus/core";
import { Campus } from "../../simple/src/campus/loadCampus.ts";
import { Assistant, type Reply } from "../../simple/src/chat/Assistant.ts";
import { Gemma } from "../../simple/src/chat/Gemma.ts";
import { Location } from "../../simple/src/chat/Location.ts";
import { TripPlanner } from "../../simple/src/trip/TripPlanner.ts";

interface Props {
  /** Live trolleys and buses, when that layer is on. */
  vehicles: LiveVehicle[];
  /** Put the trip the chatbot chose into the directions fields, so the map draws it. */
  onApply: (trip: { from: Endpoint; to: Endpoint; mode: ModeId }) => void;
  onStop: (id: string, at: LngLat) => void;
  onFocus: (at: LngLat) => void;
}

const EXAMPLES = ["I have MATH 20C tomorrow at 11", "Nearest restroom", "Next bus at Gilman", "Take me to Geisel"];

/**
 * The Gemma chat, inside the campus-nav panel. It uses the same campus data,
 * live buses, and map as the rest of the app.
 */
export function ChatPanel({ vehicles, onApply, onStop, onFocus }: Props) {
  const [status, setStatus] = useState("Finding Gemma…");
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<{ who: "user" | "bot"; reply: Reply }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const assistant = useRef<Assistant | null>(null);
  const vehiclesRef = useRef(vehicles);
  const onApplyRef = useRef(onApply);
  const onStopRef = useRef(onStop);
  const onFocusRef = useRef(onFocus);
  vehiclesRef.current = vehicles;
  onApplyRef.current = onApply;
  onStopRef.current = onStop;
  onFocusRef.current = onFocus;
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let stopped = false;
    const campus = Campus.load();
    campus
      .then(async (loaded) => {
        const gemma = new Gemma(
          (code) => loaded.sections?.courses.some((c) => courseKey(c.code) === courseKey(code)) ?? false,
          setStatus,
        );
        await gemma.connect();
        if (stopped) return;
        const location = new Location(loaded.graph.data.bbox, (at) => onFocusRef.current(at));
        void location.start();
        const bot = new Assistant(loaded, new TripPlanner(loaded), gemma, location, () => vehiclesRef.current, {
          trip(_route, placed) {
            if (placed) onApplyRef.current(placed);
          },
          markers(points) {
            if (points[0]) onFocusRef.current(points[0].lngLat);
          },
          stop(ids, at) {
            if (ids[0]) onStopRef.current(ids[0], at);
          },
        });
        assistant.current = bot;
        setMessages([
          {
            who: "bot",
            reply: {
              text: `Hi! Tell me where you need to be. I'll check walking, biking, step-free, and the bus or trolley, and take whichever is fastest.${bot.known()}`,
              choices: EXAMPLES.map((example) => ({ label: example, pick: () => bot.handle(example) })),
            },
          },
        ]);
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!stopped) setStatus(err instanceof Error ? err.message : "Couldn't load the campus for chat.");
      });
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  const answer = async (work: () => Promise<Reply>) => {
    setBusy(true);
    try {
      const reply = await work();
      setMessages((m) => [...m, { who: "bot", reply }]);
    } catch (err) {
      console.error(err);
      setMessages((m) => [...m, { who: "bot", reply: { text: "Something went wrong planning that. Try saying it another way." } }]);
    }
    setBusy(false);
  };

  const send = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || busy || !assistant.current) return;
    setText("");
    setMessages((m) => [...m, { who: "user", reply: { text: trimmed } }]);
    void answer(() => assistant.current!.handle(trimmed));
  };

  return (
    <div className="chat-panel">
      <p className="note">{status}</p>
      <ol className="chat-log" ref={listRef} aria-live="polite">
        {messages.map((item, i) => (
          <li key={i} className={`chat-msg ${item.who}`}>
            {item.reply.text}
            {item.reply.steps && item.reply.steps.length > 0 && (
              <details>
                <summary>Directions ({item.reply.steps.length} steps)</summary>
                <ol>
                  {item.reply.steps.map((step, n) => (
                    <li key={n}>{step}</li>
                  ))}
                </ol>
              </details>
            )}
            {item.reply.choices && item.reply.choices.length > 0 && (
              <span className="choices">
                {item.reply.choices.map((choice) => (
                  <button
                    key={choice.label}
                    type="button"
                    disabled={busy || !ready}
                    onClick={() => {
                      setMessages((m) => [...m, { who: "user", reply: { text: choice.label } }]);
                      void answer(choice.pick);
                    }}
                  >
                    {choice.label}
                  </button>
                ))}
              </span>
            )}
          </li>
        ))}
        {busy && <li className="chat-msg bot thinking">Thinking…</li>}
      </ol>
      <form
        className="chat-ask"
        onSubmit={(event) => {
          event.preventDefault();
          send(text);
        }}
      >
        <input
          value={text}
          placeholder="I have MATH 20C today in 30 minutes"
          disabled={!ready || busy}
          onChange={(event) => setText(event.target.value)}
        />
        <button className="primary" type="submit" disabled={!ready || busy || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
