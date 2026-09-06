# 16 — Create content documents and media through one Drive contract

**What to build:** Give every content app one complete creation, lifecycle, and media contract.

**Blocked by:** [12 — Keep and restore versions with bounded automatic history](12-version-history.md); [13 — Show reusable previews without charging users](13-preview-lifecycle.md); [14 — Keep comments, history, and personal lists on nodes](14-comments-and-records.md); [15 — Archive roots and charge Meet reservations to roots](15-root-administration-and-meet.md)

**Status:** done

**Owner:** Suite Drive content contract

**Starting revisions:** Suite `6b39b85fd8b8b0363c52310d52e1ef66046872cc`;
Frappe `e9cc6261d1bb342383d9cb641e8190cbfc3854fd`.

**Final revision:** Suite `74a9a92456b129b125c4fce7f48278201ee91958`;
Frappe `e9cc6261d1bb342383d9cb641e8190cbfc3854fd` (unchanged, read only).

**Claimed files:** `suite/drive/_core/content.py`,
`suite/drive/_core/nodes.py`, `suite/drive/_core/versions.py`,
`suite/drive/framework.py`, `suite/drive/jobs.py`,
`suite/drive/__init__.py`, `suite/drive/tests/test_content.py`,
`suite/drive/tests/test_nodes.py`, `suite/drive/tests/test_versions.py`,
`suite/hooks.py`, `suite/composition/lifecycle.py`,
`suite/tests/test_architecture.py`, `ARCHITECTURE.md`, and this ticket.

`suite/drive/doctype/drive_node/drive_node.py` was claimed and not needed. The
node-side link guard was already there. `ARCHITECTURE.md` and
`suite/composition/lifecycle.py` were touched and not claimed up front.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §5.13, §8.3, §8.9–8.10, §10.1–10.6.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Implement the registry, required callbacks, public types, and DriveContent mixin with boot validation.
- [x] Create node and document in one transaction with immutable reciprocal links. Reject node-less documents.
- [x] Adapt Frappe row and query permissions for documents and Satellites, preserving hook keyword signatures.
- [x] Keep title, grants, lifecycle, versions, comments, and quota owned by Drive. Stage registry activation after migrated data is valid.
- [x] Copy through callbacks, copy media references, and rewrite app references. Reuse one media node per document per blob.
- [x] Provide media URLs through document authorization and the specified 15-minute TTL.
- [x] Add daily unused-media trashing after seven days. Skip undeclared used_nodes callbacks; preserve normal trash retention.
- [x] Complete all five scheduler adapters. Verify no sixth expired-grant sweep exists.

## Verification

Run fake-adapter contract tests for factory failure, immutable links, inherited Satellite access, copy remapping, media sweep, and forbidden fields.

All six run green. Factory failure `test_a_factory_failure_leaves_no_node_and_no_document`;
immutable links `test_both_sides_of_the_link_are_set_once_and_never_change`;
inherited Satellite access `test_a_satellite_takes_read_and_edit_from_the_document_node`;
copy remapping `test_a_copy_remaps_references_and_keeps_one_media_node_per_blob`;
media sweep `test_the_sweep_trashes_only_unnamed_media_older_than_seven_days`;
forbidden fields `test_boot_validation_refuses_a_doctype_that_owns_a_title_or_trash_field`.

## Completion evidence

Implemented 2026-09-06. Four commits, in order:

| Commit | What it did |
|---|---|
| `5218e1314` | The contract: registry, mixin, create, copy, media, sweep, four adapters. |
| `e31852d00` | Review corrections. See "Review corrections" below. |
| `8a85ce59a` | A `DocShare` could grant around the four adapters. Four arms close it. |
| `74a9a9245` | Site isolation for the test module, plus two product defects it exposed. |

The stack changes no doctype JSON and adds no patch. `suite/patches.txt` is
untouched.

### Changed behavior

- New `suite/drive/_core/content.py` holds the whole contract: `Satellite`,
  `ContentTypeSpec`, the `drive_content_types` registry with `spec_for`,
  `satellite_for`, `validate_registry`, `governs`, `governed_doctypes`, the
  `DriveContent` mixin, `touch`, `list_media`, `copy_document_media`,
  `copyable_media_bytes`, and `sweep_unused_media`.
- `nodes.create_document` writes the node and the document in one savepoint and
  links both sides once. `_link_document` uses a conditional UPDATE and refuses
  when `ROW_COUNT()` is not 1, so a link can never move.
- `nodes.copy` runs the app `duplicate` factory for each document row, copies
  media one node per blob, and hands the app the old-to-new node map. It admits
  the deduplicated media bytes with the file bytes in the same admission.
- `nodes._content_purge_callbacks` and `versions._content_spec` now read the
  registry instead of a dotted path on the node.
- `framework.py` adds `principals_for(user)` and four permission adapters:
  `doc_has_permission`, `doc_query_conditions`, `satellite_has_permission`,
  `satellite_query_conditions`. The two `has_permission` targets keep
  `(doc, ptype, user, debug)`; the two query targets keep `(user, doctype)`.
- `framework.refuse_governed_share` is wired on `DocShare.validate`. It refuses
  a share on a registered content doctype or a declared satellite.
- `jobs.sweep_unused_document_media` is the fifth daily `_core` adapter. There
  is no sixth expired-grant sweep: grants expire by predicate, not by a sweep.
- `composition/lifecycle.after_migrate` and `after_install` call
  `framework.validate_content_registry`, so an invalid declaration stops a
  migration or an install instead of reaching a request.
- `suite/drive/__init__.py` gains six workflow functions (`check`,
  `create_document`, `copy`, `touch`, `take_version`, `push_preview`), the
  three public types, and the five role constants. Each workflow imports its
  module inside the call, so importing `suite.drive` for byte accounting alone
  still does not load PIL.

### Review corrections, `e31852d00`

- `_validate_mixin` called `Meta.get_controller`, which does not exist. Every
  real declaration would have died at migrate time. Use
  `frappe.model.base_document.get_controller`.
- An app factory or `remap_media` that called `frappe.db.commit()` destroyed
  Drive's savepoint. Every `ContentTypeSpec` callback now runs inside
  `content.app_callback()`.
- Swept media landed in a bin no owner could restore from. `_restore` now
  allows the original document parent.
- The mixin guard read `cls.__dict__`, so an inherited `before_insert` skipped
  `require_node`. Guard the resolved attribute, and guard `validate` too.
- `ptype=None` mapped to EDIT, so a read-only viewer saw no document at all.
  A missing ptype maps to read.
- A child-table satellite predicate matched on `parent` alone. Add
  `parenttype`, and refuse a child-table satellite that is not a Table field on
  its content doctype.
- The creator grant ran once per copied media node. Grant first, then copy.
- The sweep read one 200-row batch a day and never caught up. Loop batches.
- Refuse a registry doctype or field name that is not one SQL identifier.
- `suite/tests/test_architecture.py` shipped red on `drive.__all__` ordering.
  Fixed the test, not the module: ruff RUF022 puts constants first.

### Product defects found by the site run, `74a9a9245`

Both were unreachable until the 41 workflow tests ran on a real site.

- `DriveContent.node` was a read-only property. Frappe assigns every Link field
  the name it just read (`base_document.py:1159`), so a content doctype whose
  node field is called `node`, which is what §10.7 declares for every app, died
  with an `AttributeError` on insert and on save. It takes the write-back now.
  `refuse_node_change` is what holds the node still.
- `media_rows` left `blob` unquoted. It is a MariaDB keyword, so listing media
  and the daily media sweep both failed with a syntax error.

The same commit made the module re-runnable. `setUp` created a Personal root
per fixture user and `tearDown` deleted it, so a run that stopped between the
two left the roots behind and `create_root` refused every later run. Cleanup
now goes through `purge_root`, scoped to the two fixture users, registered with
`addCleanup` before the first row exists, and repeated in `setUpClass`.

### Commands run, and results

Migration and tests ran on `slides.localhost` at
`74a9a92456b129b125c4fce7f48278201ee91958`.

```text
bench --site slides.localhost migrate                                                     # OK
bench --site slides.localhost run-tests --module suite.drive.tests.test_content           # 82/82
bench --site slides.localhost run-tests --module suite.drive.tests.test_nodes             # 36/36
bench --site slides.localhost run-tests --module suite.drive.tests.test_versions          # 17/17
bench --site slides.localhost run-tests --module suite.drive.tests.test_previews          # 27/27
bench --site slides.localhost run-tests --module suite.tests.test_architecture            #  7/7
bench --site slides.localhost run-tests --module suite.tests.test_scheduler_events        #  2/2
bench --site slides.localhost run-tests --module suite.tests.test_composition             #  3/3
bench --site slides.localhost run-tests --module suite.sheets.tests.test_permissions      #  9/9
bench --site slides.localhost run-tests --module suite.sheets.tests.test_share_notify     #  6/6
bench --site slides.localhost run-tests --module suite.sheets.tests.test_api_security     # 11/11
```

Split by class: `test_content` is 41 unit tests in `TestContentContract` plus
41 integration tests in `TestContentWorkflows`. `test_nodes` is 13 plus 23,
`test_versions` 7 plus 10, `test_previews` 14 plus 13.

The three Sheets modules are the regression surface of the new
`DocShare.validate` hook. Sheets shares through `frappe.share.add` on the
`Sheet` doctype (`suite/sheets/api.py:163`, `:186`), so every Sheets share now
passes through `refuse_governed_share`. `Sheet` is not registered, so the guard
returns early and Sheets sharing is unchanged. The 26 Sheets tests prove it.

The earlier worktree checks (`ruff 0.12.3 check`, `ruff format --check`,
`python -m compileall`) were recorded at `5218e1314` and are **not re-run at
this HEAD**. That is the one unverified item in this block.

Pre-existing ruff findings outside this ticket, left alone:
`suite/drive/patches/team_restructure.py` (E722),
`suite/drive/doctype/drive_grant/drive_grant.py` and
`suite/drive/tests/benchmark_views.py` (format).

### Failure and rollback evidence

Failure paths are tested, not argued:

| Failure | Test |
|---|---|
| App factory raises after inserting its row | `test_a_factory_failure_leaves_no_node_and_no_document` |
| App factory commits, then fails | `test_a_factory_that_commits_still_leaves_no_node_and_no_document` |
| App factory returns nothing or a bad name | `test_a_factory_that_returns_no_document_is_refused` |
| A copy fails part way | `test_a_copy_is_refused_whole_when_the_app_factory_fails` |
| One document breaks the daily sweep | `test_one_failing_document_does_not_stop_the_sweep` |
| An owner wants swept media back | `test_media_the_sweep_trashed_can_be_restored_to_its_document` |
| A second link tries to move a document | `test_both_sides_of_the_link_are_set_once_and_never_change` |
| A saved document repoints itself | `test_a_saved_document_cannot_repoint_itself_at_another_node` |

Rollback is a code revert of the four commits and nothing else. The stack adds
no patch, changes no doctype JSON, and writes no row on migrate.
`drive_content_types` is `[]`, so the registry, the four adapters, the share
guard, and the media sweep are all no-ops at this HEAD. Reverting cannot orphan
data because no content doctype carries a node link yet.

### Criterion to test

Test names verified against `suite/drive/tests/test_content.py` at this HEAD.

| Criterion | Tests |
|---|---|
| Registry, callbacks, types, mixin, boot validation | `test_the_registry_is_keyed_by_doctype_and_cached_for_the_request`, `test_a_declaration_that_is_not_a_content_type_spec_is_refused`, `test_each_required_callback_is_refused_when_it_is_missing`, `test_an_optional_callback_may_be_absent_but_never_uncallable`, `test_one_doctype_is_declared_once_and_never_twice`, `test_a_satellite_is_declared_by_one_content_type_only`, `test_satellite_for_answers_its_owning_content_type`, `test_a_default_export_must_be_one_of_the_offered_formats`, `test_a_registry_name_that_cannot_be_one_sql_identifier_is_refused`, `test_the_mixin_guard_runs_even_when_the_controller_declares_its_own`, `test_the_mixin_guard_runs_when_another_base_owns_the_hook`, `test_the_node_accessor_takes_the_link_write_back_frappe_always_does`, `test_boot_validation_resolves_the_controller_the_framework_way`, `test_boot_validation_accepts_a_complete_declaration`, `test_boot_validation_refuses_a_missing_or_wrong_node_field`, `test_boot_validation_refuses_a_doctype_without_the_mixin`, `test_boot_validation_refuses_a_satellite_that_links_elsewhere`. The public types are pinned by `suite/tests/test_architecture.py::test_drive_public_interface_is_explicit_and_complete_only` |
| One transaction, immutable links, no node-less document | `test_the_node_and_the_document_are_created_and_linked_in_one_transaction`, `test_a_factory_failure_leaves_no_node_and_no_document`, `test_a_factory_that_commits_still_leaves_no_node_and_no_document`, `test_an_app_callback_cannot_end_the_drive_transaction`, `test_a_factory_that_returns_no_document_is_refused`, `test_both_sides_of_the_link_are_set_once_and_never_change`, `test_a_saved_document_cannot_repoint_itself_at_another_node`, `test_a_document_without_a_node_is_refused_by_the_mixin_guard`, `test_a_document_that_names_another_node_is_refused`, `test_a_document_cannot_be_created_below_another_document`, `test_an_unregistered_content_type_cannot_create_a_document` |
| Row and query permissions, frozen signatures | `test_the_hook_targets_keep_the_framework_keyword_signatures`, `test_a_document_row_check_reads_an_inherited_folder_grant`, `test_a_document_with_no_node_is_an_error_not_a_fallback`, `test_a_missing_ptype_asks_for_read_and_never_for_edit`, `test_a_satellite_takes_read_and_edit_from_the_document_node`, `test_the_list_predicate_disappears_for_an_admin_and_refuses_a_stranger`, `test_the_list_predicate_reads_the_whole_ancestor_chain_and_denies_nearest`, `test_the_list_predicate_matches_the_engine_on_real_rows`, `test_the_satellite_predicate_resolves_through_its_content_document`, `test_a_child_table_satellite_is_filtered_by_its_parent_doctype`, `test_a_child_table_satellite_must_belong_to_its_content_doctype`, `test_the_query_hooks_answer_nothing_without_a_doctype`, `test_a_trashed_document_leaves_the_list_but_stays_readable` |
| No `DocShare` widens an adapter | `test_a_docshare_cannot_grant_a_document_row_the_grants_refuse`, `test_a_docshare_cannot_grant_a_satellite_row_the_grants_refuse`, `test_a_row_the_grants_allow_never_reads_the_share_table`, `test_a_ptype_the_framework_cannot_share_stays_a_plain_refusal`, `test_the_share_right_the_guard_asks_for_matches_the_framework`, `test_a_docshare_refuses_the_list_it_would_widen`, `test_an_admin_lists_beside_a_share_instead_of_being_locked_out`, `test_a_list_with_no_share_answers_with_the_predicate`, `test_an_everyone_share_is_one_the_guard_finds`, `test_a_share_of_a_governed_doctype_is_refused_and_one_elsewhere_is_not`, `test_the_share_guard_is_wired_on_validate_alone`, `test_boot_validation_refuses_a_content_type_that_still_carries_shares`, `test_an_everyone_share_that_predates_adoption_opens_no_document`, `test_a_grant_still_answers_beside_a_share_of_another_document`, `test_a_share_of_a_registered_content_doctype_is_refused_but_stays_removable`, `test_boot_validation_refuses_a_type_that_still_carries_a_share` |
| Drive owns title, grants, lifecycle, versions, quota; staged activation | `test_boot_validation_refuses_a_doctype_that_owns_a_title_or_trash_field`, `test_versions_read_the_body_through_the_same_registry`, `test_touch_stamps_content_time_under_an_edit_check`, `test_purge_calls_the_registered_on_purge_and_removes_the_media`, `test_a_copy_gives_the_creator_one_grant_and_not_one_per_picture` (grants), the `used_bytes` assertions inside the copy and purge tests (quota), `test_the_registry_is_empty_until_an_app_adoption_ticket_declares_one` |
| Copy through callbacks, remap references, one node per blob | `test_a_copy_remaps_references_and_keeps_one_media_node_per_blob`, `test_a_folder_copy_carries_the_documents_inside_it`, `test_a_content_type_without_remap_media_copies_no_media`, `test_media_below_a_document_is_never_copied_or_moved_on_its_own`, `test_a_copy_is_refused_whole_when_the_app_factory_fails`, `test_a_copy_gives_the_creator_one_grant_and_not_one_per_picture`, `test_new_from_template_copies_the_body_and_drops_the_template_flag`, `test_a_template_of_another_content_type_is_refused` |
| 15-minute media URLs behind document authorization | `test_media_urls_are_signed_for_fifteen_minutes_after_one_read_check`, `test_media_is_refused_to_a_caller_who_cannot_read_the_document`, `test_the_media_ttl_is_fifteen_minutes_and_the_page_refreshes_at_ten` |
| Seven-day unused-media trashing, skip undeclared `used_nodes` | `test_the_sweep_trashes_only_unnamed_media_older_than_seven_days`, `test_the_sweep_skips_a_content_type_that_declares_no_used_nodes`, `test_a_content_type_without_used_nodes_is_skipped_by_the_sweep`, `test_one_failing_document_does_not_stop_the_sweep`, `test_one_sweep_pass_drains_every_batch_it_can_reach`, `test_media_the_sweep_trashed_can_be_restored_to_its_document`, `test_the_sweep_cursor_only_revisits_documents_that_changed`, `test_a_used_nodes_answer_must_be_a_set_of_node_ids` |
| Five scheduler adapters, no sixth grant sweep | `test_five_daily_drive_jobs_are_registered_and_there_is_no_sixth`, `suite/tests/test_scheduler_events.py::test_registered_methods_resolve` |

The five `_core` adapters are `recompute_root_usage` (§7.7),
`purge_trashed_nodes` (§8.8), `thin_versions` (§9.1),
`sweep_missing_previews` (§9.2), and `sweep_unused_document_media` (§10.6).
The no-sixth rule is §6.4, not §5.13: "There is no expired-grant cleanup job
and no retention deadline for expired grants."

### Decisions

- **`remap_media` added to `ContentTypeSpec`.** §8.9 requires the app's own
  references to point at the copied media nodes. §10.1 declares no callback
  that can do it, and the word does not appear anywhere in the spec. The
  optional `remap_media(docname, {old_node: new_node})` closes that gap. A type
  that does not declare it gets no media copied, because copied media that
  nothing names would only charge the destination root and be trashed in seven
  days.
- **Registry cached on `frappe.local`, not `frappe.cache()`.** A spec holds
  declared callables, which redis cannot pickle. The cache is per request.
- **Staged activation.** `hooks.drive_content_types` is `[]` and no
  `has_permission` or `permission_query_conditions` entry is wired. No content
  doctype carries a `node` Link yet. Tickets 17 to 19 declare the first type
  and wire its two hook entries.
- **A `DocShare` must not widen an adapter's answer.** §1 makes `Drive Grant`
  the only permission table and the read path. The framework disagrees twice,
  and both times outside the four adapters: a row check is
  `perm or false_if_not_shared()` (`frappe/permissions.py:214-216`), and a list
  is `(conditions) OR name IN (shared)` (`frappe/database/query.py:1739-1742`).
  There is no hook, meta flag, or setting that turns sharing off for one
  doctype. So a governed doctype carries no share at all. Four arms:
  `doc_events["DocShare"]["validate"]` refuses a new one,
  `validate_content_registry` refuses to activate a type that still has rows,
  and the two read guards refuse the row and the list when one exists anyway.
  Deleting a row runs `on_trash`, so a legacy share stays removable. All four
  arms are no-ops while the registry is empty. Rewriting the existing Sheets
  rows as grants is ticket 011's, and stays there.
- **The write path is the only defence in one branch.** With no role read,
  `frappe/database/query.py:1712-1719` returns the share predicate *before* it
  calls `get_permission_query_conditions`. The list guard cannot run there,
  because the hook is never invoked. In that branch only
  `refuse_governed_share` and `validate_content_registry` stand between a
  legacy share and a list. The two read guards cover the `:1739-1742` branch,
  which is the one an open role read reaches. The integration proofs exercise
  that branch: the fixture doctype grants role `All` read and write.
- **`create_document` keeps `content_doctype`.** §8.1's signature block is
  normative and reads `create_document(p, parent, title, *, content_doctype,
  from_node=None, is_template=False)`, which is what `_core.nodes` and the
  facade implement. `ARCHITECTURE.md`'s example read `content_type="writer"`,
  a doc error that predates this ticket (`7e6debec7`) and names neither the
  keyword nor the value shape (a doctype name, not an app slug). The example
  is corrected; the public API is not.
- **Two under-permissive list-predicate simplifications**, both documented in
  `framework._list_predicate`: grants at equal depth are not ordered by own
  tier, and a password-locked link grant is skipped in the open pass. Both
  refuse more than `Acc`, never less.
  `test_the_list_predicate_matches_the_engine_on_real_rows` compares the
  predicate against the point check on real rows.

### Handoffs

- **Ticket 12 `version_bytes` MIME.** The callback returns `(stream, mime)` and
  Drive drops the MIME, because §3.4 has no MIME column on a blob and
  `put_blob` takes no content type. Handed to ticket 22.
- **Tickets 17 to 19, the first declaration.** Each must wire two hook entries
  and give its content doctype an open role DocPerm. A Frappe controller hook
  can only deny (`frappe/permissions.py:244-246`, `:491-492`). With no role
  read the adapters never run and the doctype is invisible, whatever the Drive
  Grants say. `validate_registry` does not check for this, so it is a
  declaration-time obligation, not a guard.
- **Ticket 18, upload-side media reuse.** §8.9's "pasting the same picture
  twice reuses the node" covers upload as well as copy. At this HEAD only
  `copy` collapses per blob; `create_file` under a document parent does not.
  Ticket 18 names "repeated media reuse, cross-deck paste" and ticket 28
  collapses the existing duplicates at migration.
- **Ticket 21, the media route.** `list_media` is not exported from
  `suite.drive` and nothing calls it yet. `GET /nodes/<id>/media` is ticket 21.
- **Ticket 34, the 10-minute refresh.** `MEDIA_REFRESH_SECONDS` has one reader,
  a test. No response field carries it until the frontend adoption ticket.

### Remaining risks

- **The daily list holds seven Drive entries, not five.**
  `suite.drive.api.scripts.auto_delete_from_trash` and
  `clear_deleted_files` are legacy `File`-based purges that §14.10 removes at
  Cleanup. `test_five_daily_drive_jobs_are_registered_and_there_is_no_sixth`
  scopes its tuple to the `suite.drive.jobs.` prefix, so it proves the five
  `_core` adapters and not a literal count of Drive jobs.
- **The no-grant-sweep assertion is a substring match** on `"grant"` in the
  dotted path. A sweep named `expire_links` would pass it.
- **The signature freeze is a hard-coded list.** It pins the four adapters
  against a copy of the framework signatures, not against Frappe's call sites.
  A Frappe upgrade that renames a keyword breaks the adapters silently, because
  `frappe.get_newargs` drops an unknown keyword instead of raising. Re-check
  `frappe/permissions.py:500` and `frappe/database/query.py:1766` on upgrade.
- **The forbidden-field check covers names only.** The `trashed*` arm and the
  `share_*` prefix arm of `FORBIDDEN_FIELD_NAMES` have no test; only the
  `title` arm is exercised. §10.2 also forbids share code, endpoints, and
  dialogs, which no automated check can see. Comments are not in the check at
  all; they stay on `Drive Node` under ticket 14.
- **Unreadable media is copied, not skipped.** §8.9 skips unreadable children.
  `copy_document_media` copies every Active blob-backed child with no READ
  check, unlike `_copyable_subtree`. Media normally carries no grant of its
  own, so the case needs a deliberate nearest-wins grant on a media node to
  appear. Untested either way.
- **The sweep only revisits documents that changed.** `_swept_documents`
  requires `content_modified > cursor`. Media that crosses the seven-day line
  inside a document nobody edited afterwards is never swept. That follows
  §10.6 step 1 literally, so it is spec-faithful, not a defect. It is not a
  "find all old unused media" pass.
- **`list_media` names the kind before it checks access.** A caller with no
  read gets `DriveConflict` for a folder instead of `DriveNotFound`. It leaks
  whether a node is a content document. Low severity.
- **Two off-by-a-few line citations** in the `refuse_governed_share` docstring:
  it cites `frappe/share.py:79` and `:142` for the `doc.save()` reachability.
  The saves are at `:82` and `:141`. The claim holds; the numbers do not.
  Fix on the next touch of `framework.py`.
