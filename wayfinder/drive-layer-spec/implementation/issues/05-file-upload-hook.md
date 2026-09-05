# 05 — Preserve File adoption hooks on storage v2 uploads

**What to build:** Keep non-Drive apps receiving the existing after_file_upload contract when a File is created through storage v2.

**Blocked by:** [03 — Finish trusted upload sessions without creating a File](03-trusted-blob-upload.md)

**Status:** ready-for-agent

**Owner:** Frappe storage

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §13.4.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Run registered hooks with doc= before inserting the new File from a blob.
- [ ] Persist hook mutations and propagate hook failures with transaction rollback.
- [ ] Preserve the legacy upload_file path without double invocation.
- [ ] Trusted blob-only completion creates no File and performs no File adoption hook.

## Verification

Run File upload regression tests for hook order, mutation, failure, and invocation count.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
