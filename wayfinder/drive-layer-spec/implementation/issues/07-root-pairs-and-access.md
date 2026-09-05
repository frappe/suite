# 07 — Create root pairs and resolve node access

**What to build:** Create a Personal or Shared Root with one tree identity, and resolve access to roots and descendants.

**Blocked by:** [01 — Freeze the Drive interface and enforce product boundaries](01-architecture-boundaries.md); [02 — Keep every referenced blob alive during garbage collection](02-blob-reference-gc.md); [03 — Finish trusted upload sessions without creating a File](03-trusted-blob-upload.md); [04 — Serve authorized blobs with signed URLs and byte ranges](04-blob-egress.md)

**Status:** ready-for-agent

**Owner:** Suite Drive engine

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §3.1–3.3, §3.8, §4–5.2.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Create kind=root Node, matching Drive Root metadata, and anchor grants atomically. Metadata name and node link equal the Node id.
- [ ] Keep root-node parent/root NULL and path empty. Top-level children point at the root node with an empty path.
- [ ] Validate both sides of the pair. Reject wrong-kind links, duplicate metadata, illegal root operations, and generic creation bypasses.
- [ ] Enforce concurrent creation uniqueness for Active Personal and Shared roots. Preserve migrated anchor roles later.
- [ ] Implement nearest-grant resolution with identity tiers and separate own/open passes. Same-tier groups take DENY, else the highest role.
- [ ] Apply Suite Admin precedence, inert expired grants, creator grants, and unreadable-as-404. Ownership alone grants no access.
- [ ] Add supporting schema additively. Keep source columns available for Build and postpone destructive model changes.

## Verification

Run root lifecycle and access tests with rollback injection, concurrent creation, root ancestry, and group-order permutations.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
