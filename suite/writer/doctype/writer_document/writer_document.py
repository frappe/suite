# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import base64
from datetime import datetime, timedelta

import frappe
import pycrdt
from frappe import _
from frappe.model.document import Document

from suite import drive
from suite.drive.api.notifications import create_notification, get_link

COLLISION_ERRORS = (
    frappe.exceptions.QueryDeadlockError,
    frappe.exceptions.TimestampMismatchError,
)

AUTOVERSION_DURATION = 10


class WriterDocument(drive.DriveContent, Document):
    """The body of one Writer document, on either side of Drive adoption.

    A row that carries a `node` is Drive-native. Drive owns its title, place,
    grants, lifecycle, versions, comments, and byte charge; the `DriveContent`
    mixin supplies `node`, `node_title`, `drive_check`, `drive_touch`, and
    `drive_take_version`, and nothing here mirrors a field Drive owns (§10.2).

    A row with no node is a legacy row Build has not linked yet (§14.6). It
    keeps the behaviour it has always had: the `File` permission check, the
    mirrored `File` title and size, the private `Writer Version` history, and
    the comment blob. Ticket 23 moves the legacy read path and ticket 29
    activates the registry; until both, the two shapes live side by side.

    The split is explicit at every method, and it only ever runs one way: a
    linked row never falls back to the `File`, because that would be a way
    around `Drive Grant`.

    Collaboration is unchanged on both sides. The editor still syncs peer to
    peer over WebRTC and posts the merged body here.
    """

    @property
    def drive_native(self) -> bool:
        """True when Drive owns this row, false for a legacy row with no node."""
        return bool(self.get(self.drive_node_field))

    def on_trash(self):
        # Legacy history. `Writer Version` rows link back here, so the
        # framework's link check would refuse the delete before anything
        # cleaned them up. The rows stay readable until Build copies them into
        # `Drive Node Version` and Cleanup removes the doctype (§14.6).
        frappe.db.delete("Writer Version", {"doc": self.name})

    @frappe.whitelist(methods=["POST"])
    def save_doc(self, data: str, html: str | None = None):
        """Store the merged collaborative body."""
        self._authorize_write()
        try:
            if self.drive_native:
                values = {"content": data}
                if html is not None:
                    values["html"] = html
                frappe.db.set_value("Writer Document", self.name, values, update_modified=False)
                self.drive_touch()
                return
            frappe.db.set_value("Writer Document", self.name, "content", data)
            if html is not None:
                frappe.db.set_value("Writer Document", self.name, "html", html)
            self.update_file(file_size=len(self.content))
        except COLLISION_ERRORS:
            pass

    @frappe.whitelist(methods=["POST"])
    def take_version(self, label: str | None = None):
        """Store the saved body as one immutable Drive version.

        Drive reads the body itself, so the caller saves first and passes no
        bytes. This replaces `new_version` and its private `Writer Version`
        table for a linked row; the ten-minute automatic throttle it carried is
        Drive's retention ladder (§9.1).
        """
        self._require_drive_native()
        return self.drive_take_version(kind="named" if label else "auto", label=label)

    @frappe.whitelist(methods=["POST"])
    def new_version(self, data: str, title: str | None = None):
        """Create a new version of a legacy document.

        The legacy path, kept for the current editor until ticket 34 adopts
        `take_version`. A linked row is refused rather than given a second,
        private history Drive cannot see.
        """
        self._require_legacy("take_version")
        self.check_permission("write")
        if not data or not data.strip() or data.strip() == "<p></p>":
            frappe.response["data"] = False
            return

        manual = bool(title)
        if not manual:
            now_time = frappe.utils.now_datetime()
            last_auto_version = frappe.db.get_value(
                "Writer Version",
                filters={
                    "doc": self.name,
                    "manual": 0,
                },
                fieldname=["title", "name", "creation"],
                order_by="creation desc",
                as_dict=True,
            )

            if last_auto_version:
                prev_time = datetime.strptime(
                    last_auto_version.title,
                    "%Y-%m-%d %H:%M",
                )
                diff = now_time - prev_time
                if diff < timedelta(minutes=AUTOVERSION_DURATION):
                    frappe.response["data"] = False
                    return

            title = datetime.strftime(now_time, "%Y-%m-%d %H:%M")

        # Create a new Writer Version document
        version = frappe.get_doc(
            {
                "doctype": "Writer Version",
                "doc": self.name,
                "snapshot": data,
                "manual": manual,
                "title": title,
            }
        )
        version.insert()

        frappe.response["data"] = version.as_dict()

    @frappe.whitelist(methods=["POST"])
    def update_settings(self, data: str):
        self._authorize_write()
        self.settings = data
        self.save()

    @frappe.whitelist(methods=["POST"])
    def save_html(self, html: str):
        """Store the rendered body of a non-collaborative document."""
        self._authorize_write()
        if self.drive_native:
            frappe.db.set_value("Writer Document", self.name, "html", html, update_modified=False)
            self.drive_touch()
            return
        self.html = html
        self.update_file()
        self.save()

    def update_file(self, **kwargs):
        """Mirror the title and size onto the backing legacy `File`.

        Legacy only. A linked row has no `File`, and its stamp is the node's
        `content_modified`, written by `drive_touch`.
        """
        self._require_legacy("drive_touch")
        file = frappe.db.get_value(
            "File", {"content_docname": self.name, "content_doctype": "Writer Document"}, "name"
        )
        doc = frappe.get_doc("File", file)
        for k in kwargs:
            setattr(doc, k, kwargs[k])
        doc.file_modified = frappe.utils.now()
        doc.save(ignore_permissions=True)

    def save_comments(self, data, file):
        """Store the comment blob of a legacy document and notify mentions.

        Legacy only. Comments on a linked document are `Drive Node Comment`
        rows (§8.11), and §14.6 migrates this blob into them.
        """
        self._require_legacy("Drive comments")
        try:
            frappe.db.set_value("Writer Document", self.name, "ycomments", data)

            # Go over every comment in the YJS data and check replies for mentions
            comments_doc = pycrdt.Doc()
            comments_doc.apply_update(base64.b64decode(data))
            comments_map = comments_doc.get("comments", type=pycrdt.Map)
            for comment_id, comment_data in comments_map.items():
                mentions = [{**k, "owner": comment_data["owner"]} for k in comment_data.get("mentions", [])]
                for reply in comment_data["replies"]:
                    mentions.extend([{**k, "owner": reply["owner"]} for k in reply.get("mentions", [])])
                if mentions:
                    frappe.enqueue(
                        notify_comments,
                        job_id=f"doc_comments_{self.name}_{comment_id}",
                        now=True,
                        deduplicate=True,
                        mentions=mentions,
                        file=file,
                    )
        except COLLISION_ERRORS:
            pass

    def as_dict(self, *args, **kwargs):
        result = super().as_dict(*args, **kwargs)
        result.pop("versions", None)
        return result

    def _authorize_write(self):
        """Ask Drive for EDIT on a linked row, the backing `File` on a legacy one."""
        if self.drive_native:
            self.drive_check(drive.EDIT)
            return
        self.check_permission("write")

    def _require_drive_native(self):
        if not self.drive_native:
            frappe.throw(
                _("This document is not in Drive yet. Its history is in Writer Version."),
                frappe.ValidationError,
            )

    def _require_legacy(self, instead: str):
        if self.drive_native:
            frappe.throw(
                _("Drive owns this document. Use {0} instead.").format(instead),
                frappe.ValidationError,
            )


def notify_comments(file, mentions):
    for mention in mentions:
        from_owner = frappe.get_cached_value("User", mention["owner"], "full_name")
        new_notification = create_notification(
            mention["owner"],
            mention["id"],
            "Mention",
            file,
            f'{from_owner} mentioned you in a comment in "{file.file_name}".',
        )
        if new_notification:
            try:
                frappe.sendmail(
                    recipients=[mention["id"]],
                    subject=f"Frappe Drive - Mention in {file.file_name}",
                    template="drive_comment",
                    args={
                        "message": f"{from_owner} mentioned you in a comment.",
                        "doc": file.file_name,
                        "link": get_link(file),
                    },
                    now=True,
                )
            except Exception:
                frappe.log_error(frappe.get_traceback())
