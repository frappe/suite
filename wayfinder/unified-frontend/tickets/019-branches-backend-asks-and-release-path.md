---
id: 019
title: Branches, backend asks and the release path
label: wayfinder:grilling
status: open
assignee:
blocked-by: []
---

## Question

The plan needs three facts only Faris can fix.

- **Where the backend asks go.** The ticket 003, 006 and 012 asks shipped
  on the map branch (`20befde95`, `47311aa11`), not on `forge/drive-layer`.
  The asks from tickets 007, 008, 011 and 014 have not shipped. The Drive
  README says `forge/drive-layer` is "the sole base branch and the sole
  merge target", yet `47311aa11` is composition code, not Drive. Decide:
  file the open asks as Drive issues, and whether to port the shipped ones
  onto `forge/drive-layer`.
- **Branch shape.** The draft plan cuts `forge/unified-frontend` from the
  map branch and merges `upstream/develop` (341 commits behind) in
  Stage 0. Both branches were rebased on develop on 2026-09-17. Decide merge
  or rebase from here on.
- **Release path.** How `forge/unified-frontend` reaches production, its
  order against the Drive Build release, and who runs `bench set-config`
  for each flip on Frappe Cloud sites and what the release note says (map
  fog, ticket 014).

Raised by the plan audit of
[Draft the spec and plan](015-draft-the-spec-and-plan.md).
