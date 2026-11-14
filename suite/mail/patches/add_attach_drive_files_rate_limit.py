import frappe

from suite.suite_core.doctype.rate_limit.rate_limit import create_rate_limit


def execute() -> None:
    """Give an existing site the limit a new one gets from `install.add_rate_limits`."""

    method_path = "suite.mail.api.mail.attach_drive_files"
    if not frappe.db.exists("Rate Limit", {"method_path": method_path}):
        create_rate_limit(method_path, limit=60, seconds=60)
