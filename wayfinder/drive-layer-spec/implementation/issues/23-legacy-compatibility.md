# 23 — Keep legacy callers working through the new Drive workflows

**What to build:** Keep existing clients usable during the Build release while the new API becomes the supported surface.

**Blocked by:** [22 — Expose sharing, views, history, and comments through HTTP](22-http-sharing-and-records.md)

**Status:** ready-for-agent

**Owner:** Suite Drive HTTP compatibility

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §11.7; plan compatibility stage.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Inventory the 69 named legacy methods against current code. Classify forwarders, permanent methods, and retired behavior explicitly.
- [ ] Forward supported legacy calls into the same Drive workflows, preserving required argument and result compatibility.
- [ ] Keep the product methods, stored S3 fetch URLs, permanent get_file_for_doc entry, and /dav contract.
- [ ] Retired behavior returns a tested explicit response; it cannot fabricate capability tokens or successful mutations.
- [ ] Never synthesize a deny or choose a restore destination for old clients.
- [ ] Preserve legacy authentication restrictions. Remove replaced tests only after equivalent contract coverage passes.
- [ ] Produce the caller inventory that later frontend and Cleanup tickets use. Leave destructive removal disabled.

## Verification

Run an executable inventory across all legacy names, including guest-callable methods, stored URLs, old payloads, and explicit unsupported cases.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
