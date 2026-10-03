# 29 — Complete Build records, accounting, and reporting

**What to build:** Finish the additive migration with usable personal state and reconciled root accounting.

**Blocked by:** [28 — Migrate content history, comments, templates, and media](28-build-content-and-media.md)

**Status:** done. All eight acceptance criteria pass. Criterion 7 is closed:
the three creation endpoints and the read paths around them now run on
`drive.create_document`, and the whole Suite site suite is green.

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
- [x] Coordinate content registry activation and compatibility routing only after required links exist.
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

Both halves are built and proved. The migration half was reviewed on
`review/drive-29-full`; the activation half was closed afterwards on
`integrate/drive-29-final`, where the three creation endpoints and the read
paths around them moved onto `drive.create_document`.

An independent review audited the whole `9cba9ee91..592a36ba4` delta, found five
defects, fixed four with regression tests, and proved the fifth against the
site. The fifth is now closed as well.

### Revisions

- Ticket 28 baseline: `9cba9ee91`.
- Implementation tip received for review: `592a36ba4`.
- Reviewed tip: `857d11c6b`, on `review/drive-29-full`. 16 commits, 45 files,
  +5117 / -1842.
- Activation tip: `423db9aa4`, on `integrate/drive-29-final`. 13 commits over
  the reviewed tip, 21 files, +2051 / -362 over `a70b726ac`.
- Integration target is `forge/drive-layer`. Nothing was merged or pushed.

### Defects found by the review

| # | Defect | Fix |
|---|---|---|
| 1 | `suite.tests.test_architecture` was red on the branch and green on its base. Activation moved the cross-app surface the gate measures and the exact-match baseline was not moved with it. | `4f10fadd7`: 15 entries recorded, 8 resolved entries retired, the Ticket 29 debt entry removed as its own note required. |
| 2 | The Recent rename lost every person's recents on a retried migration. `DocType.after_rename` commits `RENAME TABLE` before the `ALTER`s, so a kill in between left the table renamed with legacy column names; the plan read only table existence, so the rerun skipped, model sync added `node` and `opened_at` empty beside the full columns, and `UNIQUE recent_user_node` accepted the NULLs. | `4bbf82d64`: the plan reads the columns as well and resumes a half-done rename, emitting only the `CHANGE COLUMN`s the killed run had not landed. 17 → 25 cases. |
| 3 | §14.9's `activity_verbs_derived` and `activity_rows_dropped` counted only the rows a run inserted, so a rerun over a finished site reported zero derived verbs. Both keys are a census of the source rows. | `6b71283d8`: every source row is mapped before the already-present check. Proved by probe (2 → 0 before, stable after) and mutation-tested. |
| 4 | The dormancy package proved Cleanup is unregistered and that Build removes nothing, and checked nothing else §14.10 deletes. | `47e86ff6d`: `TestCleanupHasRemovedNothingYet` walks the whole §14.10 list. Mutation-checked with three separate removals. |
| 5 | **Activation stops document creation** in Writer, Slides, and Sheets. | Closed. `b7968daf2`, `640ed26a6`, `bfc236fa0` move the three endpoints onto `drive.create_document`; `5acf79f3d`..`423db9aa4` move the read paths around them. See the closed gate below. |

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

Modules added or rebuilt for the activation half, on the same serialized gate:

| Module | Result |
|---|---|
| `suite.writer.api.tests.test_docs` | 8 OK (new) |
| `suite.writer.api.tests.test_embed` | 9 OK (new) |
| `suite.writer.api.tests.test_general` | 21 OK |
| `suite.writer.api.tests.test_ticket29_create_document` | 7 OK |
| `suite.sheets.tests.test_api_titles` | 9 OK (new) |
| `suite.sheets.tests.test_list_sheets` | 26 OK |
| `suite.sheets.tests.test_create_sheet` | 8 OK |
| `suite.slides.doctype.presentation.test_presentation` | 28 OK |
| `suite.slides.api.test_file` | 21 OK |
| `suite.slides.tests.test_thumbnail_patches` | 5 OK |
| `suite.slides.tests.test_create_presentation` | 13 OK |
| `suite.slides.tests.test_composite_groups` | 18 + 34 OK |
| `suite.drive.api.tests.test_files` | 59 OK |
| `suite.drive.tests.test_versions` | 7 + 14 OK |
| `suite.drive.tests.test_upload` | 8 + 26 OK |

A whole-app run (`run-tests --app suite`) at `423db9aa4` is **859 unit OK, 1311
of 1447 integration OK with 26 skipped, and 1464 unspecified-category OK. No
failures and no errors.** The 36 errors recorded earlier were not code: two
`Drive Root` rows for the fixture users `drive-upload-user@example.com` and
`drive-version-user@example.com` had survived a killed run, and every one of
the 36 was the same `DriveConflict: An active Drive root already exists`. The
two rows were removed from `slides.localhost` and both modules pass.

Fourteen mutations were checked, each reverting one decision and each caught:
the `save_comments` COMMENT check, both create rollbacks, the
`get_drive_file_meta` cache guard, the sheets title and search halves, the deck
list's hidden rows, the template picker's permission query, `read_version`'s
READ check, the embed id resolution, and the three share-count rules.

Ruff 0.12.3: import sort clean, 24 lint findings, all of them present on the
base branch as well. Three files fail `ruff format`, and all three fail on the
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

### The gate, and how it was closed

**Activation must not ship before the three creation endpoints move onto
`drive.create_document`.** `drive_content_types` names all three apps, so
`content.require_node` refuses a content document with no node, and every
shipped creation endpoint used to write exactly that:

| Endpoint | Called by | Base `9cba9ee91` | Now |
|---|---|---|---|
| `suite.writer.api.docs.create_document` | `writer/resources/index.js:19`, `drive/resources/files.js:293` | creates a `File` | `b7968daf2` + `6f89d4e72`: an atomic adapter over `drive.create_document`, template applied in the same savepoint |
| `suite.sheets.api.create_sheet` | `drive/resources/files.js:299` | returns a sheet id | `640ed26a6`: the same adapter, with the personal-root fallback `shims._home` uses |
| `suite.slides...presentation.create_presentation` | `slides/stores/presentation.js:21` | inserts a deck | `bfc236fa0` + `b69b7ce0a`: the same adapter, with the `theme` write held in one savepoint beside it |

Ticket 17 recorded the size of the read path the creation endpoint cannot move
without. All of it is moved:

| Read path | Commit |
|---|---|
| `general.get_document_list`, `general.get_versions`, `get_drive_file_meta` | `da21f7704` |
| `writer/api/embed.py` (`add` and `get`) | `58f713bd5` |
| `drive.list_versions` and `drive.read_version` under `get_versions` | `5acf79f3d` |
| `sheets.api.list_sheets` and `get_sheet` titles and search | `9e56e3233` |
| `presentation.get_presentations` and `get_templates` | `b69b7ce0a` |

`docs.get_document`, the search mapping, and `drive/api/list.py:files` needed no
change: each already reads through Drive or through a column activation does not
freeze.

The 18 site test errors that were not on the base branch are gone. The six
fixtures behind them were rebuilt as linked fixtures, never made to bypass
`require_node`: `suite.slides.api.test_file`,
`suite.slides.doctype.presentation.test_presentation`,
`suite.slides.tests.test_thumbnail_patches`, `suite.writer.api.tests.test_general`,
and `suite.drive.api.tests.test_files` each build their document through
`drive.create_document` and hand it back through Drive's trash and purge.
`suite.slides.tests.test_pasted_media` was deleted: every assertion in it was
about `File` rows a linked deck cannot have, and its two surviving properties
moved to `suite.slides.tests.test_drive_adoption`.

No registry entry was deactivated and no authorization was weakened to close
this. Two hardenings went the other way: `save_comments` now checks COMMENT on
the node before it names the document, which removes an existence oracle
(§5.4), and both creation endpoints roll back the node when the write after it
fails.

Independent site proof of the migration itself is still owed and belongs to
Ticket 31: no run of the registered Build patch and no `bench migrate` has been
made against any real site.
