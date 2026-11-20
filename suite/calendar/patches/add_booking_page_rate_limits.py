import frappe

from suite.calendar.install import BOOKING_PAGE_RATE_LIMITS
from suite.suite_core.doctype.rate_limit.rate_limit import create_rate_limit


def execute() -> None:
    """Give an existing site the limits a new one gets from `install.add_rate_limits`."""

    for limit in BOOKING_PAGE_RATE_LIMITS:
        if not frappe.db.exists("Rate Limit", {"method_path": limit["method_path"]}):
            create_rate_limit(**limit)
