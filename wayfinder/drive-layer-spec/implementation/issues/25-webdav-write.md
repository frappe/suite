# 25 — Write and lock files over the same Drive workflows

**What to build:** Keep DAV PUT, MOVE, COPY, DELETE, and LOCK consistent with the web API.

**Blocked by:** [24 — Browse and download ordinary files over WebDAV](24-webdav-read.md)

**Status:** ready-for-agent

**Owner:** Suite Drive WebDAV

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §12.1, §12.3–12.5.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] PUT spools once into private blob storage. Preflight Content-Length or bound the spool by remaining quota.
- [ ] Replace keeps one nonempty previous version. Remove duplicate staging, compensation, generation, and owner-lock mechanisms.
- [ ] MOVE/COPY/MKCOL/DELETE call shared workflows with the method-role table. Reject cross-root DAV moves.
- [ ] LOCK on an unmapped path creates an empty node under UPLOAD. Expired unused locks leave that node intact.
- [ ] Preserve lock ownership, overwrite checks, dead-property cloning, conditional headers, and client content times.
- [ ] Record the authenticated actor and User-Agent once. Hidden content documents remain inaccessible to write methods.

## Verification

Run existing DAV protocol tests plus litmus against /dav/ on the authorized bench. Include quota races, zero-byte LOCK replacement, and conditional writes.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
