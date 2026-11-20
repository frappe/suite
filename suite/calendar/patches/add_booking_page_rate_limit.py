import frappe

from suite.calendar.install import BOOKING_PAGE_RATE_LIMIT
from suite.suite_core.doctype.rate_limit.rate_limit import create_rate_limit


def execute() -> None:
    """Give an existing site the limit a new one gets from `install.add_rate_limits`."""

    if frappe.db.exists("Rate Limit", {"method_path": BOOKING_PAGE_RATE_LIMIT["method_path"]}):
        return
    create_rate_limit(**BOOKING_PAGE_RATE_LIMIT)
