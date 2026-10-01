# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from uuid import uuid7

from frappe.model.document import Document


class ExternalCalendarEvent(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        all_day: DF.Check
        calendar: DF.Link
        description: DF.SmallText | None
        ends_on: DF.Datetime | None
        month_day: DF.Data | None
        repeats: DF.Literal["", "Yearly"]
        starts_on: DF.Datetime
        title: DF.Data
        uid: DF.Data
    # end: auto-generated types

    """One event on an External Calendar, as the source states it.

    A yearly repeat is stored once and drawn in every year it reaches, so a birthday is one row
    rather than one a year. Nothing here carries an organizer or participants: these are facts
    about a day, not invitations to answer.
    """

    def autoname(self) -> None:
        self.name = str(uuid7())
