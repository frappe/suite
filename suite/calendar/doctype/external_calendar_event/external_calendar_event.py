# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from uuid import uuid7

from frappe.model.document import Document
from frappe.utils import get_datetime


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
        time_zone: DF.Data | None
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

    def before_save(self) -> None:
        self.month_day = month_day(self.starts_on) if self.repeats == "Yearly" else None


def month_day(starts_on) -> str:
    """The MM-DD a yearly repeat falls on. Stored beside the event so a window of days can be
    asked for by day, rather than every yearly event being read to find the few in it."""

    return get_datetime(starts_on).strftime("%m-%d")
