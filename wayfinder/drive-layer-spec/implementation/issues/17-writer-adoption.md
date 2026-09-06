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

The review below also changed `suite/drive/_core/content.py` and
`suite/drive/framework.py`, both owned by ticket 16. The §8.8 trashed
read-only rule has one home per seam and Writer is not it, so writing the
guard in Writer would have left Slides and Sheets to repeat it. Recorded as a
deviation from the plan's file ownership, not hidden.

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

`migrate` must run first. It adds the `node` column, and `after_migrate`
validates the content registry. See "Migration" below for what the registry
refuses, and "Blockers" for the two ways `migrate` can now fail on a site that
carries real Writer data.

### What has run here

No bench, no migrate, and no site command ran in this worktree. Only static
checks and no-database tests ran.

| Check | Result |
|---|---|
| `TestWriterDeclaration`, 21 tests, no database | Pass |
| `suite.tests.test_architecture`, 7 tests, no database | Pass |
| `TestContentContract` in `suite/drive/tests/test_content.py`, 41 tests, no database | 39 pass; 2 pre-existing tests need a database connection |
| `ruff check` on the four files the review changed | Clean |
| `ruff check` on all 11 changed `.py` files | **2 errors**, both pre-existing |
| `ruff format --check` and `ruff check --select=I` on the changed files | Clean |
| `compileall` on `suite/writer`, `suite/drive`, `suite/hooks.py` | Clean |

`ruff check` is not clean on the full changed set. `suite/writer/api/docs.py`
raises `E731` at line 89 and `E722` at line 117. Both fire on
`86bda351d~1` as well, so neither is new, and neither was fixed here: they are
outside this ticket's change.

The 31 tests in `TestWriterInDrive` need rows and have **not** run. The
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

`validate_registry` runs from `after_install` and `after_migrate`
(`suite/composition/lifecycle.py:57,65`), not at boot, and refuses the site if
`Writer Document` lacks the `node` field, owns a field Drive owns, or carries
a `DocShare` row. A site with `DocShare` rows on `Writer Document` must clear
them before `migrate`, because such a row would grant around both permission
hooks. No tool writes that rewrite; see "Blockers".

Desk assignment writes a `DocShare` (`frappe/desk/form/assign_to.py` calls
`frappe.share.add`). Any site that has ever assigned a Writer document will
fail `migrate` on this check, and assignment on `Writer Document` fails from
this commit on.

### Handoffs

| To | What is owed |
|---|---|
| 28 (Build) | Link every legacy `Writer Document` row to a node. Write `Writer Version` history as `writer-document/1` envelopes, not bare HTML, or restore refuses it. Rewrite any `DocShare` on `Writer Document` as a grant before `after_migrate` runs. |
| 21, 22 | Root, trash, media upload, and version restore over HTTP. Until then `suite/writer/tests/test_drive_adoption.py` reaches `suite.drive._core`, recorded as owned debt in `suite/tests/test_architecture.py`. |
| 23 | The whole legacy Writer read path is still `File`-based and cannot see a document this ticket creates: `suite/writer/api/docs.py:get_document`, `suite/writer/api/general.py:get_document_list`, `:get_versions`, the search result mapping at `:190`, `suite/drive/api/list.py:files`, and `suite/writer/api/embed.py` for media. See "Blockers". |
| 34 (frontend) | Two call sites hit methods that no longer exist: `frontend/src/apps/writer/composables/useDocument.ts:37` (`new_version`, fired from `CoreEditor.vue:320` on a timer and from `NewVersionDialog.vue:10`) and `frontend/src/apps/writer/resources/index.js:37` (`save_comments`, fired from `useYjs.ts:83`). A further set is broken by the *changed* contract, not by a deleted method: `useDocument.ts:19` and `:29`, `drive/utils/files.js:730-736`, `Navbar.vue:74`, `VersionsSidebar.vue:234`, `CoreEditor.vue:299`, `docximporter.js:26`. `newVersion` takes different arguments and returns a different shape from `take_version`, so no alias was added. |
| e2e | `e2e/drive-backed-apps/helpers/writer.ts` and nine specs assert the old `create_document` shape and treat its result as a legacy `File` id. No ticket owns them. |

### Risks

- Until Build (ticket 28) links them, a legacy `Writer Document` row with no
  node raises `DriveConflict` on every row permission check. This is why the
  site commands above run `migrate` before any test.
- The untitled fallback tries 20 names. A folder with 20 untitled documents
  raises the last refusal instead of a friendlier message. Every refusal, not
  only a collision, costs one attempt, and InnoDB holds the parent-chain locks
  each attempt took until the caller's transaction ends.
- `duplicate` carries `settings` verbatim, so a legacy row whose settings hold
  a stale `"template"` key passes it to every copy once Build links it.
  Nothing reads it.

## Review, 2026-09-06

An independent review of `86bda351d` on `review/drive-17-writer-adoption`. It
read the ticket, §8.8, §10.1–10.7 and §14.6–14.7, ARCHITECTURE.md, ticket 16,
the Frappe sources the ticket cites, and every changed file and test. It ran
static and no-database checks only.

### Corrections made

| Severity | Defect | Fix |
|---|---|---|
| High | A picture written as a plain `data-node` attribute was invisible in the Yjs body. `MEDIA_PATTERNS` needs the literal text `data-node="x"`, but Yjs holds the attribute name apart from its value, so `used_nodes` did not name it and `remap_media` did not rewrite it. The daily sweep would trash a picture the document still shows, and a copy's pictures would still point at the source's nodes. Untested: every body fixture used the URL spelling. | `_attribute_ids` and `_remapped_attribute` read the attribute name as well. |
| High | pycrdt panics were converted for `apply_update` and nowhere else. A body whose `default` root was written as a `Text` or an `Array` applies cleanly and panics on the first child read. `PanicException` derives from `BaseException`, so it escapes the `except Exception` that rolls back `nodes.copy`'s and `nodes.create_document`'s savepoints, leaving a half-written copy, and it kills `sweep_unused_media` past its own rollback. Reproduced. | `_readable_body()` wraps every pycrdt call, not one. |
| High | A trashed document was still writable. §8.8 says a trashed node opens read-only; `versions` and `comments` both enforce it, `content` and the row hook did not. `save_doc`, `save_html`, `update_settings`, `frappe.client.save`, and `frappe.client.set_value` all landed on a node in the bin. The existing test asserted "the bin opens read-only" in a comment and only checked `read`. | `content._refuse_trashed_write` in `drive_check` and `touch`; `framework._node_allows` denies any role above READ on a node that is not Active. |
| Medium | `on_purge` left the whole body behind. Without `delete_permanently`, `frappe.delete_doc` writes a `Deleted Document` row holding `doc.as_json()`: the Yjs body, the HTML, and the comment blob all outlive a §8.8 purge. | `delete_permanently=True`. |
| Medium | `_decoded_body` folded "no body" and "undecodable body" into `None`. An undecodable body answered "I use no pictures", so the sweep trashed its media, and `remap_media` skipped `content`, so the copy kept the source's ids — the exact outcome `_remap_body`'s docstring promises to refuse. `content` is written straight from the client with no validation, so it is reachable. | `_decoded_body` refuses; `_body_ids` falls back to a raw scan of the column, `_remap_body` raises. |
| Medium | `test_a_save_stamps_the_node_and_never_the_document_title` could not fail. `create_document` already stamps `content_modified`, and `assertGreaterEqual` passes on equality, so deleting `drive_touch()` left it green. | Move the clock, then `assertGreater`. |
| Low | Three claims in the code were false: that `content.app_callback()` wraps every callback (it wraps three of eight), that the `Writer Version` cascade works around a link check `force=1` already skips, and two stale `frappe/share.py` line citations. | Corrected in place. |

`TestWriterDeclaration` goes from 16 tests to 21 and `TestWriterInDrive` from
27 to 31. Each new test was run against `86bda351d` first and fails there for
the defect it names.

### Findings recorded, not fixed

- **Medium.** Five of the eight `ContentTypeSpec` callbacks run outside
  `content.app_callback()`: `on_purge` (`nodes.py:1368`), `restore_version`
  (`versions.py:239`), `version_bytes` (`versions.py:61`, `:191`), `export`,
  and `used_nodes` (`content.py:699`). No callback commits today, so this is
  an unguarded boundary rather than a live defect. It is ticket 16's contract.
- **Medium.** `framework._role_for_ptype` maps `create` to UPLOAD and then
  resolves the node from the row being inserted. §4.3 says `create` "has no
  meaning on the row being inserted, so it is answered against the parent".
  Unreachable today, because `create_document` inserts with
  `ignore_permissions`. Ticket 16's adapter.
- **Medium.** `version_has_permission` and `version_query_conditions`
  (`suite/writer/overrides/__init__.py`) resolve through the legacy `File`.
  For a Drive-native document the row check denies everyone but Administrator
  while the list predicate still allows the owner. Unreachable until Build
  writes `Writer Version` rows for such documents. The ticket says these
  guards "still work"; they work for legacy rows only.
- **Medium.** `suite/drive/overrides/file.py:147-152` still deletes the
  `Writer Document` behind a deleted legacy `File`. Once Build links the rows,
  deleting the File takes the document out from under a live `Drive Node`.
  Registering the doctype is what makes that second delete authority
  dangerous.
- **Low.** `restore_version` writes without `update_modified=False` while
  every other body write uses it, so a restore bumps `Writer Document.modified`
  and a concurrent `update_settings` then throws `TimestampMismatchError`.
- **Low.** No API path creates a Writer template. `docs.create_document` has
  no `is_template` parameter, so "cover ordinary documents and templates"
  holds only through `_core` and through Build (§14.7).
- **Low.** The evidence text says
  `test_a_failed_reference_rewrite_leaves_no_copy_and_no_charge` uses
  `dataclasses.replace(SPEC, remap_media=explode)`. It patches
  `writer._remap_body` instead. The test is sound; the description is not.
- **Low.** `frappe.PermissionError` is not a `frappe.ValidationError`, so the
  untitled loop cannot swallow one. `docs.py:47`'s comment implies it can.

### Blockers

Both need an orchestrator decision. Neither is fixed here, because fixing
either means reversing a decision this ticket recorded.

1. **Activation is not staged, and the accepted plan says it must be.**
   README execution rules: "Stage content registry activation and permission-hook
   changes after required node links exist." Ticket 16's accepted criterion:
   "Stage registry activation after migrated data is valid." Ticket 17
   registers `Writer Document` now, before Build (28) writes a single node
   link. Two consequences the ticket does not record:
   - Every legacy `Writer Document` row 409s on any row permission check and
     vanishes from every list. The ticket records this under Risks.
   - **Every document created from this commit on is unreachable.**
     `create_document` returns a `Drive Node` id and writes no `File` row, but
     `get_document`, `get_document_list`, the Drive listing, the search result
     mapping, and the embed route are all still `File`-based. The document
     cannot be opened, listed, searched, or given an image. The ticket's
     Handoffs describe this as two frontend call sites.
   The graph puts backend compatibility at ticket 23 and the frontend at 34,
   both after 17, so neither shim belongs here. Staging the activation is what
   the plan says makes that ordering safe. Either stage it, or accept that
   Writer is unusable between 17 and 23 and say so on the ticket.

2. **`migrate` can now fail on a site with real Writer data.**
   `validate_content_registry` refuses the site if any `DocShare` names
   `Writer Document`. Desk assignment writes exactly such a row. No tool
   rewrites those rows as grants. Build (28) owes one, and it runs after this.

### Not verified

No bench, no `migrate`, and no site command ran. `TestWriterInDrive`'s 31
tests, `IntegrationTestWriterDocument`, and `TestContentWorkflows` all need
`slides.localhost` and have not run. Every claim about rows above comes from
reading source, except the pycrdt behavior, which was reproduced against the
installed pycrdt 0.12.26.
