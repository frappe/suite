# Unified frontend: implementation ledger

The orchestrator session updates this file after each unit lands. The plan
is [`unified-frontend-plan.md`](unified-frontend-plan.md).

## Run rules (Faris, 2026-09-29)

- Scope: stages 0 to 6 and 8 to 12, Drive issues 39, 41 to 45 and 47, and
  Suite asks S1 to S4. Then a local rehearsal of both flip states. The run
  stops before stage 7.
- Stage 0 merge needs no approval pause.
- No push during the run. Every merge is local to `forge/drive-layer`.
- Opus agents on medium effort implement. Codex `gpt-5.6-sol` reviews,
  researches and gives second opinions.
- Error tracking (Sentry) is out of this run.
- Heavy lock: typecheck, bundle budget, build and journeys run under
  `flock /tmp/suite-uf-heavy.lock` (7 GB RAM, `earlyoom`). At most two
  frontend implementers at once.
- Site lock: every `run-tests`, `migrate`, `bench execute` and browser
  journey on `slides.localhost` runs under `flock /tmp/suite-uf-site.lock`.

## Units

| Unit | Branch | Status | Merge | Notes |
|---|---|---|---|---|
| Stage 0 baseline | `forge/uf-0-baseline` | done | `06d5c0225` | upstream `a3dba155c` merged at `98a0558fb`; codex review: 3 fixes applied |
| Stage 1 frame rework | `forge/uf-1-frame-rework` | done | `b7f3b49f7` | codex review: sheet focus and phone-to-desktop close; AccountSheet named. Shell journeys 24 of 24 |
| Stage 2 link credentials | `forge/uf-2-link-credentials` | done | `ec448fa23` | codex review: 7 link-store fixes; composite reference codes are pre-existing (stage 11) |
| Stage 3 four fixes | `forge/uf-3-shell-fixes` | done | `5b6443d87` | codex review: journey asserts exact socket counts |
| Stage 4 settings | `forge/uf-4-settings` | done | `1ef0e0504` | codex review: 10 fixes (phone profile lists read the Suite list, typed Mail openSettings, Admin row in Mail's sidebar, drill-in history ids, focus trap, failed-group Retry row). Settings journeys 10 of 10; `mail-shared-page` socket journey needs socket.io on 9000 (none on this devbox) |
| Stage 5 adoption | `forge/uf-5-adoption` | done | `431d97980` | Four sub-lanes (Meet, Mail, Calendar, PWA and shell), each codex-reviewed. Gates after merging drive-layer: 195 unified, legacy manifest, boundaries 332/71/2, typecheck 0, bundle 116.08 KiB, architecture and boot OK. Shell journeys on the PWA sub-lane: 64 passed, 1 known socket failure. PWA review: logout drops the push token, one notification per message across tabs, click handler for every browser, one top inset. Manifest `id` is `/suite` (question 21) |
| Stage 6 flip plumbing | `forge/uf-6-shell-flip-plumbing` | done | `e1f75678e` | codex review: kind redirects keep the hash (`#link=`), old `/drive/f/` kind check reads the node through the Drive client (no new legacy call), Apps drill-in focus, shell-off files-on journeys, Home Drive group hidden while `suite_flip_files` is off. Gates: 197 unified, legacy manifest, boundaries 332/71/2, typecheck 0, bundle 116.43 KiB. Journeys: shell 91 plus the known socket failure, files 81 (2 skipped), home 10. Exit-gate grep has one hit, `legacy/utils/files.js:308` (stage 15 deletes it) |
| Stage 8 guest and link routes | `forge/uf-8-guest-routes` | first half and review fixes committed `52ccd4376`; wiring in `ShellLayout.vue`, `routes.ts`, `router/index.ts`, `FilesPage.vue` waits for stage 6 | | Server needed no change (Drive 43 and S2 meet the gate). Guest name field belongs to stage 11 after this wiring |
| Stage 9 sharing dialog | `forge/uf-9-sharing-dialog` | committed with review fixes `72ee41df4`; the `FilesPage.vue` row Share waits for stage 8 | | codex review: self-demotion confirm based on the outcome (groups, inherited Deny, overwrites); session access re-read after each write; per-row pending; expiry on people and groups; expired General and Public rows stay. Journeys: sharing 8, document-surfaces and slides-document 11 |
| Stage 10 upload, restore, batch | `forge/uf-10-upload-restore-batch` | part 1 and review fixes committed `9c6ecd7cc`; `FilesPage.vue`, `apps/drive/index.ts` and composition wiring wait for stages 8 and 9 | | codex review: resume probes the server offset, records keyed by user or guest link, row Retry clears the halt, trash Retry, one tap one action on the ring. S3 direct mode built (presigned POST, restarts after reload); unit tests only, no S3 here. `hash-wasm` 4.12.0 placed by hand; not in the initial graph |
| Stage 11 document surfaces | `forge/uf-11-document-surfaces` | done | `a15886a7a` | Four sub-lanes, each codex-reviewed. Gates after merging drive-layer: 177 unified, legacy manifest, boundaries 333/71 plus 2 legacy Drive calls (SuiteCommandPalette, stage 15), typecheck 0, bundle 116.25 KiB, architecture OK. Files journeys 81 passed, 2 skipped. Legacy-call rule is a substring scan over `frontend/src` and `suite/public/js`, comments included. Drive dialogs cross the seam as `useDriveDialogs()`. Desk picker attach checked by hand (a repo journey needs `bench build`) |
| Stage 12 drive flip plumbing | `forge/uf-12-drive-flip-plumbing` | server half merged `8cfd957f8`; client half waits on 6 | | codex review: redirect only when the caller can READ the target, encoded separators fall through. Only while `suite_flip_files` is on (spec §14.3 over the brief). `flip_is_on` moved to `suite/suite_core/flips.py`. Edits `hooks.py` ahead of 6 and 8 in the shared-files order |
| Drive 39 settings and webdav routes | `forge/drive-39-settings-webdav-routes` | done | `bcb7bb1d1` | codex review: 3 fixes (int quotas, closed WebDAV shapes, insert race) |
| Drive 41 storage breakdown | `forge/drive-41-storage-breakdown` | done | `817900a18` | codex review: breakdown only for the root owner or a Suite Admin; legacy rows carry `mime_type`; fixed-height lists. `test_quota` 12 errors from Administrator's old Personal root `4b15fe1948`, same on base |
| Drive 42 upload, restore, purge routes | `forge/drive-42-upload-restore-purge` | done | `116dfa952` | codex review: replace preflight credits the old head; title check before the session is claimed; batch purge shallowest first |
| Drive 43 link routes and unlock | `forge/drive-43-link-routes-unlock` | done | `8f1bb3ff2` | codex review: Retry-After read inside the lock; route test independent of the flag |
| Drive 44 grants, passwords, share email | `forge/drive-44-grants-passwords-email` | done | `740cd8cca` | codex review: ancestor link secrets redacted unless the caller manages that ancestor; enqueue failure after commit never fails the PUT; `send_to` takes one address |
| Drive 45 legacy-call counter | `forge/drive-45-legacy-call-counter` | done | `4d879dff0` | codex review: durable Redis hand-off, flush lock, 50 user agents per name then `(other)`, verb-aware File methods, controller refuses hand edits. Desk list checked in a browser as a non-Administrator System Manager |
| Drive 47 recents content doctype filter | `forge/drive-47-recents-doctype-filter` | done | `15721d624` | codex review: stable order, windows past unreadable rows, Active only, STRAIGHT_JOIN from the user's recents. These also change unfiltered recents |
| Suite S1, S2 (server) | `forge/uf-suite-asks-s1-s3` | done | `9852ca10b` | codex review: bounded people cursor. S3 moves to stage 8; S4 shipped with stage 11 Writer |
| Flip rehearsal | | waiting on all | | |

## Open questions for Faris

1. **Cmd+K palette (stage 0).** Upstream #848 added a Cmd+K palette to the
   shell and palette entries in the Mail, Calendar and Meet sidebars.
   Ticket 012 says launch has no palette. Production already has it,
   because production tracks `develop`. Interim: the run keeps upstream's
   palette and builds nothing new on it.
2. **`auto_detect_links` (Drive 39).** Upstream #879 (`c005af4b1`) deleted
   this field from `Drive Settings`. Drive spec §3.14 and §11.2 still list
   it. Orchestrator ruling: follow upstream; `GET /settings` answers
   `{webdav_enabled, writer_settings}`. Overrule to restore the field.
   `writer_settings` is a JSON object on the new route (legacy returned
   the stored text).
3. **Link eviction and tagging (stage 2).** Orchestrator reading of ticket
   008: a 404 drops a link only when one code was sent and the 404 is on
   the link's own target; any 410 drops it. A 404 inside a shared folder
   keeps the link. Any node-returning response through one code tags its
   nodes, writes included (ticket 008 says "a read or listing"), so a
   node created through a link stays reachable.

4. **Writer automatic versions on `/d/` (stage 11).** The Writer editor
   asks for `new_version` on the first edit of each page load. Drive
   refuses it for a Drive-owned document, so it threw on every `/d/`
   document. The surface now skips it. Option: route it through
   `session.versions.create('auto')`; Drive does not throttle, so each
   first edit per load would add a version that counts against quota.
   Interim: skipped.
5. **Mentions for non-admins (stage 11).** Writer mentions read
   `GET /api/suite/users`, which answers only a System Manager, so other
   users see an empty list until Suite ask S1 (`/api/suite/people`)
   ships. Interim: accepted; S1 is in this run's backend lane.

6. **Replace after a collision (Drive 42).** `POST /uploads` refuses a
   taken name (D11), including the file a Replace targets. Orchestrator
   ruling: `create_upload` takes an optional `replaces`; it checks EDIT
   on that node and skips the name check for it only, and the session can
   finish only as that replace. One round trip, as ticket 007 implies.
   D15 is a separate `POST /nodes/batch/purge` route, not a flag.

7. **Share button on a Sheets document (stage 11, Sheets).**
   `new-and-open.spec.ts:146` (a `fixme`) expects no Share button on a
   Sheets document; the Sheets brief asks for a disabled one until stage 9.
   Interim: disabled button with a tooltip. Stage 9 decides.
8. **Sheets cell Notes next to Drive Comments.** Both now show, with
   similar icons. Interim: both stay.
9. **Who a non-admin sees in `/api/suite/people` (S1).** Interim: any
   `Suite User` sees all enabled System Users and all User Groups, and
   the caller is listed. `member_count` counts disabled members, as legacy
   did.
10. **Deny plus `notify` (Drive 44).** A deny grant with `notify: true`
    sends no email. Interim: accepted.
11. **Stage 4 settings details.** Mail PWA Notifications has no Settings
    row (still reachable from Mail's Profile view); Mail Credentials now
    shows only under the JMAP condition; Workspace has two tabs, General
    and Users.
12. **Sheets recovery file format.** The recovery copy downloads as
    .xlsx with values and formulas, without formatting. Interim: accepted.
13. **Stage 4 phone Back from a Profile row** goes tab, then the full
    Settings list, then Profile (one step more than the old Mail
    sub-page). The failed-group row does not name the product. Interim:
    accepted.

14. **Slides decks reached through a parent-folder link.** A composite
    reference whose deck is readable only through a link on a parent
    folder shows as unreadable: the client matches codes to a link's own
    target. Fix needs a Drive function naming which presented code opens
    a node. Interim: not handled.
15. **Slides on a phone.** The stage stays 900 px wide (as on the base);
    spec §16.1 items 2 and 3 leave phone Slides open.
16. **Largest files rows.** They do not open the file (the spec does not
    say they should); the cap is 10.
17. **Legacy Drive invitations after flip 2.** The new route table has no
    `/drive/signup`, and `File.share` to an unknown email still creates
    legacy invitations. Interim: with `suite_flip_files` on, accepting one
    does what `POST /api/suite/invitations` does (same user type, roles and
    `/update-password` landing). With the key off, nothing changes.
18. **Meet recording emails after flip 2.** New recordings are legacy
    `File` rows, not Drive nodes, so `node_url` has no address for them.
    Interim: the email goes without the file link. Meet does not adopt
    nodes in this run.
19. **Search is dead with both keys off.** Sidebar Search and Ctrl+K open
    nothing, the phone install offer is gone, and Cmd+Shift+K and
    Cmd+Shift+Comma have no binding: `App.vue` stopped mounting
    `SuiteLayout.vue` in `61b6401e4` (before this run). The ledger assigns
    it to stage 15. Recommendation: fix it before stage 7.
20. **Mail on a phone lost its Push Notifications switch** in stage 4. No
    Settings row replaces it; existing subscriptions still deliver.
21. **Manifest `id`.** Stage 5 changed it from `/mail` to `/suite`. Mail
    installs become a second installed app. Please confirm; another change
    makes a third.
22. **Invitation redirect target.** With the key on, a legacy invitation
    lands on `/suite` and drops the old share email's `redirect`.
23. **Drive seam naming.** Spec §5.15 lists `createDriveDocument()` as a
    descriptor; the seam exports `useDriveDocumentCreation()` because
    creation first finds the Personal root.
24. **Share expiry timezone.** The dialog sends `YYYY-MM-DD 23:59:59`; the
    server reads it in site time. Interim: end of that day in site time.
25. **Share picker default role** is View. Interim: accepted.
26. **Dead-link "Go to Home"** links to `/`, which lands on `/mail` before
    flip 2. Interim: unchanged.
27. **Home panel Drive links before flip 2.** With the files flip off,
    `/home` links to `/drive/shared-with-me` and `/drive/starred`, which
    the old Drive router does not have. Interim: stage 6 review decides.
28. **Upload picker.** Plain file input, not `showOpenFilePicker`, so only
    dropped files resume without a re-pick. Interim: accepted.
29. **Tracker Cancel.** No Cancel for a running upload. Interim: none.
30. **S3 direct uploads.** The Drive spec says the browser PUTs the bytes;
    the framework S3 driver gives a presigned POST form, so the client
    POSTs. Deployment: the bucket needs a CORS rule allowing POST from the
    site origin. Real S3 is not verified.
31. **Home "View all"** links to `/drive/recent`, which the old Drive
    router lacks (`recents`). Interim: stage 12 client half hides it while
    the files flip is off.
32. **Hash on slug replaces.** `DocumentHost.vue`, `FilesPage.vue` and the
    old Folder page drop the hash when they add a slug. Interim: accepted,
    because stage 8 reads `#link=` on the first navigation.

## Needs a manual check (cannot run on this devbox)

- iOS standalone keyboard in Mail after stage 3 removed body
  `overflow:hidden` (Mail's focusout scroll reset remains).
- Mail dark mode safe-area strips on a phone.

## Old bugs found, assigned to a unit

| Bug | Found in | Assigned to |
|---|---|---|
| `shell/MobileNav.vue` passes `:to`; frappe-ui item takes `route`, so phone nav items do nothing | stage 0 | stage 1 (fixed) |
| Capability journeys assume Administrator has no mail account; the site has `administrator@suite.test` since 2026-09-18 | stage 0 | stage 1 (shell journeys), stage 5 |
| `FilePreviewSurface.vue` passes `:link`; Button takes `href`, so Download does nothing | stage 0 | stage 11 (Drive sub-lane) |
| Writer surface throws on `storage.styleClipboard` | stage 0 | stage 11 (Writer) |
| `test_shims` permanent-surface check fails on `api.product.set_settings` | stage 0 | Drive 39 (fixed) |
| Logout no longer calls `clearSlidesUserData` (merge regression) | stage 0 | stage 0 |
| Upstream `SuiteCommandPalette.vue` calls legacy `suite.drive.api.*` for search | stage 0 review | stage 11 (legacy-call baseline) |
| `/mail` stays blank and does not redirect to the inbox | stage 3 | stage 5 (Mail sub-lane) |
| Calendar opens a site socket per mount and never closes it | stage 3 | stage 5 (Calendar sub-lane) |
| `shell/SuiteLayout.vue` is mounted nowhere; its theme-cycle and Mod+Shift+Comma shortcuts are dead | stage 3 | stage 15 |
| Slides composite references are Reference Presentation row ids, not node ids, so a separately linked deck sends no code. Needs the manifest to return each reference's node id (backend ask) | stage 2 review | stage 11 (Slides) |
| Legacy share shim maps `read, write, comment` without `upload` to COMMENT, so the old-page journey "editor can edit" fails now that Writer shows the real Drive role. Not checked on the base commit | stage 11 Writer | Drive program (check `shims._legacy_role`) |
| Old Writer page loses the favourite star and share count on load: `GET nodes/{node}` lacks `expand=favourite,shares` | stage 11 Writer | backend ask; old page goes in stage 15 |
| `views/favourites` has no tie-breaker, reads one window, and lists trashed nodes (Drive 47 fixed the same in recents); `_view_eligible` can still return short pages | Drive 47 review | Drive program |
| `meet.api.test.test_recording`: `test_reprovision_during_recording_keeps_reservation_bound_to_archived_root` errors with "Unsupported recording callback protocol version". Same error on `forge/drive-layer` | stage 12 server | Meet (not in this run) |
| Mail shows a blank page when `get_user_info` fails: its route guard waits with no error handler. Before stage 5 | stage 5 PWA | not assigned |
| Guest "Your name" field in comment composers (plan stage 11) waits for stage 8's wiring | stage 8 | stage 11 follow-up after 8 |
| `suite/calendar/http/routes.py` types `recurrence_rule` as a string, route returns an object; Home Upcoming errors for any account with events | stage 0 | stage 5 (Calendar sub-lane) |

## Backend asks raised during the run

| Ask | From | Blocks |
|---|---|---|
| Socket room join that checks Drive link credentials, so link-only readers get live Sheets updates | stage 11 Sheets | nothing at launch (they can open and save) |
| Link codes in the collaboration v2 (Hocuspocus) token, e.g. a `driveLinkCodes(node)` root export | stage 11 Sheets | nothing while `collab_v2` is off |
| Server-side "attach a Drive node to a document" route, so the Desk picker does not move bytes through the browser (now capped at the framework's `max_file_size`) | stage 11 Drive | nothing (cap in place) |
| User full names on grant rows (`users_get` is System Manager only; the dialog shows emails for people the picker has not seen) | stage 9 | nothing (emails shown) |
| Creation date on link grant rows, for the "made on" text | stage 9 | nothing (text left out) |
| `DriveConflict` names the existing node, so Replace needs no `findChild` lookup | stage 10 | nothing (lookup works) |
| Explain answer lists the subject's own groups, or `PUT grants` gets a dry run, so the self-demotion confirm sees a new group row | stage 9 | nothing (confirm covers existing rows) |
| `own_role` or "has own access" in the Drive `access` expansion, so a member who opens a higher link keeps Star and Recent | stage 8 | nothing (link-only rule is stricter) |
| Site timezone in boot or session, so share expiry means the sharer's end of day | stage 9 | nothing (site time used) |
| Upload status route (`GET /uploads/<id>` with `received`) and a stable "session gone" error type; the client probes with an empty chunk and matches message text | stage 10 | nothing (probe works) |
| Multipart presigned uploads, so direct (S3) uploads can resume | stage 10 | nothing (direct uploads restart) |
| `recordDriveVisit(node)` root export in `apps/drive/index.ts` | stage 11 Sheets | nothing (a local operation works) |

## Baselines

Stage 0, `06d5c0225`, 2026-09-29. Gates run by the orchestrator after the
review fixes.

| Gate | Result |
|---|---|
| `yarn test:unified` | 31 files, 103 tests pass |
| `yarn test:legacy` | 2870 tests; matches the manifest (0 expected failures). One timing-sensitive Meet test (`ParticipantConnection lifecycle`) failed once under load, then passed |
| `yarn check:import-boundaries` | 376 owned graph violations, 71 unstable frappe-ui imports baselined |
| `yarn check:bundle-budget` | 146.62 KiB gzip, 28 chunks (cap 200) |
| `yarn typecheck` | 0 errors in scope (128 at start); 1111 outside scope ignored |
| Architecture test | 7 tests OK |
| Journeys (agent run) | shell 12 of 16, files 58 of 63 (2 fixme), home 9 of 10. Failures also fail on the pre-merge commit |
| Backend (agent run) | `test_http` 4, `test_contract` 2, `suite.api.test_routes` 9, `test_account` 10, drive `test_routes` 102: all OK. `test_shims` 266 of 267 (`set_settings`, pre-existing) |

Site data on `slides.localhost`:

- 2026-09-29: three empty "Untitled Sheet" rows from 2026-09-23 (Sheets
  `42lu282cdd`, `5p1q8onbjh`, `7058epn4nm`) had legacy `File` rows and no
  Drive node, so `after_migrate` refused. The orchestrator backed them up
  to `~/backups/slides-localhost/orphan-sheets-20260929.json` and deleted
  them. `migrate --skip-fixtures` then completed.
- Four documents have nodes whose `name` field differs from the document
  (Writer `qpbhfljtgt`, `u69iadktp2`; Presentation `u6cck0hr73`; Sheet
  `u6ae4ocqai`). A full Drive Build rerun would stop on them. Migrate does
  not. Left alone.
- The dev site bench (`suite-bench.service`, 8006) runs without reload.
  It serves pre-merge Python until someone restarts it. The run does not
  restart services.
