---
id: 006
title: Files area: listing, navigation and roots
label: wayfinder:grilling
status: open
assignee:
blocked-by: [001, 005]
---

## Question

Specify the Files area on the real node model. The prototype's
`FilesArea.vue` fixes the layout: page header with breadcrumbs and New,
search field, view settings (list or grid, group by, columns), selection
mode with a bulk bar of equal height, context menu, empty state.

Settle on real data:

- How the Shared Root and the Personal Root appear now that the workspace
  switcher is gone: two panel entries, a root picker in the header, or one
  merged root view. Business sites have both roots; personal sites have
  Personal only.
- The saved views (`all`, `shared`, `starred`, `trash`, recents) against
  spec §5.3 to §5.7 queries, and the panel body that lists them.
- Folder listing with opaque cursors (§11.4, 60 rows default, short windows
  possible), sort and group on the server versus the client, and which
  `?expand=` sets each view requests.
- Node row shape to node kind mapping: folder, file, link, content document
  (Writer, Sheets, Slides) and their icons and open targets.
- Selection and bulk actions against the batch route (§11.5) with per-node
  ok/failed reporting.
- Rename with the sibling dedupe rule (§8.6), move as one path rewrite
  (§8.7), copy (§8.9), star and recents (§9.5).
- Where Drive's client module lives and what it exports to other areas
  (`@/apps/drive` interface, ARCHITECTURE.md rule 8.3).

Inputs: Drive spec §5, §8, §9.5, §11; ticket 32 acceptance criteria; the
legacy inventory from ticket 005; the frappe-ui skill for list patterns.
