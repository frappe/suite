# 11 — Move, copy, trash, and explicitly restore node trees

**What to build:** Let users organize and recover files without corrupting ancestry, access, or byte accounting.

**Blocked by:** [10 — Upload and replace files under Drive authority and quota](10-upload-and-quota.md)

**Status:** done

**Owner:** Suite Drive node workflows

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §7.6, §8.6–8.11.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Create folders and links; enforce kind invariants, leaf rules, title rules, and depth limits.
- [x] Move uses root-relative prefixes, checks cycles and destination rights, and rewrites Active and Trashed descendants atomically.
- [x] Cross-root moves transfer head and version charges once. Reservations stay with their original root.
- [x] Copy checks source READ and destination UPLOAD. Skip unreadable descendants; copy no grants, versions, or comments.
- [x] Trash preserves earlier independent trash stamps. Restore restores only the matching trash root and timestamp.
- [x] When the original chain is unavailable, require a user-selected Active destination in the same root before any mutation.
- [x] Cancel or missing destination leaves Trash unchanged. Validate access and deduplicate at the selected destination.
- [x] Implement ordered purge through registered content callbacks, with reference cleanup and quota release. Refuse ordinary root purge.
- [x] Register the daily 30-day trash purge through the scheduler adapter, processing each trash root once.

## Verification

Run lifecycle tests for nested trash, selected restore, rollback, title collisions, depth boundaries, root destinations, cross-root accounting, and purge ordering.

## Completion evidence

Completed 2026-09-06 from ticket 10 revision
`b066ea2723a3c15d4adea970dff5dc089c25240c`.

Suite implementation revision: `08f5b87324869216f0200774931864c784885bf4`.
The isolated branch was reviewed and fast-forwarded onto `forge/drive-layer`.
Frappe stayed at `158a173a1c8fb0083f2b352250f8ac4bba1781ba`.

Changed behavior:

- Folder and link creation now enforce active container, title, kind, leaf, and
  depth rules. Node validation rejects malformed lifecycle stamps, tree
  positions, mutable content identities, and non-document templates.
- Rename checks Active sibling collisions. Move locks both endpoints, the
  source subtree, both ancestry chains, and root pairs in stable order. It
  rejects cycles and invalid materialized trees before its two-statement path
  rewrite. Active and Trashed descendants move together.
- Cross-root move computes head and version bytes with the frozen root/path
  query. It admits the destination before releasing the source in the same
  transaction. Reservations remain on their original root. A mover who loses
  inherited EDIT receives one direct EDIT grant, except for link-authorized
  destinations.
- Copy requires source READ and destination UPLOAD. It skips unreadable
  descendant branches, shares private Ready blobs, charges head bytes only,
  and creates no copied grants, versions, or comments. Generic document and
  document-media copies fail closed until the content contract owns them.
- Trash locks and validates the physical subtree before stamping only Active
  rows. Restore uses the exact trash root and timestamp. An actor can restore
  their own item in place with node EDIT. Explicit reparenting requires an
  Active same-root destination with UPLOAD and applies title deduplication
  before the state change.
- Purge validates the root and complete subtree before mutation. It validates
  all registered content callbacks before cleanup, deletes references in the
  specified order, releases head and version charges, and leaves blob deletion
  to framework garbage collection. Ordinary root purge remains forbidden.
- The daily scheduler adapter selects trash roots older than 30 days. It
  rechecks each root under lock and commits or rolls back each root separately.

Full worktree verification used:

```text
cd /home/faris/benches/suite-bench && PYTHONPATH=/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-11:/home/faris/benches/suite-bench/apps/frappe bench --site slides.localhost run-tests --module suite.drive.tests.test_nodes
cd /home/faris/benches/suite-bench && PYTHONPATH=/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-11:/home/faris/benches/suite-bench/apps/frappe bench --site slides.localhost run-tests --module suite.drive.tests.test_views
cd /home/faris/benches/suite-bench && PYTHONPATH=/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-11:/home/faris/benches/suite-bench/apps/frappe bench --site slides.localhost run-tests --module suite.drive.tests.test_upload
```

Results before final review fixes: node lifecycle 24/24, views 20/20, and
upload 34/34, for 78/78 total. One existing upload deprecation warning was
reported. Committed concurrency fixtures were removed cleanly.

Final review found and fixed two specification gaps. Ordinary in-place restore
no longer overchecks parent UPLOAD. Cross-root byte accounting now uses the
single root/path-indexed SQL shape from §7.6. The focused node lifecycle module
then passed 26/26: five unit and 21 integration tests. It had zero warnings and
clean fixture removal.

Static verification passed for the final implementation: Python compileall
over the changed Python files, `git diff --check`, cached Ruff lint, and Ruff
format check. The independent standards review found no blocker, high, or
medium issue after these checks.

No schema, patch, or migration changed in this ticket. The scheduler hook is
an additive code registration. No migration or remigration was run.

Deferred by the frozen plan:

- Version workflows remain ticket 12.
- Preview lifecycle and preview cloning remain ticket 13.
- Record workflows remain ticket 14.
- Reservations, root administration, and daily quota recompute remain ticket 15.
- Central content registry validation, document duplication, and media
  reference remapping remain ticket 16.
- HTTP exposure remains ticket 21.
- DAV dead-property cloning remains ticket 25.

Generic document copy fails closed until ticket 16. No push, PR, install,
restart, or migration was performed.

### Post-completion concurrency correction

Reviewed 2026-09-06 after a concurrent descendant create and cross-root move
reproduced MariaDB deadlock 1213, whose cleanup then masked the cause with a
missing-savepoint 1305. Suite correction revision `c0968458f` gives create,
copy, and move one ancestry lock order: non-root rows by root-first depth and
id, root-node rows last. It refreshes and rejects changed path snapshots before
mutation, locks direct-insert parent/root validation reads, and preserves the
original deadlock if InnoDB has already removed the workflow savepoint.

The same review made optional purge reference cleanup require both DocType
metadata and its table, so an orphan later-ticket table cannot break ticket 11
purge. Deterministic source-side and destination-side move/create selectors
each passed 1/1. The final node module passed 32/32 (9 unit, 23 integration),
with no warnings, timeouts, or deadlocks, and fixture teardown completed.
Static Ruff lint and format, Python compileall, and `git diff --check` also
passed. No schema, migration, job, install, or restart was needed.

### Corrupt ancestry error class correction

Reviewed 2026-09-06 after the corrupt-path subcase of
`TestDriveFileAccounting.test_corrupt_parent_root_and_path_are_refused_without_charging`
failed. The ancestry lock order added by `c0968458f` locks each id the stored
`root` and `path` name. A node whose path names a missing ancestor made that
lock read raise `DriveNotFound`, so structural corruption reached the caller as
404 instead of the 409 the contract states.

The lock reads now go through one helper that translates a missing chain row
into `DriveConflict`. The translation boundary is the lock order alone. The
caller-named node is still read before the order begins, so a parent that does
not exist, or that the caller may not see, keeps its `DriveNotFound`. Lock
acquisition is unchanged: same ids, same depth-then-id order, root nodes last.

Verified without the shared site: 61/61 Drive unit-shaped tests pass, including
two new `_lock_create_parent` tests, and a fake-node harness shows both corrupt
subcases refused as `DriveConflict` before any charge. Ruff lint and format
pass. The integration case still needs `bench --site slides.localhost run-tests
--module suite.drive.tests.test_upload`, which was not run here.
