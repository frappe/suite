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
| Composite: read checks, nothing forced public | `test_a_composite_may_reference_only_what_the_saver_can_read`, `test_a_composite_save_grants_the_reference_nothing_and_forces_nothing_public`, `test_a_composite_marks_an_unreadable_reference_instead_of_dropping_it`, `test_a_stranger_reads_no_composite_at_all`, `test_the_composite_route_answers_a_stranger_the_same_way_three_times` |
| Legacy compatibility, Build sources kept | `test_a_legacy_deck_keeps_its_title_its_slug_and_its_backing_file`, `test_a_legacy_deck_still_renames_and_still_takes_a_thumbnail_file`, `test_the_legacy_columns_and_media_paths_survive_adoption` |
| No linked deck bypasses Drive | `test_the_staged_legacy_guards_never_answer_for_a_linked_row`, `test_a_linked_deck_refuses_every_legacy_method`, `test_a_linked_deck_never_grows_a_backing_file`, `test_a_docshare_cannot_open_a_deck_the_grants_refuse` |
| Access, trash, stamps | `test_an_inherited_folder_grant_reaches_the_row_and_the_list`, `test_a_stranger_reads_neither_the_row_nor_the_list`, `test_the_editor_access_answer_comes_from_the_node`, `test_a_linked_composite_answers_editor_access_from_the_node_too`, `test_a_guest_learns_nothing_from_editor_access_about_a_linked_deck`, `test_a_trashed_deck_stays_readable_and_leaves_the_list`, `test_a_trashed_deck_refuses_a_paste_and_a_preview_push`, `test_a_trashed_deck_refuses_a_paste_that_names_no_picture_at_all`, `test_a_save_stamps_the_node_and_never_the_deck_title`, `test_a_stranger_cannot_create_a_deck_in_somebody_elses_drive` |
| Dormant hooks, no `migrate` failure | `test_the_declaration_ships_dormant_and_the_hooks_stay_where_they_were`, `test_a_dormant_registry_leaves_a_docshare_alone`, `test_a_docshare_on_a_presentation_does_not_fail_a_migration` |
| Activation, proved without activating | `test_activation_registers_the_declaration_and_moves_all_four_hooks`, `test_activation_accepts_the_frozen_legacy_title_column`, `test_activation_still_refuses_a_title_column_nobody_declared`, `test_a_legacy_declaration_expires_with_the_column_cleanup_drops`, `test_the_display_title_still_resolves_to_the_frozen_legacy_column`, `test_activation_refuses_a_display_title_frappe_supplied_and_nobody_declared`, `test_a_legacy_declaration_only_covers_a_field_drive_owns`, `test_slides_declares_the_one_legacy_column_it_keeps_past_activation` |
| The frozen legacy column | `test_a_linked_deck_cannot_write_the_frozen_legacy_title`, `test_a_save_keeps_the_build_title_so_the_rollback_source_survives` |
| No `DocShare` around the staged guards | `test_a_docshare_cannot_open_a_linked_deck_through_the_staged_guards`, `test_a_docshare_on_a_legacy_deck_leaves_the_staged_list_alone`, `test_the_drive_refusal_is_not_a_frappe_permission_error`, `test_both_staged_guards_refuse_a_share_with_the_same_error`, `test_the_staged_list_guard_refuses_only_a_row_that_carries_a_node`, `test_the_staged_list_guard_never_refuses_an_administrator` |
| Media the sweep must not lose | `test_a_poster_is_walked_to_the_bottom_however_deep_it_nests`, `test_a_deep_poster_is_rewritten_at_the_same_depth_it_is_read`, `test_the_sweep_reads_a_body_shape_slides_never_wrote`, `test_a_rewrite_stays_narrow_where_the_sweep_is_wide`, `test_the_sweep_answer_over_reports_and_the_adoption_answer_does_not`, `test_a_rewrite_never_grows_a_media_key_the_element_did_not_have`, `test_a_copy_repoints_every_element_on_a_slide_not_only_the_first` |
| Adoption: disclosure, containment, the gate | `test_a_paste_naming_a_node_the_caller_cannot_read_is_never_told_what_it_is`, `test_a_paste_cannot_pull_an_ordinary_file_in_from_outside_a_deck`, `test_a_paste_that_names_no_media_is_still_checked` |

### Migration

No new patch. `suite/patches.txt` is untouched. The one schema change is the
`node` column, which `migrate` adds from the doctype JSON. Dropping
`"title_field": "title"` from `presentation.json` moves no data and, as the
review correction above records, changes no answer either.

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

- **Writer's staged guards carried the same `DocShare` bypass.** Ticket 17's
  file, so it was recorded here and fixed on this branch at `524f62c46`. The
  evidence is in
  [17 — Move Writer lifecycle and history into Drive](17-writer-adoption.md)
  under "Staged share fix". Blocker 2 below is closed with it.
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
- **`get_presentation_thumbnail` and `is_composite_presentation` run no
  permission check for a legacy deck.** Pre-existing. Ticket 23 owns the legacy
  read path. `is_composite_presentation` answers the same guest question
  `get_composite_presentation` was fixed to stop answering, one call earlier.
- **`composite_references` is an uncapped point check per reference** on a
  guest-reachable route. Ticket 20 owns the grouped load; the cap is not there
  today.
- **`push_preview` enforces no byte cap and no pixel bound.** The 6 MB limit is
  Slides' `get_thumbnail_content`, and the linked arm of
  `save_presentation_thumbnail` still runs it, so the cap holds today and only
  ticket 21's future route would inherit none. A byte cap is also the wrong
  control: `_encode_image` decodes before it thumbnails, so a 294 KB solid
  WebP of 13000x13000 (169 Mpx, under Pillow's 178.9 Mpx error threshold)
  peaks at 2.6 GB of RSS and stores 542 bytes. Measured in a standalone process
  on the venv's Pillow 12.3.0, not through `suite`. It needs EDIT on a deck the
  caller already holds. `_core/previews.py` is ticket 13's file and the route is
  ticket 21's, so it is a handoff, not a change here.
- **`composite_references` returns the docname of an unreadable reference.**
  §6.6 requires the mark, so this is the spec's answer, not a defect. Nothing
  else about that deck crosses: `get_composite_presentation` skips an unreadable
  reference before it inlines any slide.
- **A composite that names a composite renders a hole.** There is no recursion:
  the inner deck's own `slides` table is read, and a composite carries none.
  Every level that is read takes a READ check. Ticket 20 owns the semantics.
- **`refuse_unreadable_references` runs with the restorer's principals.** A
  version restore fails if a reference was revoked since the version was taken.
  Availability, not access. Ticket 20.
- **The staged list guard refuses a Suite Admin.** `refuse_shared_linked_rows`
  skips only the literal `Administrator`, where `_refuse_shared_list` skips any
  Drive admin. Correct here and deliberate: the legacy predicate is empty only
  for `Administrator`, so for anyone else the shared-names OR still applies and
  skipping them would be the bypass. It costs a Suite Admin with a `DocShare` on
  a linked deck their whole `Presentation` list in that window. Fails closed.
- **`refuse_legacy_field_write` covers no direct-SQL path.** It hangs off
  `DriveContent.validate`, so `frappe.db.set_value`, `db_set`, `frappe.db.sql`,
  and `flags.ignore_validate` all bypass it. No production write to
  `Presentation.title` survives activation: `update_title`,
  `set_duplicate_metadata`, and `set_template_metadata` are all behind
  `refuse_drive_native`, and after activation every row is linked.
- **A linked composite answers `get_composite_presentation` with its legacy
  columns.** `doc.as_dict()` carries `title`, `slug`, `thumbnail`, and
  `is_template`. For a Drive-created deck all four are empty; for a Build-linked
  one they hold the frozen Build values, so a Drive rename leaves the client
  showing the old name until Cleanup drops the column. Ticket 34 handoff below.
- **An oversized `X-Drive-Links` header marks every reference unreadable**
  rather than being rejected. `principals` raises a `frappe.ValidationError` for
  more than 20 tickets and `_readable` swallows it. §6.6 asks for an explicit
  refusal. Ticket 20.

### Corrected: two claims this review found wrong

- **`''` needs a direct write only on a *linked* row.** The earlier record said
  a `''` node needs a direct write full stop. Frappe does not enforce
  `read_only` on save, so `frappe.client.insert` with `{"node": ""}` persists it
  on a *legacy* row: `require_node` returns early on a falsy value and
  `refuse_node_change` sees no stored node. On a linked row `refuse_node_change`
  refuses, so clearing a real node still needs `frappe.db.set_value`.

  Only one of the sixteen node-presence checks disagrees about `''`, and it
  fails closed. `("is", "set")` compiles to `node <> ''`
  (`frappe/database/operator_map.py:112-120`), which puts `''` on the same side
  as the falsy row hook: legacy. The two staged list predicates use `IS NULL`,
  which excludes a `''` row from the list entirely. Nothing on this branch
  writes `''`.

  **Ticket 28 precondition.** Build writes the column in bulk. If it ever
  writes `''`, the row silently reverts to the legacy `File` path, which is a §1
  bypass. Either Build guarantees `NULL`, or the two predicates widen to
  `` (`tab…`.`node` IS NULL OR `tab…`.`node` = '') `` at
  `presentation.py:654` and `writer/overrides/__init__.py:103`. Not widened here:
  today that would make a `''` row *more* reachable, not less.

- **Dropping `"title_field": "title"` removed no mirror.** Frappe resolves an
  absent `title_field` to a field literally called `title` before it falls back
  to `name` (`frappe/model/meta.py:373-384`), so `Presentation.get_title()`
  still answers the frozen column. `_validate_forbidden_fields` read the raw
  attribute, so §10.2's activation gate passed every doctype with that exact
  shape. Fixed at `e974c07d7`: the guard reads `meta.get_title_field()` and
  exempts a declared `legacy_fields` name. Setting `title_field` to `name`
  instead is not open, it would rename every legacy deck's backing `File` to its
  docname on the next save (`overrides/file.py:607-613`). What holds "no mirror
  in either direction" is the freeze, not the missing attribute.

  Same correction in `suite/hooks.py`: a deck Build linked keeps its `File`
  until §14.10, so `sync_content_file` does not return early for it. It is a
  no-op because `title` is frozen.

- **The `_is_public` fix only half landed.** The render half is fixed. The save
  half is not: `Presentation.validate`'s legacy arm still throws for a legacy
  composite naming a reference Build has linked, because `_is_public` answers
  `False` for it. That is the right answer, not a bug: a legacy composite cannot
  hold the public invariant over a deck Drive owns. The review table's
  "failed to save and failed to render" is corrected to render only.

## Second review

An independent review of `6a77171e8`, run by agents against the spec, the
ticket, and the frappe sources each claim depends on. Nine defects, all fixed
here. Nothing was found that regresses access relative to `a61e78970`.

| Severity | Defect | Fix |
|---|---|---|
| High | `test_a_docshare_cannot_open_a_linked_deck_through_the_staged_guards` expected `frappe.PermissionError` from the staged list guard. It raises `DriveForbidden`, a `frappe.ValidationError`; the two classes are unrelated (`frappe/exceptions.py:23,40`). The assertion could never match, so the one test proving the High fix above never passed. | Expects `DriveForbidden`. Four unit tests pin the contract. `301ba35dd` |
| High | `_validate_forbidden_fields` read the raw `title_field` attribute, which frappe overrides. §10.2's activation gate accepted every doctype owning a `title` column and declaring no `title_field`. | Reads `meta.get_title_field()`, exempts a declared `legacy_fields` name. `e974c07d7` |
| High | Two tests about a legacy row lived in `TestSlidesInDrive`, which runs under `activated()`. `require_node` refuses a node-less insert once registered, and `refuse_governed_share` refuses the `frappe.share.add` in one of them. Both died before asserting anything, including the only test proving the staged list guard leaves a Desk-assigned site alone. | Moved to `TestSlidesBeforeActivation`. `c25c00f5e` |
| Medium | `get_editor_access`'s composite arm ran before the node check and answered `"view"` off the legacy `is_composite` column with no check, on a guest route. A stranger learned a name is a composite deck Drive owns (§5.4), and the answer came from a column rather than `Drive Grant` (§1). | The node arm runs first for a linked deck; a composite's Edit reads as view. `a013f1475` |
| Medium | `adopt_media` took §8.8's trash refusal inside its savepoint, after the empty-map early return, so a paste that names no media was accepted by a deck in the bin. The endpoints' own `drive.check` reads the caller, not the state. | The refusal sits with the UPLOAD gate. `d49971ec4` |
| Medium | `test_a_stranger_reads_no_composite_at_all` expected `DriveNotFound`; the route raises `frappe.PermissionError` and could not raise the other. It also asserted the disclosure the route exists to prevent. | Expects `frappe.PermissionError`; one test proves the three refusals give one message. `bad1716d9` |
| Medium | `test_the_deck_answers_only_the_pictures_it_still_names` and `test_a_background_colour_never_hides_a_picture_from_the_sweep` compared `used_nodes` for equality. It over-reports by design, so both answers carry an element id and a type. | Assert the named pictures are in and an unnamed one is out. `325b7fb88` |
| Medium | `test_a_paste_naming_a_node_the_caller_cannot_read_is_never_told_what_it_is` put the unreadable folder in OTHER's own Personal root, which anchors a MANAGE grant to its owner (`roots.py:280-283`). OTHER could read it, so the paste reached the kind check and raised. | The folder moves where OTHER holds nothing. `325b7fb88` |
| Low | `suite/hooks.py` claimed a linked deck has no `File`, so the staged mirror hooks return early. False for a Build-linked deck. | Comment corrected. `ee55f5a5a` |

Three areas were audited and found sound: every write path into the composite
`references` column reaches `refuse_unreadable_references`; `get_templates` is
unchanged by this branch and no linked deck reaches it, because `is_template`
lives on the node and never on the row; and the five Writer tests added at
`524f62c46` carry no static defect.

## Verification

Run Slides tests for Satellite access, repeated media reuse, cross-deck paste,
dictionary posters, templates, preview pushes, and round-trip copies.

### Static and pure checks run here

Run in this worktree at `325b7fb88`. No bench, no migrate, no shared-site
command.

| Check | Result |
|---|---|
| `compileall suite/slides suite/drive suite/tests suite/hooks.py suite/writer` | Clean |
| `uvx ruff@0.12.3 check` on the 11 changed `.py` files | All checks passed |
| `uvx ruff@0.12.3 format --check` on the same 11 | 11 files already formatted |
| `TestSlidesDeclaration` + `test_architecture` + `TestWriterDeclaration`, 60 tests, no database | OK, 1.07s |

Repo-wide `ruff check` still reports five errors, all pre-existing and all in
files this branch does not touch: `E722` at
`suite/drive/patches/team_restructure.py:56`, `E731` and `E722` at
`suite/writer/api/docs.py:108,145`, and `RUF012` at `suite/writer/search.py:9,15`.

The declaration classes run with `frappe.init(site="slides.localhost")` and no
connection, from `/home/faris/benches/suite-bench/sites` with `PYTHONPATH` set
to this worktree. `slides.drive.__file__` is asserted to come from the
worktree. Four of the new unit tests answer `frappe.db` with a `MagicMock`
bound to `frappe.local.db`, so a guard runs against real code with no server.

### The site gate, run on `slides.localhost`

Run 2026-09-06 from `/home/faris/benches/suite-bench` against the main
worktree at `5b79746c0`, serialised. `migrate` was not run: the repair below
touches no schema, and the site already carries the `node` column.

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
bench --site slides.localhost run-tests --module suite.drive.tests.test_upload
bench --site slides.localhost run-tests --module suite.writer.tests.test_drive_adoption
bench --site slides.localhost run-tests --module suite.tests.test_architecture
bench --site slides.localhost run-tests --module suite.tests.test_composition
```

The Drive and Writer modules are in the list because this ticket changed
`nodes.create_file`, `content`, and `drive.__all__`, which they all exercise.
`test_composition` was added to the run beside `test_architecture`.

#### Results

| Module | Result |
|---|---|
| `suite.slides.tests.test_drive_adoption` | 30 unit, 70 integration, all OK |
| `suite.slides.tests.test_pasted_media` | 3 OK |
| `suite.slides.tests.test_thumbnail_patches` | 5 OK |
| `suite.slides.api.test_file` | 21 OK |
| `suite.drive.tests.test_content` | 53 unit, 49 integration, all OK |
| `suite.drive.tests.test_nodes` | 13 unit, 23 integration, all OK |
| `suite.drive.tests.test_previews` | 14 unit, 13 integration, all OK |
| `suite.drive.tests.test_versions` | 7 unit, 10 integration, all OK |
| `suite.drive.api.tests.test_files` | 49 OK |
| `suite.drive.tests.test_upload` | 8 unit, 26 integration, all OK |
| `suite.tests.test_architecture` | 7 OK |
| `suite.tests.test_composition` | 3 OK |
| `suite.writer.tests.test_drive_adoption` | 23 unit OK. 43 integration, 3 errors, all pre-existing |

The three Writer errors are `test_activation_would_accept_the_declaration_itself`,
`test_a_stranger_reads_neither_the_row_nor_the_list`, and
`test_an_inherited_folder_grant_reaches_the_row_and_the_list`. They reproduce
at `a8f747fd2` with `suite/drive/_core/content.py` restored to that revision,
so they are not this repair. Not fixed here; they belong to ticket 17.

**"They sit in Writer's list-permission path" is wrong.** Corrected at
`25bdc25af`. The permission path answered correctly every time. Writer's own
adoption fixture committed a `DocShare` whose removal the class rollback threw
away, so the row survived each run and the guards refused it, which is what
they are for. Suspicion 1 below had the shape right; the source of the row was
the test module. See "Site gate repair" in `17-writer-adoption.md`.

#### Site gate repair: the Slides fixture leaked the same way

Recorded above as inert. It was not. Fixed at `d5ac8beb6`, `c1157620f`, and
`db645102f`. Agents traced the row footprint and ran the mutations.

`TestSlidesBeforeActivation` writes a legacy deck and commits.
`IntegrationTestCase` rolls back once per class, not once per test, so the
commit makes the rows permanent and the per-test `delete_doc` cleanups delete
them inside the transaction the class rollback throws away.

Which rows survive depends on method name order alone. The last committing test
in the class is `test_a_legacy_composite_still_answers_editor_access_without_a_grant`,
so its commit persists every earlier cleanup and strands its own deck. Eight
runs left eight `Presentation` rows and eight `Slide` rows.

The `File` leak is wider, and it outlives decks that were cleaned up correctly.
`after_insert` backs each legacy deck with a `File` at
`content_doctype`/`content_docname` (`presentation.py:115-124`). Deleting the
deck does not delete it: the `on_trash` hook calls `permanent_delete`, which
only sets `status` to `Removed` (`overrides/file.py:394-408`). Three files per
run survived, twenty-four in all, sixteen naming a deck that no longer existed.
`save_presentation_thumbnail` writes a second `File` at
`attached_to_doctype`/`attached_to_name` (`presentation.py:214-232`), so the
sweep covers both links.

Suspicion 6 below is exactly this, for the second time on this gate.

`_remove_fixture_rows` is the helper `TestSlidesInDrive` already had. It is
registered first in `setUp`, so it runs last, and it commits. Decks go before
files, so the `after_delete` cascade back to `content_docname` finds nothing to
do.

**Two lines of the first version were not load-bearing, and mutation runs
proved it.** The `DocShare` sweep is redundant: `delete_doc` clears the share
rows that name the deck (`frappe/model/delete_doc.py:505`). The deck sweep read
as redundant for a different reason: every deck the test wrote carried a backing
`File`, and `File.after_delete` deletes the row its `content_docname` names, so
the file sweep removed the deck as a side effect. The share sweep is gone. The
deck sweep stayed and the test now also writes a template, which `after_insert`
leaves with no backing `File` (`presentation.py:79-82`), so only the deck sweep
can reach it.

`test_a_committed_fixture_row_does_not_outlive_the_class_rollback` asserts the
leak in the run that causes it, not the next one. Each of the three remaining
lines fails it when removed:

| Line removed | Failure |
|---|---|
| `frappe.db.commit()` | `'...' is not false : the deck is gone for good` |
| the `File` sweep | `'...' is not false : and the File that backs it` |
| the deck sweep | `'...' is not false : and so is the template` |

The lookup is `_backing_file`, not `DriveFile.get_for_doc`. Importing
`suite.drive.overrides.file` for it made a fourth boundary violation and failed
`test_architecture`; the helper beside it already runs the same `get_value`.

Module counts after the repair: 30 unit and 71 integration, all OK, twice in a
row with no row change on `slides.localhost`. `test_architecture` 7 OK,
`suite.writer.tests.test_drive_adoption` 23 unit and 44 integration OK.

Rows removed from `slides.localhost`: 10 `Presentation`, 10 `Slide`, 30 `File`,
30 `Drive Entity Activity Log`. Eight decks were the pre-existing leak; two more
came from running the module at `HEAD` during mutation work. Every removed deck
matched `Legacy composite access <56 hex>` and carried `node IS NULL` and one
slide. Every removed `File` carried `content_doctype = "Presentation"` and an
`Assigned`/`Shared`/`Legacy composite access` fixture name; no `File` with that
column belonged to anything else. Four `Presentation` rows were kept: `Light`
and `Dark` from `suite/fixtures/presentation.json`, and two prototype decks from
2026-08-16.

#### The one defect the gate caught

The first run of `suite.slides.tests.test_drive_adoption` gave 70 integration
tests and 6 errors. Every trace ended the same way: `adopt_media` called
`nodes._validate_stored_position` on a sound destination and got
`DriveConflict("The Drive node has an invalid tree position")`.

`_document_node` read a field list with no `parent`, and the position check
walks the stored `parent` link. A `frappe._dict` answers `None` for a column it
was never asked for, so the check read every content document as a node with no
parent. The empty `path` in the traces was correct, not the fault: §3.1 gives a
direct child of a root `parent = <root id>`, `root = <root id>`, and
`path = ""`. Every cross-deck paste failed, for every caller.

| Commit | What it did |
|---|---|
| `5b1fe60c4` | Added `parent` to `DOCUMENT_NODE_FIELDS`, with the reason on the tuple |
| `5b79746c0` | Five Drive-level `adopt_media` tests, all red before `5b1fe60c4` |

`adopt_media` had no test in `suite.drive.tests.test_content` before this. It
was reached only through the Slides module, which is why a defect in Drive's
own core surfaced on an app ticket's site gate. The new tests cover a
destination below a root and one below a folder, refuse a destination whose
path disagrees with its parent, refuse one that stores no parent, and assert
from the check's own source that the field list covers every column it walks.
Validation was not relaxed for folders, media, or documents: the two refusal
tests paste once into a sound destination first, so neither can pass because
adoption is broken everywhere.

#### What the gate was expected to catch

Each item below was a static suspicion written before the run. None of them is
what the run found. Items 1 and 3 did not fire, because the registry is still
empty. Item 5's shape did appear, from the new tests rather than from the site:
a test that leaves a node's stored position corrupt strands the fixture roots,
because `_purge_fixture_roots` walks the tree Drive's own way and refuses an
inconsistent one. The `_corrupt` helper puts the column back before cleanup.

1. **A pre-existing `DocShare` on any `Presentation` or `Writer Document`
   refuses activation.** `validate_content_registry` scans the whole table at
   `before_migrate`. If `slides.localhost` carries shares from earlier manual
   work, `migrate` fails as soon as ticket 29 flips the registry. It does not
   fail today, because the registry is empty. Blocker 1.
2. **The same rows change what the staged list guard answers.** A `DocShare`
   naming a *linked* deck now makes `refuse_shared_linked_rows` raise for every
   non-`Administrator` caller, so an unrelated list test in another module can
   fail with `DriveForbidden`. Deliberate, and it fails closed.
3. **A Property Setter on `Presentation.title_field` defeats the new §10.2
   gate, or trips it.** `meta.get_title_field()` reads the customised meta. If
   the site carries a Property Setter naming `title`, activation now refuses
   until `legacy_fields` covers it, which it does. If one names another column,
   activation refuses and should.
4. **`frappe.get_list`'s default page length of 20 hides a list defect.** The
   staged-list tests that count rows pass trivially on a small fixture set and
   would not catch a leak past row 20 on a populated site.
5. **`create_root` fixture collisions.** The integration classes create roots
   per test. A leftover root from an aborted earlier run gives
   `DuplicateEntryError` on setup rather than an assertion failure.
6. **`frappe.db.commit()` inside any test defeats rollback isolation.** A
   committed fixture survives into the next module and can turn a later
   activation scan from item 1 into a failure that looks unrelated.
   **This fired twice.** Writer's fixture committed a `DocShare` and item 1 was
   the failure that looked unrelated. Slides' fixture committed a deck and its
   backing `File`. Both are repaired; see the two "Site gate repair" sections.

## Blockers

1. **A `DocShare` on a `Presentation` still refuses activation.** Same shape as
   Writer's. Ticket 28 owes the rewrite to grants before ticket 29 activates.
   Harmless today: the registry is empty, so `validate_content_registry`
   inspects nothing. Between Build and activation the staged guards now refuse
   a share that names a linked deck rather than letting it through; see the
   review section below.

2. **Closed, `524f62c46`. Writer's staged guards carried the same `DocShare`
   bypass this ticket fixed in Slides.** `suite/writer/overrides/__init__.py`
   answered `False` for a linked row and wrote no list refusal, so Frappe's
   `false_if_not_shared` and the shared-names OR reopened it. Both guards now
   call `drive.refuse_shared_row` and `drive.refuse_shared_linked_rows`, the
   two package-root entries this ticket added. It is ticket 17's file, so the
   defect, the five tests, and the checks are recorded in
   [17 — Move Writer lifecycle and history into Drive](17-writer-adoption.md)
   under "Staged share fix". Ticket 28 still owes the rewrite of the
   `Writer Document` shares to grants, and now the `Writer Version` rows with
   them.

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
- `_validate_forbidden_fields` exempts a declared name, for the `title_field`
  as well as for the column. It has to: frappe resolves an absent `title_field`
  to a field literally called `title` (`frappe/model/meta.py:373-384`), so
  dropping `"title_field": "title"` from `presentation.json` changed no answer.
  `Presentation.get_title()` still returns the frozen column. The guard reads
  `meta.get_title_field()` for that reason, corrected at `e974c07d7`.
  What holds "no mirror in either direction" is the freeze, not the missing
  attribute. Pointing `title_field` at `name` is not an option: it would rename
  every legacy deck's backing `File` to its docname on the next save
  (`overrides/file.py:607-613`).
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
  When it exposes `push_preview` it owes a **pixel bound**, not a byte cap:
  `_encode_image` decodes before it thumbnails, so a small highly compressed
  image with a huge pixel count costs gigabytes of RSS and stores nothing. See
  the review corrections above for the measurement. Slides' own 6 MB byte cap
  still applies on the route that exists today.
- **Ticket 28, before Build writes `node` in bulk.** Build must write `NULL`
  for an unlinked deck and never `''`, or the two staged list predicates at
  `presentation.py:654` and `writer/overrides/__init__.py:103` must widen to
  `(node IS NULL OR node = '')` first. A `''` row reads as legacy to the row
  hook and is invisible to the list, which is a §1 bypass once Build has run.
  Not widened here: today that would make a `''` row more reachable, not less.
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
  preview through Drive and media through the signed `/f/` route. It also owes
  the composite payload: `get_composite_presentation` returns `doc.as_dict()`,
  so a deck Build linked still carries the frozen `title`, `slug`, `thumbnail`,
  and `is_template`. A Drive rename leaves the client showing the Build-time
  name until §14.10 drops the columns. The client must read the name from the
  node.
