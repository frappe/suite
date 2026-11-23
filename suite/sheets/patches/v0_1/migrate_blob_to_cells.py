"""Backfill v1 single-blob `Sheet.sheets_data` into v2 per-cell rows.

Runs once on `bench migrate` after this app updates. Idempotent — if a doc
has already been migrated (i.e. it already has Sheet Cell rows OR its blob is
empty), it's skipped. The legacy `sheets_data` blob is preserved on the
parent doc as a rollback artifact; cut-over code in the v2 API reads from
the new cells, not the blob.
"""

import json

import frappe


def execute():
    sheet_names = frappe.get_all("Sheet", pluck="name")
    if not sheet_names:
        return

    migrated = 0
    skipped = 0
    for name in sheet_names:
        try:
            if _migrate_one(name):
                migrated += 1
            else:
                skipped += 1
        except Exception:
            frappe.log_error(
                title=f"Sheet v2 migration failed for {name}",
                message=frappe.get_traceback(),
            )
    frappe.db.commit()
    print(f"sheets: migrated {migrated} workbook(s); skipped {skipped}.")


def _migrate_one(name: str) -> bool:
    """Returns True if the doc was migrated; False if already migrated / empty."""
    # Skip if any Sheet Cell rows already exist for this parent.
    if frappe.db.exists("Sheet Cell", {"parent_sheet": name}):
        return False

    doc = frappe.get_doc("Sheet", name)
    blob = (doc.sheets_data or "").strip()
    if not blob or blob == "{}":
        # Nothing to migrate; just initialize view + revision.
        doc.view_json = doc.view_json or "{}"
        doc.db_set("revision_id", 0, update_modified=False)
        return False

    try:
        parsed = json.loads(blob)
    except (ValueError, TypeError):
        # Malformed blob — leave it alone so a developer can inspect.
        return False

    sheets = (parsed.get("sheet") or {}).get("sheets", {}) or {}
    formats = parsed.get("formats") or {}
    merge = parsed.get("merge") or None
    view = parsed.get("view") or {}
    current = (parsed.get("sheet") or {}).get("current", "Sheet1")

    # Each Sheet Cell row corresponds to one populated cell. Empty cells are
    # not stored — same as the old blob.
    rows = []
    for sheet_name, cells in sheets.items():
        for cell_id, raw in cells.items():
            if raw is None or raw == "":
                continue
            fmt = ((formats.get(sheet_name) or {}).get(cell_id)) or None
            rows.append(
                (
                    frappe.generate_hash(length=10),
                    name,
                    sheet_name,
                    cell_id,
                    str(raw),
                    json.dumps(fmt) if fmt else None,
                )
            )

    if rows:
        frappe.db.bulk_insert(
            "Sheet Cell",
            fields=["name", "parent_sheet", "sheet_name", "cell_id", "raw_value", "format_json"],
            values=rows,
        )

    # Stash workbook-level state on the parent. `view_json` carries everything
    # the v2 reader needs to reconstitute the workbook beyond raw cells:
    # - sheet order
    # - which sheet was current
    # - col widths / row heights / freeze / hidden / merge / zoom from grid
    combined_view = {
        "sheet_order": list(sheets.keys()),
        "current": current,
        "merge": merge,
        "grid": view,
    }
    doc.view_json = json.dumps(combined_view)
    doc.db_set("revision_id", 1, update_modified=False)
    doc.save(ignore_permissions=True)
    return True
