# Problems (current)

Logged 2026-10-19 from the app on `main` at `0efe983`. Product gaps, not a feature wishlist. Open this file when changing live transit or the UI.

## 1. Not realtime in a usable way

Buses and trolleys do not move like a live map. What shows up is late, jumpy, or easy to distrust.

| Layer | Behavior | Where |
|---|---|---|
| Agency | New GPS in batches about every 30–40s; each fix is already slightly old | comment in `apps/web/src/mts.ts` |
| Client poll | Every 10s, and not while the tab is hidden | `LIVE_REFRESH_MS`, live effect in `apps/web/src/App.tsx` |
| Model | Nothing is estimated. The vehicle stays on the last fix. | `packages/core/src/liveTransit.ts` |
| Draw | Teleport when `fixAt` changes. No glide along the route. | marker effect in `apps/web/src/MapView.tsx` |
| Clock | Age label ticks every 1s, so the UI looks alive while the dot is frozen | `showAges` in `MapView.tsx` |
| Heading | Often missing from the protobuf; guessed only after the vehicle moves at least 12 m | `liveVehicles` |
| Detail | Route-ahead and stop times load only after a tap, and shape requests run one at a time | `fetchTripAhead`, `getShape` in `mts.ts` |
| Errors | After the first failure, later errors are ignored | `.catch` on the live effect in `App.tsx` |

"Realtime" here means the last published GPS, up to about a minute stale, then a jump.

An earlier client plotted OneBusAway `tripStatus.position`, which is schedule-extrapolated and could sit ~10 km from the AVL fix (a route 30 bus drawn at UTC while GPS was downtown). Current `main` uses the protobuf GPS fix on purpose. That fixed the wild mis-plot. Do not go back to `position`. The dot is still a stale snapshot, not a moving vehicle.

Transit *routing* uses static timetables. A planned bus leg does not follow the dot on the map.

### Direction (not implemented)

- Keep GPS fixes as truth.
- Between fixes, move the marker along the trip shape and snap back when a new fix arrives. `pointAlong` / `measurePath` in `liveTransit.ts` exist and are not used for the marker.
- Show staleness as a state ("last update 45s ago"), not only a tiny age on a parked icon.
- One obvious Buses control. Do not plan all five modes on every change if the user is only watching the map.

## 2. Too many controls

The first screen stacks map style, place categories, Spin, two live-transit chips, from/to search, locate, swap, five travel modes with ETAs, timing, schedule next-up, and a Schedule tab for the course planner. Report a problem is a third mode in the footer.

Scooter is both a trip mode and a map chip (show the fleet). Transit is both a trip mode (timetable) and two chips (live dots). Those are different systems with similar names.

Search placeholders advertise rooms and courses ("WLH 2001, CSE 11") even when `sections.json` is absent.

`docs/DEVELOPMENT.md` still says four modes in one place; the app has five (`walk`, `accessible`, `bike`, `scooter`, `bus` in `packages/core/src/route.ts`).

## 3. Not fast

- The sheet waits on large static JSON (`graph.json`, `transit.json`, buildings) via `loadCampus` ("Loading campus paths…").
- Every live poll downloads the whole MTS fleet, then drops vehicles outside the view.
- Trip shape fetches are serialized. Opening one vehicle can wait behind others.
- All five modes are planned on the main thread so the mode buttons can show ETAs.
- Spin pulls a full GBFS feed about every 60s when its chip is on.

## 4. Repo friction

- `git pull` fails with "divergent branches" if you have a local commit. To take GitHub and drop local commits: `git fetch origin main` then `git reset --hard origin/main`.
- The dev server must be restarted after `.env.local` changes.
- No course picker until private TSS files are built (`data/private/`, then `npm run build:graph`). See `docs/DEVELOPMENT.md`.
