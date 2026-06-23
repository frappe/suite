<div align="center">

# Frappe Suite

**Drive · Slides · Writer · Sheets · Meet · Mail · Calendar — in one app.**

<kbd>
<img width="1268" height="780" alt="Screenshot 2026-06-16 at 19 10 57" src="https://github.com/user-attachments/assets/20e2d1c2-caae-43ee-9eb8-ed6a27ad9917" />
</kbd>


</div>

<br>

> ⚠️ **Work in progress.** Frappe Suite is the consolidation of seven standalone
> Frappe apps into a single installable app with one unified frontend. The merge is
> functional but still being verified and hardened — expect rough edges, and don't
> treat it as production-ready yet.

## What this is

Frappe Suite merges what used to be seven separate apps —
[Drive](https://github.com/frappe/drive), 
[Slides](https://github.com/frappe/slides),
[Writer](https://github.com/frappe/writer),
[Sheets](https://github.com/frappe/sheets), 
[Meet](https://github.com/frappe/meet),
[Mail](https://github.com/frappe/mail), and [Calendar](https://github.com/frappe/calendar_app) — into **one Frappe app** with:

- **One backend app** (`suite`) — each former app now lives as a module under
  `suite/<module>/`, with a single consolidated `hooks.py`, `modules.txt`,
  `patches.txt`, and `pyproject.toml`.
- **One frontend SPA** — a single Vite + Vue 3 + [frappe-ui](https://ui.frappe.io)
  app (`frontend/`) that serves every product under its own route prefix
  (`/drive`, `/slides`, `/writer`, `/sheets`, `/meet`, `/mail`, `/calendar`), with a
  launcher at `/suite`. Each app's UI lives under `frontend/src/apps/<app>/`.
- **Preserved history** — every original app's git history is grafted in, so
  `git log --follow` / `git blame` on a file under `frontend/src/apps/<app>/` (or
  `suite/<module>/`) still reaches its original authors.

## Status

The migration is tracked phase-by-phase in [`monorepo.md`](./monorepo.md):

- **Phases 0–5 (backend relocation → site cutover → frontend unification): done.**
- **Phase 6 (cutover verification): in progress** — most apps verified at runtime;
  remaining items and known issues are listed in `monorepo.md`.
- **Phase 7 (CI / docs consolidation, release): not started.**

## Develop

```bash
# Backend lives in this app; the frontend is a single SPA under frontend/.
cd frontend
yarn install
yarn build          # build the whole suite SPA (gate: exits 0)
# or, via bench, from the bench root:
bench build --app suite
```

Working on a specific app's UI? Start with
[`frontend/src/apps/README.md`](./frontend/src/apps/README.md) (unified-SPA
architecture + conventions) and the per-app `frontend/src/apps/<app>/PORT-NOTES.md`
(what changed, known issues, verify checklist).

## License

To be finalized as part of the consolidation. The merged apps shipped under their
own licenses — refer to each upstream app in the meantime.
