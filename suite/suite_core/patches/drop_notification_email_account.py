import frappe

from suite.suite_core.utils import is_suite_cloud_configured

# A hosted site sent through a notification@ mailbox that Suite Cloud set up and now drops, so the
# account can no longer log in. Suite Cloud sends Suite's emails itself; other mail of the site
# goes through an Email Account its owner sets up. A site Suite Cloud never set up keeps its own
# Notifications account, as does one at another address.
ACCOUNT = "Notifications"


def execute() -> None:
    if not is_suite_cloud_configured():
        return
    if (frappe.db.get_value("Email Account", ACCOUNT, "email_id") or "").startswith("notification@"):
        frappe.delete_doc("Email Account", ACCOUNT, ignore_permissions=True, force=True)
