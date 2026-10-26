import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  closedStatus,
  handle,
  isAcknowledgement,
  stampAssignment,
  subagentFollowup,
  parentFollowup,
} from "./manager.mjs";

const hook = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "hooks", "agent-manager.mjs");

function root() {
  return mkdtempSync(path.join(tmpdir(), "agent-manager-"));
}

function run(payload) {
  return handle({ workspace_roots: [root()], ...payload });
}

test("acknowledgements do not replace the task", () => {
  assert.equal(isAcknowledgement("ok"), true);
  assert.equal(isAcknowledgement("fix the stop colors"), false);
  const workspace = root();
  handle({
    hook_event_name: "beforeSubmitPrompt",
    conversation_id: "c1",
    prompt: "fix the stop colors",
    workspace_roots: [workspace],
  });
  handle({
    hook_event_name: "beforeSubmitPrompt",
    conversation_id: "c1",
    prompt: "go ahead",
    workspace_roots: [workspace],
  });
  const board = JSON.parse(
    readFileSync(path.join(workspace, ".cursor/agent-manager/state/board.json"), "utf8"),
  );
  assert.equal(board.conversations.c1.task, "fix the stop colors");
});

test("a new request replaces the task", () => {
  const workspace = root();
  handle({
    hook_event_name: "beforeSubmitPrompt",
    conversation_id: "c1",
    prompt: "fix the stop colors",
    workspace_roots: [workspace],
  });
  handle({
    hook_event_name: "beforeSubmitPrompt",
    conversation_id: "c1",
    prompt: "add a dining filter",
    workspace_roots: [workspace],
  });
  const board = JSON.parse(
    readFileSync(path.join(workspace, ".cursor/agent-manager/state/board.json"), "utf8"),
  );
  assert.equal(board.conversations.c1.task, "add a dining filter");
});

test("stamps the parent task onto a subagent once", () => {
  const stamped = stampAssignment("Update StopPanel stripes.", "fix the stop colors");
  assert.match(stamped, /Parent task: fix the stop colors/);
  assert.match(stamped, /Update StopPanel stripes\./);
  assert.equal(stampAssignment(stamped, "other"), stamped);
});

test("placeholder status lines do not count as closed", () => {
  assert.equal(closedStatus("STATUS: done — <evidence>"), null);
  assert.equal(closedStatus("STATUS: done — edited StopPanel"), "done");
  assert.equal(closedStatus("STATUS: blocked — missing the timetable"), "blocked");
});

test("empty subagent results get one pull back", () => {
  const follow = subagentFollowup({
    status: "completed",
    loopCount: 0,
    task: "Update StopPanel stripes.",
    summary: "",
  });
  assert.match(follow.followup_message, /Finish only this/);
  assert.deepEqual(
    subagentFollowup({
      status: "completed",
      loopCount: 1,
      task: "Update StopPanel stripes.",
      summary: "",
    }),
    {},
  );
});

test("a finished subagent is left alone", () => {
  assert.deepEqual(
    subagentFollowup({
      status: "completed",
      loopCount: 0,
      task: "Update StopPanel stripes.",
      summary: "STATUS: done — stripe colors now come from lineColor",
    }),
    {},
  );
  assert.deepEqual(
    subagentFollowup({
      status: "completed",
      loopCount: 0,
      task: "Update StopPanel stripes.",
      summary: "Stripe colors now come from lineColor, and the panel test covers 201.",
    }),
    {},
  );
});

test("drift gets a follow-up", () => {
  const child = subagentFollowup({
    status: "completed",
    loopCount: 0,
    task: "Update StopPanel stripes.",
    summary: "I also refactored the dining menu while I was here.",
  });
  assert.match(child.followup_message, /outside the assignment/);
  const parent = parentFollowup({
    status: "completed",
    loopCount: 0,
    task: "fix the stop colors",
    lastResponse: "I went ahead and rewrote the router too.",
  });
  assert.match(parent.followup_message, /fix the stop colors/);
  assert.deepEqual(
    parentFollowup({
      status: "completed",
      loopCount: 0,
      task: "fix the stop colors",
      lastResponse: "Stop squares now use the route color. STATUS: done — edited lineColor.ts",
    }),
    {},
  );
});

test("Task calls are stamped and recorded", () => {
  const workspace = root();
  handle({
    hook_event_name: "beforeSubmitPrompt",
    conversation_id: "c1",
    prompt: "fix the stop colors",
    workspace_roots: [workspace],
  });
  const out = handle({
    hook_event_name: "preToolUse",
    tool_name: "Task",
    tool_use_id: "tool-1",
    conversation_id: "c1",
    workspace_roots: [workspace],
    tool_input: {
      description: "Color the stops",
      prompt: "Update the stop square colors.",
      subagent_type: "generalPurpose",
    },
  });
  assert.equal(out.permission, "allow");
  assert.match(out.updated_input.prompt, /Parent task: fix the stop colors/);
  assert.equal(out.updated_input.description, "Color the stops");
  const board = JSON.parse(
    readFileSync(path.join(workspace, ".cursor/agent-manager/state/board.json"), "utf8"),
  );
  assert.equal(board.conversations.c1.agents["tool-1"].status, "working");
});

test("shell calls are ignored", () => {
  assert.deepEqual(
    run({ hook_event_name: "preToolUse", tool_name: "Shell", tool_input: { command: "ls" } }),
    {},
  );
});

test("a subagent that stops empty is nudged on the board", () => {
  const workspace = root();
  const stamped = stampAssignment("Update the stop square colors.", "fix the stop colors");
  handle({
    hook_event_name: "subagentStart",
    parent_conversation_id: "c1",
    subagent_id: "sub-1",
    tool_call_id: "tool-1",
    subagent_type: "generalPurpose",
    task: stamped,
    workspace_roots: [workspace],
  });
  const out = handle({
    hook_event_name: "subagentStop",
    parent_conversation_id: "c1",
    status: "completed",
    loop_count: 0,
    task: stamped,
    summary: "",
    workspace_roots: [workspace],
  });
  assert.match(out.followup_message, /Update the stop square colors/);
  const board = JSON.parse(
    readFileSync(path.join(workspace, ".cursor/agent-manager/state/board.json"), "utf8"),
  );
  assert.equal(board.conversations.c1.agents["sub-1"].status, "nudged");
});

test("the parent is pulled back only after drift", () => {
  const workspace = root();
  handle({
    hook_event_name: "beforeSubmitPrompt",
    conversation_id: "c1",
    prompt: "fix the stop colors",
    workspace_roots: [workspace],
  });
  handle({
    hook_event_name: "afterAgentResponse",
    conversation_id: "c1",
    text: "I also refactored the trip planner while I was here.",
    workspace_roots: [workspace],
  });
  const drifted = handle({
    hook_event_name: "stop",
    conversation_id: "c1",
    status: "completed",
    loop_count: 0,
    workspace_roots: [workspace],
  });
  assert.match(drifted.followup_message, /fix the stop colors/);
  handle({
    hook_event_name: "afterAgentResponse",
    conversation_id: "c1",
    text: "Squares use the route color. STATUS: done — edited lineColor.ts",
    workspace_roots: [workspace],
  });
  assert.deepEqual(
    handle({
      hook_event_name: "stop",
      conversation_id: "c1",
      status: "completed",
      loop_count: 0,
      workspace_roots: [workspace],
    }),
    {},
  );
});

test("the hook command records the task", () => {
  const workspace = root();
  const result = spawnSync("node", [hook], {
    input: JSON.stringify({
      hook_event_name: "beforeSubmitPrompt",
      conversation_id: "c1",
      prompt: "fix the stop colors",
      workspace_roots: [workspace],
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { continue: true });
  const board = JSON.parse(
    readFileSync(path.join(workspace, ".cursor/agent-manager/state/board.json"), "utf8"),
  );
  assert.equal(board.conversations.c1.task, "fix the stop colors");
});
