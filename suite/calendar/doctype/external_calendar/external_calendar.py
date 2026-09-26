# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from uuid import uuid7

import frappe
from frappe import _
from frappe.model.document import Document


class ExternalCalendar(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        calendar_name: DF.Data
        color: DF.Color | None
        hidden_by_default: DF.Check
        source: DF.Data
        source_key: DF.Data
    # end: auto-generated types

    """A calendar of events this site holds on behalf of another system.

    The events are read from somewhere else — Frappe HR's holidays today — and kept here rather
    than on the mail server, so nothing has to be shared with each reader: who sees the calendar
    is the audience beside it, which is a row per person and not a limit the mail server sets.

    What the source calls the thing the calendar is about is its `source_key`. That pair, source
    and key, is how a run finds the calendar it made last time, so neither can be edited.
    """

    def autoname(self) -> None:
        self.name = str(uuid7())

    def validate(self) -> None:
        self.validate_one_per_source_key()

    def validate_one_per_source_key(self) -> None:
        """One calendar per thing the source has. Two would each reconcile the other's events away."""

        twin = frappe.db.exists(
            "External Calendar",
            {"source": self.source, "source_key": self.source_key, "name": ("!=", self.name)},
        )
        if twin:
            frappe.throw(
                _("{0} already has a calendar for {1}.").format(
                    frappe.bold(self.source), frappe.bold(self.source_key)
                )
            )

    def on_trash(self) -> None:
        """What the calendar holds goes with it: neither the events nor the audience mean anything
        without it, and both are written by the source rather than by hand."""

        frappe.db.delete("External Calendar Event", {"calendar": self.name})
        frappe.db.delete("External Calendar Audience", {"calendar": self.name})


def on_doctype_update():
    """One calendar per thing a source has, enforced where it holds.

    The check in `validate` is a message, not a guarantee: two writers in flight both look, both
    find nothing, and both insert. Called by the framework whenever this doctype is synced — on a
    fresh install as much as on a migrate, which a patch would miss, since a new site marks its
    patches done without running them.
    """

    frappe.db.add_unique("External Calendar", ["source", "source_key"], constraint_name="unique_source_key")
