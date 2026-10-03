# Handoff: currently resolved unified frontend scope

## Objective

Implement every backend and frontend behavior owned by closed unified-frontend
tickets 001–006, 009, 012 and 013. The result is the grow-beside unified shell
with Home, Files and canonical document hosting. Keep legacy pages reachable;
ticket 014 owns the production switch and deletion.

The scope rule is ticket ownership: when a closed resolution explicitly hands
behavior to an open ticket, stop at that gate. Missing code or endpoints named
by a closed resolution are implementation work, not blockers to omit.

## Sources

Read the resolutions in [001](tickets/001-route-grammar.md),
[002](tickets/002-shell-and-platform-interface.md),
[003](tickets/003-rest-endpoint-structure.md),
[006](tickets/006-files-area-listing-and-navigation.md),
[009](tickets/009-content-page-contract.md),
[012](tickets/012-home-palette-and-notifications-at-launch.md), and
[013](tickets/013-frontend-module-layout-and-boundaries.md). Tickets
[004](tickets/004-frappe-ui-shell-component-gap.md) and
[005](tickets/005-legacy-drive-client-inventory.md) supply verified inventory.
The [base prototype](https://sketch.netchamp.dev/u/netchampfaris/suite-shell-prototype)
is the layout authority; [`ARCHITECTURE.md`](../../ARCHITECTURE.md) owns module
and dependency rules.

## In scope

1. **Structure and safeguards:** create `composition/`, `shell/` and the
   day-one `platform/` modules; relocate current Drive pages under
   `apps/drive/legacy`; put new Files code under `apps/drive/files`; enforce
   import boundaries, stable frappe-ui imports, lazy product chunks, the
   200 KiB-gzip initial-graph budget, CODEOWNERS and the zero-red unified test
   project from ticket 013.
2. **Backend enablement:** implement ticket 003's dispatcher, typed product
   route tables, conformance kit and required Suite/Mail/Calendar/Meet REST
   resources. Implement every backend ask recorded by tickets 006 and 012,
   including Drive roots, listing filters/grouping/expansions, search
   breadcrumbs, folder archives, `drive:changed`, Recent `opened_at`, the
   notification count, and Calendar's all-account conferencing shape.
3. **Shell and platform:** implement the area registry, responsive shell,
   route-frame contract, session, transport, server state, realtime,
   translation, theme, page metadata, feedback, capability gating and
   page-header target exactly as ticket 002 specifies.
4. **Home:** implement the complete ticket 012 resolution: Drive Recent,
   Calendar Upcoming, generic document creation, Meet actions, Drive
   notifications and Mail badge, including independent loading, empty, error
   and retry states. The resolved launch has no command palette or rail Search.
5. **Files:** implement every ticket 006 behavior: roots and saved views,
   folder/search paging, list and grid presentation, server sorting/grouping,
   previews, node-kind routing, single-row mutations, Move/Move-to-trash bulk
   behavior, selection, New actions that are resolved, mobile navigation,
   accessibility, normalized updates and realtime refresh. Cross-product use
   goes only through `apps/drive/index.ts`.
6. **Documents:** implement ticket 009's `DocumentHost`, `DocumentSession`,
   content registry and Writer/Sheets/Slides surface adapters for canonical
   `/d/<node>/<slug>` routes, except capabilities delegated to tickets 008 or
   011. Preserve the separate legacy editor routes during grow-beside.
7. **Verification:** add colocated unit/contract tests and browser journeys
   under `e2e/unified-frontend/{shell,files}`. Cover every implemented branch
   required by the closed resolutions on desktop and mobile.

## Open-ticket gates

| Ticket | Work that remains gated |
|---|---|
| [007](tickets/007-upload-restore-and-batch-outcomes.md) | upload/replace UX, restore destination, permanent deletion and remaining batch rules |
| [008](tickets/008-sharing-dialog-and-link-credentials.md) | sharing dialog, grants, publishing and link credentials |
| [010](tickets/010-mail-meet-calendar-adoption-contract.md) | mounting the full Mail, Meet and Calendar areas; their Home integrations remain in scope |
| [011](tickets/011-guest-and-link-routes.md) | link entry, password unlock and Guest surface; blocked by 008 |
| [014](tickets/014-rollout-redirects-and-old-page-deletion.md) | redirect switch, rollback and legacy deletion; currently waits on 010 |
| [015](tickets/015-draft-the-spec-and-plan.md) | complete program specification and plan |

Implement ticket 006's ordinary mutations and Move/Move-to-trash batch path;
leave only the flows named above to ticket 007. Keep gated controls absent or
explicitly unavailable. New code uses the resolved REST and product interfaces
and never silently falls back to a legacy RPC.

## Execution and done condition

```text
structure + enforcement
  -> backend contracts and missing routes
  -> platform + composition + shell
  -> Home + Files vertical slices
  -> document host and product surfaces
  -> browser journeys + bundle gate
```

Before declaring completion, account for every normative bullet in the closed
ticket resolutions as implemented, verified, or explicitly delegated to an
open ticket above. `/home`, `/files` and `/d/...` must run through the new
interfaces; all covered real-data journeys must pass; the dependency and
bundle gates must pass; and `/drive` plus legacy editor routes must remain
recoverable during grow-beside.
