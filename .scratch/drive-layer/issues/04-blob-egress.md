# 04 — Serve authorized blobs with signed URLs and byte ranges

**What to build:** Allow Drive downloads and WebDAV reads without a framework File row.

**Blocked by:** None — can start immediately after execution is authorized.

**Status:** ready-for-agent

**Owner:** Frappe storage

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../../wayfinder/drive-layer-spec/drive-layer-spec.md), §13.3, §13.5.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Provide signed_url_for_blob with filename-bound signatures and native driver URL support.
- [ ] Keep signed_url(File) behavior through delegation. Reject expired signatures and changed filenames.
- [ ] Provide stream_blob for already-authorized callers. Keep serve_file authorization at its existing boundary.
- [ ] Support local and non-local Range responses, including open-ended ranges, 206, 416, and conditional 304.
- [ ] Use native S3 Range requests and retain a working default for other drivers.
- [ ] Streaming adds no Drive permission query or File access-log row. Preserve opt-in DAV native redirects.

## Verification

Run signing, serving, and driver tests. Assert response bytes and headers with local, memory, and S3 driver substitutes.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
