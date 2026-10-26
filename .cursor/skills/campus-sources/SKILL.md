---
name: campus-sources
description: >-
  Maps a Triton Trails question to the campus file that answers it: dining
  hours and menus, nearby places, routes, bus times, or classes. Use when
  the open model (Gemma or Qwen in LM Studio or Ollama), ChatModel, agentPrompt, or a
  student message might read food times from the wrong place, confuse hours
  with places near other places, or answer from memory instead of menus.json,
  campus-places.json, or the path graph.
---

# Campus sources

The open model only picks a tool. The app reads the file for that tool and writes the reply. Gemma does not know today's hours, the nearest restroom, or a path.

Model, in order (`apps/web/src/config.ts`, `packages/chat/src/ChatModel.ts`): Qwen in LM Studio (`qwen/qwen3.5-9b`, local server on port 1234), else Ollama (`qwen3.5:9b`), else Chrome's built-in model, else the local parser alone. Thinking stays off. One JSON tool call (`agentPrompt` in `packages/chat/src/agent.ts`). A clear line never waits on the model (`needsModel` in `packages/chat/src/intent.ts`). When the model does run, `agentPrompt` attaches the skills that line needs from `packages/chat/src/skills.ts` (campus-chat, campus-sources, and shortest-route on a trip).

## Which file

| They ask | Tool | Read this | Not this |
| --- | --- | --- | --- |
| Open, closed, hours, what's serving, a dish, a price (`64 Degrees close`, `burrito under $12`, `what's good under $10`) | `food` | `apps/web/public/data/menus.json`. Hours are `halls[].stations[].hours` (`day`, `open`, `close`), read with `hoursOn` and `isOpenAt` in `packages/chat/src/diningMenu.ts`. Dishes and prices are `items`, ranked by `recommend` in `packages/chat/src/menus.ts`. | `campus-places.json` has pins, not clocks. `under 10` is `maxPrice`, not a time and not a dish. |
| Nearest restroom, water, coffee, printer, parking, bike rack, ATM, or a place near another place (`coffee at Geisel`, `bathroom near Price Center`) | `nearby` | `apps/web/public/data/campus-places.json`. A point is `[lng, lat, category index, name, kind, building]`. `nearest` in `packages/chat/src/nearby.ts` picks the kind (`NEARBY_KINDS`) and sorts by straight-line meters. The route graph then gives the walk. | Menus have no restrooms. `at` / `near` is where to search, not a destination. |
| How to get somewhere, including a dining hall as the destination (`take me to 64 Degrees`, `Geisel`) | `trip` | The path graph, `apps/web/public/data/graph.json`, through the `shortest-route` skill. | A hall name is a place to route to. It is not a menu and not "nearest food". |
| Food on the way (`anything under $10 on the way to Muir`) | `food` with `along` | Menus for the dishes, then the graph for halls near that route. | Not a nearby search for the word "under". |
| Next bus at a stop (`next bus at Gilman`, `bus times`) | `stop` | Shuttle and trolley arrivals on `ChatCampus.transit`, via `stopNamed`, `nearestStop`, and `arrivalsAtStops` in `packages/chat/src/stops.ts`. No stop name means the nearest stop. | Dining hours. `next bus to Geisel` is a trip with mode `bus`, not the stop board. |
| Class, next class, add or drop (`MATH 20C in 20`) | `classes` | Saved sections in this browser (`localStorage` key `chat.sections`, `packages/chat/src/myClasses.ts`). Rooms and meeting times come from `ChatCampus.sections` and `ChatCampus.search`. `in 20` is minutes until they need to be there. | Not a food time. Sections are null when the private schedule file is absent; say so. |

`say` is anything else. One short sentence about directions, food, buses, or classes. No campus file, and no invented room, time, or path.

## Rules for the model

1. Repair the line, then `parseLocally`. If `needsModel` is false, do not call the model.
2. The tool names the file in the table. Read that file. If it has no row for the question, say the chat does not have that fact.
3. Wait times are not in `menus.json`. A Triton2Go clock (`packages/chat/src/dining.ts`) is when the kitchen may see the ticket, not when the food is ready.
4. Do not paste menus or place lists into `agentPrompt`. Skill text comes from `packages/chat/src/skills.ts` via `pickSkills` / `skillPrompt`. Keep those copies in sync with this file and the campus-chat / shortest-route skills.
5. Refresh hours with `npm run fetch:menus`. Refresh pins with `npm run fetch:places`. Rebuild paths with `npm run build:graph`.

Message shapes and typo repairs stay in the `campus-chat` skill. Door-to-door times stay in the `shortest-route` skill. The student-facing reply is the `campus-answer` skill.
