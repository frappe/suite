# 18 — Move Slides documents and media into Drive

**What to build:** Keep decks, embedded media, templates, and previews under Drive identity and access.

**Blocked by:** [16 — Create content documents and media through one Drive contract](16-content-contract.md)

**Status:** in-progress

**Owner:** Suite Slides

**Starting revision:** Suite `a61e78970bcd702f4c0ef499c8e38bc6e2a4dbda`;
Frappe `e9cc6261d1bb342383d9cb641e8190cbfc3854fd` (read only, unchanged).

**Claimed files:** `suite/slides/drive.py`,
`suite/slides/doctype/presentation/presentation.py`,
`suite/slides/doctype/presentation/presentation.json`,
`suite/slides/tests/test_drive_adoption.py`, `suite/hooks.py`,
`suite/tests/test_architecture.py`, and this ticket.

This ticket also changed ticket 16's files: `suite/drive/_core/content.py`,
`suite/drive/_core/nodes.py`, and `suite/drive/__init__.py`. Recorded as a
deviation from the plan's file ownership, not hidden. Two reasons:

- Cross-deck paste had no Drive workflow. `copy` refuses both a source and a
  destination below a content document, so a picture could not move between
  decks at all. The workflow belongs beside `copy_document_media`, not in
  Slides.
- Ticket 16 handed this ticket the upload-side half of §8.9's per-blob rule in
  writing. The fix is inside `nodes.create_file`.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §6.6, §10.7 Presentation; §14.7.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Scope: this is the expand phase

The README is the source for integration order: new workflows stay beside
legacy paths until their replacement and migration tests pass, and registry
activation and permission-hook changes are staged until the node links exist.

So this ticket ships everything Slides needs and activates none of it:

| Ships here | Waits |
|---|---|
| `suite/slides/drive.py`: `SPEC` and all seven callbacks | — |
| The `node` Link on `Presentation`, and the `DriveContent` mixin | — |
| Drive-native create, copy, template, version, restore, purge, media sweep | — |
| `drive.adopt_media`, and per-blob reuse on upload | — |
| The §6.6 composite read checks, and the end of the forced-public row | — |
| `drive_content_types = ["suite.slides.drive.SPEC"]` | 29 |
| Both `Presentation` permission hooks pointing at `suite.drive.framework` | 29 |
| The two `Slide` satellite hooks | 29 |
| Legacy `File` media, `is_public_presentation`, the webp convert path | 23, 34 |
| Dropping `title`, `is_template`, and `thumbnail` | Cleanup, §14.10 |

## Acceptance criteria

- [x] Declare Presentation and its Slide Satellite through the public Drive contract.
- [x] Implement deck creation, duplication, versions, restoration, purge, and complete used_nodes discovery.
- [x] Use media nodes for sources, backgrounds, and posters. Share blobs while copying node ownership and references across decks.
- [x] Push browser previews through Drive. Keep default_export=None.
- [x] Remove forced-public composite behavior and app-specific sharing decisions. Save references only when the caller can read them.
- [x] Keep legacy media compatibility until client adoption. Preserve Build source fields until Cleanup.
- [x] Remove app-side File conversion/deletion paths when their replacement is active. Drive does not convert uploads.

Criteria five and seven hold for a deck that carries a node. A node-less deck
keeps the forced-public row, the public-reference invariant, the legacy upload,
and the webp convert-and-delete path, because §14.7 has not linked it and
nothing may drop those early. That is criterion six, and the two only agree
through the dual path below.

Criterion seven's "when their replacement is active" is read as "for a linked
deck". `save_base64_image`, `get_webp_doc`, and `optimize_images` refuse a
linked deck and name the Drive route instead. The functions stay for legacy
rows until ticket 23 moves the read path and ticket 34 moves the client.

## Completion evidence

Implemented 2026-09-06. Two commits:

| Commit | What it did |
|---|---|
| `517d0d4dc` | The adapter, the node link, the dual path, and `adopt_media`. |
| `cccf8814d` | 71 tests and the architecture debt entries. |

An independent review then found and fixed nine defects. See
[Review corrections](#review-corrections) for the list and the new commits.

### Changed interfaces and schema

- New `suite/slides/drive.py`. `SPEC` declares `doctype="Presentation"`,
  `mime="frappe/slides"`, `node_field="node"`, `default_export=None`,
  `export_formats=()`, `export=None`, `pushes_preview=True`, and
  `satellites=(Satellite(doctype="Slide", link_field="parent"),)`. Callbacks:
  `create_empty`, `duplicate`, `version_bytes`, `restore_version`, `on_purge`,
  `used_nodes`, `remap_media`.
- The module also exposes the Drive calls Slides makes: `node_of`,
  `elements_of`, `adopt_slide_media`, `adopt_element_media`,
  `push_deck_preview`, `refuse_unreadable_references`, and
  `composite_references`.
- New public Drive workflow `drive.adopt_media(document_node, media_nodes)`.
  It answers an old-to-new id map, shares the blob, gives the destination its
  own node, reuses a node the destination already holds for the same blob,
  copies the preview row, and charges the destination root once.
  `suite/drive/__init__.py` gained it in `__all__`; the pinned tuple in
  `suite/tests/test_architecture.py` follows.
- `nodes.create_file` under a `kind="document"` parent now returns the node
  already holding that blob instead of inserting a second one. `put_blob`
  deduplicates on checksum, so the reused node already references the caller's
  blob and nothing is orphaned. The reuse path answers a node whose title is the
  first upload's, not the caller's, and records no `create` activity.
- `content.reuse_media` and `content.adopt_media` are new;
  `MEDIA_SOURCE_FIELDS` names the columns an adoption reads.
- Schema: `Presentation` gains a read-only `node` Link to `Drive Node`, first
  in `field_order`, with a search index. `title` loses `reqd` and gains a
  description naming §14.10, and `title_field` is dropped so the doctype stops
  displaying the frozen column (§10.2 forbids a mirror in either direction).
  No field is dropped, no data moves, and no DocPerm row changes. `Slide` is
  unchanged.
- `ContentTypeSpec.legacy_fields`, `content.refuse_legacy_field_write`, and
  `content._validate_legacy_fields` are new. They are what let ticket 29
  activate with the `title` column still in place; see
  [Resolved: activation and the legacy `title` column](#resolved-activation-and-the-legacy-title-column).
- `suite/drive/__init__.py` gained `adopt_media`, `refuse_shared_row`, and
  `refuse_shared_linked_rows` in `__all__`; the pinned tuple in
  `suite/tests/test_architecture.py` follows.
- `suite/hooks.py`: `drive_content_types` still `[]`. Both `Presentation`
  permission entries still point at `presentation.py`, each with the ticket-29
  replacement named beside it. The `doc_events["Presentation"]` mirroring
  entries stay, with a comment saying they no-op for a linked deck because it
  has no `File`.

### Behaviour, per shape

A deck that carries a node is Drive-native. Drive owns its title, place,
grants, lifecycle, versions, comments, preview, and byte charge. The controller
skips the slug, asks Drive for the composite read checks, stamps
`content_modified` on save, and creates no `File`. `save_presentation_thumbnail`
pushes the browser capture through `drive.push_preview`.
`update_slide_attachments` and `get_updated_json` adopt the pasted media.
`get_composite_presentation` and `get_editor_access` answer from the node.
`save_base64_image`, `delete_presentation`, `update_title`,
`is_public_presentation`, `get_webp_doc`, `optimize_images`,
`create_drive_file`, and `create_presentation` with a linked source all refuse.

A deck with no node is a legacy row Build has not linked. Everything above is
exactly as it was.

The split runs one way only. A linked deck is never answered from a `File`,
because that would be a way around `Drive Grant` (§1).
`get_permission_query_conditions` wraps the legacy predicate with
`` `tabPresentation`.`node` IS NULL AND (…) `` and `has_permission` returns
False for any row carrying a node.

Answering False is not enough on its own. Frappe reads a denied controller check
as "no role permission" and then asks `false_if_not_shared`
(`frappe/permissions.py:214-216`), and `frappe.db.query` ORs the shared names
around the list predicate (`frappe/database/query.py:1737-1741`). Both guards
therefore call Drive: `drive.refuse_shared_row` on the row and
`drive.refuse_shared_linked_rows` on the list, scoped to a deck that carries a
node. A legacy row is still the app's to share, and before Build no row carries
a node, so a site with Desk assignments lists what it always listed.

For `Administrator` the legacy predicate is empty (`overrides/file.py:536-537`),
so the wrapper returns nothing and linked decks stay in an Administrator's
`get_list`. `has_permission` still refuses each row.

### Decisions

- **A media reference is one whole node id.** `Slide.background` holds a colour
  as often as a node, and an element `src` may still hold a `/private/files/`
  URL. A whole-token match on `[A-Za-z0-9_-]{1,140}` can never read a hex or
  functional colour or a URL as an id: each carries a character an id cannot.
  A bare id-shaped word such as `red` **is** reported as used, which only keeps
  media alive, and `remap_media` rewrites nothing it was not given.
- **An unreadable `elements` column over-reports for the sweep and refuses a
  rewrite.** A copy whose pictures still point at the source's nodes is worse
  than a refused copy; a sweep that reads "this deck names nothing" would trash
  a picture the deck still shows.
- **The sweep reads the whole body; the rewrite reads two keys.** Deliberately
  asymmetric. `used_nodes` walks every string in the parsed `elements` column,
  so no body shape Slides did not anticipate can make it answer "this slide
  names nothing" and let §10.6 trash a live picture. It over-reports words that
  are not nodes, which costs the sweep nothing. `remap_media` and the adoption
  reader stay on `src` and `poster`, because rewriting a value that is not a
  reference corrupts a body.
- **A dictionary poster is walked to the bottom, not skipped.** §14.7 says a
  legacy poster may be a dict and fixes no depth for it. `used_nodes`,
  `remap_media`, and the adoption reader all recurse through nested dicts and
  lists.
- **Cross-deck paste is `adopt_media`, not `copy`.**
  `nodes._validate_generic_destination` refuses a copy into or out of a content
  document, so `copy` could not move a picture between decks. `adopt_media`
  runs the §8.9 media step alone, under UPLOAD at the destination and READ at
  each source.
- **An unreadable or unknown source id is skipped, not refused.** §8.9 skips
  what the copier cannot read, and the ids come out of a body that also holds
  colours and URLs. An id naming a node that is not media is refused, because
  that is a caller error, not a body value.
- **Upload obeys the per-blob rule too.** Ticket 16's handoff. Without it the
  same picture uploaded twice into one deck was two nodes and two charges,
  while a copy of that deck collapsed them to one.
- **The insert-time touch is skipped.** `create_document` stamps the new node
  itself, and `drive_touch` is debounced to one write per request, so touching
  on insert would swallow the first real save of the same request.
- **§6.6 replaces the invariant, it does not relax it.** The save-time "every
  reference must be public" rule and the forced-public `Drive Permission` row
  both go for a linked deck. What replaces them is one READ check per reference
  at save, and one per reference at read. Being named grants nothing. An
  unreadable reference is marked in `references`, never dropped silently.
- **A reference with no node is refused.** A Drive-native composite is a live
  view over Drive decks, and a legacy row carries no node for the read check to
  ask about. Build links every deck before ticket 29 activates.
- **The open baseline DocPerm stays.** `Presentation` keeps its `All` row and
  its `Guest` read row. A Frappe permission hook can only deny
  (`frappe/permissions.py:244-246`), so a governed doctype needs a baseline for
  Drive to narrow at activation.
- **`create_presentation` refuses a linked template before the flag check.**
  `is_template` lives on the node for a linked deck, so the legacy column would
  have answered "template does not exist" instead of naming the Drive copy.

### Failure and rollback evidence

- `test_a_failed_reference_rewrite_leaves_no_copy_and_no_charge` patches
  `slides._remap_element` to raise and asserts the copy leaves no node, no
  deck, and no charge.
- `test_a_refused_create_leaves_neither_a_node_nor_a_deck` replaces the spec
  with `dataclasses.replace(SPEC, create_empty=explode)` and asserts the node
  is gone too.
- `test_a_failed_adoption_leaves_no_media_and_no_charge` raises inside
  `copy_preview` mid-adoption and asserts the savepoint took the inserted node
  and the charge back.
- `test_a_reader_cannot_paste_into_a_deck_and_a_stranger_is_not_told_it_exists`
  holds both halves of §5.4: a caller with no grant gets `DriveNotFound`, a
  Read holder who cannot upload gets `DriveForbidden`.
- `test_a_purge_keeps_no_recoverable_copy_of_the_deck` asserts no
  `Deleted Document` row survives a purge.
- `test_an_unreadable_elements_column_over_reports_instead_of_losing_a_picture`
  and `test_an_unreadable_elements_column_refuses_a_rewrite` hold the two sides
  of the unreadable-body rule.

### Criteria to tests

`TestSlidesInDrive` runs under `activated()`, a context manager that injects
the registry and the four hook targets ticket 29 installs. It patches
`frappe.get_hooks` and drops the per-request registry cache on both sides, so
nothing it proves depends on the site being activated and nothing it does
activates one.

| Criterion | Tests |
|---|---|
| Declaration and Slide satellite | `test_slides_declares_the_identity_section_ten_seven_fixes`, `test_the_slide_child_table_is_declared_as_the_satellite`, `test_every_callback_the_ticket_names_is_declared`, `test_the_controller_carries_the_drive_mixin` |
| Satellite access | `test_a_slide_takes_its_rights_from_the_deck_node`, `test_a_stranger_sees_neither_the_slide_row_nor_the_slide_list`, `test_the_slide_list_filter_names_the_parent_doctype_too` |
| Create, duplicate, versions, restore, purge | `test_a_new_deck_carries_its_node_and_its_node_carries_it`, `test_a_new_deck_starts_with_one_empty_slide_and_no_title_of_its_own`, `test_a_deck_without_a_node_cannot_exist`, `test_a_saved_deck_cannot_repoint_itself_at_another_node`, `test_a_version_round_trips_the_slides_the_theme_and_the_references`, `test_a_restore_keeps_the_state_it_replaced_as_history`, `test_a_restore_replaces_the_slides_rather_than_appending_them`, `test_the_deck_takes_a_version_through_drive`, `test_a_purge_removes_the_deck_its_slides_and_its_media`, `test_a_purge_keeps_no_recoverable_copy_of_the_deck` |
| Complete `used_nodes` | `test_a_media_id_is_read_from_a_src_a_poster_and_a_background`, `test_a_dictionary_poster_is_walked_rather_than_skipped`, `test_a_colour_and_a_legacy_url_are_never_read_as_a_node`, `test_the_deck_answers_only_the_pictures_it_still_names`, `test_a_background_colour_never_hides_a_picture_from_the_sweep` |
| Media nodes, shared blobs, repeated reuse | `test_a_copy_carries_the_slides_and_repoints_every_picture`, `test_one_picture_used_twice_becomes_one_node_and_one_charge`, `test_a_copy_shares_the_blob_it_never_stores_the_bytes_twice`, `test_an_upload_of_a_blob_the_deck_already_holds_reuses_its_node` |
| Cross-deck paste | `test_a_pasted_slide_brings_its_pictures_under_the_destination_deck`, `test_pasting_the_same_picture_twice_reuses_the_node_and_charges_once`, `test_a_loose_element_paste_adopts_its_src_and_its_poster`, `test_a_paste_of_media_the_caller_cannot_read_is_skipped_not_disclosed`, `test_a_paste_that_names_something_other_than_media_is_refused` |
| Templates | `test_a_template_starts_a_new_deck_and_drops_the_template_flag` |
| Previews through Drive, `default_export=None` | `test_slides_stays_hidden_over_dav_and_offers_no_export`, `test_the_browser_capture_is_pushed_through_drive_and_not_onto_a_file`, `test_a_reader_cannot_push_a_preview`, `test_a_copy_carries_the_preview_so_it_looks_right_at_once` |
| Composite: read checks, nothing forced public | `test_a_composite_may_reference_only_what_the_saver_can_read`, `test_a_composite_save_grants_the_reference_nothing_and_forces_nothing_public`, `test_a_composite_marks_an_unreadable_reference_instead_of_dropping_it`, `test_a_stranger_reads_no_composite_at_all` |
| Legacy compatibility, Build sources kept | `test_a_legacy_deck_keeps_its_title_its_slug_and_its_backing_file`, `test_a_legacy_deck_still_renames_and_still_takes_a_thumbnail_file`, `test_the_legacy_columns_and_media_paths_survive_adoption` |
| No linked deck bypasses Drive | `test_the_staged_legacy_guards_never_answer_for_a_linked_row`, `test_a_linked_deck_refuses_every_legacy_method`, `test_a_linked_deck_never_grows_a_backing_file`, `test_a_docshare_cannot_open_a_deck_the_grants_refuse` |
| Access, trash, stamps | `test_an_inherited_folder_grant_reaches_the_row_and_the_list`, `test_a_stranger_reads_neither_the_row_nor_the_list`, `test_the_editor_access_answer_comes_from_the_node`, `test_a_trashed_deck_stays_readable_and_leaves_the_list`, `test_a_trashed_deck_refuses_a_paste_and_a_preview_push`, `test_a_save_stamps_the_node_and_never_the_deck_title`, `test_a_stranger_cannot_create_a_deck_in_somebody_elses_drive` |
| Dormant hooks, no `migrate` failure | `test_the_declaration_ships_dormant_and_the_hooks_stay_where_they_were`, `test_a_dormant_registry_leaves_a_docshare_alone`, `test_a_docshare_on_a_presentation_does_not_fail_a_migration` |
| Activation, proved without activating | `test_activation_registers_the_declaration_and_moves_all_four_hooks`, `test_activation_accepts_the_frozen_legacy_title_column`, `test_activation_still_refuses_a_title_column_nobody_declared`, `test_a_legacy_declaration_expires_with_the_column_cleanup_drops`, `test_the_doctype_no_longer_names_the_legacy_column_as_its_display_title`, `test_a_legacy_declaration_only_covers_a_field_drive_owns`, `test_slides_declares_the_one_legacy_column_it_keeps_past_activation` |
| The frozen legacy column | `test_a_linked_deck_cannot_write_the_frozen_legacy_title`, `test_a_save_keeps_the_build_title_so_the_rollback_source_survives` |
| No `DocShare` around the staged guards | `test_a_docshare_cannot_open_a_linked_deck_through_the_staged_guards`, `test_a_docshare_on_a_legacy_deck_leaves_the_staged_list_alone` |
| Media the sweep must not lose | `test_a_poster_is_walked_to_the_bottom_however_deep_it_nests`, `test_a_deep_poster_is_rewritten_at_the_same_depth_it_is_read`, `test_the_sweep_reads_a_body_shape_slides_never_wrote`, `test_a_rewrite_stays_narrow_where_the_sweep_is_wide`, `test_the_sweep_answer_over_reports_and_the_adoption_answer_does_not`, `test_a_rewrite_never_grows_a_media_key_the_element_did_not_have`, `test_a_copy_repoints_every_element_on_a_slide_not_only_the_first` |
| Adoption: disclosure, containment, the gate | `test_a_paste_naming_a_node_the_caller_cannot_read_is_never_told_what_it_is`, `test_a_paste_cannot_pull_an_ordinary_file_in_from_outside_a_deck`, `test_a_paste_that_names_no_media_is_still_checked` |

### Migration

No new patch. `suite/patches.txt` is untouched. The schema changes are the
`node` column, which `migrate` adds from the doctype JSON, and the removal of
`title_field`, which is doctype metadata and moves no data.

`validate_content_registry` runs from `after_install` and `after_migrate`
(`suite/composition/lifecycle.py:57,65`). With the registry empty it iterates
nothing, so no doctype is proved and no `DocShare` is inspected. A site with
shared Presentations migrates unchanged and Desk assignment keeps working.

## Review corrections

An independent review of `9fc790ba6` against the spec, the plan, ticket 16's
contract corrections, and ticket 17's staged pattern. Everything below is fixed
in this worktree, with a test for each.

| Severity | Defect | Fix |
|---|---|---|
| High | A `DocShare` opened a linked deck through both staged guards. Answering `False` is not a denial: Frappe falls through to `false_if_not_shared` and ORs shared names around the list predicate. §1 bypass for the whole Build-to-activation window. | Both guards call Drive: `drive.refuse_shared_row` and the new `drive.refuse_shared_linked_rows`, scoped to a deck with a node. |
| High | `remap_media` rewrote only the first changed element on a slide. `any()` over a generator short-circuits, so a copy of a slide with two or more pictures kept naming the source deck's nodes. | Materialise the list before `any()`. |
| High | `used_nodes` under-reported any body shape it did not expect: a poster nested more than one level, a poster holding a list, an element below a list. §10.6 would trash a picture the deck still shows. | `_value_ids` recurses through dicts and lists; the sweep walks the whole parsed body. |
| Medium | `adopt_media` validated node kind before the READ check, so a caller with no grant learned that an id names a folder rather than nothing. §5.4 disclosure. | READ first, then state, then kind. |
| Medium | `adopt_media` returned `{}` before any permission check when the paste named no media, and both Slides paste endpoints relied on it as their only gate. | The UPLOAD check runs before the early return, and both endpoints take `drive.check(node, UPLOAD)` of their own. |
| Medium | `composite_references` handed out the `Drive Node` id of a reference the caller cannot read, on a guest-reachable route. | `node` is `None` for an unreadable reference; `readable` still marks it. |
| Medium | `is_public_presentation` raised for a linked deck, so a legacy composite naming a reference Build had already linked failed to save and failed to render. | Internal `_is_public` answers `False` for a linked deck; the whitelisted method still refuses. |
| Medium | `get_presentation_thumbnail` answered a linked deck from the legacy `title`-era `thumbnail` column with no permission check, contradicting "a linked deck is never answered from a `File`". | Refuses a linked deck and names the Drive preview. |
| Medium | `get_composite_presentation` gave a different error for an unreadable linked composite than for a name that is not one, on a guest route. | One `PermissionError` for all three cases, through `slides_drive.deck_is_readable`. |
| Medium | `_validate_adoptable_media` refused with "media below a Drive content document" while checking only `kind == "file"`, so an ordinary file could be pulled into a deck. | The ancestor check is enforced. |
| Medium | One expired or locked link on a source id aborted a whole paste; only `DriveNotFound` was skipped. | Every "you cannot read this" answer skips the id. |
| Medium | The `activated()` test helper declared `hooks(key=…)` while frappe's signature is `get_hooks(hook=…)`, so three framework call sites raised `TypeError` inside the block. Ticket 29 would have copied it. | Renamed to `hook`. |
| Medium | `test_a_composite_save_grants_the_reference_nothing_and_forces_nothing_public` counted `Drive Grant` rows; the forced-public row is a `Drive Permission`. It would have passed without the change. | Counts the `Drive Permission` rows the legacy path writes. |

Not fixed, recorded instead:

- **Writer's staged guards carry the same `DocShare` bypass.** Ticket 17's file.
  Blocker 2 above.
- **A purge leaves the framework's deletion `Comment`.** `delete_doc` ends with
  `insert_feed`, which writes a row naming the doctype, the deck, and the
  owner's full name, with no `reference_name` for anything to match. It carries
  no deck body, and every Drive purge of every content type has it, so removing
  it is a framework decision. `test_a_purge_keeps_no_recoverable_copy_of_the_deck`
  covers the body, not the deletion audit trail.
- **`get_templates` uses `frappe.get_all`**, so neither permission hook applies,
  and it returns every `Slide` row with `fields=["*"]`. Pre-existing and
  unchanged here. §14.7 gives migrated templates a `$GENERAL` READ grant, so the
  migrated set is not a leak; a user-created template that gets a node would be.
  Ticket 21 owns the template route.
- **`get_presentation_thumbnail`, `is_composite_presentation`, and
  `get_editor_access`'s composite arm run no permission check for a legacy
  deck.** Pre-existing. Ticket 23 owns the legacy read path.
- **A row whose `node` is `''` rather than `NULL`** is excluded by the SQL and
  treated as legacy by `has_permission`. Frappe writes `NULL` for an unset Link,
  so it needs a direct write to occur. Inherited from Writer's staged guard.
- **`composite_references` is an uncapped point check per reference** on a
  guest-reachable route. Ticket 20 owns the grouped load; the cap is not there
  today.
- **`push_preview` enforces no byte cap of its own.** The 6 MB limit lives in
  Slides' `get_thumbnail_content`, so ticket 21's route would inherit none.

## Verification

Run Slides tests for Satellite access, repeated media reuse, cross-deck paste,
dictionary posters, templates, preview pushes, and round-trip copies.

### Static and pure checks run here

Run in this worktree. No bench, no migrate, no shared-site command.

| Check | Result |
|---|---|
| `python -m compileall suite/slides suite/drive suite/tests suite/hooks.py` | Clean |
| `uvx ruff@0.12.3 check suite/slides suite/drive suite/tests suite/hooks.py` | One error, pre-existing: `E722` at `suite/drive/patches/team_restructure.py:56`. Untouched file, fires on the starting revision too. |
| `uvx ruff@0.12.3 format --check` on every changed `.py` | 8 files already formatted |
| `suite.tests.test_architecture`, 7 tests, no database | OK, 0.96s |
| `TestSlidesDeclaration`, 26 tests, no database | OK, 0.012s |

The declaration class runs with `frappe.init(site="slides.localhost")` and no
connection, from `/home/faris/benches/suite-bench/sites` with `PYTHONPATH` set
to this worktree. `slides.drive.__file__` is asserted to come from the
worktree.

### The site gate, not run here

The orchestrator serialises these. Run from
`/home/faris/benches/suite-bench`, with `PYTHONPATH` set to this worktree:

```
bench --site slides.localhost migrate
bench --site slides.localhost run-tests --module suite.slides.tests.test_drive_adoption
bench --site slides.localhost run-tests --module suite.slides.tests.test_pasted_media
bench --site slides.localhost run-tests --module suite.slides.tests.test_thumbnail_patches
bench --site slides.localhost run-tests --module suite.slides.api.test_file
bench --site slides.localhost run-tests --module suite.drive.tests.test_content
bench --site slides.localhost run-tests --module suite.drive.tests.test_nodes
bench --site slides.localhost run-tests --module suite.drive.tests.test_previews
bench --site slides.localhost run-tests --module suite.drive.tests.test_versions
bench --site slides.localhost run-tests --module suite.drive.api.tests.test_files
bench --site slides.localhost run-tests --module suite.writer.tests.test_drive_adoption
bench --site slides.localhost run-tests --module suite.tests.test_architecture
```

`migrate` should add the `node` column and nothing else. The Drive and Writer
modules are in the list because this ticket changed `nodes.create_file`,
`content`, and `drive.__all__`, which they all exercise.

Expected counts from this HEAD: `suite.slides.tests.test_drive_adoption` is 26
unit (`TestSlidesDeclaration`) and 64 integration (`TestSlidesBeforeActivation`
7, `TestSlidesInDrive` 57), 90 in total.

**64 integration tests are unverified.** They have never run: this worktree may
not touch `slides.localhost`. Nothing outside the "Static and pure checks" table
above has been executed, including every test the review added for a defect it
fixed.

## Blockers

1. **A `DocShare` on a `Presentation` still refuses activation.** Same shape as
   Writer's. Ticket 28 owes the rewrite to grants before ticket 29 activates.
   Harmless today: the registry is empty, so `validate_content_registry`
   inspects nothing. Between Build and activation the staged guards now refuse
   a share that names a linked deck rather than letting it through; see the
   review section below.

2. **Writer's staged guards carry the same `DocShare` bypass this ticket fixed
   in Slides.** `suite/writer/overrides/__init__.py` answers `False` for a
   linked row and writes no list refusal, so Frappe's `false_if_not_shared` and
   the shared-names OR reopen it. Ticket 17's file, not this one's, so it is
   recorded here and not edited. `drive.refuse_shared_row` and
   `drive.refuse_shared_linked_rows` are the two calls it needs.

### Resolved: activation and the legacy `title` column

§10.2 forbids a content doctype owning a `title` field. §14.7 reads
`Presentation.title` at Build and §14.10 drops it at Cleanup, one release after
activation, and §14.11's post-Build rollback is "ship the old code", which reads
the same column. So the column has to outlive activation.

§10.2's stated reason is that the title lives on the node "with no mirror in
either direction". A column no code reads or writes is not a mirror. The
resolution keeps the reason and drops the over-strict test:

- `ContentTypeSpec.legacy_fields` names the columns §14.10 drops at Cleanup.
  Slides declares `("title",)`. `is_template` and `thumbnail` need no entry;
  §10.2 forbids neither.
- `_validate_shape` refuses a `legacy_fields` entry that is not already a name
  §10.2 forbids, so the hatch cannot exempt an arbitrary column.
- `_validate_forbidden_fields` exempts a declared name. `title_field` stays
  strict, so `presentation.json` drops `"title_field": "title"`. That removes
  the read-direction mirror and moves no data: §14.7 reads the column, not the
  meta.
- `_validate_legacy_fields` refuses a declared name the doctype no longer owns.
  Once Cleanup drops `title`, the next migration fails until the declaration
  drops the entry, so the exemption cannot outlive the column.
- `content.refuse_legacy_field_write` freezes the column at runtime for a
  registered doctype: every write is refused, in either direction. The Build
  value stays exactly as Build left it.

Ticket 29 therefore flips five entries and drops no column. Sheets (19) has the
same shape with `title`, `trashed`, `trashed_on`, and `trashed_by`, and takes
the same route.

## Handoffs

- **Ticket 20, composite loading.** `slides_drive.composite_references` runs one
  READ point check per referenced deck, in a loop. Ticket 20 owns the grouped
  load that batches them, and the response codes for a marked reference.
- **Ticket 21, HTTP.** A picture reaches a Drive-native deck through the Drive
  upload route, and a deck is copied through the Drive copy route. Neither is
  exposed yet, so `create_presentation` and `save_base64_image` refuse a linked
  deck instead of answering. Trash, restore, and root workflows are the same.
- **Ticket 23, legacy read path.** `is_public_presentation`, `get_attachment`,
  `attach_poster`, `suite/slides/api/file.py`, and the `File`-based list are
  still the only read path. They must move before ticket 29.
- **Ticket 28, Build.** §14.7 owes: one media node per deck per blob from the
  slide media `File` rows, `Slide.elements` `src` and `poster` rewritten to
  node ids with `attachmentName` dropped, dict posters normalised,
  `Presentation.thumbnail` moved to `Drive Node Preview`, template decks given
  nodes under Administrator's `Templates` folder with `$GENERAL` READ, and
  every `DocShare` rewritten as a grant. §14.7 migrates no deck history, so
  Build owes no `presentation/1` envelope; a deck's first version is taken
  after Build.
- **Ticket 29, activation.** Five entries move together: `drive_content_types`
  gains `suite.slides.drive.SPEC`, both `Presentation` hooks become
  `suite.drive.framework.doc_*`, and `Slide` gains
  `suite.drive.framework.satellite_*`. No column has to be dropped first: the
  `title` exemption is declared and the column is frozen. Blocker 1 above, the
  `DocShare` rewrite, still has to land at ticket 28.
- **Ticket 35, Cleanup.** When it drops `Presentation.title` it must drop
  `legacy_fields=("title",)` from `suite/slides/drive.py` in the same release.
  `_validate_legacy_fields` refuses the migration otherwise, which is the point:
  the exemption expires with the column.
- **Ticket 34, frontend.** `save_presentation_thumbnail` answers `""` for a
  linked deck instead of a `file_url`, and `update_slide_attachments` answers
  node ids rather than `/private/files/` URLs. The client must read the deck
  preview through Drive and media through the signed `/f/` route.
