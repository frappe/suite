# 24 — Browse and download ordinary files over WebDAV

**What to build:** Expose the caller’s Personal Root through existing DAV clients using the new permission engine.

**Blocked by:** [23 — Keep legacy callers working through the new Drive workflows](23-legacy-compatibility.md)

**Status:** ready-for-agent

**Owner:** Suite Drive WebDAV

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §12.1–12.2, §12.4–12.5.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Retarget path lookup, locks, and dead properties to Node identity. Keep existing auth, opt-in, method allow-list, and log settings.
- [ ] Mount only the caller’s Personal Root. Add no shared, archived, or admin mount.
- [ ] Use the batched folder role calculation, plus one lock and one property fetch for Depth 1.
- [ ] Hide Writer, Slides, Sheets, and their child-media paths from listing and direct lookup. Return 404.
- [ ] Keep ordinary uploaded office files visible according to access, regardless of filename extension.
- [ ] Use authorized blob streaming with strong ETags, conditional requests, and ranges.
- [ ] Report Personal Root usage and available quota. Omit available quota when unlimited, and never add link principals.

## Verification

Run DAV listing/read tests, direct hidden-path probes, query-count assertions, and local/non-local range checks.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
