# 28 — Migrate content history, comments, templates, and media

**What to build:** Preserve Writer, Slides, and Sheets content around their new Drive nodes.

**Blocked by:** [27 — Migrate root pairs, node trees, and grants](27-build-tree-and-grants.md)

**Status:** ready-for-agent

**Owner:** Suite migration and content adapters

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §14.2 steps 7–8 and 10, §14.6–14.7.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Migrate Writer and Sheet versions with ids, sequence, pinning, labels, and blob bytes. Preserve the specified head-version relationship.
- [ ] Migrate Writer and Sheets comments with opaque anchors and authors. Do not erase source content during Build.
- [ ] Attach immutable document/node links. Adopt orphan documents into the specified Personal Root and report them.
- [ ] Convert Slide media to one node per deck per blob. Rewrite sources, backgrounds, legacy paths, and dictionary posters.
- [ ] Convert deck thumbnails to previews and both template types to granted template nodes.
- [ ] Preserve resumability for body rewrites and newly created template documents. No duplicate media, comments, or versions after rerun.
- [ ] Report state disagreements with File as the accepted source. Keep old fields available through the Build release.

## Verification

Run per-app migration fixtures and a second identical run. Compare document bodies, bytes, links, template grants, and every reported count.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
