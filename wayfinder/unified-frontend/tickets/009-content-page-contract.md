---
id: 009
title: Content page contract
label: wayfinder:grilling
status: open
assignee:
blocked-by: [002, 005]
---

## Question

Define the contract between the shell and an editor mounted in the content
pane. Writer, Sheets and Slides keep their editors and get new document
pages on the node route. The shell owns the title bar (decided from the
prototype).

Settle:

- What the shell passes the editor: node id, content doctype and name from
  the node's identity link, the caller's role, the document's link codes.
- What the editor gives the shell: title and rename, save and sync state,
  read-only and refused states from the collab server (spec §6.7), a share
  action, comments and version panel triggers, presence.
- Document creation through the generic Drive workflow only
  (ARCHITECTURE.md rule 8.6): New menu items, templates (§8.10), copy.
- Media: node ids and signed `/f/` URLs (§6.8) with the 15-minute lifetime
  refreshed at ten minutes; pinned caching by signature-free blob key;
  Slides composites loaded in groups under the 20-code cap with ordered
  unreadable placeholders (§6.6).
- Versions and comments as Drive tables (§9.1, §9.3) rendered by shared
  panels versus per-editor panels.
- Mounting: the editor's own scroll ownership, full-pane sizing for the
  Sheets canvas and Slides stage, and leaving the editor by the rail.
- The old editor pages (`/writer/d/<id>`, `/sheets/...`, `/slides/...`)
  during grow-beside.

Inputs: ticket 34 acceptance criteria; Drive spec §6.6 to §6.8, §8.10,
§9.1, §9.3, §10; `frontend/src/apps/writer/pages`,
`frontend/src/apps/sheets/pages`, `frontend/src/apps/slides/pages`.
