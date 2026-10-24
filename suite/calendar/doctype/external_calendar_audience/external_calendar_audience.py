# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from uuid import uuid7

from frappe.model.document import Document


class ExternalCalendarAudience(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        calendar: DF.Link
        user: DF.Link
    # end: auto-generated types

    """One person an External Calendar is drawn for.

    This is what a share would have been on the mail server, kept here instead: a row per reader,
    so a calendar about four thousand people is four thousand rows rather than a share list no
    server would take.
    """

    def autoname(self) -> None:
        self.name = str(uuid7())
