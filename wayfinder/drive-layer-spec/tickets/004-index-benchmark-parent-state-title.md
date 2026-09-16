---
id: 004
title: Index benchmark parent-state-title
label: wayfinder:research
status: closed
assignee: faris
blocked-by: []
---

## Question

Every folder-listing shape in the 2026-09-02 benchmark paid an ~11 ms
`ORDER BY title` filesort (the dominant cost of a path-model page). Rerun
the path-model benchmark with a `(parent, state, title)` covering index on
the node table: folder page at 10k/1k/50 children, and the write cost the
index adds to insert/rename/move. Output: the index set the spec should
freeze for Drive Node. Method and scale: same as the prior run (250k
nodes, 30k grants, zz_bench_ scratch tables on slides.localhost, dropped
after).

## Resolution

Resolved 2026-09-02 by an Opus benchmark subagent. MariaDB 10.11.14, same
data profile as the prior run.

**Freeze `KEY (parent, state, title)` and drop `(parent, state)`** (a
redundant prefix). Do not freeze modified/size sort indexes.

- 10k-child folder page: 11.7 ms -> **0.57 ms median** (id fetch 11.9 ms
  -> 0.16 ms, index-only, 3 pages accessed vs 30,202). The optimizer
  picks the index unaided. Deep pagination (OFFSET 5000): 1.7 ms.
- Cost of the swap: **+5.0 MB per 250k nodes**; insert wall-clock +1.5%
  (inside run noise). `ALTER TABLE ADD KEY` on 250k rows: 298 ms.
- Non-title sorts (`modified DESC`, `size DESC`) still filesort:
  ~11.5 ms at 10k children, 1.2 ms at 1k, 0.24 ms at 48. Accept filesort;
  revisit only if telemetry shows users sorting big folders by date or
  size. If needed later, add `(parent, state, modified)` alone
  (11.5 ms -> 0.16 ms, +11.5 MB, ~+5% insert).
- Subtree move path-rewrite is unaffected by the index (9.1 ms for 1k
  nodes); a 1000-row rename storm that does maintain it: 10.5 ms.

Caveats: no Trashed rows were mixed into folders (selectivity with trash
untested); single connection only. Scratch tables dropped.
