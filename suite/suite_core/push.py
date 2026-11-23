"""Device notifications through Frappe's notification relay, one subscription per installed app.

On a phone each product is an app of its own (ticket 047). An iPhone keeps a push subscription per
home-screen app, so a subscription the relay knew only by user would deliver Mail's notifications
through the Calendar app too, and a tap would open the wrong one. Each app is therefore its own
address at the relay: Mail keeps the user's own id, as every subscription before the split did, and
Calendar is the user's id with `::calendar`. An installed app subscribes for itself; a browser tab,
or the one Suite app, for every app. A tap opens the link the notification carries, which is the
app's own.

Every token stays in the one relay project, `mail`, which existing subscriptions use.
"""

from typing import Literal, TypedDict

import frappe
from frappe.push_notification import PushNotification

PROJECT = "mail"
App = Literal["mail", "calendar"]
APPS: tuple[App, ...] = ("mail", "calendar")


class PushResult(TypedDict):
    success: bool
    message: str


def relay_user(user: str, app: App) -> str:
    """The user's address at the relay for `app`'s notifications."""
    return user if app == "mail" else f"{user}::{app}"


def notify(
    user: str, app: App, title: str, body: str, link: str | None = None, icon: str | None = None
) -> bool:
    """Sends a notification to the user's devices subscribed for `app`. False when the relay is off."""
    pn = PushNotification(PROJECT)
    if not pn.is_enabled():
        return False
    return pn.send_notification_to_user(relay_user(user, app), title, body, link, icon)


@frappe.whitelist(methods=["POST"])
def subscribe(fcm_token: str, apps: list[str]) -> PushResult:
    """Subscribes this device's token for each of `apps`."""
    return _each(apps, lambda pn, user: pn.add_token(user, fcm_token))


@frappe.whitelist(methods=["POST"])
def unsubscribe(fcm_token: str, apps: list[str]) -> PushResult:
    """Unsubscribes this device's token from each of `apps`."""
    return _each(apps, lambda pn, user: pn.remove_token(user, fcm_token))


def _each(apps: list[str], call) -> PushResult:
    chosen = [app for app in APPS if app in (apps or [])]
    if not chosen:
        frappe.throw(frappe._("Choose an app to be notified for."), frappe.ValidationError)
    pn = PushNotification(PROJECT)
    messages = []
    for app in chosen:
        success, message = call(pn, relay_user(frappe.session.user, app))
        if not success:
            return {"success": False, "message": message}
        messages.append(message)
    return {"success": True, "message": "; ".join(dict.fromkeys(messages))}
