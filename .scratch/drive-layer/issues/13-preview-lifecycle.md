# 13 — Show reusable previews without charging users

**What to build:** Render uploaded-file previews and accept app-supplied images with predictable lifecycle behavior.

**Blocked by:** [10 — Upload and replace files under Drive authority and quota](10-upload-and-quota.md)

**Status:** ready-for-agent

**Owner:** Suite Drive previews

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../../wayfinder/drive-layer-spec/drive-layer-spec.md), §3.5, §6.8, §9.2.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Generate a 512-pixel longest-side WebP for supported file MIME types, using existing render dependencies.
- [ ] Reuse by immutable source_blob before rendering. Unsupported MIME types create no preview.
- [ ] Accept document preview pushes under EDIT without touching content time or writing activity.
- [ ] Invalidate on replace, retain on trash, copy references on copy, and remove on purge.
- [ ] Protect against stale jobs publishing a preview for a replaced head.
- [ ] Mint 15-minute URLs only for requested preview expansion. Previews never affect quota.
- [ ] Add the daily missing-preview sweep for files only.

## Verification

Run preview tests with source reuse, replacement races, push authorization, lifecycle transitions, and signed URL expiry.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
