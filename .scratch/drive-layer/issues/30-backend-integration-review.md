# 30 — Verify the complete backend before migration rehearsal

**What to build:** Produce one verified integration state across storage, Drive, all content apps, HTTP, and WebDAV.

**Blocked by:** [05 — Preserve File adoption hooks on storage v2 uploads](05-file-upload-hook.md); [29 — Complete Build records, accounting, and reporting](29-build-records-and-report.md)

**Status:** ready-for-agent

**Owner:** Suite integration

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../../wayfinder/drive-layer-spec/drive-layer-spec.md), §1–14; plan stage 8.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Check every normative spec section against implementation and ticket evidence. Close missing behavior before marking done.
- [ ] Review grants, link transport, upload bindings, byte egress, query filters, Guest identity, and all HTTP/DAV mutation paths.
- [ ] Test failure atomicity and concurrency for root pairs, quota admission, replacement, moves, and purge.
- [ ] Run the full storage package, Suite app suite, app adapter tests, architecture checks, and DAV acceptance.
- [ ] Rerun measurements only when relevant changes affect them. Record actual MariaDB schema and performance results.
- [ ] Confirm all four Drive Blob Link columns protect bytes and exactly five daily jobs are wired.
- [ ] Inspect the additive deployment path. Retain legacy data required for rollback and client adoption.
- [ ] Record exact code revisions, failures fixed, remaining external gates, and reproducible test commands.

## Verification

Run integration checks serially on slides.localhost. Attach actual output summaries and failure fixes; fixture tests do not count as a real export rehearsal.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
