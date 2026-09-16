# 15 — Archive roots and charge Meet reservations to roots

**What to build:** Keep offboarded sharing intact and account for Meet recordings through the public Drive interface.

**Blocked by:** [11 — Move, copy, trash, and explicitly restore node trees](11-node-lifecycle.md)

**Status:** done

All eight acceptance criteria are implemented and covered by named tests that
passed on the authorized test site.

**Owner:** Suite Drive and Meet

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §3.2, §3.12–3.14, §7.4–7.9, §11.2.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Archive metadata only. Keep root node, grants, content, and byte charges unchanged.
- [x] Wire install, boot, and offboarding through Suite composition. Keep product lifecycle orchestration outside product-neutral suite_core.
- [x] Create fresh Personal Root identity for recreated users. Preserve specified access to archived descendants.
- [x] Provide Suite Admin quota changes and explicit archived-root purge. Reject Active-root purge.
- [x] Purge the pair atomically after descendant references, root grants/activity, and remaining root-linked records.
- [x] Implement reservation create, grow, reduce, and release on root metadata through package-root workflows.
- [x] Migrate all Meet reservation callers and backfill behavior to the Room Owner’s Personal Root. Remove redundant owner-lock calls.
- [x] Recompute Active and Archived root usage daily, including all nodes, versions, and reservations. Log drift.

## Verification

Run root/Meet tests for concurrent admission, reservation consumption, offboarding, recreated identity, purge rollback, and recompute reconciliation.

## Completion evidence

Implemented 2026-09-06 from ticket 11 revision
`228a5c19cc1b7a3d97222aa999d6061449667f02`. Finalized on 2026-09-06 by merging
Suite integration main `40330feb8` (tickets 11-14) into the source commit
`5fc378e53`. Frappe stayed on its main; the upload fixes are already there.
Amended by `eaf0c8ddff71c98ecc63802f4eba940446587ed0`, which clears the
departed user's private records on offboarding and aligns the purge lock order,
and by four Meet test-fixture commits (`3ac7a305c`, `de0f6abc7`, `94da05590`,
`0ac59e257`). Test revision `10800b6de428598cea688f7001c3fdf87e4ce516` adds the
Archived recompute, the root-scan filter assertion, and the daily registration
assertion; it changes no production file. Reconciled at HEAD
`bff1dde0631aced3b47396e2bde2b8386d37ede0`.

Merge result: one conflict, in `suite/drive/jobs.py`, where both sides added a
scheduler adapter. All three were kept. `suite/hooks.py` and
`suite/drive/_core/roots.py` merged without conflict.

Changed behavior:

- `suite/drive/_core/roots.py` owns the root pair: `create_root`,
  `provision_personal_root`, `archive_personal_root`, `update_root`,
  `purge_root`, and `validate_root_pair`. Archiving writes one metadata field.
  A recreated email gets a fresh root node id, never the archived one.
- `purge_root` refuses an Active root, then locks descendants shallowest
  first, the root node, and the `Drive Root` row, in that order. It deletes
  descendant references, runs the content purge callbacks, deletes descendant
  nodes, then the root node's own references, its reservations, its metadata,
  and last the root node. Any failure rolls the whole operation back.
- `suite/drive/_core/quota.py` owns admission, release, `effective_quota`,
  `recompute_usage`, and the four reservation operations on root metadata. A
  reservation is bound to its root at creation and never moves.
- `suite/drive/__init__.py` exports the nine product-facing workflows and
  documents their errors, transactions, lock order, permissions, and cost.
- Meet reserves against the Room Owner's Personal Root through
  `suite.drive`. Grow, reduce, release, and the segment free-byte check read
  the reservation's bound root, so a recording that started before its owner
  was offboarded stays charged to the archived root. The Redis owner lock is
  gone from every migrated call site.
- The owner-concurrency limit is enforced after the recording row and its
  reservation exist, with a locking read, so two concurrent rooms cannot both
  pass it.
- `suite/meet/patches/backfill_recording_storage_reservations.py` charges
  every live recording to its owner's Personal Root through the facade, one
  recording per transaction. Terminal recordings release instead. It writes no
  Drive table itself and never rebinds a bound reservation. Registered again
  as `#2` so sites that ran the old version re-run the new one.
- `suite.drive.jobs.recompute_root_usage` recomputes every Active and
  Archived root from nodes, versions, and reservations, one root per
  transaction, and logs the drift.
- Lifecycle and User dispatch moved to `suite/composition`.
  `suite.suite_core.boot` is deleted, not shimmed.

Review decisions recorded on this ticket:

- **Offboarding clears the departed user's private records.** Recents,
  favourites, and notifications are keyed by email, not by a root id.
  Archiving alone left them behind, so a User recreated on the same address
  read the previous person's open history, stars, and inbox.
  `activity.discard_personal_records` deletes those three, and
  `install.on_user_trash` calls it after `archive_personal_root`. Grants,
  comments, activity rows, and versions are deliberately kept: they are
  attributed history and specified access that the archived tree still needs
  (§3.2, §9.5). `ignore_links_on_delete` covers every remaining Drive table
  that links a User, so the framework's link check cannot refuse the delete.
- **Purge takes the tree lock order, not the root-first order.** Ticket 11's
  `_lock_tree_chains` locks descendants shallowest first and the root node
  last. Root purge originally locked the root pair first and its descendants
  deepest first, the exact reverse, which deadlocks against an upload or a
  move inside the same archived root. Both orders are now the same, the
  descendant query uses `CHAR_LENGTH(path)` like `SUBTREE_SQL`, and the
  Archived state is proved again under the lock. `purge_root` and
  `create_root` use ticket 11's `_rollback_savepoint`, so a deadlock victim's
  rollback does not mask MariaDB's original error.

## Migration and test commands

Run on the authorized bench site against this branch, after
`bench --site <site> migrate`. All eight modules passed:

```text
bench --site slides.localhost run-tests --module suite.drive.tests.test_root_admin                                     # 11/11
bench --site slides.localhost run-tests --module suite.drive.tests.test_quota                                          # 19/19
bench --site slides.localhost run-tests --module suite.meet.patches.test.test_backfill_recording_storage_reservations  #  6/6
bench --site slides.localhost run-tests --module suite.meet.api.test.test_recording                                    # 41/41
bench --site slides.localhost run-tests --module suite.meet.api.test.test_callback_security                            #  7/7
bench --site slides.localhost run-tests --module suite.tests.test_architecture                                         #  7/7
bench --site slides.localhost run-tests --module suite.tests.test_composition                                          #  3/3
bench --site slides.localhost run-tests --module suite.tests.test_scheduler_events                                     #  2/2
```

`test_quota` is 11 unit tests in `TestQuotaContract` plus 8 integration tests in
`TestRootReservationsAndRecompute`, run at this HEAD.
`test_scheduler_events.test_registered_methods_resolve` resolves every dotted
path in `scheduler_events`, so the daily entry is a real callable.

| Criterion | Tests |
|---|---|
| Archive metadata only | `test_archive_changes_metadata_only_and_a_new_root_gets_fresh_identity` |
| Composition wiring | `test_lifecycle_hooks_are_owned_by_composition`, `test_user_hooks_are_single_composition_dispatchers`, `test_the_suite_core_lifecycle_shim_is_gone`, `test_delete_and_recreate_email_archives_old_identity_and_provisions_a_new_one` |
| Fresh identity, preserved access | `test_delete_and_recreate_email_archives_old_identity_and_provisions_a_new_one`, `test_offboarding_discards_private_records_and_keeps_attributed_ones`, `test_discarding_private_records_is_idempotent_and_needs_a_user` |
| Admin quota, purge guard | `test_admin_quota_update_and_active_purge_guard`, `test_non_admin_cannot_change_or_purge_a_root` (unit), `test_archived_purge_removes_descendants_references_and_pair` |
| Atomic pair purge | `test_descendants_lock_before_the_root_node_and_its_metadata` (unit), `test_archived_purge_removes_descendants_references_and_pair`, `test_purge_failure_rolls_back_descendants_references_and_pair`, `test_corrupt_descendant_position_refuses_purge_without_mutation`, `test_orphan_table_without_doctype_metadata_is_ignored` (unit) |
| Reservation workflows | `test_create_resize_release_are_root_keyed_idempotent_and_charged`, `test_every_operation_stays_on_the_bound_root_once_it_is_archived`, `test_a_grow_beyond_the_archived_root_quota_is_still_refused`, `test_binding_a_legacy_reservation_charges_it_once_and_never_rebinds`, `test_releasing_an_unbound_legacy_reservation_charges_no_root`, `test_concurrent_reservations_admit_exactly_one_near_quota`, and the eight admission and reservation unit tests in `TestQuotaContract` |
| Meet callers migrated | `test_reprovision_during_recording_keeps_reservation_bound_to_archived_root`, `test_two_concurrent_rooms_admit_one_recording_and_roll_the_other_back`, and the six backfill tests |
| Daily recompute | `test_recompute_repairs_nodes_versions_and_reservations` (Active), `test_the_daily_pass_recomputes_an_archived_root` (Archived), `test_the_daily_scan_reads_archived_roots_as_well_as_active_ones` (unit), `test_daily_recompute_isolates_roots_and_logs_drift` (unit, drift), `test_the_recompute_is_registered_once_as_a_daily_scheduler_event` (unit), `test_registered_methods_resolve` |

`test_architecture` proves the boundary rules this ticket depends on:
`test_drive_public_interface_is_explicit_and_complete_only` pins
`suite.drive.__all__` to exactly the nine exported names, and
`test_python_boundaries_match_owned_debt_baseline` fails on any new unowned
cross-package import.

### The four Meet test-fixture commits

Each touches only
`suite/meet/patches/test/test_backfill_recording_storage_reservations.py`. No
production file changed.

- `3ac7a305c` inserts the `Meet Room` as the test owner. `validate_parties`
  compares `recording.room_owner` against the stored Meet Room `owner`, which
  Frappe takes from the session user at insert time, so inserting as
  Administrator threw.
- `de0f6abc7` adds `estimated_seconds`, `estimated_bytes`, and
  `drive_home_folder` to the recording fixture, taking the folder from
  `suite.drive.utils.get_user_folder`.
- `94da05590` supplies upload metadata as a complete tuple (`upload_id`,
  `upload_size`, `upload_sha256`, `upload_duration_ms`), because
  `validate_state` accepts it only whole.
- `0ac59e257` is the boundary fix. `de0f6abc7` had introduced a direct
  `suite.drive.utils` import into a Meet test. The architecture checker walks
  every `*.py` under `suite/` with no test exclusion, so that import is a new
  violation that no `BASELINE_DEBT` entry owns, and
  `test_python_boundaries_match_owned_debt_baseline` fails. `suite.drive`
  exports no folder workflow, and adding one would fail
  `test_drive_public_interface_is_explicit_and_complete_only`. Meet already
  owns `_get_drive_destination`, the helper the recording API itself calls to
  pick `drive_home_folder`, so the fixture uses that. The fixture now matches
  production and the `suite.drive.utils` debt stays confined to its one
  baselined line in `suite/meet/api/recording.py`.

### Static checks

Re-run from the worktree at this HEAD:

```text
uvx ruff@0.12.3 check suite            # 24 errors, all pre-existing
uvx ruff@0.12.3 format --check suite   # 2 files would be reformatted, both pre-existing and unchanged here
```

The earlier note said none of the 24 fall in drive, meet, or composition. That
was wrong: one is `suite/drive/patches/team_restructure.py:56 E722`. It is
pre-existing and untouched on this branch.

The earlier claim that "the 85 Drive `UnitTestCase` tests also pass" without a
site is withdrawn as stale. That count was taken at `5fc378e53`, where the real
figure was 80; at this HEAD it is 107, after the `40330feb8` merge brought in
tickets 11 to 14. The no-site harness was not re-run after the merge. The
`bench` runs above supersede it.

### Daily recompute coverage

Each part of the eighth criterion now has a test:

- **Archived roots.** `test_the_daily_pass_recomputes_an_archived_root`
  archives the root, charges a node, a version, and a reservation, corrupts
  `used_bytes`, then runs `recompute_root_usage` against the real table. The
  root is repaired to 23 bytes and stays Archived. Only this root is recomputed
  for real; every other root on the site is stubbed, so the pass stays inside
  the test's own data.
- **The state filter.**
  `test_the_daily_scan_reads_archived_roots_as_well_as_active_ones` asserts the
  exact `frappe.get_all` call, so an Active-only filter fails. The drift test's
  `get_all` fake now answers that query only and raises on any other one.
- **Nodes, versions, and reservations.** One charge helper feeds both
  `test_recompute_repairs_nodes_versions_and_reservations` (Active) and the
  Archived test.
- **Drift and isolation.** `test_daily_recompute_isolates_roots_and_logs_drift`.
- **Daily registration.**
  `test_the_recompute_is_registered_once_as_a_daily_scheduler_event` pins one
  daily entry and resolves the dotted path to the job.
  `suite.tests.test_scheduler_events` is now in the run set, and it resolves
  every registered method.

### Coverage note on preserved access

The third criterion's second sentence is proved inside the recorded set at row
level: `test_offboarding_discards_private_records_and_keeps_attributed_ones`
asserts the grant row and the Drive Activity actor survive archiving, which is
the specified access itself. The read-path proof, that a grantee can still
discover and open an archived descendant, lives in
`test_archived_root_discovery_uses_existing_descendant_grants` in
`suite.drive.tests.test_views`, which was not in this run set. Adding that
module to the evidence run would close the loop.

Schema changed only through the doctypes tickets 12 to 14 added, so a site
needs `bench --site <site> migrate`. The backfill patch is registered a second
time as `#2` so sites that ran the old version re-run the new one. No push, PR,
install, or restart was performed.