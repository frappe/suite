# 07 — Create root pairs and resolve node access

**What to build:** Create a Personal or Shared Root with one tree identity, and resolve access to roots and descendants.

**Blocked by:** [01 — Freeze the Drive interface and enforce product boundaries](01-architecture-boundaries.md); [02 — Keep every referenced blob alive during garbage collection](02-blob-reference-gc.md); [03 — Finish trusted upload sessions without creating a File](03-trusted-blob-upload.md); [04 — Serve authorized blobs with signed URLs and byte ranges](04-blob-egress.md)

**Status:** done

**Owner:** Suite Drive engine

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §3.1–3.3, §3.8, §4–5.2.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Create kind=root Node, matching Drive Root metadata, and anchor grants atomically. Metadata name and node link equal the Node id.
- [x] Keep root-node parent/root NULL and path empty. Top-level children point at the root node with an empty path.
- [x] Validate both sides of the pair. Reject wrong-kind links, duplicate metadata, illegal root operations, and generic creation bypasses.
- [x] Enforce concurrent creation uniqueness for Active Personal and Shared roots. Preserve migrated anchor roles later.
- [x] Implement nearest-grant resolution with identity tiers and separate own/open passes. Same-tier groups take DENY, else the highest role.
- [x] Apply Suite Admin precedence, inert expired grants, creator grants, and unreadable-as-404. Ownership alone grants no access.
- [x] Add supporting schema additively. Keep source columns available for Build and postpone destructive model changes.

## Verification

Run root lifecycle and access tests with rollback injection, concurrent creation, root ancestry, and group-order permutations.

## Completion evidence

Completed 2026-09-05. The isolated implementation started from Suite
`580935039c28f697cfd1497d422c4b0cdf0e0b53`, was reviewed and committed as
`925c2d29b062ebdacecfbf5885f9a1b6d2ae1e5d`, then integrated onto
`forge/drive-layer` from `fdf628feb24008987076ccbf542dfa456e8abe61` as
`b136fdbf9f336959961e6f6e2482262a8f2ad8d8`. The adjacent Frappe revision
used by the verified bench was `d7948050b321a7f28b546a461554e9b2d14a0a33`.

- Added the frozen `Drive Node`, `Drive Root`, `Drive Grant`, and
  `Drive Activity` schemas and their required uniqueness and hot-path
  indexes. The migration was additive: it created/synchronized these tables
  and indexes without removing legacy source fields or rows.
- `create_root()` now serializes on a stable identity row, creates the root
  node, metadata, and Personal MANAGE or Shared `$GENERAL` UPLOAD anchor in
  one savepoint, preserves the domain owner independently of the provisioning
  session, validates both sides, and rolls the entire pair back on failure.
- Root controllers reject generic pair creation, wrong-kind metadata,
  identity changes, invalid root shapes, and ordinary move, copy, trash,
  restore, purge, or delete paths. Direct children retain `parent = root` and
  an empty path.
- Point access resolution parses the materialized ancestry once, filters
  expired rows in SQL, applies nearest-depth and user/group/`$GENERAL` tiers,
  resolves own and open principals separately, makes same-tier DENY final,
  and otherwise takes the highest role independently of database row order.
  Suite Admin bypasses grants; ownership grants nothing; unreadable nodes
  raise the documented 404 error.
- Creator grants are decided from the parent: a signed-in creator below EDIT
  receives one node-local EDIT row, while inherited EDIT and link uploads add
  none.

Verification reported from the isolated Suite worktree:

- `env PYTHONPATH=/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-07
  /home/faris/.local/bin/bench --site slides.localhost migrate` — completed
  successfully.
- `env PYTHONPATH=/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-07
  /home/faris/.local/bin/bench --site slides.localhost run-tests --module
  suite.drive.tests.test_roots` — 26 passed.
- The same worktree-targeted command for `suite.drive.tests.test_access` —
  12 passed; for `suite.drive.tests.test_principals` — 3 passed. Total: 41
  passed, zero failures or errors.
- Independent merger review passed cached-diff whitespace checks and JSON
  parsing for all four DocTypes. Ruff was unavailable in the environment, so
  no Ruff result is claimed.

Unresolved gates: ticket 08 owns link-header parsing, password unlock and
locked-link responses, and grant mutation workflows. Ticket 09 owns listing
queries and root-page index measurement. Migrated anchor-role preservation is
retained as a Build requirement for ticket 27; this ticket creates only the
specified fresh-root anchors.
