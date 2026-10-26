---
name: campus-talk
description: >-
  Turns messy campus talk — near, far, close, slang verbs, casual nouns, and
  multi-stop then/via lists — into a trip or nearby search. Use when the
  student says near, far, close by, hit up, swing by, how far, then, via,
  through, or names more than one place.
---

# Campus talk

Students do not say "navigate to." They say near, far, hit up, swing by, then. The local parser (`repair.ts`, then `parseLocally`) must still get a complete intent. `needsModel` stays false when the hops are known.

The short copy the model sees is `campus-talk` in `packages/chat/src/skills.ts`.

## Spatial words

| They say | Means |
| --- | --- |
| near, nearby, close, close to, close by, next to, around, right by, not far from | Search or start at that place. Amenity + near = `nearby`. Place only = that building. |
| how far is X, how close is X, is X far, distance to X, I'm far from X | `route` to X. Far is a trip, not a dead end. |
| far from X (no amenity) | They want X. Route there. |

`at` / `near` on an amenity is the search center, not the destination. `not far from` is `near`. Do not invent a second meaning for "far."

## Verbs and nouns

Quiet expansions live in `repair.ts`. After repair, the usual `to` / `from` / `nearby` patterns should fire.

| They say | Treat as |
| --- | --- |
| hit up, swing by, drop by, pop over, head over, run over, make it to, get over, pull up | go to |
| how far / how close / distance to | how do I get to |
| the lib, lib | library |
| thru, by way of | through / via |
| loo, pee, potty | restroom (already in `nearby.ts`) |

A leftover slang verb is still a trip if a campus place is in the line.

## Several places

Keep every named stop, in the order they said it. Last place is the destination. Earlier places are `via`.

| They say | Hops |
| --- | --- |
| Geisel then Pines | start → Geisel → Pines |
| to Geisel via Pines | start → Pines → Geisel |
| swing by Pines then Geisel | start → Pines → Geisel |
| stop at Pines on the way to Geisel | start → Pines → Geisel |
| Geisel then Pines then WLH | start → Geisel → Pines → WLH |

Do not skip a named stop to "optimize" a shorter path. Path hop by hop on the campus graph (`TripPlanner.plan` with `via`, or `--via` on the shortest-route script). The reply is the `campus-answer` skill. Do not invent a street that ties them together.

"And I'm hungry" is food, not a stop. Only `then` / `via` / `through` / `on the way` split places.

## When you add a shape

1. Add a row to the `campus-chat` skill.
2. Teach `repair.ts` (slang) or `parseLocally` (`via`, `then`, far).
3. Add a case in `packages/chat/src/intent.test.ts`.
4. Keep `needsModel` false when place and hops are set.
