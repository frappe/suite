# 08 — Manage grants and share links with explicit denial

**What to build:** Let managers share, remove a grant, explicitly deny access, and inspect why access applies.

**Blocked by:** [07 — Create root pairs and resolve node access](07-root-pairs-and-access.md)

**Status:** done

**Owner:** Suite Drive engine

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §4.7–4.8, §5.8–5.12, §6.1–6.5.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Implement all grant refusal cases, including root public/link guards and Personal Root owner deny protection.
- [x] Raise ValidationError for malformed roles/principals, missing principal targets, and past expiry. Failed writes mutate nothing.
- [x] Revoke deletes only the local row. Explicit role 0 creates a deny. Revoke-below includes the origin and its descendants.
- [x] Write the specified activity exactly once per successful grant operation, including root targets and bulk revoke-below.
- [x] Implement link minting, rotation, password unlock tickets, expiry responses, and specified rate limits.
- [x] Count supplied header items before validation or deduplication. Reject more than 20, and never truncate.
- [x] Retain every expired grant, including denies and links. They authorize nothing; no expiry cleanup job exists.
- [x] Expose the explanation through the engine, with current-row resolution and no grant cache.

## Verification

Run grant/principal tests, including READ+EDIT, DENY ties, inherited access after removal, HMAC invalidation, rate limits, and retained expiry.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.

Completed 2026-09-05. The isolated implementation started from Suite
`d7ed583fd21d54cc64f436cd197b9a8ad7079327`, was reviewed and committed as
`d3824486381e8e76e15972f88e622de2b379ed51`, then integrated onto
`forge/drive-layer` as `4375e27bf8cdb043d0583f22ad5bfd8fa11d3b0e`.

- Grant mutation now validates the actor, target node, principal, role,
  expiry, root guards, and Personal Root owner protection in the specified
  refusal order before writing. A local revoke deletes only that row, role
  zero persists an explicit DENY, and revoke-below is confined to the origin
  tree. Each successful insert, update, root mutation, or bulk revoke writes
  its specified activity once in the same transaction.
- Link creation stores only the token hash and password hash, rotation keeps
  the grant row and settings while invalidating prior credentials, and
  unlock tickets are bound to the current token/password hashes and expiry.
  Locked and expired links remain distinguishable, own DENY remains final,
  and the Redis-backed failure bucket atomically exhausts at the fifth
  failure so a sixth attempt skips password verification.
- Request principal parsing rejects more than 20 raw header items before
  validation or deduplication. Authorization checks reuse request-local
  validated link proof, resolve only current rows, retain expired grants as
  inert records, and do not introduce a grant cache or expiry cleanup job.
- Explanation output uses the same fresh authorization resolution and
  ordering as enforcement, including unheld rows where required.
- Review found and corrected the pre-existing nested `Drive Node` validator's
  extra-slash construction so canonical depth-three paths accepted by the
  materialized ancestry contract can be inserted. This is a current §8.7
  invariant correction; ticket 11 continues to own move/copy/trash/restore
  lifecycle behavior.

Verification against the isolated Suite worktree used
`PYTHONPATH=/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-08`
with `bench --site slides.localhost run-tests --module <module>`:

- `suite.drive.tests.test_roots` — 26 passed (2 unit, 24 integration).
- `suite.drive.tests.test_grants` — 24 integration tests passed.
- `suite.drive.tests.test_access` — 12 unit tests passed.
- `suite.drive.tests.test_principals` — 10 unit tests passed.
- Total: 72 passed with zero failures, errors, or warnings. No schema changed,
  so no migration was run. Cached-diff whitespace checking also passed.

Unresolved gates: HTTP exposure remains ticket 22, frontend sharing actions
remain ticket 33, and Sheets collaboration adoption remains ticket 19. No
push, pull request, install, restart, or expiry cleanup was performed.
