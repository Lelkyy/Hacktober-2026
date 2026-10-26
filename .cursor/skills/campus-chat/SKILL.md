---
name: campus-chat
description: >-
  Reads Triton Trails chat messages into a campus action (route, class, food,
  nearby, bus, schedule) and answers from the local parser first. Use when
  changing the chat bar, intents, typos, mistyped prompts, complex questions,
  slow replies, parseLocally, ChatModel, or what a student message should do.
---

# Campus chat

The chat answers from `packages/chat`. The local parser is the fast path. A language model runs only when `needsModel` is true and one is already connected, and that call is capped at 5 seconds. Do not probe LM Studio on the message that the student is waiting on. When the model runs, `agentPrompt` attaches this skill (and the others the line needs) from `packages/chat/src/skills.ts`.

## What to do

1. Repair the line (`repair.ts`), then `parseLocally`.
2. If `needsModel` is false, return that intent. Do not call a model.
3. If it is true and no model is connected, return the local intent anyway and look for LM Studio in the background.
4. Reply from campus data (search, schedule, menus, the route graph). Never invent a room, a time, or a path. Which file answers food times, nearby places, buses, or a route is the `campus-sources` skill. The reply itself is the `campus-answer` skill (shortest-route for a trip).

Show `heard` when a real word was corrected, so a typo is visible.

## Message shapes

| They say | Action | Notes |
| --- | --- | --- |
| `Geisel`, `yo geisle?`, `WLH 2001`, `geisel in 20` | route | Bare place. `in 20` is 20 minutes. |
| `hw do i gt to geisle`, `take me 2 geisel from pc by bike` | route | Fix the typo, keep from / mode / time. |
| `hit up geisel`, `how far is pines`, `is geisel far` | route | Slang and "how far" are a trip. `campus-talk` skill. |
| `swing by pines then geisel`, `to geisel via pines` | route, via | `then` / `via` are extra stops, in order. Last place is the destination. |
| `next bus to geisel`, `bus to Price Center` | route, mode bus | A destination, not the stop board. |
| `next bus at Gilman`, `bus times` | stop | Delete mode. No stop name means the nearest stop. |
| `bathroom`, `wheres the nearest bathrom`, `coffee at geisel`, `i need to pee` | nearby | The whole phrase is the amenity. `at` / `near` is where. |
| `coffee close to geisel`, `bathroom not far from pines` | nearby | close / not far = near. |
| `geisel library` | route | Library in a building name is not "nearest study spot". |
| `MATH 20C in 20`, `cse12 discussion at 4 biking from price center` | class | Real course code only. |
| `class in 20`, `take me to class`, `where's my next class` | next | No course code. |
| `i have math 20c in 30 and i'm hungry` | class, along | Class wins. Food is listed on that route. |
| `heading toward geisel, i'm starving`, `anything under $10 on the way to Muir` | order, along | Food near the route. A dining hall as the destination is `place`, not `to`. |
| `burrito at 64 degrees under 12` | order | `under` is exclusive. Not a dish named "under". |
| `what's good under $10` | order | No hall yet: closest open hall once we know where they are. |
| `add CSE 12`, `drop CSE 12`, `what are my classes`, `what do I have tomorrow` | add / drop / classes / day | |
| `by bike instead`, `I'm at Price Center`, `same place` | change | Keeps the last trip. No trip yet: remember the start and ask where to. |
| `I usually bike`, `I use a wheelchair` | remember | One-off trips are not remembered. |
| `where tf is geisel`, `i gotta piss`, `gimme a burrito im broke`, `im at sixth, get me to geisel but im hungry` | route / nearby / order | Filler and slang come off. The place, amenity, or food is the request. |
| `what's the deal with the shuttle` | stop | A bus with no destination is the stop board. |
| `why is the bus always late` | other + reply | No live delays. The next scheduled bus is the offer. |
| `i'm lost`, `what time is it`, `who are you`, `tell me a joke`, `this is stupid`, `talk to me` | other + reply | The reply answers that line. Instant. |
| `help`, `hey`, `asdf`, `thanks` | other + reply | Instant. Do not wait on a model. |
| A long line with no place, class, food, or amenity | other, no reply | `needsModel` may ask a connected model. If that fails, answer the line and say what the chat can do. |

A place the search misses gets up to four "did you mean" choices, not a dead end.

While the chat is asking "where are you?", a short place (`Geisel`, `Price Center`) is the start. `take me to Geisel` is a new trip.

## Typos

Quiet fixes stay invisible: `gonna`, `im`, `whats`, `mins`, `tmrw`, `pc` (Price Center), `u`, `2` used as "to".

Loud fixes set `heard`: place and verb typos (`geisle`, `mur`, `goign`, `bathrom`, `hw`, `gt`) plus a one-edit fuzzy match against campus words. Do not fuzzy a word that is already a real word (`anything`, `math`, `degrees`, course subjects).

## When you add a shape

1. Add the row above.
2. Teach `parseLocally` (and `repair.ts` if it is a typo).
3. Add a case in `packages/chat/src/intent.test.ts`.
4. Keep `needsModel` false when the parse is complete. A long sentence is not a reason to wait.
