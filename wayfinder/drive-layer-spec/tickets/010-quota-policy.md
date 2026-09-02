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
