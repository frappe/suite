import time

import frappe
from frappe import _

from suite.mail.doctype.push_subscription.push_subscription import (
    _fetch_subscriptions,
    _set_subscriptions,
)
from suite.mail.utils import log_mail_error


def execute() -> None:
    if not frappe.utils.get_url().startswith("https://"):
        return

    for user in frappe.db.get_all("User Settings", {"username": ["!=", ""]}, pluck="user"):
        try:
            subscriptions = _fetch_subscriptions(user, ignore_permissions=True)
            if ids := [s["id"] for s in subscriptions]:
                _set_subscriptions(user, destroy=ids, ignore_permissions=True)

            ps = frappe.new_doc("Push Subscription")
            ps.user = user
            ps.insert(ignore_permissions=True)
        except Exception as e:
            log_mail_error(
                _("Push Subscription Creation Failed"),
                _("Failed to create push subscription for user {0}: {1}").format(user, str(e)),
            )

        time.sleep(0.1)
