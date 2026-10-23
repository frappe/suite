# Orchestrator rulings for the fix pass (ticket 015)

These override the audit reports where they conflict. Each ruling is small and reversible; cite it in the documents as `[T015]` unless another source is named.

## New tickets that now own real gaps

Open items that belong to these tickets must point to them by name and link (`tickets/0NN-...md`), and say "blocks Stage N" where the plan needs it. Do not decide them.

- 017 [Product methods and the zero-call gate](../tickets/017-product-methods-and-the-zero-call-gate.md): which `suite.drive.api.*` names the boundary check bans and the D26 counter counts; product methods in Files settings tabs; Drive §11.7 vs §14.10; whether the hold clock restarts. (Spec audit A finding 3 and 4 second half, audit C finding 1, plan O4, plan audit finding 11 line 598.) Fix the plain factual errors (19 product methods, 17 called by legacy UI) but leave the exemption undecided. The Stage 11 boundary-check extension (plan audit finding 2) stays, with "the names ticket 017 settles".
- 018 [Flip 1 rollback with deleted app chrome](../tickets/018-flip-1-rollback-with-deleted-app-chrome.md): plan O1.
- 019 [Branches, backend asks and the release path](../tickets/019-branches-backend-asks-and-release-path.md): plan O2, O6, merge vs rebase (plan audit finding 18: record the fact, do not add the "merge only" rule), Frappe Cloud `bench set-config` (map fog).
- 020 [Unmapped legacy routes and the /files path](../tickets/020-unmapped-legacy-routes-and-the-files-path.md): spec open item 16 (routes with no row or wrong match, trailing slug, lookup finds no node) and 19 (`/files` clash).
- 021 [Account menu, Files entry points and icons](../tickets/021-account-menu-files-entry-points-and-icons.md): spec open items 22 (Upgrade plan), 23 (Open Desk), 25 (folder upload and template entry points), 1 (icon source).
- 022 Fold decisions into the spec and plan: the task that folds 017 to 021 in later.

## Rulings (apply as rules)

1. **Writer New label is "Document".** T011 (resolved 2026-09-21) is later than T006 and T012 and says "New hides Document, Spreadsheet and Presentation". Apply audit B finding 3. Remove open item 24.
2. **Client navigation to `/l/<token>`** (open item 17): the client guard does a full page load, so the server rule answers. Same pattern T014 uses for Sheets and Slides. Cite [T014, T015]. Remove the open item. Plan Stage 8 removes the `/l/:token` SPA placeholder route.
3. **Bottom-nav tap on the active area** (open item 14): the shell dispatches the existing `suite:open-active-area-panel` window event with `{ area }` (`shell/ShellLayout.vue:153`, `apps/drive/files/pages/FilesPage.vue:372`). `<AreaSidebar>` listens and opens its phone sheet. Remove the open item.
4. **File surface on `/d/`** (audit C finding 5): Drive owns the file preview surface and exports it from its package root (`filePreviewSurface`, already in `apps/drive/index.ts`). `DocumentHost` uses it when the node has no content doctype. `openDocumentSession` serves both. Cite [T011, T015]. Apply the line 1169 fix; do not add the open item.
5. **How Files gets the document registry** (audit A new gap): composition provides it through the platform injection key `DOCUMENT_TYPES_KEY` (already in code, `App.vue`), so Files never imports composition. Cite [T009, T013, T015].
6. **Settings modules across the package root** (open item 15): a product exports a lazy settings loader from its package root, the same shape as `loadSurface`. No subpath import. Cite [T013, T016, T015]. Remove the open item.
7. **`/files/f/<root-node>`** (audit A new gap): the router replace-redirects a root id to `/files` or `/files/organization`. Cite [T001, T015].
8. **Interim behavior before an open ask ships** (open items 18 and 28): no interim behavior. A feature that depends on an open ask stays disabled, with the reason in its tooltip, until the ask ships. The stage that builds it waits on the ask. Exception: D17, where `/drive/l/<token>` works today through `drive_link.py`. Cite [T015]. Remove items 18 and 28; keep a one-line rule in section 15.
9. **`node_url` owner** (plan O3): the Drive Python interface, per ARCHITECTURE.md rules 2.1 and 2.2. It reads `suite_flip_files` from `frappe.conf`.
10. **Calendar and Meet extras in the shell fixes** (plan O5): add the Calendar `FrappeUIProvider` and `apps/meet/socket.ts` to Stage 3. `body.calendar-app` is not shell-breaking.
11. **Slides old pages** (plan O8): `Slideshow.vue` is an old page, deleted at Stage 15. `ExportView.vue` moves into the Slides surface in Stage 11.
12. **Star state** (plan O9): add ask D28 "`favourite` on the Drive node shape" to spec §15 (owner Drive, raised by T006 via ACCOUNTING.md, status open, depends spec §5.11). Also add D29 "Type `shapes.py` outputs" (raised by the server-state reference, status met). Plan uses these IDs.
13. **Between the flips** (open item 27): `/home`, `/files` and `/d/` answer a direct URL for every signed-in user before flip 2 [T009, T013, T014]. Only the rail with the flag off stays open: reword item 27 to that point.
14. **Quota surface** (open item 8): apply audit C's rewrite (Settings > Files > Statistics is the launch surface; totals from `/roots/<id>/usage` until D10). Keep "whether the Files panel also shows it" open.
15. **Phone behavior** (open item 4): drop 5.14 from it; T006 answers Files.

## Keep as open items (implementation time or environment, not map decisions)

- Server-state tuning (item 21), `DocumentSession` method signatures (item 20: the stage that builds them designs them under the codebase-design skill), frame literal (item 13: Stage 1 names it), mounting spike (3), Sentry (5), shortcuts (7), post-launch fog (2, 6, 9, 10, 11, 12).
- Plan: hasher package (O7), `vue-tsc` (O10), Mail account for journeys (O11). Mark each "needs Faris's approval; blocks Stage N only".
