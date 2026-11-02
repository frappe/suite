# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class DriveSettings(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        user: DF.Link | None
        webdav_enabled: DF.Check
        writer_settings: DF.JSON | None
    # end: auto-generated types

    def validate(self) -> None:
        """Refuse a row whose name is not its user: reads go by name, permission checks by user."""
        if self.name != self.user:
            frappe.throw(_("Drive settings must be named after their own user"), frappe.ValidationError)
