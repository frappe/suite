# 08 — Manage grants and share links with explicit denial

**What to build:** Let managers share, remove a grant, explicitly deny access, and inspect why access applies.

**Blocked by:** [07 — Create root pairs and resolve node access](07-root-pairs-and-access.md)

**Status:** ready-for-agent

**Owner:** Suite Drive engine

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../../wayfinder/drive-layer-spec/drive-layer-spec.md), §4.7–4.8, §5.8–5.12, §6.1–6.5.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Implement all grant refusal cases, including root public/link guards and Personal Root owner deny protection.
- [ ] Raise ValidationError for malformed roles/principals, missing principal targets, and past expiry. Failed writes mutate nothing.
- [ ] Revoke deletes only the local row. Explicit role 0 creates a deny. Revoke-below includes the origin and its descendants.
- [ ] Write the specified activity exactly once per successful grant operation, including root targets and bulk revoke-below.
- [ ] Implement link minting, rotation, password unlock tickets, expiry responses, and specified rate limits.
- [ ] Count supplied header items before validation or deduplication. Reject more than 20, and never truncate.
- [ ] Retain every expired grant, including denies and links. They authorize nothing; no expiry cleanup job exists.
- [ ] Expose the explanation through the engine, with current-row resolution and no grant cache.

## Verification

Run grant/principal tests, including READ+EDIT, DENY ties, inherited access after removal, HMAC invalidation, rate limits, and retained expiry.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
