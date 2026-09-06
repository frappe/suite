# 17 — Move Writer lifecycle and history into Drive

**What to build:** Create, edit, copy, version, and purge Writer documents through the Drive contract.

**Blocked by:** [16 — Create content documents and media through one Drive contract](16-content-contract.md)

**Status:** in-progress

**Owner:** Suite Writer

**Starting revisions:** Suite `f33ceb9224b5befb0e1cead4acdf61dc95e3c209`;
Frappe `e9cc6261d1bb342383d9cb641e8190cbfc3854fd`.

**Claimed files:** `suite/writer/drive.py`,
`suite/writer/doctype/writer_document/writer_document.py`,
`suite/writer/doctype/writer_document/writer_document.json`,
`suite/writer/doctype/writer_document/test_writer_document.py`,
`suite/writer/api/docs.py`, `suite/writer/overrides/__init__.py`,
`suite/writer/tests/test_drive_adoption.py`, `suite/hooks.py`,
`suite/tests/test_architecture.py`, `suite/drive/tests/test_content.py`,
`suite/drive/api/tests/test_files.py`, and this ticket.

`suite/drive/api/tests/test_files.py` and `suite/drive/tests/test_content.py`
were touched and not claimed up front. Both are Drive tests whose expectations
this ticket changes; neither changes Drive behavior.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §10.7 Writer; §14.6–14.7.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Declare the Writer content adapter and immutable node link. Use package-root Drive workflows.
- [ ] Implement creation, duplicate, version bytes, restoration, purge, and used-node discovery.
- [ ] Keep explicit HTML export available. Set default_export=None so Writer stays hidden over DAV.
- [ ] Replace title/file synchronization, private history, and comment behavior with Drive ownership.
- [ ] Keep legacy columns and source rows until Build copies them and Cleanup permits deletion.
- [ ] Cover ordinary documents and templates. Keep WebRTC collaboration unchanged and authorize saves.

The boxes stay clear until the shared site runs the integration tests. See
"Verification" below for what has run and what has not.

## Verification

Run Writer integration tests and the shared adapter contract, including inherited access, trash read-only behavior, HTML export, and copy/version round trips.

### Site commands the orchestrator must run

```
bench --site slides.localhost migrate
bench --site slides.localhost run-tests --module suite.writer.tests.test_drive_adoption
bench --site slides.localhost run-tests --module suite.writer.doctype.writer_document.test_writer_document
bench --site slides.localhost run-tests --module suite.drive.tests.test_content
bench --site slides.localhost run-tests --module suite.drive.api.tests.test_files
bench --site slides.localhost run-tests --module suite.tests.test_architecture
```

`migrate` must run first. It adds the `node` column and validates the content
registry at boot. See "Migration" below for what the registry refuses.

### What has run here

No bench, no migrate, and no site command ran in this worktree. Only static
checks and no-database tests ran.

| Check | Result |
|---|---|
| `TestWriterDeclaration`, 16 tests, no database | Pass |
| `suite.tests.test_architecture`, 7 tests, no database | Pass |
| `TestContentContract` in `suite/drive/tests/test_content.py`, 41 tests, no database | 39 pass; 2 pre-existing tests need a database connection |
| `ruff check` on the changed files | Clean |
| `ruff format --check` on the changed files | Clean |
| `compileall` on `suite/writer`, `suite/drive`, `suite/hooks.py` | Clean |

The 27 tests in `TestWriterInDrive` need rows and have **not** run. The
acceptance boxes stay clear until they do.

## Completion evidence

Implementation commit `86bda351dc8b66a9f89073370f76ddd2b57dc215`.

### Changed behavior

- New `suite/writer/drive.py` declares `SPEC` and every callback: `create_empty`,
  `duplicate`, `export`, `version_bytes`, `restore_version`, `on_purge`,
  `used_nodes`, and `remap_media`. `pushes_preview` is false, `satellites` is
  empty, `default_export` is None, and `export_formats` is `("html",)`.
- `Writer Document` gains a read-only `node` Link to `Drive Node` with a search
  index, and the controller now extends `drive.DriveContent`. A document with
  no node is refused, and a saved link cannot move.
- `hooks.py` sets `drive_content_types = ["suite.writer.drive.SPEC"]` and points
  `has_permission` and `permission_query_conditions` for `Writer Document` at
  `suite.drive.framework`.
- `suite.writer.api.docs.create_document` calls `drive.create_document` under
  the caller's personal root, with `from_node` for a template. It writes no
  Drive table. The untitled fallback tries `Untitled Document`, then numbered
  names, up to 20 times, because Drive refuses a duplicate title in a folder.
- `new_version` and its private `Writer Version` write are replaced by
  `take_version(label=None)`, which calls `drive_take_version`. `update_file`
  and `save_comments` are deleted: title and comments belong to the node.
- `save_doc`, `save_html`, and `update_settings` ask Drive for EDIT at the node
  first. The two body writers write with `update_modified=False` and then call
  `drive_touch`, so the node carries the modified stamp.
- `suite.writer.overrides.document_query_conditions` is deleted. The three
  legacy guards for `Writer Template` and `Writer Version` stay.

### Decisions

- **The open baseline DocPerm stays.** `Writer Document` keeps its wide-open
  `All` role row. A Frappe permission hook can only deny, never grant
  (`frappe/permissions.py:244-246`), so a governed doctype needs a baseline for
  Drive to narrow. `Drive Grant` remains the only authority: the row hook, the
  query hook, and the four `DocShare` arms from ticket 16 close every path
  around it. The doctype carries no `DocShare` row at all.
- **Full activation now, not staged behind Build.** Ticket 16 hands tickets
  17 to 19 the registration step. The consequence is recorded under "Risks".
- **Legacy guards stay with the legacy rows.** §10.4 lists the old permission
  code for deletion. `Writer Version` and `Writer Template` rows are still
  readable until Build copies them (§14.6, §14.7), so deleting their guards
  would leak them. They go at Cleanup, with the doctypes.
- **The version payload is a `writer-document/1` JSON envelope** carrying the
  Yjs body and its HTML together. A bare HTML payload is refused rather than
  half-applied: a Yjs body cannot be rebuilt from HTML outside the editor, so
  restoring one would leave the collaborative body and the rendered HTML
  disagreeing. §14.6 migrates `Writer Version` rows as snapshot HTML, so Build
  owes the envelope. See "Handoffs".
- **`remap_media` is declared** although the §10.7 example block predates the
  callback. Without it a copied document's pictures still point at the source's
  media nodes.
- **`used_nodes` reads `content` through pycrdt and `html` as text.** pycrdt
  answers the live element attributes exactly. A raw byte scan would match
  every id-shaped run of text in the update, including deleted content Yjs has
  not collected, so a removed picture could stay charged for ever.
- **WebRTC collaboration is unchanged.** The editor still syncs peer to peer
  through `wss://signal.frappe.cloud`; there is no backend collab endpoint to
  authorize. Authorization is on the save, at the node.

### Failure and rollback evidence

- `test_a_failed_reference_rewrite_leaves_no_copy_and_no_charge` replaces the
  spec with `dataclasses.replace(SPEC, remap_media=explode)` and asserts the
  copy leaves no node, no document, and no charge.
- `test_a_refused_create_leaves_neither_a_node_nor_a_document` breaks
  `create_empty` the same way and asserts the node is gone too.
- `test_a_body_pycrdt_cannot_read_refuses_as_an_ordinary_validation_error`
  covers a real defect found during implementation. pycrdt is a Rust extension
  and raises `pyo3_runtime.PanicException`, which derives from `BaseException`.
  Unconverted it would pass straight through the `except Exception` that rolls
  Drive's copy savepoint back and leave the savepoint open. `_loaded_body` now
  converts it to `UnreadableBody`, a `frappe.ValidationError`.
- `test_an_undecodable_body_over_reports_instead_of_losing_a_picture` proves the
  other side: the daily media sweep falls back to a raw scan instead of
  crashing, and over-reporting only keeps media alive.

### Criteria to tests

| Criterion | Tests |
|---|---|
| Adapter and immutable node link | `test_writer_declares_the_identity_section_ten_seven_fixes`, `test_a_new_document_carries_its_node_and_its_node_carries_it`, `test_a_document_without_a_node_cannot_exist`, `test_a_saved_document_cannot_repoint_itself_at_another_node` |
| Package-root workflows only | `suite.tests.test_architecture`, `test_the_two_framework_hooks_point_at_drive_and_no_writer_code` |
| Create, duplicate, version bytes, restore, purge, used nodes | `test_a_copy_carries_the_body_and_repoints_it_at_the_copied_pictures`, `test_a_version_round_trips_the_collaborative_body_and_its_html`, `test_a_restore_keeps_the_state_it_replaced_as_history`, `test_a_purge_removes_the_document_its_media_and_its_legacy_versions`, `test_the_body_answers_only_the_pictures_it_still_names` |
| HTML export, hidden over DAV | `test_writer_stays_hidden_over_dav_and_keeps_its_explicit_html_export`, `test_the_html_export_streams_the_stored_body`, `test_an_export_format_writer_does_not_offer_is_refused` |
| Drive owns title, history, comments | `test_the_document_owns_no_field_drive_owns`, `test_the_title_is_read_from_the_node_and_never_mirrored`, `test_a_save_stamps_the_node_and_never_the_document_title`, `test_the_document_method_takes_a_version_through_drive`, `test_a_copy_carries_no_comment_blob` |
| Legacy columns and rows survive | `test_the_legacy_columns_and_doctypes_survive_adoption`, `test_a_legacy_version_row_survives_an_ordinary_save` |
| Templates | `test_a_template_starts_a_new_document_and_drops_the_template_flag` |
| Saves are authorized, collab untouched | `test_a_reader_cannot_save_the_body_and_an_editor_can`, `test_a_stranger_cannot_create_a_document_in_somebody_elses_drive` |
| Inherited access, trash, no DocShare bypass | `test_an_inherited_folder_grant_reaches_the_row_and_the_list`, `test_a_stranger_reads_neither_the_row_nor_the_list`, `test_a_trashed_document_stays_readable_and_leaves_the_list`, `test_a_docshare_cannot_open_a_document_the_grants_refuse` |

### Migration

No new patch. `suite/patches.txt` is untouched. The only schema change is the
`node` column, which `migrate` adds from the doctype JSON.

`validate_registry` runs at boot and refuses the site if `Writer Document`
lacks the `node` field, owns a field Drive owns, or carries a `DocShare` row.
A site with `DocShare` rows on `Writer Document` must clear them before
`migrate`, because such a row would grant around both permission hooks.

### Handoffs

| To | What is owed |
|---|---|
| 28 (Build) | Link every legacy `Writer Document` row to a node. Write `Writer Version` history as `writer-document/1` envelopes, not bare HTML, or restore refuses it. |
| 21, 22 | Root, trash, media upload, and version restore over HTTP. Until then `suite/writer/tests/test_drive_adoption.py` reaches `suite.drive._core`, recorded as owned debt in `suite/tests/test_architecture.py`. |
| 23 | Media node creation and the media route are still legacy Writer code (`suite/writer/api/embed.py`). |
| 34 (frontend) | Two call sites now hit methods that no longer exist: `frontend/src/apps/writer/composables/useDocument.ts:37` (`new_version`) and `frontend/src/apps/writer/resources/index.js:37` (`save_comments`). Frontend adoption is separate scope, so this ticket did not change them. `newVersion` takes different arguments and returns a different shape from `take_version`, so no alias was added. |

### Risks

- Until Build (ticket 28) links them, a legacy `Writer Document` row with no
  node raises `DriveConflict` on every row permission check. This is why the
  site commands above run `migrate` before any test.
- The untitled fallback tries 20 names. A folder with 20 untitled documents
  raises the last refusal instead of a friendlier message.
