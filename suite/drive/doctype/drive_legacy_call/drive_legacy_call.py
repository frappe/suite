# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

# Set by `suite.drive.http.legacy_calls` around the one insert it makes.
FLUSH_FLAG = "drive_legacy_call_flush"


class DriveLegacyCall(Document):
    """How often one client called one legacy `suite.drive` name (§11.7).

    Only the counter's flush writes a row. The permission rows grant nobody a
    write, and this refuses the rest, Administrator included, because a row
    edited by hand could fake the zero the hold reads. Cleanup drops the
    DocType with the names (§14.10); that deletes no row one by one.
    """

    def validate(self):
        if not frappe.flags.get(FLUSH_FLAG):
            _refuse()

    def on_trash(self):
        _refuse()


def _refuse():
    frappe.throw(
        _("Drive Legacy Call rows are written by the legacy-call counter only."), frappe.PermissionError
    )
