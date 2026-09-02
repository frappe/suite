---
label: wayfinder:map
tracker: local-markdown
---

# Map: Drive layer spec

## Destination

An implementation-ready spec pair for the new Drive layer in suite:
`drive-layer-spec.md` (doctypes, path-batch permission engine, content SDK,
HTTP API, WebDAV mapping, framework-side storage_v2 asks) plus a migration
section from the current suite File-override data. Done when an
implementation effort can execute from the documents alone.

## Notes

- Architecture is already decided (2026-09-02), outside this map:
  `~/benches/suite-bench/drive-file-layer-designs.md` (also at
  https://md.netchamp.dev/drive-file-layer-designs/). The engine: new Drive
  Node doctype with `path` column; `Drive Grant` is the only permission
  table, read batched, nearest-wins in Python; deny = role 0; per-token
  link principals. Prototype: `suite/drive/webdav/perms.py`.
- Related spec: `~/benches/suite-bench/frappe-file-storage-v2-spec.md`
  (storage_v2, branch `forge/storage-v2` in this bench's frappe).
- Constraints: no custom fields on framework File; no new framework hooks
  (public functions only); write in ASD-STE100 per `~/CLAUDE.md`.
- Skills each session should consult: grilling + domain-modeling for
  decision tickets; codebase-design for interface work.
- Sessions orchestrating as Fable must spawn subagents with model opus.
- Subagents must not post or push outside this repo without confirmation.

### Local tracker conventions

- Tickets live in `tickets/`, one file each, frontmatter: `id`, `title`,
  `label` (`wayfinder:<type>`), `status` (open/closed), `assignee`
  (empty = unclaimed), `blocked-by` (list of ids).
- Frontier query: open tickets, empty assignee, all `blocked-by` ids closed.
- Resolution: append `## Resolution` to the ticket, set `status: closed`,
  add one line under Decisions so far here.

## Decisions so far

(none yet)

## Not yet specified

- HTTP API surface details (endpoint list, request/response shapes).
  Sharpens after the role ladder and content SDK decisions land.
- Search-within-shared derived index. Only if the ancestor-union round trip
  proves too slow on real data; benchmark said it is fine synthetic.
- Concurrency validation under live load. All benchmark numbers are
  single-connection.

## Out of scope

- Frontend/UI changes (share dialog, upload client, list views). Backend +
  HTTP API only; UI is a later effort.
- Standalone frappe/drive migration (Drive Team model). This spec covers
  suite sites only.
