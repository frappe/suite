# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from uuid import uuid7

import frappe
from frappe.model.document import Document


class ExternalCalendarAssignment(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        calendar: DF.Link
        user: DF.Link
    # end: auto-generated types

    """One person an External Calendar is assigned to, and so drawn for.

    This is what a share would have been on the mail server, kept here instead: a row per reader,
    so a calendar about four thousand people is four thousand rows rather than a share list no
    server would take.
    """

    def autoname(self) -> None:
        self.name = str(uuid7())


def on_doctype_update():
    """One row per person a calendar is assigned to. A second would outlive the first when the source
    stops naming them, and keep drawing the calendar for somebody it is no longer for.

    Called by the framework whenever this doctype is synced, on a fresh install as on a migrate.
    """

    frappe.db.add_unique(
        "External Calendar Assignment", ["calendar", "user"], constraint_name="unique_calendar_user"
    )
