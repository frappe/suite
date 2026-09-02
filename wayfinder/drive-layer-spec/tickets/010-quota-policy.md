---
id: 010
title: Quota policy
label: wayfinder:grilling
status: open
assignee:
blocked-by: [001]
---

## Question

Decide quota semantics: charge logical size (dedup stays a physical
saving; two owners of the same blob each pay), what counts (Active +
Trashed? Pending reservations?), where usage is stored (per-root counter
vs computed), how enforcement runs in Drive's own upload preflight, and
what happens to quota on ownership transfer. Blocked by Shared spaces and
offboarding model (transfer semantics feed in).

Context from [Shared spaces and offboarding model](001-shared-spaces-and-offboarding-model.md):
quota sits on `Drive Root.quota_bytes`, not on the node owner. Offboarding
archives a root in place and moves no bytes, so two extra things to settle:

- Who is charged for an archived root's bytes.
- Whether archived roots are ever reclaimed, and on what retention clock.

Handed from [Content app contract](005-content-app-contract.md): the live
document body stays in the app doctype (not a blob), while its versions and
comments are Drive-owned. Decide whether the body counts against the root's
quota, and how version blobs are charged.
