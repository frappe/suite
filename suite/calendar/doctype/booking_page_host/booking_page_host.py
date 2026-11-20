# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class BookingPageHost(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        calendar: DF.Data | None
        parent: DF.Data
        parentfield: DF.Data
        parenttype: DF.Data
        user: DF.Link
    # end: auto-generated types

    """A person a Booking Page books time with, and the calendar their bookings go to."""
