# 09 — Browse permission-filtered trees and measure indexes

**What to build:** Return readable folder pages and discovery views with measured database behavior.

**Blocked by:** [08 — Manage grants and share links with explicit denial](08-grant-and-link-workflows.md)

**Status:** done

**Owner:** Suite Drive engine

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §2.3, §3.1, §5.3–5.7, §11.4.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Use the three-query folder page on folders and root nodes. Prevent per-child permission queries.
- [x] Implement shared grant roots, archived-root discovery, trash roots, templates, and ancestor-union search.
- [x] Exclude root nodes from general views and document children from ordinary listings. Deduplicate view results where grants overlap.
- [x] Advance cursors by SQL window size, including fully hidden windows. Apply the 60 default and 200 maximum.
- [x] Create Data(500) and the full root/path index on target MariaDB. Validate maximum migrated ids and depth 40.
- [x] Benchmark real projections and representative root, subtree, and trash distributions using existing indexes first.
- [x] Record plans, rows examined, latency, index size, and write costs. Retain an extra root-page index only with evidence.

## Verification

Run view/query-count tests and reproducible MariaDB measurements. Record include/omit rationale; report unmet budgets without inventing benchmark results.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.

Completed 2026-09-06. The isolated implementation started from Suite
`fd295380b39bfc85a2b1c77fa511fb1c4ea6c135`, was reviewed and committed as
`baaa95fa35d01cb6f08b83998bc8f3b5a6e329ca`, then fast-forwarded onto
`forge/drive-layer` at the same revision. The adjacent Frappe revision used
by the verified bench was
`d7948050b321a7f28b546a461554e9b2d14a0a33`.

- Folder and root pages now use one parent-plus-SQL-window query followed by
  one grant query for the parent chain and one for all child ids. Batch role
  resolution reuses the point resolver's nearest-grant, principal-tier,
  explicit-DENY, password-ticket, and expiry semantics without per-child
  queries. Successful pages cost exactly three SQL queries; denied parents
  retain the ticket 08 locked, expired, and unreadable error distinctions.
- Added cursor-paged shared grant roots, archived-root discovery, trash roots,
  templates with `content_doctype` filtering, and title search with one grant
  query over the page's deduplicated ancestor-id union. Permission filtering
  runs after each raw SQL window, so cursors advance across hidden rows. Page
  size defaults to 60 and caps at 200.
- General views exclude root and template nodes as specified. Candidate SQL
  rejects descendants of content documents, and shared results deduplicate
  identity and ancestor overlaps globally before `LIMIT` so overlaps cannot
  consume cursor windows.
- The existing ticket 07 schema was validated in place: `Drive Node.path` is
  `varchar(500)` with `utf8mb4_unicode_ci`; `node_parent_page` is the full
  `(parent, state, title)` index and `node_subtree` is the full `(root, path)`
  index, with every `Sub_part` null. No migration or persistent schema change
  was needed.

Focused verification used:

```text
cd /home/faris/benches/suite-bench && PYTHONPATH=/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-09:/home/faris/benches/suite-bench/apps/frappe bench --site slides.localhost run-tests --module suite.drive.tests.test_views
```

All 20 tests passed: 10 unit and 10 integration tests, with zero failures or
errors. They cover exact query counts on roots and ordinary folders, hidden
windows, DENY/tier resolution, locked and expired parents, shared overlap
across pages, archived-root filtering, trash, templates, search, document
descendants, cursor validation, and the schema/index contract.

Static verification used:

```text
cd /home/faris/benches/suite-bench/apps/.worktrees/suite-drive-09 && python3 -m compileall -q suite/drive/_core/access.py suite/drive/_core/nodes.py suite/drive/tests/test_views.py suite/drive/tests/benchmark_views.py && git diff --check
```

Both checks passed. Ruff was unavailable locally and was not installed, so no
Ruff result is claimed.

The reproducible MariaDB 10.11.14 measurement used only connection-local
temporary tables and ran:

```text
cd /home/faris/benches/suite-bench && PYTHONPATH=/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-09:/home/faris/benches/suite-bench/apps/frappe bench --site slides.localhost execute suite.drive.tests.benchmark_views.run --kwargs '{"rows":250000,"iterations":25}'
```

The corpus contained 250,025 nodes in 25 roots: 148,960 top-level rows,
202,639 Active rows, 47,386 Trashed rows, a depth-40 chain, maximum path
length 430, 100 document nodes, and 1,000 document-media descendants. It also
contained 30,000 unique grants distributed across user, group, `$GENERAL`,
and `$PUBLIC` principals, including sparse allow and DENY rows. End-to-end
temporary corpus creation took 13,802.218 ms (18,114.8 nodes/s).

The two exact three-query hot paths both met the under-2-ms reference budget
at p95 after warmup and 25 repetitions:

- Root page: 1.373 ms median, 1.510 ms p95. The window was 0.731/0.817 ms,
  parent-chain grants 0.153/0.184 ms, and child grants 0.492/0.527 ms.
- Ordinary subtree page: 1.384 ms median, 1.797 ms p95. The window was
  0.741/1.012 ms, parent-chain grants 0.172/0.286 ms, and child grants
  0.480/0.578 ms.

Both window plans used `node_parent_page`, read 60 actual node rows, and
materialized/filesorted only the 61-row parent-plus-page result. Both grant
plans used `grant_node_principal` range access. Root chain/child estimates
were 4/240 rows and actuals were 1/12; subtree estimates were 8/240 and
actuals were 1/4. Median handler-read totals were 490 and 494 respectively.
MariaDB's session `Rows_read` counter remained zero, so the recorded handler
deltas and `ANALYZE FORMAT=JSON` actual rows provide the rows-examined
evidence. One separately captured cold root-window `ANALYZE` took 16.499 ms;
the repeated root-window p95 was 0.843 ms, so the cold sample is retained
rather than hidden.

The deliberately slower real projections were also recorded, without
claiming that the root-page candidate could help them:

- A 100,001-row subtree projection used `node_subtree`, performed 100,002
  handler reads, and measured 172.041/184.052 ms median/p95.
- The trash page scanned the 25,000-row root range and filesorted to 60 rows;
  it measured 39.733/41.676 ms.
- The whole-root byte sum chose a 250,025-row scan and measured
  32.848/34.551 ms.
- Leading-wildcard search scanned 250,025 rows, retained the document-media
  exclusion, and measured 350.915/357.881 ms.

Descriptive write measurements on the same temporary corpus were
0.035/0.143 ms for a one-row rename, 116.209/130.057 ms for a 10,001-row
move, and 136.006/163.823 ms for a 10,001-row trash-state update. These are
end-to-end temporary-table timings, not isolated per-index overhead claims.
The target table was empty during inventory and reported 16,384 data bytes
and 114,688 index bytes; MariaDB did not expose temporary-table size through
`SHOW TABLE STATUS`.

Legacy target inventory found 38 Personal roots with 233 eligible non-root
rows (maximum id length 10, depth 3, target path 23) and one Shared root with
six eligible rows (maximum id length 10, depth 2, target path 12). The
depth-40 ancestor-path capacity is 441 characters, which fits the accepted
500-character column. The inventory anchors pinned `Drive` and
`Users/<email>` roots and excludes root/current ids from target path length.

Index decision: omit `node_root_page`. Both exact folder hot paths pass at
p95 with `node_parent_page`; the slower quota, trash, subtree, and wildcard
search shapes are not served by `(root, parent, state, title)`. No candidate
index was created, so no candidate-overhead comparison is claimed.

The helper created no persistent tables, committed no rows, and changed no
schema. A new connection verified cleanup with:

```text
cd /home/faris/benches/suite-bench && bench --site slides.localhost mariadb --batch --skip-column-names --execute="SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('tabDrive Node Benchmark', 'tabDrive Grant Benchmark');"
```

The result was `0`.

Unresolved gates: HTTP exposure remains ticket 22; recents, favourites,
activity, and notification workflows remain ticket 14; node lifecycle and
archived-root administration remain tickets 11 and 15. No push, pull
request, dependency install, service restart, migration, or persistent
database mutation was performed.
