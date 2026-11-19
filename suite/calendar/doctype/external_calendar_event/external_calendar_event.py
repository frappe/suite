# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from calendar import isleap
from datetime import datetime
from uuid import uuid7

import frappe
from frappe.model.document import Document
from frappe.utils import get_datetime

# A 29 February repeat anchored in a year without one is stored against the 28th, and says so.
LEAP_DAY = "02-29"


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

    def validate(self) -> None:
        # Written here as well as by the store, which writes past this: an event entered or
        # moved in Desk is drawn on the day it now says.
        self.repeats = self.repeats or ""
        self.month_day = month_day_of(get_datetime(self.starts_on), self.repeats, self.month_day)


def on_doctype_update():
    """One row per event the source has on a calendar, by the uid it knows the event as. A second
    would be drawn twice, and a rewrite would reach only one of them.

    Called by the framework whenever this doctype is synced, on a fresh install as on a migrate.
    """

    frappe.db.add_unique(
        "External Calendar Event", ["calendar", "uid"], constraint_name="unique_calendar_uid"
    )


def month_day_of(starts_on: datetime, repeats: str | None, stated: str | None = None) -> str | None:
    """The MM-DD a repeat falls on, which a window asks for it by; none for an event that happens
    once.

    The day it starts on, except a 29 February anchored on the 28th of a year without one: that
    is the one day an event is stored against a day it does not fall on, and it is kept.
    """

    if not repeats:
        return None
    if stated == LEAP_DAY and (starts_on.month, starts_on.day) == (2, 28) and not isleap(starts_on.year):
        return LEAP_DAY
    return f"{starts_on:%m-%d}"
