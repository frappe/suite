"""What a folder holds, read for a listing page at once."""

from collections.abc import Iterable, Mapping

import frappe

from suite.drive._core.nodes import child_path

# One range of the `node_subtree` index for each folder: every node under it.
FOLDER_SIZE_SQL = """
SELECT %(folder_{index})s AS folder, COALESCE(SUM(size), 0) AS size
FROM `tabDrive Node`
WHERE root = %(root_{index})s
  AND path LIKE %(prefix_{index})s
  AND kind = 'file'
  AND state = 'Active'
"""


def contents_sizes(rows: Iterable[Mapping]) -> dict[str, int]:
    """Answer the total size of the files in each folder among `rows`, at every depth.

    Trashed files are left out. The rows are ones the caller has already read,
    so the totals are only for folders the caller can read. A page costs one
    query whatever its size; a page with no folder costs none.
    """
    folders = [row for row in rows if row["kind"] == "folder"]
    if not folders:
        return {}
    parts = []
    values = {}
    for index, folder in enumerate(folders):
        parts.append(FOLDER_SIZE_SQL.format(index=index))
        values[f"folder_{index}"] = folder["name"]
        values[f"root_{index}"] = folder["root"]
        values[f"prefix_{index}"] = f"{child_path(folder)}%"
    found = frappe.db.sql("\nUNION ALL\n".join(parts), values, as_dict=True)
    return {row.folder: int(row.size) for row in found}
