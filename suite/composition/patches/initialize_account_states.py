"""Migrate retained identities once without resetting credentials or applying new defaults."""

import frappe

from suite import drive, mail
from suite.suite_core.account_state import read, write


def execute() -> None:
    for account in mail.administration_accounts():
        user = account["user"]
        if user in ("Guest", "Administrator") or read(user):
            continue
        write(user, account=account["username"], status="Active", must_change_password=0)
    for root in drive.administration_usage():
        if (
            root["kind"] == "Personal"
            and root["state"] == "Active"
            and frappe.db.get_value("User", root["user"], "enabled") == 0
        ):
            drive.set_user_active(root["user"], active=False)
