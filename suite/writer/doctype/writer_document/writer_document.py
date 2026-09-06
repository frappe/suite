# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from suite import drive

COLLISION_ERRORS = (
    frappe.exceptions.QueryDeadlockError,
    frappe.exceptions.TimestampMismatchError,
)


class WriterDocument(drive.DriveContent, Document):
    """The body of one Writer document. Drive owns everything around it.

    The `DriveContent` mixin supplies `node`, `node_title`, `drive_check`,
    `drive_touch`, and `drive_take_version`, and refuses a document with no
    node. Title, place, grants, lifecycle, versions, comments, and the byte
    charge all live on the node; nothing here mirrors them (§10.2).

    Collaboration is unchanged. The editor still syncs peer to peer over
    WebRTC and posts the merged body here; every method that writes the body
    asks Drive for EDIT at the node first.
    """

    def on_trash(self):
        # Legacy history. `Writer Version` rows link back here, so the
        # framework's link check would refuse the delete before anything
        # cleaned them up. The rows stay readable until Build copies them into
        # `Drive Node Version` and Cleanup removes the doctype (§14.6).
        frappe.db.delete("Writer Version", {"doc": self.name})

    @frappe.whitelist(methods=["POST"])
    def save_doc(self, data: str, html: str | None = None):
        """Store the merged collaborative body, then stamp the node."""
        self.drive_check(drive.EDIT)
        try:
            values = {"content": data}
            if html is not None:
                values["html"] = html
            frappe.db.set_value("Writer Document", self.name, values, update_modified=False)
            self.drive_touch()
        except COLLISION_ERRORS:
            pass

    @frappe.whitelist(methods=["POST"])
    def take_version(self, label: str | None = None):
        """Store the saved body as one immutable Drive version.

        Drive reads the body itself, so the caller saves first and passes no
        bytes. This replaces `new_version` and its private `Writer Version`
        table; the ten-minute automatic throttle it carried is now Drive's
        retention ladder (§9.1).
        """
        return self.drive_take_version(kind="named" if label else "auto", label=label)

    @frappe.whitelist(methods=["POST"])
    def update_settings(self, data: str):
        self.drive_check(drive.EDIT)
        self.settings = data
        self.save()

    @frappe.whitelist(methods=["POST"])
    def save_html(self, html: str):
        """Store the rendered body of a non-collaborative document."""
        self.drive_check(drive.EDIT)
        frappe.db.set_value("Writer Document", self.name, "html", html, update_modified=False)
        self.drive_touch()

    def as_dict(self, *args, **kwargs):
        result = super().as_dict(*args, **kwargs)
        result.pop("versions", None)
        return result
