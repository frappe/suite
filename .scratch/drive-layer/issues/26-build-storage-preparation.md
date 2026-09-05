# 26 — Prepare legacy bytes for an additive Build

**What to build:** Make legacy Drive bytes available as blobs before any tree conversion.

**Blocked by:** [25 — Write and lock files over the same Drive workflows](25-webdav-write.md)

**Status:** ready-for-agent

**Owner:** Suite migration

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../../wayfinder/drive-layer-spec/drive-layer-spec.md), §14.1–14.2 steps 1–3.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Implement the storage-enabled and S3-configuration gates before mutation.
- [ ] Run idempotent framework local backfill. Preserve framework attachments outside reachable Drive trees.
- [ ] For legacy S3 URLs, hash once, copy through the specified canonical layout, and link File.blob.
- [ ] Use managed multipart copy above 5 GB. Resume from linked blobs without copying complete objects again.
- [ ] Record missing-byte and S3-copy results for the final report. Preserve original local bytes and legacy S3 objects.
- [ ] Keep Build registration gated on the later integration ticket so an ordinary migrate cannot run a partial patch.

## Verification

Run fixture-backed migration tests for disabled storage, invalid S3 configuration, missing files, interrupted copy, and multipart selection.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
