import frappe
from frappe import _

from suite.mail.doctype.push_subscription.push_subscription import (
    _fetch_subscriptions,
    _set_subscriptions,
)
from suite.mail.jmap import format_set_error
from suite.mail.utils import log_mail_error
from suite.mail.utils.user import get_jmap_configured_users


def execute() -> None:
    """Reset every push subscription's types to null, subscribing it to all types.

    The JMAP server only pushes CalendarAlert notifications (triggered event alerts) to
    subscriptions whose types include it. Subscriptions used to be created with an explicit
    list ("Email", "Mailbox", "Identity", "VacationResponse") that predates calendar alert
    support and would never receive them. Null means all supported types — including
    CalendarAlert and any types added later — which is now also the default for new
    subscriptions.
    """

    if not frappe.utils.get_url().startswith("https://"):
        return

    for user in get_jmap_configured_users():
        try:
            updates = {
                subscription["id"]: {"types": None}
                for subscription in _fetch_subscriptions(user, ignore_permissions=True)
            }
            if not updates:
                continue

            result = _set_subscriptions(user, update=updates, ignore_permissions=True)
            if not_updated := result.not_updated:
                errors = "<br>".join(f"{id}: {format_set_error(error)}" for id, error in not_updated.items())
                log_mail_error(
                    _("Push Subscription Update Failed"),
                    _("Failed to reset push subscription types for user {0}:<br>{1}").format(user, errors),
                )
        except Exception as e:
            log_mail_error(
                _("Push Subscription Update Failed"),
                _("Failed to reset push subscription types for user {0}: {1}").format(user, str(e)),
            )
