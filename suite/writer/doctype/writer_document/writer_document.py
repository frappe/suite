# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from suite import drive
from suite.suite_core import content
from suite.writer.content import ADAPTER

COLLISION_ERRORS = (
    frappe.exceptions.QueryDeadlockError,
    frappe.exceptions.TimestampMismatchError,
)


class WriterDocument(drive.DriveContent, Document):
    """The body of one Writer document.

    Drive owns the document's title, place, grants, lifecycle, versions,
    comments, and byte charge; the `DriveContent` mixin supplies `node`,
    `node_title`, `drive_check`, `drive_touch`, and `drive_take_version`, and
    nothing here mirrors a field Drive owns (§10.2). Every write asks Drive for
    EDIT on the node first.

    Collaboration is the editor's: it syncs peer to peer over WebRTC and posts
    the merged body here.

    The editor's saves admit Guest: a share link's holder has no session, and
    `drive_check` answers for the link the request carries (§4.6).
    """

    @frappe.whitelist(methods=["POST"], allow_guest=True)
    def save_doc(self, data: str, html: str | None = None):
        """Store the merged collaborative body."""
        self.drive_check(drive.EDIT)
        self.refuse_logged()
        values = {"content": data}
        if html is not None:
            values["html"] = html
        try:
            frappe.db.set_value("Writer Document", self.name, values, update_modified=False)
            self.drive_touch()
        except COLLISION_ERRORS:
            pass

    @frappe.whitelist(methods=["POST"])
    def take_version(self, label: str | None = None):
        """Store the saved body as one immutable Drive version.

        Drive reads the body itself, so the caller saves first and passes no
        bytes. An automatic version's retention is Drive's ladder (§9.1).
        """
        return self.drive_take_version(kind="named" if label else "auto", label=label)

    @frappe.whitelist(methods=["POST"])
    def update_settings(self, data: str):
        self.drive_check(drive.EDIT)
        self.db_set("settings", data)

    @frappe.whitelist(methods=["POST"], allow_guest=True)
    def save_html(self, html: str):
        """Store the rendered body of a non-collaborative document."""
        self.drive_check(drive.EDIT)
        self.refuse_logged()
        frappe.db.set_value("Writer Document", self.name, "html", html, update_modified=False)
        self.drive_touch()

    def validate(self):
        if not self.is_new() and (self.has_value_changed("content") or self.has_value_changed("html")):
            self.refuse_logged()

    def apply_fieldlevel_read_permissions(self):
        """A document with a log is read through it; its row's body may be behind the edits after it."""
        super().apply_fieldlevel_read_permissions()
        if content.find(ADAPTER, self.node):
            self.content = None

    def refuse_logged(self):
        """A document with a log saves through it, so an old tab cannot write an older body over the row."""
        if content.find(ADAPTER, self.node):
            raise drive.DriveConflict(frappe._("This document saves as you edit; reload it to keep editing"))
