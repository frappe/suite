import json

import frappe
from frappe.model.document import Document

from suite import drive
from suite.drive.overrides.file import File as DriveFile
from suite.sheets.doctype.sheet.storage import (
    MAX_SHEETS_DATA_BYTES,
    decode_sheets_data,
    effective_size,
)

# Defence in depth — anything that bypasses the whitelisted API (Desk form,
# fixture import, future scripted insert) still gets these checks. The cap
# applies to the *uncompressed* workbook bytes; storage.py handles the
# envelope detection so we accept both compressed and legacy plain values.
MAX_TITLE_LEN = 280


class Sheet(drive.DriveContent, Document):
    """One spreadsheet, on either side of Drive adoption.

    A row that carries a `node` is Drive-native. Drive owns its title, place,
    grants, lifecycle, versions, comments, and byte charge; the `DriveContent`
    mixin supplies `node`, `node_title`, `drive_check`, `drive_touch`, and
    `drive_take_version` (§10.2). Sheets keeps the body.

    A row with no node is a legacy row Build has not linked yet (§14.6). It
    keeps what it has always had: the backing `File`, the mirrored title, and
    the `trashed` flag. Ticket 34 moves the client and ticket 29 activates the
    registry; until both, the two shapes live side by side.

    The split only ever runs one way. A linked row never falls back to the
    `File`, because that would be a way around `Drive Grant` (§1).
    """

    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        node: DF.Link | None
        sheets_data: DF.JSON | None
        title: DF.Data | None
    # end: auto-generated types

    @property
    def drive_native(self) -> bool:
        """True when Drive owns this row, false for a legacy row with no node."""
        return bool(self.get(self.drive_node_field))

    def validate(self):
        if not self.drive_native:
            title = (self.title or "").strip()
            if not title:
                frappe.throw("Title is required")
            self.title = title[:MAX_TITLE_LEN]
        # A linked sheet is left alone here. Drive owns its title on the node
        # with no mirror in either direction (§10.2), and the mixin's
        # `refuse_legacy_field_write` refuses every write to the column. What
        # Build wrote there stays readable for the §14.11 rollback until
        # Cleanup drops the column, so this must not clear it either.

        if self.sheets_data:
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

    def after_insert(self):
        # Back every sheet with a Drive File so it shows up in — and opens
        # from — Drive, exactly like Writer/Slides docs. The Drive File is a
        # thin pointer (content_doctype/content_docname); the workbook itself
        # stays in this doctype.
        #
        # A linked sheet already has a `Drive Node`, which is what Drive reads.
        # A second backing row would be a second answer to "who may open this",
        # and the legacy one answers from `DocShare` (§1).
        if self.drive_native:
            return
        self.create_drive_file()

    def on_update(self):
        if not self.drive_native or self.flags.in_insert:
            # `create_document` stamps the new node itself. Touching here would
            # only add the row to the mixin's per-request debounce set, and the
            # first real save of the same request would then be swallowed.
            return
        # The body changed, so the node's `content_modified` moves with it
        # (§8.11). It is the sheet's only stamp and the daily media sweep's
        # cursor. Debounced to one write per request by the mixin.
        self.drive_touch()

    def create_drive_file(self, parent: str | None = None):
        return DriveFile.create_for_doc(
            self,
            parent=parent or self.flags.get("drive_parent"),
            mime_type="frappe/sheet",
            file_type="Spreadsheet",
        )
