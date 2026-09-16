---
id: 014
title: Rollout, redirects and old-page deletion
label: wayfinder:grilling
status: open
assignee:
blocked-by: [006, 009, 010, 013]
---

## Question

Rollout is grow beside, then switch (decided 2026-09-11). Define the
switch.

- The gates a new area passes before its redirect flips: browser journeys,
  the legacy-call count for that area at zero, the import-boundary check.
- The redirect layer: old prefix to new route, per area, including deep
  links, share links and the Desk app switcher. Who owns it and when it is
  removed.
- Deletion of the old Drive, Writer, Sheets and Slides pages as the last
  stage, and what that unblocks in the Drive program (Cleanup activation,
  ticket 36).
- The release shape: one release for the shell plus Files, or the shell
  first with the old apps inside it.
- Rollback: how to point a prefix back at the old page without a deploy.

Inputs: the resolutions of tickets 006, 009, 010 and 013; the Drive
implementation README's release checkpoints;
`wayfinder/drive-layer-spec/implementation/issues/36-cleanup-later-release.md`.
