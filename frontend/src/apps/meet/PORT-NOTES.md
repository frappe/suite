# Meet — port notes

Standalone source: `apps/meet/frontend/src`. Now at
`apps/suite/frontend/src/apps/meet/`, served under **`/meet`**.
See the parent `../README.md` for suite-wide conventions.

## Routes (relative to `/meet`, names namespaced `meet-*`)
Nested under `views/MeetLayout.vue`:
- `''` → `meet-home`
- `audio-test` → `meet-audio-test` (admin only; role checked in the guard)
- `:meetingId` → `meet-meeting` — **`meta: { isPublic: true }`** so guests can join.

## What changed vs standalone
- **Build-breakers fixed:** `socket.ts` reads `window.site_name` / `window.socketio_port`
  from Jinja boot data, falling back to Vite `__SITE_NAME__` / `__SOCKETIO_PORT__` in dev.
  The router's `__FRONTEND_ROUTE__` define + `createWebHistory` were dropped
  (relative routes under `/meet` instead).
- `requiresAdmin`/`allowGuest` logic moved into a prefix-scoped guard (`router.ts`).
- **`$socket` → `useSocket()`**, **`$platform` → `usePlatform()`** composable (the
  global properties from `main.ts` are gone). Boot side-effects
  (`loadMediaPreferences`, `installConsoleBuffer`) run on module load in `routes.ts`.
- Global frappe-ui components are now imported locally per-component.
- Pinia stores namespaced `meet-*` (`meet-chat`, `meet-media`, `meet-lobby`,
  `meet-connection`, `meet-participant`, `meet-reaction`, `meet-raiseHand`).
- frappe-ui `0.1.271` → `1.0.0-beta.9` (major API jump — re-verified).
- **Deps added:** `mediasoup-client`, `@mediapipe/selfie_segmentation`,
  `@workadventure/noise-suppression`, `emoji-mart`/`@emoji-mart/data`, `reka-ui`.
  These stay lazy/code-split (the Meeting view chunk is large, ~775 kB — expected).
- **Noise-suppression worklet** bundles natively under the suite's Vite 8 — the
  standalone's custom `noiseSuppressionAudioWorkletVitePlugin` was NOT needed.
- Backend method paths rewritten to `suite.meet.api.*`.

## Known / deferred (please review)
- `window.site_name` / `window.socketio_port` are expected as Jinja boot data; Vite dev
  falls back to `__SITE_NAME__` / `__SOCKETIO_PORT__`.

## Verify (Phase 6)
Log in at `suite.localhost:8004/meet`. Confirm: home loads; create/join a meeting
(`/meet/<id>`) as host and as a guest; camera/mic device selection; screen share;
chat/reactions; background effects + noise cancellation toggles; `/meet/audio-test`
gated to admins.
