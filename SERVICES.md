# Suite sidecar services

Three former-per-app components are standalone processes, not part of the Frappe
web/worker processes. They were migrated into the `suite` app but must be run and
wired up separately (Procfile/supervisor + nginx + `site_config.json`). Their own
`deploy/` snippet dirs hold reference Procfile/supervisor/nginx/site_config fragments.

## 1. Meet — SFU media server (🔴 required for Meet calls)
- **Path:** `suite/meet/sfu-server/` · WebRTC SFU (mediasoup + socket.io, TypeScript)
- **Build:** `npm --prefix suite/meet/sfu-server install && npm --prefix suite/meet/sfu-server run build`
- **Run:** `node suite/meet/sfu-server/dist/sfu-server/src/server.js`
- **Port:** signaling `PORT` (default `3000`); media UDP `RTC_MIN_PORT`–`RTC_MAX_PORT` (default `40000`–`40200`)
- **Env:** `JWT_SECRET` (must equal site_config `sfu_secret`), `WEBRTC_ANNOUNCED_IP`, `HOST`, `PORT`, `RTC_MIN_PORT`, `RTC_MAX_PORT`
- **site_config keys:** `sfu_server_url`, `sfu_secret`
- **Health:** `GET /health`
- **Deploy refs:** `suite/meet/sfu-server/deploy/`

## 2. Meet — realtime handlers (🔴, no separate process)
- **Path:** `suite/meet/realtime/handlers.js` — Frappe socketio handler (guest rooms, ping/pong)
- **Run:** auto-loaded by Frappe's existing `socketio` node process by convention. **No Procfile entry needed.** Backend counterpart: `suite/meet/api/meeting.py::validate_guest_session`.

## 3. Sheets — collaboration server (🔴 required for live spreadsheet collab)
- **Path:** `suite/sheets/collab-server/` · Yjs/Hocuspocus v4 WebSocket backend (Node ESM)
- **Build:** `npm --prefix suite/sheets/collab-server install` (no compile step)
- **Run:** `node suite/sheets/collab-server/index.js`
- **Port:** `COLLAB_PORT` (default `1234`)
- **Env:** `FRAPPE_BASE_URL` (required), `COLLAB_SERVER_SECRET` (must equal site_config `collab_server_secret`), `COLLAB_PORT`, `REDIS_HOST`/`REDIS_PORT` (optional multi-instance fan-out)
- **site_config keys:** `collab_server_secret`; frontend boot toggles `collab_v2`, `collab_ws_url`
- **nginx:** proxy `location /collab/ { proxy_pass http://127.0.0.1:1234/; }` with WebSocket upgrade + long read/send timeouts
- **Deploy refs:** `suite/sheets/collab-server/deploy/` (Procfile/supervisor/nginx/site_config snippets)

---

### Local dev (bench) Procfile entries
Add to the bench-root `Procfile` to run the media/collab sidecars alongside `bench start`:

```
sfu: node apps/suite/suite/meet/sfu-server/dist/sfu-server/src/server.js
collab: node apps/suite/suite/sheets/collab-server/index.js
```

Set the matching secrets in the site's `site_config.json` (`sfu_secret`, `sfu_server_url`,
`collab_server_secret`) and export `JWT_SECRET` / `COLLAB_SERVER_SECRET` for the processes.
