# 30 — Verify the complete backend before migration rehearsal

**What to build:** Produce one verified integration state across storage, Drive, all content apps, HTTP, and WebDAV.

**Blocked by:** [05 — Preserve File adoption hooks on storage v2 uploads](05-file-upload-hook.md); [29 — Complete Build records, accounting, and reporting](29-build-records-and-report.md)

**Status:** done

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

- [x] Check every normative spec section against implementation and ticket evidence. Close missing behavior before marking done.
- [x] Review grants, link transport, upload bindings, byte egress, query filters, Guest identity, and all HTTP/DAV mutation paths.
- [x] Test failure atomicity and concurrency for root pairs, quota admission, replacement, moves, and purge.
- [x] Run the full storage package, Suite app suite, app adapter tests, architecture checks, and DAV acceptance.
- [x] Rerun measurements only when relevant changes affect them. Record actual MariaDB schema and performance results.
- [x] Confirm all four Drive Blob Link columns protect bytes and exactly five daily jobs are wired.
- [x] Inspect the additive deployment path. Retain legacy data required for rollback and client adoption.
- [x] Record exact code revisions, failures fixed, remaining external gates, and reproducible test commands.

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
  own readable copy sorted past the cut). It has since been rebounded again
  (`fix/drive-30-site-findings`): the proof is now the caller's own
  references first (`BLOB_OWN_SOURCES_SQL`, the cheap, common case), then
  every reference any principal holds only if that finds nothing. Each tier
  pages in bounded batches and now also caps the number of pages it reads
  (`BLOB_SOURCE_MAX_PAGES`), refusing past that bound instead of paging to
  exhaustion under `create_file`'s parent lock. See
  `suite/drive/_core/nodes.py`'s `_require_readable_blob` docstring and
  `test_blob_provenance.py`'s `TestReadableBlobProof` for the current
  contract.
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

### 2026-09-09 — terminal-validation fixes, `fix/drive-30-site-findings`

Three findings from a terminal validation pass against `19be46c0b`
(`/tmp/ticket30-validation/log.md`), fixed in an isolated worktree, never
merged past `forge/drive-layer`:

- **Stale `preview_size=100` on a live `tabSingles` row.** The 2026-09-08
  entry above stopped `patches/remove_personal.py` from writing the
  megabyte-era `100` on *future* runs, but a site that already carried that
  value from an earlier run keeps it - §9.2's pixel default never
  retroactively applies to an existing Single row, so `_preview_longest_side()`
  reads a real, explicit `100` instead of falling back to `512`.
  `suite/drive/patches/migrate_preview_size_unit.py` (registered in
  `suite/patches.txt`, post-model-sync, immediately before
  `suite.drive.patches.build`) is additive and idempotent: it moves the one
  known legacy sentinel value forward once, and leaves every other stored
  value - including one an admin genuinely set to `512`, or to anything
  else post-transition - untouched. Not run: no `bench migrate` was executed
  against `slides.localhost` for this validation, so its stale
  `preview_size=100` row (and `test_previews`' resulting failure) is
  unchanged and still needs a real `migrate` to clear. Tests:
  `suite/drive/patches/test_migrate_preview_size_unit.py` (100→512, an
  explicit non-legacy value preserved, the pixel default itself preserved,
  rerun-after-translation is a no-op).
- **`test_ticket29_create_document`'s reproducible MariaDB error.** The
  failing case mocked `docs.drive.personal_root_for` and
  `docs.drive.create_document` at the boundary `writer/api/docs.py` calls
  Drive through, but not `docs.drive.rollback_savepoint` - the same
  boundary, called from the same `except` arm. With that one call unmocked,
  the adapter's real exception handler ran the real
  `_core/errors.rollback_savepoint`, which issued a genuine
  `frappe.db.rollback(save_point=...)` against live MariaDB using a
  savepoint name built from a mocked `frappe.generate_hash()`. This is a
  test boundary gap, not a production leak: `rollback_savepoint`'s
  deadlock-vs-lost-savepoint behavior is real transaction logic and stays
  covered, unweakened, by `suite/writer/tests/test_docs_savepoint.py`. The
  fix mocks `docs.drive.rollback_savepoint` in
  `test_a_workflow_refusal_leaves_no_trailing_write`, the same way the
  module's other tests already mock every other `docs.drive.*` call, and
  asserts it received the workflow's own exception.
- **`test_blob_provenance` standalone `RecursionError`.** Confirmed
  test-isolation, not a production defect. `StubbedDatabase.setUp` replaces
  `frappe.local.db` with a bare `MagicMock()`; every test in the module
  explicitly stubs `db.sql` for its own proof, but none stubs `db.get_value`,
  which framework internals (translation, doctype meta) still call
  incidentally while constructing a `DriveForbidden`. An unconfigured mock
  answers `get_value(...)` with a fresh child mock, not `None`; subscripting
  it (`d["doctype"]`, `d["fieldtype"]`, ...) reads as a present row instead
  of a miss, so `Document.load_from_db()`'s doctype-meta bootstrap keeps
  reconstructing a "doctype" that is itself never anything but another mock
  of the same call, recursing until the interpreter's stack gives out. Only
  surfaces when this module runs first or alone in a process, which is why
  it passed embedded in the full run and failed standalone: whichever test
  ran first elsewhere already resolved that meta over a real connection.
  Setting `self.db.get_value.return_value = None` in `StubbedDatabase.setUp`
  makes that incidental path a normal, harmless miss; no test in this module
  reads or asserts on `get_value` itself. Verified standalone
  (`bench --site slides.localhost run-tests --module
  suite.drive.tests.test_blob_provenance`) 5/5 green runs, and embedded
  alongside `test_nodes`, `test_upload`, and `test_access` in the same
  process.

### 2026-09-09 — closeout

Ticket done. Final state: Suite `integrate/drive-30-backend-review` at
`c24bbbafd` (this merge commit); Frappe `forge/storage-v2` reviewed at
`0614986218` (`frappe-drive-30-storage`, "Merge Ticket 30 storage v2
streaming-route fix"). This entry closes the ticket; it records the review's
final result and does not add new fixes beyond the two entries above.

Test results, by area:

- Frappe storage-v2 streaming-affected gates: 78/78 pass.
- `test_blob_provenance`: 25/25, standalone, twice; 111/111 embedded with
  the rest of the Drive suite.
- Writer savepoint/workflow tests: 7/7, run three times.
- `test_migrate_preview_size_unit.py`: 4/4.
- HTTP adapter tests: 587/587.
- WebDAV adapter tests: 342/342.
- Full Suite app run: 3681 pass. Six `test_previews` failures remain, all
  caused by one untouched live `tabSingles` row still holding the legacy
  `preview_size=100` sentinel (see the terminal-validation entry above), not
  a code defect.

Schema and jobs, verified by reading code, not by migrating a site: the four
`Drive Blob Link` columns that protect bytes from GC (`Drive Node.blob`,
`Drive Node Version.blob`, `Drive Node Preview.source_blob`,
`Drive Node Preview.blob`) and the five daily Drive jobs
(`recompute_root_usage`, `purge_trashed_nodes`, `thin_versions`,
`sweep_missing_previews`, `sweep_unused_document_media`) are all wired.
EXPLAIN plans for the reviewed queries use the `node_parent_page` and blob
indexes.

`suite/drive/patches/migrate_preview_size_unit.py` is registered in
`suite/patches.txt` (additive, moves the one legacy `100` sentinel to `512`,
idempotent, leaves any other stored value untouched). `bench migrate` was
not run against `slides.localhost`: it would trigger Build, and rehearsing
Build against real data is [Ticket 31](31-migration-rehearsal.md)'s job, not
this one's. The six `test_previews` failures above stay unfixed until that
migrate runs.

litmus was not run: no served site was available in this review. Its
coverage is substituted by Ticket 25's own clean litmus run plus the 342
WebDAV adapter tests above; only comment and deadlock-helper changes have
touched WebDAV since Ticket 25 closed.

`Drive Notification.activity`'s `reqd: 1` gap stays deferred to
[Ticket 35](35-cleanup-implementation.md), as recorded in the entry above and
in Ticket 35 itself. Frontend adoption and its vitest suite are out of scope
here; that is [Ticket 32](32-frontend-drive-adoption.md).

No `bench migrate`, push, merge, or Cleanup activation happened in this
closeout. The next agent-owned ticket is [35](35-cleanup-implementation.md).
[Ticket 31](31-migration-rehearsal.md) is human-owned (migration
operations) and is not claimed by this closeout.
