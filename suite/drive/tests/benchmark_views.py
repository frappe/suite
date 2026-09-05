"""Reproducible, session-local MariaDB measurements for Drive listing indexes."""

import json
import time

import frappe

from suite.drive._core.access import POINT_SQL
from suite.drive._core.nodes import SEARCH_SQL, TRASH_SQL, _folder_page_query

TEMP_TABLE = "tabDrive Node Benchmark"
TEMP_GRANT_TABLE = "tabDrive Grant Benchmark"
ROOTS = tuple(f"br{index:08d}" for index in range(25))
SUBTREE_PARENT = "bf00000001"
MOVE_PARENT = "bf00000002"
BATCH_SIZE = 5000

INSERT_SQL = f"""
INSERT INTO `{TEMP_TABLE}`
    (`name`, `creation`, `modified`, `owner`, `docstatus`, `idx`, `title`, `parent`,
     `root`, `path`, `kind`, `size`, `state`, `trashed_at`, `trash_root`, `is_template`)
VALUES (%s, %s, %s, %s, 0, 0, %s, %s, %s, %s, %s, %s, %s, %s, %s, 0)
"""


def run(rows: int = 250_000, iterations: int = 25) -> dict:
    """Build one indexed temporary corpus, measure it, and always drop it."""
    if rows != 250_000 or iterations < 5:
        raise ValueError("The accepted Drive benchmark uses 250000 rows and at least 5 iterations")

    frappe.db.sql(f"DROP TEMPORARY TABLE IF EXISTS `{TEMP_TABLE}`")
    frappe.db.sql(f"DROP TEMPORARY TABLE IF EXISTS `{TEMP_GRANT_TABLE}`")
    frappe.db.sql(f"CREATE TEMPORARY TABLE `{TEMP_TABLE}` LIKE `tabDrive Node`")
    frappe.db.sql(f"CREATE TEMPORARY TABLE `{TEMP_GRANT_TABLE}` LIKE `tabDrive Grant`")
    try:
        insert_started = time.perf_counter()
        inserted = _populate(rows)
        grant_rows = _populate_grants()
        insert_ms = (time.perf_counter() - insert_started) * 1000
        frappe.db.sql(f"ANALYZE TABLE `{TEMP_TABLE}`")
        frappe.db.sql(f"ANALYZE TABLE `{TEMP_GRANT_TABLE}`")

        folder_query = _on_temp_table(_folder_page_query())
        trash_query = _on_temp_table(TRASH_SQL)
        search_query = _on_temp_table(SEARCH_SQL)
        grant_query = POINT_SQL.replace("`tabDrive Grant`", f"`{TEMP_GRANT_TABLE}`")
        subtree_query = f"""
SELECT `name`, `root`, `path`, `size`, `state`
FROM `{TEMP_TABLE}`
WHERE `root` = %(root)s AND `path` LIKE %(prefix)s
"""
        root_sum_query = f"""
SELECT COALESCE(SUM(`size`), 0) AS bytes
FROM `{TEMP_TABLE}`
WHERE `root` = %(root)s
"""
        queries = {
            "root_page_union": (
                folder_query,
                {"parent": ROOTS[0], "limit": 60, "offset": 0},
            ),
            "subtree_folder_page_union": (
                folder_query,
                {"parent": SUBTREE_PARENT, "limit": 60, "offset": 0},
            ),
            "subtree_projection": (
                subtree_query,
                {"root": ROOTS[1], "prefix": f"/{SUBTREE_PARENT}/%"},
            ),
            "trash_projection": (
                trash_query,
                {"root": ROOTS[2], "limit": 60, "offset": 0},
            ),
            "root_sum": (root_sum_query, {"root": ROOTS[1]}),
            "search_projection": (
                search_query,
                {
                    "visible_roots": ROOTS,
                    "term": "%needle%",
                    "limit": 60,
                    "offset": 0,
                },
            ),
        }

        measurements = {}
        for label, (query, values) in queries.items():
            measurements[label] = {
                "explain": _explain(query, values),
                **_measure_read(query, values, iterations),
            }

        measurements["root_page_three_queries"] = _measure_folder_page(
            folder_query,
            grant_query,
            ROOTS[0],
            [ROOTS[0]],
            iterations,
        )
        measurements["subtree_folder_page_three_queries"] = _measure_folder_page(
            folder_query,
            grant_query,
            SUBTREE_PARENT,
            [ROOTS[1], SUBTREE_PARENT],
            iterations,
        )

        return {
            "mariadb": frappe.db.sql("SELECT VERSION()", pluck=True)[0],
            "target_inventory": _target_inventory(),
            "corpus": {**_corpus_summary(), "grant_rows": grant_rows},
            "insert": {
                "rows": inserted,
                "elapsed_ms": round(insert_ms, 3),
                "rows_per_second": round(inserted / (insert_ms / 1000), 1),
            },
            "temporary_table_status": _table_status(),
            "indexes": _indexes(),
            "reads": measurements,
            "writes": _measure_writes(iterations),
        }
    finally:
        # Frappe treats every DROP as a possible implicit commit after DML, while
        # MariaDB's DROP TEMPORARY TABLE neither commits nor touches persistent schema.
        frappe.db._cursor.execute(f"DROP TEMPORARY TABLE IF EXISTS `{TEMP_TABLE}`")
        frappe.db._cursor.execute(f"DROP TEMPORARY TABLE IF EXISTS `{TEMP_GRANT_TABLE}`")


def _populate(rows: int) -> int:
    stamp = "2026-09-06 00:00:00"
    root_rows = [
        (
            root,
            stamp,
            stamp,
            "Administrator",
            f"Benchmark root {index:02d}",
            None,
            None,
            "",
            "root",
            0,
            "Active",
            None,
            None,
        )
        for index, root in enumerate(ROOTS)
    ]
    _executemany(root_rows)
    folder_rows = [
        (
            SUBTREE_PARENT,
            stamp,
            stamp,
            "Administrator",
            "Subtree parent",
            ROOTS[1],
            ROOTS[1],
            "",
            "folder",
            0,
            "Active",
            None,
            None,
        ),
        (
            MOVE_PARENT,
            stamp,
            stamp,
            "Administrator",
            "Movable subtree",
            SUBTREE_PARENT,
            ROOTS[1],
            f"/{SUBTREE_PARENT}/",
            "folder",
            0,
            "Active",
            None,
            None,
        ),
    ]
    _executemany(folder_rows)

    deep_start = rows - 2 - 40
    previous_deep_names = []
    batch = []
    for index in range(rows - 2):
        name = f"bn{index:08d}"
        title = f"{'needle ' if index % 389 == 0 else ''}Node {index:08d}"
        kind = "folder"
        trashed_at = None
        trash_root = None

        if index < 10_000:
            root = ROOTS[0]
            parent = root
            path = ""
            state = "Active" if index < 9_000 else "Trashed"
        elif index < 100_000:
            root = ROOTS[1]
            parent = SUBTREE_PARENT
            path = f"/{SUBTREE_PARENT}/"
            state = "Active" if index < 90_000 else "Trashed"
        elif index < 110_000:
            root = ROOTS[1]
            parent = MOVE_PARENT
            path = f"/{SUBTREE_PARENT}/{MOVE_PARENT}/"
            state = "Active"
        elif index < 135_000:
            root = ROOTS[2]
            parent = root
            path = ""
            state = "Trashed"
        elif index >= deep_start:
            root = ROOTS[24]
            parent = previous_deep_names[-1] if previous_deep_names else root
            path = "" if not previous_deep_names else f"/{'/'.join(previous_deep_names)}/"
            state = "Active"
            previous_deep_names.append(name)
        elif index < 136_100:
            relative = index - 135_000
            group = relative // 11
            slot = relative % 11
            document_name = f"bn{135_000 + group * 11:08d}"
            root = ROOTS[3 + group % 22]
            if slot == 0:
                parent = root
                path = ""
                kind = "document"
            else:
                parent = document_name
                path = f"/{document_name}/"
                kind = "file"
            state = "Active"
        else:
            root = ROOTS[3 + (index - 135_000) % 22]
            parent = root
            path = ""
            state = "Trashed" if index % 10 == 0 else "Active"

        if state == "Trashed":
            trashed_at = stamp
            trash_root = name
        batch.append(
            (
                name,
                stamp,
                stamp,
                "Administrator",
                title,
                parent,
                root,
                path,
                kind,
                index % 4096,
                state,
                trashed_at,
                trash_root,
            )
        )
        if len(batch) == BATCH_SIZE:
            _executemany(batch)
            batch.clear()
    if batch:
        _executemany(batch)
    return len(ROOTS) + rows


def _populate_grants() -> int:
    stamp = "2026-09-06 00:00:00"
    rows = []
    seen = set()

    def add(name: str, node: str, principal: str, role: int) -> None:
        key = (node, principal)
        if key in seen:
            return
        seen.add(key)
        rows.append((name, stamp, stamp, "Administrator", node, principal, role))

    for index, root in enumerate(ROOTS):
        add(f"bgroot{index:04d}", root, "benchmark@example.com", 10)

    # Sparse direct and group grants in the measured windows exercise DENY and
    # direct-over-group precedence without making every child grant-heavy.
    for index in range(0, 120, 9):
        add(
            f"bgtarget{index:04d}",
            f"bn{index:08d}",
            "benchmark@example.com",
            0 if index % 18 == 0 else 10,
        )
    for index in range(4, 120, 13):
        add(f"bggroup{index:04d}", f"bn{index:08d}", "$GROUP:benchmark", 10)

    principals = (
        "$GENERAL",
        "$PUBLIC",
        "$GROUP:benchmark",
        "$GROUP:design",
        "reader@example.com",
        "writer@example.com",
        "external@example.com",
    )
    candidate = 0
    while len(rows) < 30_000:
        node_index = (candidate * 7919 + 137) % 249_958
        principal = principals[candidate % len(principals)]
        add(
            f"bgnoise{candidate:07d}",
            f"bn{node_index:08d}",
            principal,
            0 if candidate % 97 == 0 else (10 if candidate % 5 else 20),
        )
        candidate += 1
    query = f"""
INSERT INTO `{TEMP_GRANT_TABLE}`
    (`name`, `creation`, `modified`, `owner`, `docstatus`, `idx`, `node`, `principal`, `role`)
VALUES (%s, %s, %s, %s, 0, 0, %s, %s, %s)
"""
    frappe.db._cursor.executemany(query, rows)
    return len(rows)


def _executemany(rows: list[tuple]) -> None:
    frappe.db._cursor.executemany(INSERT_SQL, rows)


def _on_temp_table(query: str) -> str:
    return query.replace("`tabDrive Node`", f"`{TEMP_TABLE}`")


HANDLER_STATUS = (
    "Rows_read",
    "Handler_read_key",
    "Handler_read_next",
    "Handler_read_rnd",
    "Handler_read_rnd_next",
)


def _handler_status() -> dict[str, int]:
    names = ",".join(f"'{name}'" for name in HANDLER_STATUS)
    return {
        row[0]: int(row[1])
        for row in frappe.db.sql(f"SHOW SESSION STATUS WHERE Variable_name IN ({names})")
    }


def _measure_read(query: str, values: dict, iterations: int) -> dict:
    frappe.db.sql(query, values)
    latencies = []
    handler_reads = []
    result_rows = 0
    handler_deltas = []
    for _iteration in range(iterations):
        before = _handler_status()
        started = time.perf_counter()
        result = frappe.db.sql(query, values)
        latencies.append((time.perf_counter() - started) * 1000)
        after = _handler_status()
        delta = {name: after.get(name, 0) - before.get(name, 0) for name in HANDLER_STATUS}
        handler_deltas.append(delta)
        handler_reads.append(sum(value for name, value in delta.items() if name != "Rows_read"))
        result_rows = len(result)
    return {
        "result_rows": result_rows,
        "latency_ms_median": round(_percentile(latencies, 0.5), 3),
        "latency_ms_p95": round(_percentile(latencies, 0.95), 3),
        "handler_reads_median": int(_percentile(handler_reads, 0.5)),
        "handler_reads_p95": int(_percentile(handler_reads, 0.95)),
        "server_rows_read_median": int(
            _percentile([delta["Rows_read"] for delta in handler_deltas], 0.5)
        ),
        "handler_deltas_median": {
            name: int(_percentile([delta[name] for delta in handler_deltas], 0.5))
            for name in HANDLER_STATUS
        },
    }


def _measure_folder_page(
    folder_query: str,
    grant_query: str,
    parent: str,
    chain: list[str],
    iterations: int,
) -> dict:
    folder_values = {"parent": parent, "limit": 60, "offset": 0}
    principals = ("benchmark@example.com", "$GROUP:benchmark", "$GENERAL", "$PUBLIC")
    grant_base = {"principals": principals, "now": "2026-09-06 00:00:01"}

    sample_window = frappe.db.sql(folder_query, folder_values)
    child_ids = tuple(row[2] for row in sample_window if row[0] == 1) or ("__none__",)
    chain_values = {**grant_base, "chain": tuple(chain)}
    child_values = {**grant_base, "chain": child_ids}
    frappe.db.sql(grant_query, chain_values)
    frappe.db.sql(grant_query, child_values)

    latencies = []
    individual_latencies = {"window": [], "chain_grants": [], "child_grants": []}
    handler_reads = []
    server_rows_read = []
    handler_deltas = []
    result_counts = None
    for _iteration in range(iterations):
        before = _handler_status()
        started = time.perf_counter()
        window = frappe.db.sql(folder_query, folder_values)
        after_window = time.perf_counter()
        chain_rows = frappe.db.sql(grant_query, chain_values)
        after_chain = time.perf_counter()
        child_rows = frappe.db.sql(grant_query, child_values)
        finished = time.perf_counter()
        latencies.append((finished - started) * 1000)
        individual_latencies["window"].append((after_window - started) * 1000)
        individual_latencies["chain_grants"].append((after_chain - after_window) * 1000)
        individual_latencies["child_grants"].append((finished - after_chain) * 1000)
        after = _handler_status()
        delta = {name: after.get(name, 0) - before.get(name, 0) for name in HANDLER_STATUS}
        handler_deltas.append(delta)
        handler_reads.append(sum(value for name, value in delta.items() if name != "Rows_read"))
        server_rows_read.append(delta["Rows_read"])
        result_counts = {
            "window": len(window),
            "chain_grants": len(chain_rows),
            "child_grants": len(child_rows),
        }

    return {
        "plans": {
            "window": _explain(folder_query, folder_values),
            "chain_grants": _explain(grant_query, chain_values),
            "child_grants": _explain(grant_query, child_values),
        },
        "result_rows": result_counts,
        "latency_ms_median": round(_percentile(latencies, 0.5), 3),
        "latency_ms_p95": round(_percentile(latencies, 0.95), 3),
        "individual_latency_ms": {
            label: {
                "median": round(_percentile(values, 0.5), 3),
                "p95": round(_percentile(values, 0.95), 3),
            }
            for label, values in individual_latencies.items()
        },
        "handler_reads_median": int(_percentile(handler_reads, 0.5)),
        "handler_reads_p95": int(_percentile(handler_reads, 0.95)),
        "server_rows_read_median": int(_percentile(server_rows_read, 0.5)),
        "handler_deltas_median": {
            name: int(_percentile([delta[name] for delta in handler_deltas], 0.5))
            for name in HANDLER_STATUS
        },
    }


def _explain(query: str, values: dict) -> dict:
    raw = frappe.db.sql(f"EXPLAIN FORMAT=JSON {query}", values)[0][0]
    plan = json.loads(raw)
    analyzed_raw = frappe.db.sql(f"ANALYZE FORMAT=JSON {query}", values)[0][0]
    analyzed = json.loads(analyzed_raw)
    return {
        "tables": _plan_tables(plan),
        "analyzed_tables": _plan_tables(analyzed),
        "analyzed_total_ms": analyzed.get("query_block", {}).get("r_total_time_ms"),
        "features": sorted(_plan_features(analyzed)),
    }


def _plan_tables(value) -> list[dict]:
    tables = []
    if isinstance(value, dict):
        if "table_name" in value:
            tables.append(
                {
                    key: value.get(key)
                    for key in (
                        "table_name",
                        "access_type",
                        "possible_keys",
                        "key",
                        "rows",
                        "r_rows",
                        "r_loops",
                        "r_table_time_ms",
                        "filtered",
                    )
                    if key in value
                }
            )
        for nested in value.values():
            tables.extend(_plan_tables(nested))
    elif isinstance(value, list):
        for nested in value:
            tables.extend(_plan_tables(nested))
    return tables


def _plan_features(value) -> set[str]:
    features = set()
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in {"filesort", "materialized", "temporary_table"}:
                features.add(key)
            features.update(_plan_features(nested))
    elif isinstance(value, list):
        for nested in value:
            features.update(_plan_features(nested))
    return features


def _percentile(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int((len(ordered) - 1) * percentile + 0.5)))
    return ordered[index]


def _corpus_summary() -> dict:
    row = frappe.db.sql(
        f"""
SELECT COUNT(*) AS nodes,
       COUNT(DISTINCT COALESCE(`root`, `name`)) AS roots,
       SUM(`kind` = 'root') AS root_nodes,
       SUM(`parent` = `root`) AS top_level,
       SUM(`state` = 'Active') AS active_nodes,
       SUM(`state` = 'Trashed') AS trashed_nodes,
       MAX(CASE WHEN `path` = '' THEN 1
                ELSE LENGTH(`path`) - LENGTH(REPLACE(`path`, '/', '')) END) AS max_depth,
       MAX(CHAR_LENGTH(`path`)) AS max_path_chars
FROM `{TEMP_TABLE}`
""",
        as_dict=True,
    )[0]
    return dict(row)


def _target_inventory() -> dict:
    path_column = frappe.db.sql(
        "SHOW FULL COLUMNS FROM `tabDrive Node` LIKE 'path'", as_dict=True
    )[0]
    indexes = frappe.db.sql(
        """
SELECT INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, SUB_PART
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'tabDrive Node'
  AND INDEX_NAME IN ('node_parent_page', 'node_subtree', 'node_root_page')
ORDER BY INDEX_NAME, SEQ_IN_INDEX
""",
        as_dict=True,
    )
    table = frappe.db.sql(
        """
SELECT TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tabDrive Node'
""",
        as_dict=True,
    )[0]
    legacy = frappe.db.sql(
        """
WITH RECURSIVE roots AS (
    SELECT name AS root_id, 'Shared' AS root_kind
    FROM `tabFile`
    WHERE name = 'Drive' AND is_folder = 1
    UNION ALL
    SELECT name, 'Personal'
    FROM `tabFile`
    WHERE folder = 'Users' AND is_folder = 1
), eligible AS (
    SELECT root_id, root_kind, root_id AS name, 0 AS depth,
           CAST(0 AS UNSIGNED) AS target_path_chars
    FROM roots
    UNION ALL
    SELECT e.root_id, e.root_kind, f.name, e.depth + 1,
           e.target_path_chars
               + CASE WHEN e.depth = 0 THEN 0
                      ELSE CHAR_LENGTH(e.name) + 1 + (e.depth = 1) END
    FROM `tabFile` f
    JOIN eligible e ON f.folder = e.name
    WHERE e.depth < 100
)
SELECT COALESCE(root_kind, 'All') AS root_kind,
       COUNT(DISTINCT root_id) AS roots,
       SUM(depth > 0) AS eligible_nonroot_rows,
       MAX(CASE WHEN depth > 0 THEN CHAR_LENGTH(name) END) AS max_nonroot_id_chars,
       MAX(CASE WHEN depth > 0 THEN depth END) AS max_source_depth,
       MAX(CASE WHEN depth > 0 THEN target_path_chars END) AS max_target_path_chars,
       40 * (MAX(CASE WHEN depth > 0 THEN CHAR_LENGTH(name) END) + 1) + 1
           AS depth_40_ancestor_path_capacity_chars
FROM eligible
GROUP BY root_kind WITH ROLLUP
""",
        as_dict=True,
    )
    return {
        "path_column": {
            "type": path_column.Type,
            "collation": path_column.Collation,
            "nullable": path_column.Null,
        },
        "listing_indexes": [
            {
                "name": row.INDEX_NAME,
                "sequence": row.SEQ_IN_INDEX,
                "column": row.COLUMN_NAME,
                "sub_part": row.SUB_PART,
            }
            for row in indexes
        ],
        "table": {
            "rows_estimate": table.TABLE_ROWS,
            "data_bytes": table.DATA_LENGTH,
            "index_bytes": table.INDEX_LENGTH,
        },
        "eligible_legacy": [dict(row) for row in legacy],
    }


def _table_status() -> dict | None:
    rows = frappe.db.sql("SHOW TABLE STATUS LIKE %s", (TEMP_TABLE,), as_dict=True)
    if not rows:
        return None
    row = rows[0]
    return {
        "rows_estimate": row.Rows,
        "data_bytes": row.Data_length,
        "index_bytes": row.Index_length,
    }


def _indexes() -> list[dict]:
    return [
        {
            "name": row.Key_name,
            "sequence": row.Seq_in_index,
            "column": row.Column_name,
            "sub_part": row.Sub_part,
        }
        for row in frappe.db.sql(f"SHOW INDEX FROM `{TEMP_TABLE}`", as_dict=True)
    ]


def _measure_writes(iterations: int) -> dict:
    rename = _measure_updates(
        f"UPDATE `{TEMP_TABLE}` SET `title` = %s WHERE `name` = %s",
        [
            (f"Renamed {iteration % 2}", "bn00000000")
            for iteration in range(iterations)
        ],
    )

    move_values = []
    in_root_one = True
    for _iteration in range(6):
        if in_root_one:
            move_values.append(
                (
                    ROOTS[3],
                    ROOTS[3],
                    f"/{MOVE_PARENT}/",
                    f"/{MOVE_PARENT}/",
                    len(f"/{SUBTREE_PARENT}/{MOVE_PARENT}/") + 1,
                    MOVE_PARENT,
                    ROOTS[1],
                    f"/{SUBTREE_PARENT}/{MOVE_PARENT}/%",
                )
            )
        else:
            move_values.append(
                (
                    ROOTS[1],
                    SUBTREE_PARENT,
                    f"/{SUBTREE_PARENT}/{MOVE_PARENT}/",
                    f"/{SUBTREE_PARENT}/{MOVE_PARENT}/",
                    len(f"/{MOVE_PARENT}/") + 1,
                    MOVE_PARENT,
                    ROOTS[3],
                    f"/{MOVE_PARENT}/%",
                )
            )
        in_root_one = not in_root_one
    move = _measure_updates(
        f"""
UPDATE `{TEMP_TABLE}`
SET `root` = %s,
    `parent` = CASE WHEN `name` = '{MOVE_PARENT}' THEN %s ELSE `parent` END,
    `path` = CASE WHEN `name` = '{MOVE_PARENT}' THEN
        CASE WHEN %s = '/{MOVE_PARENT}/' THEN '' ELSE '/{SUBTREE_PARENT}/' END
        ELSE CONCAT(%s, SUBSTRING(`path`, %s)) END
WHERE `name` = %s OR (`root` = %s AND `path` LIKE %s)
""",
        move_values,
    )

    trash_values = []
    for iteration in range(6):
        trashed = iteration % 2 == 0
        trash_values.append(
            (
                "Trashed" if trashed else "Active",
                "2026-09-06 00:00:00" if trashed else None,
                MOVE_PARENT if trashed else None,
                MOVE_PARENT,
                ROOTS[1],
                f"/{SUBTREE_PARENT}/{MOVE_PARENT}/%",
            )
        )
    trash = _measure_updates(
        f"""
UPDATE `{TEMP_TABLE}`
SET `state` = %s, `trashed_at` = %s, `trash_root` = %s
WHERE `name` = %s OR (`root` = %s AND `path` LIKE %s)
""",
        trash_values,
    )
    return {"rename_one": rename, "move_10001": move, "trash_state_10001": trash}


def _measure_updates(query: str, values: list[tuple]) -> dict:
    latencies = []
    affected = []
    for params in values:
        started = time.perf_counter()
        frappe.db.sql(query, params)
        latencies.append((time.perf_counter() - started) * 1000)
        affected.append(frappe.db._cursor.rowcount)
    return {
        "runs": len(values),
        "affected_rows": affected,
        "latency_ms_median": round(_percentile(latencies, 0.5), 3),
        "latency_ms_p95": round(_percentile(latencies, 0.95), 3),
    }
