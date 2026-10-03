from urllib.parse import unquote

import frappe
from frappe import _
from frappe.utils import random_string
from jmap.models.push import CalendarAlert, PushVerification

from suite.calendar.doctype.calendar_event.calendar_event import enqueue_send_event_alert_notification
from suite.mail.doctype.mail_message.mail_message import enqueue_fetch_changes
from suite.mail.doctype.push_subscription.push_subscription import (
    get_push_subscription_keys,
    is_jmap_push_notifications_frozen,
    read_jmap_push,
    verify_push_subscription,
)
from suite.mail.jmap import invalidate_jmap_identities_cache, invalidate_jmap_mailboxes_cache
from suite.mail.utils.logger import get_push_logger


@frappe.whitelist(methods=["POST"], allow_guest=True)
def push_notification() -> dict:
    """Handle JMAP Push Notification."""

    ctx = {
        "req_id": random_string(10),
        "ip": frappe.request.remote_addr,
    }
    logger = get_push_logger(ctx)

    try:
        logger.debug("push-received")

        user = frappe.request.args.get("user")
        if not user:
            logger.warning("missing-user")
            return {"status": "error", "message": _("Missing user query parameter.")}

        user = unquote(user)
        ctx["user"] = user

        if is_jmap_push_notifications_frozen(user):
            logger.warning("push-frozen")
            return {
                "status": "frozen",
                "message": _("Push notifications are currently frozen for this user."),
            }

        keys = get_push_subscription_keys()
        content_encoding = frappe.request.headers.get("Content-Encoding", "")

        if keys:
            logger.debug("encrypted-payload-expected")

            if content_encoding != "aes128gcm":
                logger.warning("invalid-content-encoding", encoding=content_encoding)
                return {
                    "status": "error",
                    "message": _("Invalid Content-Encoding. Expected 'aes128gcm'."),
                }

            logger.debug("decrypting-payload")
        else:
            logger.debug("using-plain-json-payload")

        # Anything but the three push objects is refused here, as RFC 8620 §7 has it: discarded.
        pushed = read_jmap_push(frappe.request.get_data(), encrypted=bool(keys))
        ctx["type"] = pushed.TAG
        logger.debug("push-type-received")

        if isinstance(pushed, PushVerification):
            logger.info("verifying-subscription")

            verify_push_subscription(user, pushed.push_subscription_id, pushed.verification_code)

            logger.info("subscription-verified")
            return {"status": "verified"}

        if isinstance(pushed, CalendarAlert):
            ctx["account"] = pushed.account_id

            logger.info("calendar-alert-received")
            enqueue_send_event_alert_notification(user, pushed.to_wire(), ctx=ctx)

            return {"status": "processed"}

        logger.debug("state-change-received")

        for account, changes in pushed.changed.items():
            ctx["account"] = account

            for entity, state in changes.items():
                if entity == "Email":
                    logger.debug("queueing-email-sync", entity=entity, state=state)
                    enqueue_fetch_changes(user, account, state, ctx=ctx)

                elif entity == "Mailbox":
                    logger.debug("invalidating-mailbox-cache", entity=entity, state=state)
                    invalidate_jmap_mailboxes_cache(account)

                elif entity == "Identity":
                    logger.debug("invalidating-identity-cache", entity=entity, state=state)
                    invalidate_jmap_identities_cache(account)

                else:
                    logger.warning("unhandled-state-change-entity", entity=entity)

        return {"status": "processed"}

    except Exception:
        logger.exception("failed-to-process", traceback=frappe.get_traceback())
        return {"status": "error", "message": _("Failed to handle JMAP Push Notification.")}
