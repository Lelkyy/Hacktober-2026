#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { handle } from "../agent-manager/manager.mjs";

try {
  const raw = readFileSync(0, "utf8");
  const payload = raw.trim() ? JSON.parse(raw) : {};
  process.stdout.write(JSON.stringify(handle(payload) ?? {}) + "\n");
} catch (err) {
  process.stderr.write(`agent-manager: ${err instanceof Error ? err.message : String(err)}\n`);
  process.stdout.write("{}\n");
}
