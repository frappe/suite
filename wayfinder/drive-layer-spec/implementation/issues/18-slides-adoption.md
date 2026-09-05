# 18 — Move Slides documents and media into Drive

**What to build:** Keep decks, embedded media, templates, and previews under Drive identity and access.

**Blocked by:** [16 — Create content documents and media through one Drive contract](16-content-contract.md)

**Status:** ready-for-agent

**Owner:** Suite Slides

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §6.6, §10.7 Presentation; §14.7.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Declare Presentation and its Slide Satellite through the public Drive contract.
- [ ] Implement deck creation, duplication, versions, restoration, purge, and complete used_nodes discovery.
- [ ] Use media nodes for sources, backgrounds, and posters. Share blobs while copying node ownership and references across decks.
- [ ] Push browser previews through Drive. Keep default_export=None.
- [ ] Remove forced-public composite behavior and app-specific sharing decisions. Save references only when the caller can read them.
- [ ] Keep legacy media compatibility until client adoption. Preserve Build source fields until Cleanup.
- [ ] Remove app-side File conversion/deletion paths when their replacement is active. Drive does not convert uploads.

## Verification

Run Slides tests for Satellite access, repeated media reuse, cross-deck paste, dictionary posters, templates, preview pushes, and round-trip copies.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
