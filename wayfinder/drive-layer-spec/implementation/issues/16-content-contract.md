# 16 — Create content documents and media through one Drive contract

**What to build:** Give every content app one complete creation, lifecycle, and media contract.

**Blocked by:** [12 — Keep and restore versions with bounded automatic history](12-version-history.md); [13 — Show reusable previews without charging users](13-preview-lifecycle.md); [14 — Keep comments, history, and personal lists on nodes](14-comments-and-records.md); [15 — Archive roots and charge Meet reservations to roots](15-root-administration-and-meet.md)

**Status:** ready-for-agent

**Owner:** Suite Drive content contract

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

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
