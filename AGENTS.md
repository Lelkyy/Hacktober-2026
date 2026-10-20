# Agents

Short facts. The code and `docs/DEVELOPMENT.md` are the architecture. Do not add a second architecture write-up.

- No app server. Routing runs in the browser (`packages/core`). The web app is `apps/web` (Vite, React, MapLibre).
- MTS key: `VITE_MTS_KEY` in `apps/web/.env.local` only. Never commit it.
- Live trolley/bus dots use the GTFS-realtime GPS fix. Do not switch them to OneBusAway `tripStatus.position`.
- Before changing live transit or adding UI, read `context/problems.md`.

Cursor loads `.cursor/rules/project.mdc` every chat. In a new chat, also `@` the files you are changing (`apps/web/src/mts.ts`, `packages/core/src/liveTransit.ts`, `apps/web/src/MapView.tsx`).
