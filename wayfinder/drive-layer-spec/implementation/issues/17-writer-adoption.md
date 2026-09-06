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

`suite/drive/api/tests/test_files.py` is back at its ticket-16 state. The
correction below removed the reason it had changed.

The review and the correction also changed `suite/drive/_core/content.py` and
`suite/drive/framework.py`, both owned by ticket 16. Two reasons, both
recorded as deviations from the plan's file ownership, not hidden:

- The §8.8 trashed read-only rule has one home per seam and Writer is not it.
  Writing the guard in Writer would have left Slides and Sheets to repeat it.
- The `DriveContent` mixin had to work before its doctype is registered. That
  is ticket 16's contract, not Writer's, and Slides and Sheets need the same
  thing at tickets 18 and 19.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §10.7 Writer; §14.6–14.7.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Scope: this is the expand phase

The README is the source for integration order: "This is a wide replacement
using expand, migrate, then contract. New workflows stay beside legacy paths
until their replacement and migration tests pass." and "Stage content registry
activation and permission-hook changes after required node links exist."

So this ticket ships everything Writer needs and activates none of it:

| Ships here | Waits |
|---|---|
| `suite/writer/drive.py`: `SPEC` and all eight callbacks | — |
| The `node` Link on `Writer Document`, and the `DriveContent` mixin | — |
| Drive-native create, copy, version, restore, purge, media sweep | — |
| `drive_content_types = ["suite.writer.drive.SPEC"]` | 29 |
| Both `Writer Document` permission hooks pointing at `suite.drive.framework` | 29 |
| `suite.writer.api.docs.create_document` returning a Drive node | 21, 23 |
| The legacy `File` read path, `new_version`, `save_comments` | 23, 34 |

Ticket 29 owns the activation, because it is the first ticket that runs after
Build has linked every `Writer Document` row and checked the result.

## Acceptance criteria

- [ ] Declare the Writer content adapter and immutable node link. Use package-root Drive workflows.
- [ ] Implement creation, duplicate, version bytes, restoration, purge, and used-node discovery.
- [ ] Keep explicit HTML export available. Set default_export=None so Writer stays hidden over DAV.
- [ ] Replace title/file synchronization, private history, and comment behavior with Drive ownership.
- [ ] Keep legacy columns and source rows until Build copies them and Cleanup permits deletion.
- [ ] Cover ordinary documents and templates. Keep WebRTC collaboration unchanged and authorize saves.

Criterion four holds for a document that carries a node. A legacy row keeps
the `File` title mirror, the private `Writer Version` history, and the comment
blob, because §14.6 has not copied them and nothing may drop them early. That
is criterion five, and the two only agree through the dual path below.

The boxes stay clear until the shared site runs the integration tests. See
"Verification" for what has run and what has not.

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

`migrate` runs first. It adds the `node` column. `after_migrate` still calls
`validate_content_registry`, which is now a no-op for Writer: the registry is
empty, so it inspects no doctype and no `DocShare`.

### What has run here

No bench, no migrate, and no site command ran in this worktree. Only static
checks and no-database tests ran.

| Check | Result |
|---|---|
| `TestWriterDeclaration`, 23 tests, no database | Pass |
| `suite.tests.test_architecture`, 7 tests, no database | Pass |
| `TestContentContract` in `suite/drive/tests/test_content.py`, 42 tests, no database | 40 pass; 2 pre-existing tests need a database connection |
| `ruff check` on all 12 changed `.py` files | **2 errors**, both pre-existing |
| `ruff format --check` and `ruff check --select=I` on the changed files | Clean |
| `compileall` on `suite/writer`, `suite/drive`, `suite/hooks.py`, `suite/tests` | Clean |
| The Writer permission dual path, driven directly against a mock database | Pass |
| The controller dual path, driven directly against a mock database | Pass |

`ruff check` is not clean on the full changed set. `suite/writer/api/docs.py`
raises `E731` at line 108 and `E722` at line 145. Both fire on `86bda351d~1`
as well, so neither is new, and neither was fixed here: they are outside this
ticket's change.

`TestWriterInDrive` (33 tests) and `TestWriterBeforeActivation` (4 tests) need
rows and have **not** run. Neither has `IntegrationTestWriterDocument` or
`TestContentWorkflows`. The acceptance boxes stay clear until they do.

## Completion evidence

Implementation commit `86bda351dc8b66a9f89073370f76ddd2b57dc215`, corrected by
the review commit `197a083dd` and the expand-phase commit below.

### Changed behavior

- New `suite/writer/drive.py` declares `SPEC` and every callback: `create_empty`,
  `duplicate`, `export`, `version_bytes`, `restore_version`, `on_purge`,
  `used_nodes`, and `remap_media`. `pushes_preview` is false, `satellites` is
  empty, `default_export` is None, and `export_formats` is `("html",)`.
- `Writer Document` gains a read-only `node` Link to `Drive Node` with a search
  index, and the controller extends `drive.DriveContent`. No legacy column and
  no legacy doctype is dropped.
- `hooks.py` keeps `drive_content_types` empty. Both `Writer Document`
  permission entries point at `suite.writer.overrides`, one line above the
  comment naming what ticket 29 replaces them with.
- `WriterDocument` runs one explicit dual path. A row that carries a node is
  Drive-native: `save_doc`, `save_html`, and `update_settings` ask Drive for
  EDIT at the node, write with `update_modified=False`, and call `drive_touch`;
  `take_version` calls `drive_take_version`. A row with no node keeps the
  `File` permission check, the `File` title and size mirror, and
  `new_version`'s private `Writer Version` write.
- The path only ever runs one way. `new_version`, `save_comments`, and
  `update_file` refuse a linked row, and `take_version` refuses a legacy one.
  Nothing lets a Drive-native document answer from a `File`.
- `suite.writer.overrides.document_has_permission` and
  `document_query_conditions` do the same at the framework boundary. A linked
  row is refused by the row hook and excluded from the list predicate by
  `node IS NULL`, because only `Drive Grant` may open it and the hook that
  reads grants arrives at ticket 29.
- `version_query_conditions` now reuses `document_query_conditions`, so the
  `Writer Version` row check and its list predicate agree on a linked
  document: both refuse it.
- `suite.drive._core.content` resolves a content document's node column from
  the registry when the doctype is registered and from the controller's
  `drive_node_field` when it is not. `require_node` demands a node only from a
  governed doctype; a legacy row with none is legal, and a legacy row that
  acquires one is held to the same link rules. `_validate_mixin` refuses an
  activation where the declaration and the controller name different columns.
- `suite.writer.api.docs.create_document` and `save_comments` are unchanged
  from ticket 16. Both are live frontend and e2e contracts, and every read
  path around them is still `File`-based.

### Decisions

- **Activation is staged, not taken here.** Reversed from the implementation
  commit, which registered `Writer Document` immediately. The README stages
  registry activation and permission-hook changes after the required node
  links exist, ticket 16's accepted criterion repeats it, and the graph puts
  backend compatibility at 23 and the frontend at 34. Registering now made
  every legacy row 409 on its next permission check and made every newly
  created document unreachable. Ticket 29 activates. See "Blockers".
- **The dual path is explicit, and it never falls back.** Where a controller
  or a hook must serve both shapes, it branches on the node column, once, in
  the open. Drive decides for a linked row. A node-less row keeps its exact
  legacy behavior. There is no arm that answers a linked row from the `File`,
  because that would be a way around `Drive Grant` (§1).
- **The mixin reads its node column from the controller while dormant.** The
  registry is the activation switch, so it cannot also be what makes the
  mixin work. `drive_node_field` names the column, the declaration names it
  again for the SQL predicate, and `_validate_mixin` proves they agree before
  activation. Slides and Sheets need the same at 18 and 19.
- **The open baseline DocPerm stays.** `Writer Document` keeps its wide-open
  `All` role row. A Frappe permission hook can only deny, never grant
  (`frappe/permissions.py:244-246`), so a governed doctype needs a baseline
  for Drive to narrow at activation. The doctype carries no `DocShare` rule
  yet: `refuse_governed_share` is a no-op while the registry is empty, so Desk
  assignment keeps working.
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

- `test_a_failed_reference_rewrite_leaves_no_copy_and_no_charge` patches
  `writer._remap_body` to raise and asserts the copy leaves no node, no
  document, and no charge.
- `test_a_refused_create_leaves_neither_a_node_nor_a_document` replaces the
  spec with `dataclasses.replace(SPEC, create_empty=explode)` and asserts the
  node is gone too.
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

`TestWriterInDrive` runs under `activated()`, a context manager that injects
the registry and the two hook targets ticket 29 installs. It patches
`frappe.get_hooks` and drops the per-request registry cache on both sides, so
nothing it proves depends on the site being activated and nothing it does
activates one.

| Criterion | Tests |
|---|---|
| Adapter and immutable node link | `test_writer_declares_the_identity_section_ten_seven_fixes`, `test_a_new_document_carries_its_node_and_its_node_carries_it`, `test_a_document_without_a_node_cannot_exist`, `test_a_saved_document_cannot_repoint_itself_at_another_node` |
| Package-root workflows only | `suite.tests.test_architecture`, `test_the_declaration_ships_dormant_and_the_hooks_stay_where_they_were` |
| Create, duplicate, version bytes, restore, purge, used nodes | `test_a_copy_carries_the_body_and_repoints_it_at_the_copied_pictures`, `test_a_version_round_trips_the_collaborative_body_and_its_html`, `test_a_restore_keeps_the_state_it_replaced_as_history`, `test_a_purge_removes_the_document_its_media_and_its_legacy_versions`, `test_the_body_answers_only_the_pictures_it_still_names` |
| HTML export, hidden over DAV | `test_writer_stays_hidden_over_dav_and_keeps_its_explicit_html_export`, `test_the_html_export_streams_the_stored_body`, `test_an_export_format_writer_does_not_offer_is_refused` |
| Drive owns title, history, comments, for a linked row | `test_the_document_owns_no_field_drive_owns`, `test_the_title_is_read_from_the_node_and_never_mirrored`, `test_a_save_stamps_the_node_and_never_the_document_title`, `test_the_document_method_takes_a_version_through_drive`, `test_a_copy_carries_no_comment_blob`, `test_a_linked_row_refuses_every_legacy_method` |
| Legacy rows and columns keep working | `test_the_legacy_columns_and_doctypes_survive_adoption`, `test_a_legacy_version_row_survives_an_ordinary_save`, `test_a_legacy_row_still_has_no_node_and_stays_legacy`, `test_delete_purges_versions`, `test_a_legacy_document_still_takes_its_private_history` |
| No unreachable new document | `test_a_document_the_api_creates_is_reachable_by_the_legacy_read_path` |
| Dormant hooks, and no `migrate` failure | `test_the_declaration_ships_dormant_and_the_hooks_stay_where_they_were`, `test_a_dormant_registry_leaves_a_docshare_alone`, `test_a_docshare_on_a_writer_document_does_not_fail_a_migration` |
| Activation, proved without activating | `test_activation_registers_the_declaration_and_moves_both_hooks`, `test_activation_would_accept_the_declaration_itself`, `test_activation_refuses_a_controller_that_names_another_node_field` |
| No Drive-native document bypasses Drive | `test_the_staged_legacy_guards_never_answer_for_a_linked_row`, `test_a_linked_row_refuses_every_legacy_method` |
| Templates | `test_a_template_starts_a_new_document_and_drops_the_template_flag` |
| Saves are authorized, collab untouched | `test_a_reader_cannot_save_the_body_and_an_editor_can`, `test_a_stranger_cannot_create_a_document_in_somebody_elses_drive` |
| Inherited access, trash, no DocShare bypass | `test_an_inherited_folder_grant_reaches_the_row_and_the_list`, `test_a_stranger_reads_neither_the_row_nor_the_list`, `test_a_trashed_document_stays_readable_and_leaves_the_list`, `test_a_docshare_cannot_open_a_document_the_grants_refuse` |

### Migration

No new patch. `suite/patches.txt` is untouched. The only schema change is the
`node` column, which `migrate` adds from the doctype JSON.

`validate_registry` runs from `after_install` and `after_migrate`
(`suite/composition/lifecycle.py:57,65`). With the registry empty it iterates
nothing: no doctype is proved, and no `DocShare` is inspected. A site with
assigned Writer documents migrates unchanged, and Desk assignment keeps
working.

At activation (ticket 29) the same call refuses the site if `Writer Document`
lacks the `node` field, owns a field Drive owns, names a different node column
than its declaration, or carries any `DocShare` row. The last is what ticket
28 owes a rewrite for.

### Handoffs

| To | What is owed |
|---|---|
| 21, 23 | Move `suite.writer.api.docs.create_document` onto `drive.create_document`, and the read path with it: `docs.get_document`, `general.get_document_list`, `:get_versions`, the search mapping at `:190`, `drive/api/list.py:files`, `writer/api/embed.py`. Until then `suite/writer/tests/test_drive_adoption.py` reaches `suite.drive._core`, recorded as owned debt in `suite/tests/test_architecture.py`. The listing filter is `mime_type == "frappe_doc"` while a node carries `frappe/writer`. |
| 28 (Build) | Link every legacy `Writer Document` row to a node. Write `Writer Version` history as `writer-document/1` envelopes, not bare HTML, or restore refuses it. Rewrite every `DocShare` on `Writer Document` as a grant, or ticket 29 refuses the site. |
| 29 | The activation, as three changes in one step: `drive_content_types = ["suite.writer.drive.SPEC"]`, `has_permission["Writer Document"] = "suite.drive.framework.doc_has_permission"`, and `permission_query_conditions["Writer Document"] = "suite.drive.framework.doc_query_conditions"`. `activated()` in `suite/writer/tests/test_drive_adoption.py` is that step, written out. Then delete `suite.writer.overrides.document_has_permission` and `document_query_conditions`. |
| 34 (frontend) | Adopt `take_version` in place of `new_version` (`useDocument.ts:37`, `CoreEditor.vue:320`, `NewVersionDialog.vue:10`) and Drive comments in place of `save_comments` (`resources/index.js:37`, `useYjs.ts:83`). Both still work today; both go with the legacy row. `newVersion` takes different arguments and returns a different shape from `take_version`, so no alias exists. |
| 35 (Cleanup) | `suite/drive/overrides/file.py:146-152` deletes the content document behind a deleted `File`. Once Build links the rows, that second delete authority can take a `Writer Document` out from under a live `Drive Node`. |

### Risks

- The dual path doubles the surface until 23, 29, and 34 close it. Every
  branch is one `if` on the node column, and each has a test on both sides,
  but a fifth caller added meanwhile has to choose a side.
- `duplicate` carries `settings` verbatim, so a legacy row whose settings hold
  a stale `"template"` key passes it to every copy once Build links it.
  Nothing reads it.
- A legacy row that acquires a node through an ordinary save is validated, not
  refused, so Build may use either `db.set_value` or a save. The validation is
  `require_node`, so it cannot take a node that already names another
  document.

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

Each new test was run against `86bda351d` first and fails there for the defect
it names.

### Blockers, both now resolved

1. **Activation was not staged, and the accepted plan says it must be.**
   Resolved by the correction below: `drive_content_types` is empty, both
   permission hooks stay on `suite.writer.overrides`, and ticket 29 owns the
   step. The two consequences the blocker named are gone with it. No legacy
   row 409s, because no hook resolves a node. No new document is unreachable,
   because `create_document` still writes a `File`.

2. **`migrate` could fail on a site with real Writer data.**
   Resolved by the same change. `validate_content_registry` iterates the
   registry, the registry is empty, so no `DocShare` is inspected and Desk
   assignment still writes one. Ticket 28 owes the rewrite before ticket 29
   activates; `test_a_docshare_on_a_writer_document_does_not_fail_a_migration`
   asserts both halves.

## Correction, 2026-09-06

Applied on the same branch, after the review. It reverses one decision and
refactors the ticket into a deployable expand phase.

### What changed

- `suite/hooks.py`: `drive_content_types` back to `[]`. Both `Writer Document`
  permission entries point at `suite.writer.overrides`, with the ticket-29
  replacement named in a comment beside each.
- `suite/writer/doctype/writer_document/writer_document.py`: the dual path.
  `new_version`, `save_comments`, `update_file`, and `notify_comments` are
  restored for legacy rows and refuse a linked one. `save_doc`, `save_html`,
  and `update_settings` branch on the node.
- `suite/writer/overrides/__init__.py`: `document_has_permission` and
  `document_query_conditions` added, the second one excluding linked rows from
  the legacy predicate. `version_query_conditions` now agrees with
  `version_has_permission` on a linked document.
- `suite/writer/api/docs.py`: `create_document` and `save_comments` back to
  their ticket-16 form, with a comment naming what replaces them and when.
- `suite/drive/_core/content.py`: `node_field_of`, `drive_node_field`, the
  registry-aware `require_node` and `refuse_node_change`, and the
  `_validate_mixin` cross-check.
- `suite/drive/api/tests/test_files.py`: reverted; `Writer Document` is again
  a valid subject for the content-link hijack tests.
- `suite/drive/tests/test_content.py`: the registry is empty again, and the
  node accessor and mixin validation tests cover both sides of activation.
- `suite/writer/tests/test_drive_adoption.py`: `activated()`, a third class
  `TestWriterBeforeActivation`, and six new tests. `TestWriterDeclaration`
  goes to 23 tests and `TestWriterInDrive` to 33.

### Review findings this correction also fixed

- **Medium**, `version_has_permission` and `version_query_conditions`
  disagreed on a Drive-native document: the row check denied everyone but
  Administrator while the list predicate still returned the owner's rows.
  `version_query_conditions` now goes through `document_query_conditions`.
- **Low**, the evidence text described
  `test_a_failed_reference_rewrite_leaves_no_copy_and_no_charge` as using
  `dataclasses.replace`. It patches `writer._remap_body`. Corrected above.
- **Low**, `docs.py:47`'s comment implied the untitled loop could swallow a
  `frappe.PermissionError`. The loop is gone with the Drive-native
  `create_document`.

### Ticket 16 findings closed before integration, `c36991fb8` and `a5d3d44e8`

Both were this ticket's findings against ticket 16's shared code, so the fixes
and their evidence live in
`wayfinder/drive-layer-spec/implementation/issues/16-content-contract.md`
under "Contract corrections". In short:

- **Medium.** Five of the eight `ContentTypeSpec` callbacks ran outside
  `content.app_callback()`: `on_purge`, `restore_version`, `version_bytes`,
  `export`, and `used_nodes`. Every call into app code now goes through
  `content.call_app`, and the two stream callbacks through
  `content.call_app_stream`, which keeps the guard on the stream Drive reads
  after the callback returned. Writer's own callbacks commit nothing, so no
  Writer code changes; only its module note does, below.
- **Medium.** `doc_has_permission` asked the row's own node for `create`. It
  now asks that node's parent for UPLOAD (§4.3) and fails closed when the
  parent cannot be resolved. Still unreachable for Writer at this HEAD: the
  registry is empty behind the Build stage gate, and `create_document` inserts
  with `ignore_permissions`.

`suite/writer/drive.py`'s module note said `app_callback()` wrapped three
callbacks. It is corrected to name `call_app` and `call_app_stream`. Docstring
only; no Writer behaviour changes.

### Findings recorded, not fixed

- **Medium.** `suite/drive/overrides/file.py:146-152` deletes the content
  document behind a deleted legacy `File`. Not reachable for Writer today: no
  row has both a `File` and a node. It becomes reachable when Build links
  them, so it moved from this ticket's findings to the ticket 35 handoff.
- **Low.** `restore_version` writes without `update_modified=False` while
  every other body write uses it, so a restore bumps `Writer Document.modified`
  and a concurrent `update_settings` then throws `TimestampMismatchError`.
- **Low.** No API path creates a Writer template. `docs.create_document` has
  no `is_template` parameter, so "cover ordinary documents and templates"
  holds only through `_core` and through Build (§14.7).

### Not verified

Unchanged by `c36991fb8` and `a5d3d44e8`, whose own evidence is in ticket 16.
No bench, no `migrate`, and no site command ran. Every integration class needs
`slides.localhost`: `TestWriterInDrive` (33), `TestWriterBeforeActivation`
(4), `IntegrationTestWriterDocument` (2), and `TestContentWorkflows`. Every
claim about rows above comes from reading source, except the pycrdt behavior,
which was reproduced against the installed pycrdt 0.12.26, and the two dual
paths, which were driven directly against a mock database.
