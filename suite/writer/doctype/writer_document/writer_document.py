# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from suite import content, drive
from suite.writer.content import APP

# A document with a log keeps these through it, so nothing else writes them
LOGGED_FIELDS = ("content", "html", "ycomments", "collab")


class WriterDocument(drive.DriveContent, Document):
    """The body of one Writer document.

    Drive owns the document's title, place, grants, lifecycle, versions,
    comments, and byte charge; the `DriveContent` mixin supplies `node`,
    `node_title`, `drive_check`, `drive_touch`, and `drive_take_version`, and
    nothing here mirrors a field Drive owns (§10.2). Every write asks Drive for
    EDIT on the node first.

    The editor saves through the document's log, not through this row.
    """

    @frappe.whitelist(methods=["POST"])
    def update_settings(self, data: str):
        self.drive_check(drive.EDIT)
        # settings only; save() would rewrite the logged body
        self.db_set("settings", data)

    def validate(self) -> None:
        """Refuse a generic save that changes a logged field of a logged document."""
        if (
            not self.is_new()
            and any(self.has_value_changed(field) for field in LOGGED_FIELDS)
            and content.find(APP, self.node, for_update=True)
        ):
            raise drive.DriveConflict(frappe._("This document saves as you edit; reload it to keep editing"))

    def apply_fieldlevel_read_permissions(self) -> None:
        """Hide the row's body of a logged document, which may be behind the edits after it."""
        super().apply_fieldlevel_read_permissions()
        if content.find(APP, self.node):
            self.content = None
