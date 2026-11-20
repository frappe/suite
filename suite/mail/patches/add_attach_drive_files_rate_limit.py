import frappe

from suite.mail.install import RATE_LIMITS
from suite.suite_core.doctype.rate_limit.rate_limit import create_rate_limit


def execute() -> None:
    """Give an existing site the limit a new one gets from `install.add_rate_limits`."""

    method_path = "suite.mail.api.mail.attach_drive_files"
    if frappe.db.exists("Rate Limit", {"method_path": method_path}):
        return
    for limit in RATE_LIMITS:
        if limit["method_path"] == method_path:
            create_rate_limit(**limit)
