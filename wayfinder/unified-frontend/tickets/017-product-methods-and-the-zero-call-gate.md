---
id: 017
title: Product methods and the zero-call gate
label: wayfinder:grilling
status: closed
assignee: faris (fable, 2026-09-29)
blocked-by: []
---

## Question

Ticket 014 gates flip 2 on "zero legacy `suite.drive.api.*` calls" in new
code, and gates deletion on a legacy-call counter at zero. Drive §11.7 keeps
the 19 `suite.drive.api.product` methods on `/api/method/` by design. The
Files settings tabs from ticket 016 call some of them today
(`webdav_config`, `set_webdav_enabled`, `disk_settings`, `is_site_admin`),
and Statistics calls `storage.storage_breakdown`. Read literally, the
counter never reaches zero and deletion never happens. Drive §14.10 adds a
conflict: it deletes "the 69 API forwarders except the three permanent
names", and the 69 include the product methods.

Decide:

- Which names the boundary check bans in new code, and which names the
  counter (ask D26) must show at zero. Likely: only the names Drive §11.7
  maps to a REST route; the product methods and the three permanent names
  are exempt.
- Whether the Files settings tabs call product methods at launch or wait for
  `/api/suite/drive/` routes. That would be a new Drive ask.
- The Drive §11.7 against §14.10 conflict: an ask on the Drive program.
- The hold clock: if the counter shows a call during the hold, does the
  14-day period restart? Ticket 014 does not say.

Raised by the spec and plan audits of
[Draft the spec and plan](015-draft-the-spec-and-plan.md).

## Resolution

Decided on 2026-09-29 by Faris: "i dont want to keep any dotted paths when
suite is launched, update the spec and do whatever is necessary". Option B,
and further: the 19 product methods go, and so do the two names Drive
called permanent (`s3.fetch`, `get_file_for_doc`). At launch no Suite
client and no Suite server code depends on a `suite.drive.api.*` dotted
path. Drive Cleanup deletes all 69 names and removes the
`/api/method/suite.drive.api.` allowlist prefix. A Fable subagent applied
this to the Drive spec and filed the Drive issues. Ticket 022 applies it to
the unified spec and plan.

### Facts checked against the code

- Stored data that carries a dotted path, counted from code, no site
  queried. None needs a rewrite, because Build and Cleanup already handle
  each carrier:
  - `File.file_url` on S3 sites is
    `/api/method/suite.drive.api.s3.fetch?path=<key>` (`S3_URL_PREFIX`,
    `suite/drive/utils/files.py:21`; also written by Meet ingest,
    `suite/meet/recording/ingest.py:386`). Build step 3 gives every such
    row a blob and a node; Cleanup deletes the Drive-owned rows. `s3.fetch`
    resolves a `File` by `file_url`, so after Cleanup it could answer
    nothing even if kept.
  - Slides `Slide.elements[].src` holds `file_url` values. Build rewrites
    each to a node id (`slide_elements_rewritten`, Drive §14.7).
    `Presentation.thumbnail` holds a `file_url`; the column is dropped and
    previews replace it.
  - Invitation emails carry
    `/api/method/suite.drive.api.product.accept_invite?key=`
    (`drive_user_invitation.py:49`, `notifications.py:77`). A
    `Drive User Invitation` expires after one day (`EXPIRY_DAYS = 1`), so
    no emailed link outlives the release gap before Cleanup.
  - Writer bodies embed `/api/method/suite.writer.api.embed.get?id=`, a
    Writer path outside the rule. Its Python imports
    `suite.drive.api.files`; that import moves, the URL stays.
  - `Drive Notification` rows store text and a doctype pointer, no URL.
- `get_file_for_doc` was called permanent because of a "checked-in bundle"
  `suite/public/frontend/assets/sdk-*.js`. That directory is gitignored
  (`.gitignore:14`) build output of `frontend/src/apps/drive/legacy/sdk.js`.
  The name resolves through `File.get_for_doc`, so it dies with the `File`
  rows too. The reason was never true on this branch.
- Callers of the 21 names outside `apps/drive/legacy`:
  `product.get_translations` at `apps/drive/runtime.ts:12`,
  `apps/writer/runtime.ts:11`, `apps/writer/routes.ts:49`;
  `get_file_for_doc` through `legacy/sdk.js:23` from
  `apps/slides/components/SharePopover.vue:13`. The other 19 have no caller
  outside `legacy/`.
- Outside clients: the repo has no mobile or desktop app. `/dav` is used by
  third-party file managers; it is not a dotted path and stays. One Suite
  client lives outside `frontend/src`: the Desk file picker
  `suite/public/js/FileUploader.vue`, shipped as `ff_integration.bundle.js`
  through `app_include_js` (`suite/hooks.py:29`). It calls
  `files.get_root_folder`, `list.files` and `files.upload_file`. The
  boundary check, the stage 15 grep and Cleanup's evidence scan all miss
  it today.
- The Suite invitation resource (`suite/api/routes.py`) runs on the
  framework's `User Invitation`, not on `Drive User Invitation`. Its accept
  link is `frappe.core.api.user_invitation.accept_invitation`, a framework
  path.
- `suite/hooks.py:440` points `after_request` at
  `suite.drive.api.product.after_request` (the CSP `frame-ancestors`
  hook). A hook target, not a URL; it moves with `product.py`.

### New routes

Drive spec §11.2, block "Settings and WebDAV". "Drive admin" is write on
`Drive Disk Settings`, today's `is_drive_site_admin` rule.

- `GET /api/suite/drive/settings`: the caller's `Drive Settings` row
  (`webdav_enabled`, `auto_detect_links`, `writer_settings`). Replaces
  `get_settings`.
- `PATCH /api/suite/drive/settings` `{webdav_enabled}`. Replaces
  `set_settings`.
- `GET /api/suite/drive/site-settings`: `{is_admin, preview_size}` for
  everyone; the admin fields (`webdav_enabled`, `webdav_allowed_methods`,
  `default_personal_quota`, `shared_quota`) for a Drive admin. Replaces
  `is_site_admin` and `disk_settings` GET.
- `PATCH /api/suite/drive/site-settings` `{webdav_enabled}`, Drive admin.
  Replaces `set_webdav_enabled`.
- `GET /api/suite/drive/webdav`: the `webdav_config` shape unchanged.
  Replaces `webdav_config`.
- Already there: `GET /roots/<id>/usage` (storage), `GET /nodes/<id>/content`
  (`s3.fetch`), `GET /nodes/<id>?expand=access` (`get_file_for_doc`),
  `GET /api/suite/users` (`get_users`), `GET` and
  `POST /api/suite/invitations` (`get_pending_invites`, `invite_users`),
  `GET /api/suite/people?q=` (`get_user_groups`, ask S1).
- No successor, retired with their surface: `get_translations`
  (`frappe.translate.get_boot_translations`, spec §3.14); `signup`,
  `send_otp`, `verify_otp`, `oauth_providers`, `signup_disabled`
  (`/drive/signup`, spec §10.10, §14.6); `accept_invite`, `get_my_invites`,
  `reject_invite` (`Drive User Invitation`, which Drive §3.16 now drops).
  `disk_settings` PUT wrote only fields Cleanup drops.

### Drive issues

- [39 — Expose Drive settings, site settings, and WebDAV access through HTTP](../../drive-layer-spec/implementation/issues/39-settings-and-webdav-routes.md).
  The five routes above. Blocked by Drive 22 (done). Stage 4's External
  access tab waits on it.
- [40 — Make Cleanup delete every legacy Drive name and the allowlist prefix](../../drive-layer-spec/implementation/issues/40-cleanup-deletes-every-legacy-name.md).
  Gate 3 and phase 6 over all 69 names; the evidence scan covers
  `suite/public/js`; `product.py`, `s3.py` and `overrides/file.py` go;
  `Drive User Invitation` and `Account Request` are dropped; only `/dav`
  stays. Blocked by Drive 35 (done) and 39.

Drive spec sections changed: §3.16, §11.2, §11.7, §14.10.

### Decided (reversible)

1. **The ban list.** `check-import-boundaries.mjs` fails on any
   `suite.drive.api.` string outside `apps/drive/legacy`. There is no
   allowlist. There is one shrinking baseline for today's callers outside
   `legacy/` (the list above plus the Sheets and Slides `track_visit`
   entries and the six Writer components), each with an owner and the stage
   whose route replaces it. Reason: no name is permanent, so a permanent
   allowlist has nothing to hold [Faris, Drive §11.7].
2. **The counter and the zero read.** D26 counts every legacy name, keyed
   by name and user agent. The gate reads zero over all 69. No class is
   exempt or "reported, not blocking" [Faris, Drive §14.10 gate 3].
3. **Files tabs at launch.** Statistics and External access ship. Statistics
   reads `GET /roots/<id>/usage` (stage 4 as written). External access reads
   `GET /webdav` when the dialog opens, writes `PATCH /settings` and
   `PATCH /site-settings`, and mints keys through
   `suite.utils.user.generate_user_keys`, a Suite method on `/api/method/`
   outside the ban. External access waits on Drive issue 39; Statistics does
   not [Drive §11.2, T016].
4. **The Storage tab does not ship.** Unchanged from the proposal: every
   control on it dies with Drive Build and Cleanup, and no route carries
   the `disk_settings` write path [Drive §3.13, §11.7].
5. **The Desk file picker moves too.** `suite/public/js/FileUploader.vue`
   moves to `GET /roots`, `GET /nodes/<id>/children` and the upload routes
   before Cleanup. Ticket 022 gives it a plan stage and owner. The Drive
   Cleanup gate refuses until it is gone (Drive issue 40). The stage 15
   grep and the boundary check cover `suite/public/js` as well as
   `frontend/src`.
6. **The hold clock.** The hold needs 14 consecutive days at zero plus one
   full release. "Zero" means no count on any of the 69 names rose between
   two reads. Reads happen at the start, once a week, and at the end, by
   whoever runs the flip's `bench set-config` (ticket 019). A non-zero read
   ends the streak. After the client is fixed or retired, the 14 days start
   again at the next zero read. The release clock restarts only if the fix
   itself needs a release. A hit from a browser user agent in the first
   days is a stale legacy tab; it retires itself on reload, so wait for the
   next zero read [T014 decision 8].

### For Faris

One choice in the Drive spec deletes data and is yours to veto. The rest
is routes and wording.

- **Dropping `Drive User Invitation` and `Account Request` in Cleanup**
  (Drive §3.16, §14.10). After `product.py` goes, nothing reads or writes
  either table: the product methods were their only callers, and the
  Suite invitation resource uses the framework's `User Invitation`.
  Options:
  - A. Drop both in Cleanup, as now written. Pro: no orphan tables, no
    permission hooks pointing at deleted modules. Con: pending invitation
    rows (one-day expiry) and account requests are gone; rollback is the
    Cleanup database restore.
  - B. Keep the tables, delete the code. Pro: nothing lost. Con: two dead
    doctypes with hooks to unwire by hand, and a later ticket to drop them.
  Recommendation: A. The rows expire in a day and the framework flow
  replaces them. Say "keep" and the two spec sentences come out.

### Spec and plan changes

Ticket 022 applies these.

Spec (`unified-frontend-spec.md`):

- §4.4, last bullet: delete "stay on `/api/method/` by design". Replace
  with: all 69 `suite.drive.api.*` names are legacy; new code calls none;
  the Drive routes of Drive §11.2 "Settings and WebDAV" and the Suite
  resources of §4.3 replace the product methods; Cleanup deletes every
  name [T017].
- §12.2 Files row: tabs "Statistics; External access", condition
  "External access when WebDAV is on or the caller is a Drive admin
  (`GET /api/suite/drive/webdav`)". Add a bullet: the legacy Storage tab
  does not ship; its controls die with Drive Build [Drive §3.13, T017].
- §13.3, second bullet: replace "Ticket 017 settles which names the ban
  covers" with decision 1 (no allowlist, one shrinking baseline), and add
  `suite/public/js` to the check's scope.
- §14.7 flip 2 gate: "New code calls none of the 69 legacy names, checked
  by the boundary check."
- §14.8, first bullet: "at zero over all 69 names". Add the hold clock
  (decision 6) and the Desk file picker (decision 5) as bullets.
- §15.1 D26 row: "open. Counts every name; the gate reads all 69 [T017]".
  Add row D30: "Drive issues 39 (settings, site settings and WebDAV
  routes) and 40 (Cleanup deletes all 69 names and the allowlist prefix);
  filed, ready-for-agent [T017]".
- §16.1 item 1: closed by T017. §16.2 item 16: unchanged.

Plan (`unified-frontend-plan.md`):

- Stage 4: drop "The Files tabs that call Drive product methods wait on
  ticket 017". Add: Statistics ships on `GET /roots/<id>/usage`; External
  access waits on Drive issue 39 and calls `GET /webdav`,
  `PATCH /settings`, `PATCH /site-settings` and
  `suite.utils.user.generate_user_keys`; no Storage tab.
- Stage 11: the boundary-check bullet becomes decision 1; scope includes
  `suite/public/js`; the Sheets and Slides `track_visit` entries go here.
  Add the Desk file picker port (decision 5) with an owner. Remove "The
  boundary rule's name list waits on ticket 017".
- Stage 12: the counter line adds "reads at start, weekly and end".
  Remove "Ticket 017 (which names the counter counts)".
- Stage 13 gate: "zero over all 69 names". Remove "Ticket 017 (which
  names read zero)".
- Stage 14: replace "Ticket 017 decides whether the clock restarts" with
  decision 6. Remove the ticket 017 dependency.
- Stage 15 exit gate: "`grep -rn "suite.drive.api" frontend/src
  suite/public/js` returns nothing". Remove "Ticket 017 (exempt names)".
- Backend asks: D26 row as the spec row; add the D30 row.
- Handoff to Drive Cleanup: the evidence says "all 69 names, including the
  Desk file picker", with no permanent list.
- Open items: delete the ticket 017 entry.

### Asks

- Drive program: filed as issues 39 and 40.
- Suite: none new. `GET /api/suite/people?q=` (ask S1) now also carries
  `get_user_groups`'s job.
- None on Meet, Mail or Calendar.
