# 10 — Upload and replace files under Drive authority and quota

**What to build:** Upload private files through Drive grants, charge the destination root, and preserve replaced bytes.

**Blocked by:** [09 — Browse permission-filtered trees and measure indexes](09-listings-and-index-measurement.md)

**Status:** ready-for-agent

**Owner:** Suite Drive node workflows

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../../wayfinder/drive-layer-spec/drive-layer-spec.md), §7.1–7.4, §8.2–8.5, §13.7.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Bind upload ids to authorized destinations server-side. Reauthorize create, every chunk, and finish.
- [ ] Guest identity alone cannot claim another visitor’s session. Refuse forged destinations, revoked access, and replayed finishes.
- [ ] Support trusted chunked and direct storage paths. Stream chunk bodies and keep framework validation intact.
- [ ] Preflight declared bytes, then admit actual bytes with one conditional root counter update in the write transaction.
- [ ] Replace keeps a nonempty old head as one auto version. Charge it exactly once; a zero-byte head creates no version.
- [ ] Enforce create-versus-replace arguments, content time, creator grant exceptions for links, and activity attribution.
- [ ] On failure, roll back node, counter, grant, and activity changes. Unreferenced blobs remain eligible for framework GC.

## Verification

Run upload and quota tests, including website ZIP uploads, Guest links, size races, direct cleanup, replacement accounting, and concurrent finish.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
