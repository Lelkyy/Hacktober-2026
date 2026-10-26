---
name: shortest-route
description: >-
  Finds the shortest-time campus route between two points using Triton Trails
  (walk, bike, transit). Use when the user wants directions, the fastest way
  to a building (Geisel, Price Center, WLH), a class, or a place; when they
  ask for a best/shortest/quickest route; or when they give a destination and
  you should use their current location as the start.
---

# Shortest-time campus route

Use this project's path graph. Do not invent streets or use Google/Apple Maps. When the chat model runs on a trip, `agentPrompt` attaches this skill from `packages/chat/src/skills.ts`.

## Workflow

1. **Destination** — a building, room (`WLH 2001`), place name, or `lat,lng`.
2. **Origin** — in order:
   - GPS they just gave (`32.877,-117.237` is lat,lng)
   - a named campus start they named
   - if they only said a destination ("get me to Geisel"), **ask for current location** (GPS or a nearby building). Do not guess a start.
3. **Run the router** from the repo root:

```bash
npx tsx .cursor/skills/shortest-route/scripts/shortest-route.ts --from "<origin>" --to "<destination>"
```

Repeat `--via "<stop>"` for extra places, in the order they named them (`then` / `via` / `through`). Path hop by hop. Do not skip a named stop.

Pass `--json` when you need structured output. Pass `--mode walk|bike|scooter|bus|accessible` only when they asked for that mode (Spin bike or scooter is `scooter`, transit is `bus`). Default compares Walk and Transit and picks whichever is faster (`walkWeight: 1`). Do not add bike or Spin unless they asked.

4. **Reply** with the `campus-answer` skill: fastest mode, minutes, distance, the comparison, and the turn-by-turn list. Mention stairs if the fastest walk uses them; offer `--mode accessible` if they need no stairs. The app uses the same slots through `integrateIntent` and `TripPlanner.compare`.

## Examples

User: "How do I get to Geisel?"
- Ask for where they are now (GPS or a building).
- Then: `--from 32.8796,-117.2359 --to Geisel` (or `--from "Price Center" --to Geisel`).

User: "Fastest way from Warren Lecture Hall to Geisel"
- `--from "Warren Lecture Hall" --to Geisel`

User: "No stairs from CSE to Geisel"
- `--from CSE --to Geisel --mode accessible`

User: "Price Center then Geisel then WLH"
- `--from "<start>" --via "Price Center" --via Geisel --to WLH`

## Rules

- Coordinates are WGS84. People say **lat,lng**; the graph stores **[lng, lat]**. The script accepts either order if one value is clearly a longitude.
- Search is typo-tolerant (`geisle` → Geisel Library). If the script prints "Did you mean", confirm before routing.
- A Spin bike or scooter is `--mode scooter`, and only when they asked. The app uses the live Spin feed for that ride.
- If the script fails (off the mapped network, shuttle-only building), quote its error. Do not sketch a fake path.
