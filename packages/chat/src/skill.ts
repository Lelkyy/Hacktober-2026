import shortestRouteFile from "../../../.cursor/skills/shortest-route/SKILL.md?raw";

/** An Agent Skill (agentskills.io): SKILL.md's name and description, and the instructions under them. */
export interface Skill {
  name: string;
  description: string;
  instructions: string;
}

/** Reads a SKILL.md: the `---` frontmatter (`key: value`, or `key: >-` with indented lines), then the body. */
export function parseSkill(text: string): Skill {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error("SKILL.md has no frontmatter.");
  const fields: Record<string, string> = {};
  let key = "";
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-z][\w-]*):\s*(.*)$/);
    if (field) {
      key = field[1];
      fields[key] = /^[>|]-?$/.test(field[2]) ? "" : field[2].trim();
    } else if (key && line.trim()) {
      fields[key] = `${fields[key]} ${line.trim()}`.trim();
    }
  }
  if (!fields.name || !fields.description) throw new Error("SKILL.md needs a name and a description.");
  return { name: fields.name, description: fields.description, instructions: match[2].trim() };
}

/** .cursor/skills/shortest-route: how to find the fastest campus route. The chat's Gemma reads it with every message. */
export const SHORTEST_ROUTE = parseSkill(shortestRouteFile);

/**
 * The skill as Gemma reads it. Gemma can't run commands here, so it answers with
 * the router's arguments, and the app runs the skill's router (scripts/router.ts) with them.
 */
export function skillPrompt(skill: Skill = SHORTEST_ROUTE): string {
  return `Skill "${skill.name}": ${skill.description}
You can't run commands in this app. To use this skill, answer action "route" (or "class" for a course) and the app runs the skill's router for you: put --to in place (or course), --from in from, --mode in mode. As the skill says, set mode only when they asked for one, and leave from out when they didn't say where they are (the app uses their GPS, or asks).
The skill's instructions:
${skill.instructions}`;
}
