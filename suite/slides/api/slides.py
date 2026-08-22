import frappe
from frappe import _
from frappe.model import default_fields, no_value_fields
from frappe.utils import cstr


@frappe.whitelist()
def save_slides(name: str, slides: list[dict] | str, base_modified: str) -> dict:
    """Replace a presentation's slides with the editor's list.

    Rows are matched by `client_id`, the identity the editor owns, so a slide it
    created keeps one row across autosaves instead of being re-inserted each time.
    `base_modified` is the version the editor built on: anything older than the
    server's is a stale snapshot that would wipe another editor's rows, so it is
    refused rather than merged.
    """
    doc = frappe.get_doc("Presentation", name)
    doc.check_permission("write")
    if doc.is_composite:
        frappe.throw(_("Composite presentations have no slides of their own"))
    if cstr(doc.modified) != cstr(base_modified):
        frappe.throw(
            _("This presentation was changed elsewhere. Reload to get the latest version."),
            frappe.TimestampMismatchError,
        )

    slides = frappe.parse_json(slides) if isinstance(slides, str) else slides
    doc.set("slides", merge_rows(doc.slides, slides))
    doc.save()
    return {"modified": doc.modified}


def merge_rows(existing_rows, incoming):
    """Existing rows keep their name when the editor still lists their client_id;
    everything else is a new row. A client_id listed twice keeps one row and
    inserts another, so a stray duplicate never collapses two slides into one."""
    by_client_id = {row.client_id: row for row in existing_rows if row.client_id}
    fields = slide_value_fields()
    rows = []
    for idx, slide in enumerate(incoming, start=1):
        values = {field: slide.get(field) for field in fields if field in slide}
        row = by_client_id.pop(values.get("client_id"), None)
        if row:
            row.update(values)
        else:
            row = frappe.new_doc("Slide").update(values)
        row.idx = idx
        rows.append(row)
    return rows


def slide_value_fields() -> set[str]:
    """Fields the editor may set; name, parent, idx and timestamps stay framework-owned."""
    meta = frappe.get_meta("Slide")
    return {
        df.fieldname
        for df in meta.fields
        if df.fieldtype not in no_value_fields and df.fieldname not in default_fields
    }
