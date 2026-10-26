import { mkdirSync, openSync, closeSync, unlinkSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";

const MARKER = "AGENT MANAGER\n";
const ASSIGNMENT_START = "AGENT MANAGER ASSIGNMENT START\n";
const DRIFT =
  /\b(while I was (?:at it|here)|went ahead and|drive-by|I also (?:refactored|cleaned up|added a new))\b/i;
const UNFINISHED = /\b(didn'?t finish|did not finish|not started|left unfinished|stopped early)\b/i;
const STUB = /^(done|fixed|ok|okay|finished)\.?$/i;
const ACK =
  /^(y|yes|yep|yeah|ok|okay|k|sure|go|continue|do it|do that|lgtm|ship it|thanks|thank you|please|sounds good|looks good|go ahead|proceed)\.?!?$/i;

export function oneLine(text, max) {
  const line = String(text).replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  return line.slice(0, max - 1) + "…";
}

export function isAcknowledgement(prompt) {
  const text = String(prompt).trim();
  if (text.length <= 2) return true;
  return ACK.test(text);
}

export function closedStatus(text) {
  const match = String(text).match(/STATUS:\s*(done|blocked)\b[^\n]*/i);
  if (!match) return null;
  const line = match[0];
  if (/<evidence>|<what is missing>/i.test(line)) return null;
  if (!/[—:-]\s*\S/.test(line)) return null;
  return match[1].toLowerCase();
}

export function stampAssignment(prompt, parentTask) {
  if (prompt.startsWith(MARKER)) return prompt;
  const taskLine = parentTask
    ? `Parent task: ${oneLine(parentTask, 400)}`
    : "No user task is recorded yet.";
  return [
    MARKER.trimEnd(),
    taskLine,
    "Do only the assignment below. Do not start other features, refactors, or research outside it.",
    "End with one line: STATUS: done — <evidence> or STATUS: blocked — <what is missing>.",
    "",
    ASSIGNMENT_START.trimEnd(),
    prompt,
  ].join("\n");
}

export function extractAssignment(stamped) {
  const text = String(stamped);
  const index = text.indexOf(ASSIGNMENT_START);
  if (index === -1) return text.trim();
  return text.slice(index + ASSIGNMENT_START.length).trim();
}

export function subagentFollowup({ status, loopCount, task, summary }) {
  if (status !== "completed") return {};
  if (Number(loopCount) > 0) return {};
  const text = String(summary || "");
  if (closedStatus(text)) return {};
  const assignment = oneLine(extractAssignment(String(task || "")), 800) || "the assignment you were given";
  const drifted = DRIFT.test(text) || /STATUS:\s*off-task\b/i.test(text);
  const unfinished = text.trim().length === 0 || STUB.test(text.trim()) || UNFINISHED.test(text);
  if (!drifted && !unfinished) return {};
  const lead = drifted
    ? "Agent manager: that went outside the assignment. Drop the extra work and finish only this:"
    : "Agent manager: you stopped before finishing. Finish only this, then stop:";
  return {
    followup_message: `${lead}\n${assignment}\nEnd with STATUS: done — <evidence> or STATUS: blocked — <what is missing>.`,
  };
}

export function parentFollowup({ status, loopCount, task, lastResponse }) {
  if (status !== "completed") return {};
  if (Number(loopCount) > 0) return {};
  const assigned = String(task || "").trim();
  if (!assigned) return {};
  const text = String(lastResponse || "");
  if (closedStatus(text)) return {};
  if (!DRIFT.test(text)) return {};
  return {
    followup_message: `Agent manager: that went outside the task. Drop the extra work and finish only this:\n${oneLine(assigned, 800)}\nEnd with STATUS: done — <evidence> or STATUS: blocked — <what is missing>.`,
  };
}

export function conversationId(payload) {
  return payload.parent_conversation_id || payload.conversation_id || payload.session_id || "default";
}

export function workspaceRoot(payload) {
  const roots = payload.workspace_roots;
  if (Array.isArray(roots) && typeof roots[0] === "string" && roots[0]) return roots[0];
  return process.cwd();
}

function toolInput(payload) {
  const input = payload.tool_input;
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch {
      return {};
    }
  }
  return input && typeof input === "object" ? { ...input } : {};
}

function ensure(state, id) {
  if (!state.conversations[id]) {
    state.conversations[id] = { task: "", taskAt: "", lastResponse: "", agents: {} };
  }
  if (!state.conversations[id].agents) state.conversations[id].agents = {};
  return state.conversations[id];
}

function upsert(convo, incoming) {
  const found = Object.values(convo.agents).find(
    (agent) =>
      (incoming.toolId && agent.toolId === incoming.toolId) ||
      (incoming.subagentId && agent.subagentId === incoming.subagentId) ||
      agent.id === incoming.id,
  );
  if (found) {
    for (const [key, value] of Object.entries(incoming)) {
      if (value !== "" && value != null) found[key] = value;
    }
    return found;
  }
  convo.agents[incoming.id] = { ...incoming };
  return convo.agents[incoming.id];
}

function prune(state) {
  const conversations = Object.entries(state.conversations);
  if (conversations.length > 20) {
    conversations.sort((a, b) => String(a[1].taskAt).localeCompare(String(b[1].taskAt)));
    for (const [id] of conversations.slice(0, conversations.length - 20)) delete state.conversations[id];
  }
  for (const convo of Object.values(state.conversations)) {
    const agents = Object.entries(convo.agents || {});
    if (agents.length <= 40) continue;
    agents.sort((a, b) => String(a[1].updatedAt).localeCompare(String(b[1].updatedAt)));
    for (const [id] of agents.slice(0, agents.length - 40)) delete convo.agents[id];
  }
}

export function renderBoard(state) {
  const conversations = Object.entries(state.conversations || {});
  if (conversations.length === 0) return "# Agent manager\n\nNo tasks yet.\n";
  const lines = ["# Agent manager", ""];
  for (const [id, convo] of conversations) {
    lines.push(`## ${id}`, "");
    lines.push(convo.task ? `Task: ${oneLine(convo.task, 300)}` : "Task: (none yet)", "");
    const agents = Object.values(convo.agents || {});
    if (agents.length === 0) {
      lines.push("Agents: none", "");
      continue;
    }
    lines.push("| Agent | Status | Assignment |", "| --- | --- | --- |");
    for (const agent of agents) {
      const name = String(agent.description || agent.type || agent.id || "agent").replace(/\|/g, "/");
      const assignment = oneLine(agent.assignment || "", 80).replace(/\|/g, "/");
      lines.push(`| ${name} | ${agent.status || "working"} | ${assignment} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function withBoard(root, fn) {
  const dir = path.join(root, ".cursor", "agent-manager", "state");
  mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, "board.lock");
  const started = Date.now();
  let fd;
  for (;;) {
    try {
      fd = openSync(lock, "wx");
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      if (Date.now() - started > 2000) {
        try {
          unlinkSync(lock);
        } catch {
          // another writer took it
        }
        continue;
      }
      sleepMs(20);
    }
  }
  try {
    const file = path.join(dir, "board.json");
    let state = { conversations: {} };
    try {
      state = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      state = { conversations: {} };
    }
    if (!state.conversations) state.conversations = {};
    const result = fn(state);
    prune(state);
    const tmp = path.join(dir, "board.json.tmp");
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, file);
    writeFileSync(path.join(dir, "board.md"), renderBoard(state));
    return result;
  } finally {
    closeSync(fd);
    try {
      unlinkSync(lock);
    } catch {
      // lock already cleared
    }
  }
}

function sessionContext(task) {
  const lines = [
    "Agent manager is on. The user's latest request is the only task. Do that and stop.",
    "Do not widen it into refactors, extra features, or drive-by fixes.",
    "A subagent gets one slice of that task. It does not get a new goal.",
    "End with one line: STATUS: done — <evidence> or STATUS: blocked — <what is missing>.",
  ];
  if (task) lines.push(`Current task: ${oneLine(task, 400)}`);
  return lines.join("\n");
}

export function handle(payload) {
  try {
    return dispatch(payload);
  } catch (err) {
    process.stderr.write(`agent-manager: ${err instanceof Error ? err.message : String(err)}\n`);
    if (payload.hook_event_name === "beforeSubmitPrompt") return { continue: true };
    return {};
  }
}

function dispatch(payload) {
  const event = payload.hook_event_name;
  const root = workspaceRoot(payload);
  if (event === "sessionStart") {
    const id = conversationId(payload);
    let task = "";
    withBoard(root, (state) => {
      task = state.conversations[id]?.task || "";
    });
    return { additional_context: sessionContext(task) };
  }
  if (event === "beforeSubmitPrompt") {
    const id = conversationId(payload);
    const prompt = String(payload.prompt || "");
    withBoard(root, (state) => {
      const convo = ensure(state, id);
      if (!isAcknowledgement(prompt)) {
        convo.task = prompt.trim().slice(0, 4000);
        convo.taskAt = new Date().toISOString();
        convo.lastResponse = "";
      }
    });
    return { continue: true };
  }
  if (event === "preToolUse") {
    if (payload.tool_name !== "Task") return {};
    const input = toolInput(payload);
    const prompt = typeof input.prompt === "string" ? input.prompt : "";
    if (!prompt) return { permission: "allow" };
    const id = conversationId(payload);
    withBoard(root, (state) => {
      const convo = ensure(state, id);
      const stamped = stampAssignment(prompt, convo.task || "");
      input.prompt = stamped;
      upsert(convo, {
        id: payload.tool_use_id || `task-${Date.now()}`,
        toolId: payload.tool_use_id || "",
        description: String(input.description || "").slice(0, 200),
        type: String(input.subagent_type || ""),
        assignment: extractAssignment(stamped),
        stamped,
        background: input.run_in_background === true,
        status: "working",
        updatedAt: new Date().toISOString(),
      });
    });
    return { permission: "allow", updated_input: input };
  }
  if (event === "subagentStart") {
    const id = conversationId(payload);
    withBoard(root, (state) => {
      const convo = ensure(state, id);
      const toolId = payload.tool_call_id || "";
      upsert(convo, {
        id: payload.subagent_id || toolId || `sub-${Date.now()}`,
        toolId,
        subagentId: payload.subagent_id || "",
        type: String(payload.subagent_type || ""),
        assignment: extractAssignment(String(payload.task || "")),
        stamped: String(payload.task || ""),
        status: "working",
        updatedAt: new Date().toISOString(),
      });
    });
    return { permission: "allow" };
  }
  if (event === "subagentStop") {
    const follow = subagentFollowup({
      status: payload.status,
      loopCount: payload.loop_count,
      task: payload.task,
      summary: payload.summary,
    });
    const id = conversationId(payload);
    const task = String(payload.task || "");
    withBoard(root, (state) => {
      const convo = state.conversations[id];
      if (!convo) return;
      const agent = Object.values(convo.agents).find(
        (item) => item.stamped === task || (item.assignment && task.includes(item.assignment)),
      );
      if (!agent) return;
      const closed = closedStatus(String(payload.summary || ""));
      agent.status = follow.followup_message
        ? "nudged"
        : closed || (payload.status === "completed" ? "reported" : payload.status || "reported");
      agent.note = oneLine(String(payload.summary || ""), 240);
      agent.updatedAt = new Date().toISOString();
    });
    return follow;
  }
  if (event === "afterAgentResponse") {
    const text = String(payload.text || "").slice(0, 4000);
    if (!text) return {};
    const id = conversationId(payload);
    withBoard(root, (state) => {
      ensure(state, id).lastResponse = text;
    });
    return {};
  }
  if (event === "stop") {
    const id = conversationId(payload);
    let task = "";
    let lastResponse = "";
    withBoard(root, (state) => {
      const convo = state.conversations[id];
      task = convo?.task || "";
      lastResponse = convo?.lastResponse || "";
    });
    return parentFollowup({
      status: payload.status,
      loopCount: payload.loop_count,
      task,
      lastResponse,
    });
  }
  if (event === "sessionEnd") {
    const id = payload.session_id || conversationId(payload);
    withBoard(root, (state) => {
      const convo = state.conversations[id];
      if (convo) convo.endedAt = new Date().toISOString();
    });
    return {};
  }
  return {};
}
