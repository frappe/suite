# 15 — Archive roots and charge Meet reservations to roots

**What to build:** Keep offboarded sharing intact and account for Meet recordings through the public Drive interface.

**Blocked by:** [11 — Move, copy, trash, and explicitly restore node trees](11-node-lifecycle.md)

**Status:** in-progress — implementation complete, site tests not run

Every acceptance box stays unchecked until the commands under [Completion evidence](#completion-evidence) run on the authorized test site. The implementation and its tests are written; nothing below is proved.

**Owner:** Suite Drive and Meet

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §3.2, §3.12–3.14, §7.4–7.9, §11.2.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Archive metadata only. Keep root node, grants, content, and byte charges unchanged.
- [ ] Wire install, boot, and offboarding through Suite composition. Keep product lifecycle orchestration outside product-neutral suite_core.
- [ ] Create fresh Personal Root identity for recreated users. Preserve specified access to archived descendants.
- [ ] Provide Suite Admin quota changes and explicit archived-root purge. Reject Active-root purge.
- [ ] Purge the pair atomically after descendant references, root grants/activity, and remaining root-linked records.
- [ ] Implement reservation create, grow, reduce, and release on root metadata through package-root workflows.
- [ ] Migrate all Meet reservation callers and backfill behavior to the Room Owner’s Personal Root. Remove redundant owner-lock calls.
- [ ] Recompute Active and Archived root usage daily, including all nodes, versions, and reservations. Log drift.

## Verification

Run root/Meet tests for concurrent admission, reservation consumption, offboarding, recreated identity, purge rollback, and recompute reconciliation.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass.

Implemented 2026-09-06 from ticket 11 revision
`228a5c19cc1b7a3d97222aa999d6061449667f02`. Finalized on 2026-09-06 by merging
Suite integration main `40330feb8` (tickets 11-14) into the source commit
`5fc378e53`. Frappe stayed on its main; the upload fixes are already there.
Status stays `in-progress`: every test below needs the shared bench site and
has not run on this revision.

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

Not run on this revision. They need the authorized test site.

```
bench --site <site> migrate
bench --site <site> run-tests --module suite.drive.tests.test_root_admin
bench --site <site> run-tests --module suite.drive.tests.test_quota
bench --site <site> run-tests --module suite.meet.patches.test.test_backfill_recording_storage_reservations
bench --site <site> run-tests --module suite.meet.api.test.test_recording
bench --site <site> run-tests --module suite.tests.test_architecture
bench --site <site> run-tests --module suite.tests.test_composition
```

Static checks that did run on this revision, from the worktree:

```
uvx ruff@0.12.3 check suite            # 24 errors, all pre-existing, none in drive/meet/composition
uvx ruff@0.12.3 format --check suite   # 2 pre-existing files, both unchanged here
python -m unittest suite.tests.test_architecture suite.tests.test_composition   # 10 tests, OK
```

The 85 Drive `UnitTestCase` tests also pass with `frappe.init` and a stubbed
`frappe.local.db`, no site connection.
