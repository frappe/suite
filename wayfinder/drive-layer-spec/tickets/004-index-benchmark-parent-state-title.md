---
id: 004
title: Index benchmark parent-state-title
label: wayfinder:research
status: open
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
