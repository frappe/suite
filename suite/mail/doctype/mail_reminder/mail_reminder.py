# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class MailReminder(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        account: DF.Link
        due_at: DF.Datetime
        email_id: DF.Data | None
        kind: DF.Literal["Snooze", "No Reply"]
        status: DF.Literal["Waiting", "Returned"]
        thread_id: DF.Data
        user: DF.Link
    # end: auto-generated types

    def autoname(self):
        # One of each kind per conversation: setting it again replaces it, whoever asks at once.
        self.name = reminder_name(self.account, self.thread_id, self.kind)


def on_doctype_update() -> None:
    # Due rows are looked for every minute, past every row kept from an earlier return.
    frappe.db.add_index("Mail Reminder", ["status", "due_at"], "status_due_at")


def reminder_name(account: str, thread_id: str, kind: str) -> str:
    return f"{account}:{thread_id}:{kind}"
