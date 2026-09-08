# 30 — Verify the complete backend before migration rehearsal

**What to build:** Produce one verified integration state across storage, Drive, all content apps, HTTP, and WebDAV.

**Blocked by:** [05 — Preserve File adoption hooks on storage v2 uploads](05-file-upload-hook.md); [29 — Complete Build records, accounting, and reporting](29-build-records-and-report.md)

**Status:** in-progress

**Owner:** Suite integration. Claimed 2026-09-08 by three independent Claude
review agents on `integrate/drive-30-backend-review`, forked from
`forge/drive-layer` at `1d3001a03` (Suite) and `forge/storage-v2` at
`3357ad1605` (Frappe). Split into three non-overlapping review branches so
each reviewer covers a disjoint file set. Each branch reports findings and
fixes back onto `integrate/drive-30-backend-review`, which merges into
`forge/drive-layer` only. This ticket work never merges into `main`.

- **Review A — storage/framework** (spec §2–6, tickets 02–06, 05). Frappe repo,
  `forge/storage-v2`: `frappe/storage/` (`blob.py`, `gc.py`, `upload.py`,
  `serve.py`, `relocate.py`, `driver.py`, `local_driver.py`, `s3_driver.py`,
  `backfill.py`, `email.py`, `url.py`) and `frappe/storage/tests/`.
- **Review B — Drive core/concurrency** (spec §7–15, tickets 07–15). Suite
  repo: `suite/drive/_core/`, `suite/drive/doctype/` (root, node, grant,
  permission, storage_reservation, node_version, node_preview, comment*,
  favourite, recent, token, dav_lock, dav_property), `suite/drive/locks/`,
  `suite/drive/jobs.py`, `suite/drive/framework.py`, and their tests.
- **Review C — content+HTTP+WebDAV/deployment** (spec §16–14.9, tickets
  16–29). Suite repo: `suite/drive/http/`, `suite/drive/webdav/`,
  `suite/drive/api/`, `suite/drive/e2e_api.py`, `suite/drive/patches/`
  (including `build/`), `suite/drive/install.py`, content-contract call
  sites in `suite/writer/`, `suite/slides/`, `suite/sheets/`, and their
  tests.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §1–14; plan stage 8.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Check every normative spec section against implementation and ticket evidence. Close missing behavior before marking done.
- [ ] Review grants, link transport, upload bindings, byte egress, query filters, Guest identity, and all HTTP/DAV mutation paths.
- [ ] Test failure atomicity and concurrency for root pairs, quota admission, replacement, moves, and purge.
- [ ] Run the full storage package, Suite app suite, app adapter tests, architecture checks, and DAV acceptance.
- [ ] Rerun measurements only when relevant changes affect them. Record actual MariaDB schema and performance results.
- [ ] Confirm all four Drive Blob Link columns protect bytes and exactly five daily jobs are wired.
- [ ] Inspect the additive deployment path. Retain legacy data required for rollback and client adoption.
- [ ] Record exact code revisions, failures fixed, remaining external gates, and reproducible test commands.

## Verification

Run integration checks serially on slides.localhost. Attach actual output summaries and failure fixes; fixture tests do not count as a real export rehearsal.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.

### 2026-09-09 — final review-fix pass, `fix/drive-30-final-review`

Bounded fixes from the three independent review branches, applied cohesively
in an isolated worktree (never merged past `forge/drive-layer`):

- `suite/meet/api/recording.py`'s `_admission_transaction` now rolls back
  through `drive.rollback_savepoint`, not a bare
  `frappe.db.rollback(save_point=...)`; added to
  `test_savepoint_discipline.py`'s `OWNED_SURFACE` and a runtime deadlock
  test (`suite/meet/api/test/test_recording_savepoint.py`).
- `preview_size` now has one coherent meaning end to end: `_core/previews.py`
  reads `Drive Disk Settings.preview_size` (falling back to 512 on a bad
  value) instead of a hardcoded constant; `patches/remove_personal.py` no
  longer writes the stale megabyte-era `100`; `FileRender.vue`'s in-browser
  file-size guard is now its own independent constant
  (`utils/filePreview.js`), decoupled from the backend's pixel setting.
- `test_blob_provenance.py`'s AST sweep now resolves `import ... as` aliases
  before matching a call to `create_file`, which surfaced the public
  `suite.drive.create_file` facade as an unproven caller; it now forwards
  `_client_named_blob=True` like the HTTP client door.
- `_require_readable_blob` no longer truncates its candidate scan at 50 rows
  before checking readability (which could falsely refuse a caller whose
  own readable copy sorted past the cut); it now pages through every
  candidate, bounded per page, until one page proves readable or the scan is
  exhausted.
- Fixed a stale rule citation and a dead file reference in
  `test_savepoint_discipline.py`'s module docstring (ARCHITECTURE.md rule
  2.4, not 2.2; the two runtime cases live in
  `suite/writer/tests/test_docs_savepoint.py` and
  `suite/slides/tests/test_presentation_savepoint.py`, not a
  `suite/tests/test_content_app_savepoints.py` that was never created).
- ARCHITECTURE.md now records `rollback_savepoint` as an intentional
  rule-9.5 exception to rule 3.2 (a transaction primitive, not a domain
  workflow) rather than leaving its public export undocumented.
- **Deferred, not fixed:** `Drive Notification.activity` is normatively
  `reqd: 1` (§3.11), but `suite/drive/api/notifications.py`'s legacy writer
  and `drive_user_invitation.py` still insert rows with no `activity` set.
  Making the field required now would break those Build-era writers.
  §14.10 already drops the legacy notification columns in Cleanup; enforcing
  `reqd: 1` belongs in that same release, once the legacy writers are gone,
  not in Build. See [Ticket 35](35-cleanup-implementation.md)'s acceptance
  criteria for the ordered removal this depends on. This does not close
  either ticket.
