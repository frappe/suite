import json

import frappe
from frappe.model.document import Document

from suite import drive
from suite.sheets.doctype.sheet.storage import (
    MAX_SHEETS_DATA_BYTES,
    decode_sheets_data,
    effective_size,
)


class Sheet(drive.DriveContent, Document):
    """One spreadsheet, bound to the Drive node that owns it.

    Drive owns the title, place, grants, lifecycle, versions, comments, and
    byte charge; the `DriveContent` mixin supplies `node`, `node_title`,
    `drive_check`, `drive_touch`, and `drive_take_version` (§10.2). Sheets
    keeps the body.
    """

    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        head_seq: DF.Int
        node: DF.Link | None
        sheets_data: DF.JSON | None
    # end: auto-generated types

    def validate(self):
        # Defence in depth: anything that bypasses the whitelisted API (Desk
        # form, fixture import, scripted insert) still gets these checks. The
        # cap applies to the uncompressed workbook bytes; storage.py detects
        # the envelope so both compressed and plain values are accepted.
        if not self.sheets_data:
            return
        if not isinstance(self.sheets_data, str):
            frappe.throw("sheets_data must be a string")
        size = effective_size(self.sheets_data)
        if size > MAX_SHEETS_DATA_BYTES:
            limit_mb = MAX_SHEETS_DATA_BYTES // (1024 * 1024)
            size_mb = size / (1024 * 1024)
            frappe.throw(
                f"This spreadsheet is {size_mb:.1f} MB, over the {limit_mb} MB limit. "
                f"Remove some data or split it across multiple spreadsheets."
            )
        try:
            json.loads(decode_sheets_data(self.sheets_data))
        except (ValueError, TypeError):
            frappe.throw("sheets_data is not valid JSON")

    def on_update(self):
        if self.flags.in_insert:
            # `create_document` stamps the new node itself. Touching here would
            # only add the row to the mixin's per-request debounce set, and the
            # first real save of the same request would then be swallowed.
            return
        # The body changed, so the node's `content_modified` moves with it
        # (§8.11). It is the sheet's only stamp and the daily media sweep's
        # cursor. Debounced to one write per request by the mixin.
        self.drive_touch()
