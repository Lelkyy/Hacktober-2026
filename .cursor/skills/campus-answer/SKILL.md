---
name: campus-answer
description: >-
  Binds a Triton Trails tool call to the campus file and the shortest-route
  path graph, then writes the student reply from that result. Use when
  answering a trip, class, food-along, or nearby walk; when the model picked
  say but the line is still a campus ask; or when editing ChatModel,
  agentPrompt, intentFromAgent, integrateIntent, Assistant.go, or how a
  tool call becomes a route.
---

# Campus answer

Works with the `shortest-route` skill. The model only picks a tool. This skill is the glue: same `--from` / `--to` / `--via` / `--mode` slots, then the app writes the reply from the graph. Do not invent a path.

## Pipeline

1. `campus-chat` — repair the line, `parseLocally`. If `needsModel` is false, skip the model.
2. `campus-sources` — the tool names the file (`menus.json`, `campus-places.json`, the graph, stops, classes).
3. **Trip, class, nearby, or food-along** — run the path graph with the `shortest-route` contract. In the app that is `TripPlanner.compare` (`packages/chat/src/TripPlanner.ts`). In Cursor, run the shortest-route script.
4. **This skill** — phrase the reply from that result. The model never writes minutes, turns, hours, or a room.

Code that keeps the tool call and the router on the same slots: `integrateIntent` in `packages/chat/src/integrate.ts`.

## Slots (same as shortest-route)

| Router flag | Tool field | Intent field |
| --- | --- | --- |
| `--to` | `to` | `place` (and `to` when food is along the walk) |
| `--from` | `from` | `from` |
| `--via` | `via` | `via` (extra stops, in order) |
| `--mode` | `mode` | `mode` (`walk`, `bike`, `bus`, `accessible`) |

A dining hall as the destination is `--to`, tool `trip`, not `food`. `food` plus `along` still routes with `--to` after the menu file is read. `nearby` reads pins, then routes to the closest one.

Leave `--from` empty when they did not name a start. Do not guess. The app asks.

## After the tool

- If the model said `say` but the local read already had a place, class, food order, or amenity, recover that action (`integrateIntent`). Drop a `reply` that looks like a path (minutes, turns, "walk north").
- If `trip` has `to` and no `place`, copy `to` onto `place` so `Assistant.go` can plan.
- Quote the router when it fails. Do not sketch a street.

## Reply from the router

From shortest-route JSON (or `Assistant.go`): fastest mode, minutes, distance, the Walk / Bike / Transit comparison, then the turn-by-turn list. Mention stairs if the walk uses them. Offer `--mode accessible` when they need no stairs.

Food and nearby answers list the dishes or pins first, then the same route block.

Message shapes stay in `campus-chat`. Which file to read stays in `campus-sources`. Door-to-door times stay in `shortest-route`.
