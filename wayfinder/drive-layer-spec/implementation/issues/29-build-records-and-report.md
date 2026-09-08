# 29 — Complete Build records, accounting, and reporting

**What to build:** Finish the additive migration with usable personal state and reconciled root accounting.

**Blocked by:** [28 — Migrate content history, comments, templates, and media](28-build-content-and-media.md)

**Status:** in-progress — blocked. Seven acceptance criteria pass. Criterion 7
(registry activation) is refused: activation breaks the three shipped document
creation endpoints. See the remaining gate below.

**Owner:** Suite migration. Claimed 2026-09-08 by the Ticket 29 implementation agent on
`implement/drive-29-build-records`, forked from `forge/drive-layer` at `9cba9ee91`.
Independently reviewed 2026-09-08 on `review/drive-29-full`.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §14.2 steps 9–13, §14.6, §14.8–14.9.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Perform the pre-model-sync Recent rename without losing source values. Retarget favourites, legacy routes, DAV locks, and properties.
- [x] Migrate activity payloads and derived verbs with detail.migrated. Start the notification inbox empty as specified.
- [x] Migrate quota settings from MB to bytes and reservation owners to roots. Create missing reservation roots as pairs.
- [x] Recompute usage last from nodes, versions, and reservations. Reconcile totals independently.
- [x] Produce every specified report key and preserve evidence across reruns. Save reports privately; do not log link secrets.
- [x] Compose the complete Build patch and registration order. Retain legacy source columns until Cleanup.
- [ ] Coordinate content registry activation and compatibility routing only after required links exist.
- [x] Prove restart behavior at each batch boundary. Keep destructive Cleanup unregistered.

## Verification

Run the full Build fixture suite twice with interrupted progress. Validate reports, source preservation, root-pair integrity, and independent usage sums.

## Claimed files

New: `suite/drive/patches/rename_entity_log_to_recent.py`,
`suite/drive/patches/build/records.py`, `.../settings.py`, `.../usage.py`,
`.../report.py`, `.../patch.py`, and their tests under
`suite/drive/patches/build/tests/`.

Edited: `suite/drive/patches/build/__init__.py`, `ports.py`, `state.py`,
`environment.py`, `tests/fakes.py`, `tests/test_dormancy.py`,
`suite/patches.txt`, `suite/hooks.py`, and the Drive record doctype JSON that
step 9 retargets.

## Completion evidence

The migration half of this ticket is built and proved. The activation half is
not: turning `drive_content_types` on stops Writer, Slides, and Sheets document
creation, so this ticket stays open behind the gate at the end of this section.

An independent review audited the whole `9cba9ee91..592a36ba4` delta, found five
defects, fixed four with regression tests, and proved the fifth against the site.

### Revisions

- Ticket 28 baseline: `9cba9ee91`.
- Implementation tip received for review: `592a36ba4`.
- Reviewed tip: `857d11c6b`, on `review/drive-29-full`. 16 commits, 45 files,
  +5117 / -1842.
- Integration target is `forge/drive-layer`. Nothing was merged or pushed.

### Defects found by the review

| # | Defect | Fix |
|---|---|---|
| 1 | `suite.tests.test_architecture` was red on the branch and green on its base. Activation moved the cross-app surface the gate measures and the exact-match baseline was not moved with it. | `4f10fadd7`: 15 entries recorded, 8 resolved entries retired, the Ticket 29 debt entry removed as its own note required. |
| 2 | The Recent rename lost every person's recents on a retried migration. `DocType.after_rename` commits `RENAME TABLE` before the `ALTER`s, so a kill in between left the table renamed with legacy column names; the plan read only table existence, so the rerun skipped, model sync added `node` and `opened_at` empty beside the full columns, and `UNIQUE recent_user_node` accepted the NULLs. | `4bbf82d64`: the plan reads the columns as well and resumes a half-done rename, emitting only the `CHANGE COLUMN`s the killed run had not landed. 17 → 25 cases. |
| 3 | §14.9's `activity_verbs_derived` and `activity_rows_dropped` counted only the rows a run inserted, so a rerun over a finished site reported zero derived verbs. Both keys are a census of the source rows. | `6b71283d8`: every source row is mapped before the already-present check. Proved by probe (2 → 0 before, stable after) and mutation-tested. |
| 4 | The dormancy package proved Cleanup is unregistered and that Build removes nothing, and checked nothing else §14.10 deletes. | `47e86ff6d`: `TestCleanupHasRemovedNothingYet` walks the whole §14.10 list. Mutation-checked with three separate removals. |
| 5 | **Activation stops document creation** in Writer, Slides, and Sheets. | Open. See the gate below. |

### Results

Site-free, on the bench interpreter with `frappe.init` and no connect:

| Suite | Result |
|---|---|
| `suite/drive/patches/build/tests` (whole package, run twice) | 811 tests, 0 failures, 0 errors, both runs |
| `suite.drive.patches.build.tests.test_dormancy` | 19 OK |
| `suite.drive.tests.test_rename_recent` | 25 OK |
| `suite.drive.patches.build.tests.test_records` | 35 OK |
| `suite.drive.patches.build.tests.test_patch` | 20 OK |
| `suite.tests.test_architecture` | 7 OK |

Serialized site gate on `slides.localhost`, through `PYTHONPATH` on the review
worktree. The registered Build patch was **not** run and `bench migrate` was
**not** run: Ticket 31 owns the rehearsal.

| Module | Result |
|---|---|
| `suite.drive.tests.test_content` | 57 + 49 + 3 OK |
| `suite.drive.http.tests.test_shims` | 267 OK |
| `suite.drive.tests.test_build_content` | 21 OK |
| `suite.writer.tests.test_drive_adoption` | 27 + 42 OK |
| `suite.sheets.tests.test_drive_adoption` | 47 + 60 OK |
| `suite.slides.tests.test_drive_adoption` | 30 + 65 OK |
| `suite.writer.doctype.writer_document.test_writer_document` | 2 OK |
| `suite.drive.tests.test_rename_recent` | 25 OK |
| `suite.tests.test_architecture` | 7 OK |
| `suite.drive.patches.build.tests.test_dormancy` | 19 OK |

A whole-app run (`run-tests --app suite`) is 859 unit OK, 1427
unspecified-category OK, and 1217 of 1395 integration with 54 errors. 36 of
those errors are on the base branch as well (`test_upload` 26, `test_versions`
10). The other 18 are the gate below.

Ruff 0.12.3: import sort clean, 24 lint findings, all of them present on the
base branch as well. Three files fail `ruff format` and all three fail on the
base branch too. `compileall` over `suite/` returns 0 on Python 3.14.

### Retired tests

`592a36ba4` deleted about 1,200 lines of pre-activation cases: Writer 103 → 69
methods, Sheets 129 → 107, Slides 101 → 95. The judgment is that the deletions
are correct. Every retired class built its fixture from a content document with
no node, which `require_node` makes impossible for a registered doctype, so the
cases describe a state that cannot be reached rather than behaviour that stopped
being checked. Legacy compatibility that is still reachable is still covered:
`test_shims.py` pins all 69 forwarders and both wildcard prefixes, and the
surviving `TestWriterInDrive`, `TestSheetsInDrive`, and `TestSlidesInDrive`
carry the workflows.

### Cleanup dormancy

`suite.drive.patches.build.tests.test_dormancy`, 19 cases. No `patches.txt`
line and no hook names `suite.drive.patches.cleanup`; the module does not
exist; no Build module holds a destructive statement or call; and every item on
§14.10's list is still shipped — the seven source doctypes, the seven `File`
custom fields, the three property setters, the legacy columns on Drive
Settings, Drive Disk Settings, Drive Storage Reservation, Presentation, Sheet
and Writer Document, the `/api/method/suite.drive.api.` prefix beside §11.2's
route namespace, and all 69 forwarders.

### The remaining gate

**Activation must not ship before the three creation endpoints move onto
`drive.create_document`.** `drive_content_types` now names all three apps, so
`content.require_node` refuses a content document with no node. Every shipped
creation endpoint writes exactly that:

| Endpoint | Called by | Base `9cba9ee91` | Tip `592a36ba4` |
|---|---|---|---|
| `suite.writer.api.docs.create_document` | `writer/resources/index.js:19`, `drive/resources/files.js:293` | creates a `File` | `DriveConflict: A Drive content document requires its node` |
| `suite.sheets.api.create_sheet` | `drive/resources/files.js:299` | returns a sheet id | same refusal |
| `suite.slides...presentation.create_presentation` | `slides/stores/presentation.js:21` | inserts a deck | same refusal, on `presentation.insert()` |

Measured directly against `slides.localhost` inside a savepoint that was rolled
back, on both revisions. The 18 site test errors that are not on the base
branch are the same defect seen through six fixtures:
`suite.slides.api.test_file` (2 `setUpClass`, 21 cases blocked),
`suite.slides.doctype.presentation.test_presentation` (3),
`suite.slides.tests.test_thumbnail_patches` (5),
`suite.slides.tests.test_pasted_media` (1, 3 cases blocked),
`suite.writer.api.tests.test_general` (5), and
`suite.drive.api.tests.test_files` (2).

Ticket 23 recorded this handover: "the fallback outlives its reason if ticket 29
does not replace `create_document` … ticket 29 or 34 owns the replacement."
Ticket 17 recorded its size: the creation endpoint cannot move without the read
path around it — `docs.get_document`, `general.get_document_list`,
`general.get_versions`, the search mapping, `drive/api/list.py:files`, and
`writer/api/embed.py`. That is ticket-sized work and the review did not
attempt it.

Close this criterion one of two ways, and the choice is the program's, not the
reviewer's:

1. Move the three endpoints and their read paths onto `drive.create_document`
   in a dedicated ticket, then keep activation here.
2. Hold the `drive_content_types` entries out of `suite/hooks.py` until Ticket
   34 lands, and ship the rest of Build now. Everything else in this ticket is
   independent of activation.

Independent site proof of the migration itself is still owed and belongs to
Ticket 31: no run of the registered Build patch and no `bench migrate` has been
made against any real site.
