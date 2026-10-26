import { isLastingFact, type TravelMode } from "./intent.ts";

const KEY = "chat.memory";
const MAX_FACTS = 8;

/** Details worth keeping after this chat: how they travel, where they usually start, a class they take. */
export interface Memory {
  mode?: TravelMode;
  /** A campus query for where trips start when we don't have a newer one. */
  start?: string;
  facts: string[];
}

export function loadMemory(): Memory {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Memory>;
    return {
      mode: raw.mode,
      start: raw.start,
      facts: Array.isArray(raw.facts) ? raw.facts.filter((f): f is string => typeof f === "string" && isLastingFact(f)) : [],
    };
  } catch {
    return { facts: [] };
  }
}

export function saveMemory(memory: Memory): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // Private window or blocked storage: remembered for this visit only.
  }
}

/** Keep a lasting fact. One-off directions never get here. */
export function noteFact(memory: Memory, fact: string): void {
  const clean = fact.replace(/\s+/g, " ").trim().slice(0, 140);
  if (clean.length < 3 || !isLastingFact(clean)) return;
  memory.facts = [...memory.facts.filter((f) => f.toLowerCase() !== clean.toLowerCase()), clean].slice(-MAX_FACTS);
}
