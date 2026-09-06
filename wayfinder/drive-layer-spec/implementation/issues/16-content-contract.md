# 16 — Create content documents and media through one Drive contract

**What to build:** Give every content app one complete creation, lifecycle, and media contract.

**Blocked by:** [12 — Keep and restore versions with bounded automatic history](12-version-history.md); [13 — Show reusable previews without charging users](13-preview-lifecycle.md); [14 — Keep comments, history, and personal lists on nodes](14-comments-and-records.md); [15 — Archive roots and charge Meet reservations to roots](15-root-administration-and-meet.md)

**Status:** in-progress

**Owner:** Suite Drive content contract

**Starting revisions:** Suite `6b39b85fd8b8b0363c52310d52e1ef66046872cc`;
Frappe `e9cc6261d1bb342383d9cb641e8190cbfc3854fd`.

**Claimed files:** `suite/drive/_core/content.py`,
`suite/drive/_core/nodes.py`, `suite/drive/_core/versions.py`,
`suite/drive/framework.py`, `suite/drive/jobs.py`,
`suite/drive/__init__.py`, `suite/drive/doctype/drive_node/drive_node.py`,
`suite/drive/tests/test_content.py`, `suite/hooks.py`,
`suite/tests/test_architecture.py`, and this ticket.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §5.13, §8.3, §8.9–8.10, §10.1–10.6.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Implement the registry, required callbacks, public types, and DriveContent mixin with boot validation.
- [ ] Create node and document in one transaction with immutable reciprocal links. Reject node-less documents.
- [ ] Adapt Frappe row and query permissions for documents and Satellites, preserving hook keyword signatures.
- [ ] Keep title, grants, lifecycle, versions, comments, and quota owned by Drive. Stage registry activation after migrated data is valid.
- [ ] Copy through callbacks, copy media references, and rewrite app references. Reuse one media node per document per blob.
- [ ] Provide media URLs through document authorization and the specified 15-minute TTL.
- [ ] Add daily unused-media trashing after seven days. Skip undeclared used_nodes callbacks; preserve normal trash retention.
- [ ] Complete all five scheduler adapters. Verify no sixth expired-grant sweep exists.

## Verification

Run fake-adapter contract tests for factory failure, immutable links, inherited Satellite access, copy remapping, media sweep, and forbidden fields.

## Completion evidence

**Revisions:** Suite `6b39b85fd8b8b0363c52310d52e1ef66046872cc` at start;
Frappe `e9cc6261d1bb342383d9cb641e8190cbfc3854fd` (unchanged, read only).

### Changed behavior

- New `suite/drive/_core/content.py` holds the whole contract: `Satellite`,
  `ContentTypeSpec`, the `drive_content_types` registry with `spec_for`,
  `satellite_for`, `validate_registry`, the `DriveContent` mixin, `touch`,
  `list_media`, `copy_document_media`, `copyable_media_bytes`, and
  `sweep_unused_media`.
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
- `jobs.sweep_unused_document_media` is the fifth daily Drive job. There is no
  sixth expired-grant sweep: grants expire by predicate, not by a sweep.
- `composition/lifecycle.after_migrate` calls
  `framework.validate_content_registry`, so an invalid declaration stops a
  migration instead of reaching a request.
- `suite/drive/__init__.py` gains six workflow functions (`check`,
  `create_document`, `copy`, `touch`, `take_version`, `push_preview`), the
  three public types, and the five role constants. Each workflow imports its
  module inside the call, so importing `suite.drive` for byte accounting alone
  still does not load PIL.

### Decisions

- **`remap_media` added to `ContentTypeSpec`.** §8.9 requires the app's own
  references to point at the copied media nodes. §10.1 declares no callback
  that can do it. The optional `remap_media(docname, {old_node: new_node})`
  closes that gap. A type that does not declare it gets no media copied,
  because copied media that nothing names would only charge the destination
  root and be trashed in seven days.
- **Registry cached on `frappe.local`, not `frappe.cache()`.** A spec holds
  declared callables, which redis cannot pickle. The cache is per request.
- **Staged activation.** `hooks.drive_content_types` is `[]` and no
  `has_permission` or `permission_query_conditions` entry is wired. No content
  doctype carries a `node` Link yet. Tickets 17 to 19 declare the first type
  and wire its two hook entries.
- **A `DocShare` cannot widen an adapter's answer.** §1 makes `Drive Grant`
  the only permission table and the read path. The framework disagrees twice,
  and both times outside the four adapters, so neither can be answered by
  returning False: a row check is `perm or false_if_not_shared()`
  (`frappe/permissions.py:214-216`), and a list is
  `(conditions) OR name IN (shared)` (`frappe/database/query.py:1739-1742`),
  which with no role read drops the predicate and answers from the share alone
  (`:1712-1719`). There is no hook, meta flag, or setting that turns sharing
  off for one doctype; the purpose-built seams are the write path. So a
  governed doctype carries no share at all:
  `doc_events["DocShare"]["validate"]` refuses a new one,
  `validate_content_registry` refuses to activate a type that still has rows,
  and the read guards refuse the row and the list outright when one exists
  anyway. The guards fail closed on a state the other two prevent, and they
  cost one indexed read on a denial and one per content list. Deleting a row
  runs `on_trash`, so a legacy share stays removable. All four arms are no-ops
  while the registry is empty. Rewriting the existing Sheets rows as grants is
  ticket 011's, and stays there.
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
  refuse more than `Acc`, never less. `test_the_list_predicate_matches_the_engine_on_real_rows`
  compares the predicate against the point check on real rows.
- **Ticket 12 `version_bytes` MIME handoff stays open.** The callback returns
  `(stream, mime)` and Drive drops the MIME, because §3.4 has no MIME column on
  a blob and `put_blob` takes no content type. Handed to ticket 22.

### Commands run in this worktree

```
ruff 0.12.3 check <changed files>               All checks passed!
ruff 0.12.3 format --check <changed files>      already formatted
python -m compileall suite/drive suite/hooks.py suite/composition/lifecycle.py
                                                OK
python -m unittest TestContentContract          Ran 39 tests, OK
python -m unittest suite.tests.test_architecture
                                                Ran 7 tests, OK
```

The 39 contract tests run with `frappe.init` and no connection, against a
`MagicMock` bound to `frappe.local.db`. Nothing in them reads a table.

Pre-existing ruff findings outside this ticket, left alone:
`suite/drive/patches/team_restructure.py` (E722),
`suite/drive/doctype/drive_grant/drive_grant.py` and
`suite/drive/tests/benchmark_views.py` (format).

### Criterion to test

| Criterion | Tests |
|---|---|
| Registry, callbacks, types, mixin, boot validation | `test_the_registry_is_keyed_by_doctype_and_cached_for_the_request`, `test_a_declaration_that_is_not_a_content_type_spec_is_refused`, `test_each_required_callback_is_refused_when_it_is_missing`, `test_an_optional_callback_may_be_absent_but_never_uncallable`, `test_one_doctype_is_declared_once_and_never_twice`, `test_a_default_export_must_be_one_of_the_offered_formats`, `test_the_mixin_guard_runs_even_when_the_controller_declares_its_own`, the five `test_boot_validation_*` |
| One transaction, immutable links, no node-less document | `test_the_node_and_the_document_are_created_and_linked_in_one_transaction`, `test_a_factory_failure_leaves_no_node_and_no_document`, `test_a_factory_that_returns_no_document_is_refused`, `test_both_sides_of_the_link_are_set_once_and_never_change`, `test_a_document_without_a_node_is_refused_by_the_mixin_guard`, `test_a_document_that_names_another_node_is_refused`, `test_a_document_cannot_be_created_below_another_document`, `test_an_unregistered_content_type_cannot_create_a_document` |
| Row and query permissions, frozen signatures | `test_the_hook_targets_keep_the_framework_keyword_signatures`, `test_a_document_row_check_reads_an_inherited_folder_grant`, `test_a_document_with_no_node_is_an_error_not_a_fallback`, `test_a_satellite_takes_read_and_edit_from_the_document_node`, `test_the_list_predicate_*` (four), `test_the_satellite_predicate_resolves_through_its_content_document`, `test_the_query_hooks_answer_nothing_without_a_doctype`, `test_a_trashed_document_leaves_the_list_but_stays_readable` |
| No `DocShare` widens an adapter | `test_a_docshare_cannot_grant_a_document_row_the_grants_refuse`, `test_a_docshare_cannot_grant_a_satellite_row_the_grants_refuse`, `test_a_row_the_grants_allow_never_reads_the_share_table`, `test_a_ptype_the_framework_cannot_share_stays_a_plain_refusal`, `test_the_share_right_the_guard_asks_for_matches_the_framework`, `test_a_docshare_refuses_the_list_it_would_widen`, `test_a_list_with_no_share_answers_with_the_predicate`, `test_an_everyone_share_is_one_the_guard_finds`, `test_a_share_of_a_governed_doctype_is_refused_and_one_elsewhere_is_not`, `test_the_share_guard_is_wired_on_validate_alone`, `test_boot_validation_refuses_a_content_type_that_still_carries_shares`, `test_an_everyone_share_that_predates_adoption_opens_no_document`, `test_a_grant_still_answers_beside_a_share_of_another_document`, `test_a_share_of_a_registered_content_doctype_is_refused_but_stays_removable`, `test_boot_validation_refuses_a_type_that_still_carries_a_share` |
| Drive owns title, grants, lifecycle, versions, quota; staged activation | `test_boot_validation_refuses_a_doctype_that_owns_a_title_or_trash_field`, `test_versions_read_the_body_through_the_same_registry`, `test_touch_stamps_content_time_under_an_edit_check`, `test_purge_calls_the_registered_on_purge_and_removes_the_media`, `test_the_registry_is_empty_until_an_app_adoption_ticket_declares_one` |
| Copy through callbacks, remap references, one node per blob | `test_a_copy_remaps_references_and_keeps_one_media_node_per_blob`, `test_a_folder_copy_carries_the_documents_inside_it`, `test_a_content_type_without_remap_media_copies_no_media`, `test_media_below_a_document_is_never_copied_or_moved_on_its_own`, `test_a_copy_is_refused_whole_when_the_app_factory_fails`, `test_new_from_template_copies_the_body_and_drops_the_template_flag`, `test_a_template_of_another_content_type_is_refused` |
| 15-minute media URLs behind document authorization | `test_media_urls_are_signed_for_fifteen_minutes_after_one_read_check`, `test_media_is_refused_to_a_caller_who_cannot_read_the_document`, `test_the_media_ttl_is_fifteen_minutes_and_the_page_refreshes_at_ten` |
| Seven-day unused-media trashing, skip undeclared `used_nodes` | `test_the_sweep_trashes_only_unnamed_media_older_than_seven_days`, `test_the_sweep_skips_a_content_type_that_declares_no_used_nodes`, `test_a_content_type_without_used_nodes_is_skipped_by_the_sweep`, `test_one_failing_document_does_not_stop_the_sweep`, `test_the_sweep_cursor_only_revisits_documents_that_changed`, `test_a_used_nodes_answer_must_be_a_set_of_node_ids` |
| Five scheduler adapters, no sixth grant sweep | `test_five_daily_drive_jobs_are_registered_and_there_is_no_sixth` |

### Open gate

The 41 `TestContentWorkflows` integration tests have never run. They need a
site. Four of them are the `DocShare` proofs on real rows:
`test_an_everyone_share_that_predates_adoption_opens_no_document`,
`test_a_grant_still_answers_beside_a_share_of_another_document`,
`test_a_share_of_a_registered_content_doctype_is_refused_but_stays_removable`,
and `test_boot_validation_refuses_a_type_that_still_carries_a_share`. The acceptance boxes stay unchecked until the orchestrator records this:

```
bench --site slides.localhost migrate
bench --site slides.localhost run-tests --module suite.drive.tests.test_content
bench --site slides.localhost run-tests --module suite.drive.tests.test_nodes
bench --site slides.localhost run-tests --module suite.drive.tests.test_versions
bench --site slides.localhost run-tests --module suite.drive.tests.test_previews
bench --site slides.localhost run-tests --module suite.tests.test_architecture
bench --site slides.localhost run-tests --module suite.tests.test_scheduler_events
bench --site slides.localhost run-tests --module suite.tests.test_composition
```
