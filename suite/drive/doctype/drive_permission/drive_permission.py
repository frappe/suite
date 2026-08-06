# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from suite.drive.api.notifications import notify_share
from suite.drive.utils import GENERAL_USER, GROUP_PREFIX


class DrivePermission(Document):
    def after_insert(self):
        # `notify_share` runs inline and emails per row; a migration rewriting
        # historical grants would mail everyone about folders they already had.
        if frappe.flags.in_install or frappe.flags.in_migrate or frappe.flags.in_patch:
            return
        # Only individual users get notified — "" (anyone with the link),
        # $GENERAL (site users) and $GROUP: rows are not email addresses.
        if self.user and self.user != GENERAL_USER and not self.user.startswith(GROUP_PREFIX):
            frappe.enqueue(
                notify_share,
                queue="short",
                job_id=f"fdocperm_{self.name}",
                deduplicate=True,
                timeout=None,
                enqueue_after_commit=True,
                at_front=False,
                entity_name=self.entity,
                docperm_name=self.name,
            )
