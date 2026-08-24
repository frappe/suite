# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
import json

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint

from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.jmap import SuiteJMAPClient, chunked_set, format_set_error, get_account_client
from suite.mail.utils.dt import normalize_utc_z
from suite.utils import parse_filters

# ``CalendarEventNotification/get`` must always name the properties it wants: Stalwart returns a
# reduced default property set when a ``get`` omits ``properties``, which silently drops
# ``event``/``eventPatch`` from every notification.
EVENT_NOTIFICATION_PROPERTIES = [
    "id",
    "created",
    "changedBy",
    "comment",
    "type",
    "calendarEventId",
    "isDraft",
    "event",
    "eventPatch",
]


class EventNotification(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        account: DF.Link
        calendar_event: DF.Link | None
        calendar_event_id: DF.Data | None
        changed_by_email: DF.Data | None
        changed_by_name: DF.Data | None
        changed_by_principal_id: DF.Data | None
        changed_by_schedule_id: DF.Data | None
        comment: DF.SmallText | None
        created_utc: DF.Data | None
        draft: DF.Check
        event: DF.JSON | None
        event_patch: DF.JSON | None
        id: DF.Data | None
        type: DF.Literal["", "Created", "Updated", "Destroyed"]
    # end: auto-generated types

    def db_insert(self, *args, **kwargs) -> None:
        frappe.throw(
            _("Event Notification are only created by the server, users cannot create them directly.")
        )

    def load_from_db(self) -> EventNotification:
        account, id = self.name.split("|")
        if notifications := get_event_notifications(account, [id]):
            return super(Document, self).__init__(notifications[0])

        frappe.throw(
            _("Event Notification with ID {0} not found in account {1}.").format(
                frappe.bold(id), frappe.bold(account)
            ),
            title=_("Event Notification Not Found"),
        )

    def db_update(self) -> None:
        frappe.throw(_("Event Notification cannot be updated by the user."))

    def delete(self) -> None:
        account, id = self.name.split("|")
        delete_event_notifications(account, [id])

    @staticmethod
    def get_list(filters=None, page_length=20, **kwargs) -> list:
        filters = parse_filters(filters)
        account = filters.get("account")

        if not account:
            frappe.msgprint(_("Please select an account to view event notifications."), alert=True)
            return []

        filter = {}
        limit = cint(kwargs.get("start")) + page_length
        notifications, total = fetch_event_notifications(account, filter, limit=limit)
        frappe.cache.set_value(_get_total_cache_key(account), total, expires_in_sec=600)

        if not notifications:
            frappe.msgprint(_("No event notifications found."), alert=True)

        return notifications

    @staticmethod
    def get_count(filters=None, **kwargs) -> int:
        filters = parse_filters(filters)
        account = filters.get("account")

        if account:
            if get_user_for_jmap_account(account, raise_exception=False):
                return cint(frappe.cache.get_value(_get_total_cache_key(account)))

        return 0

    @staticmethod
    def get_stats(**kwargs) -> dict:
        return {}


def _get_total_cache_key(account: str) -> str:
    """Returns a cache key for total event notifications count for the given account."""

    return f"{account}:event_notifications:total"


@frappe.whitelist()
def bulk_delete(names: str | list[str]) -> None:
    """Deletes multiple event notifications given their names."""

    if isinstance(names, str):
        names = json.loads(names)

    accounts_map = {}
    for name in names:
        account, id = name.split("|")
        accounts_map.setdefault(account, []).append(id)

    for account, ids in accounts_map.items():
        delete_event_notifications(account, ids)

    frappe.msgprint(_("Event Notifications deleted successfully."), alert=True)


@frappe.whitelist()
def fetch_event_notifications(
    account: str,
    filter: dict | None = None,
    position: int = 0,
    limit: int = 50,
    sort: list[dict] | None = None,
) -> tuple[list[dict], int]:
    """Returns a list of event notifications and total count based on the provided filter."""

    notifications = []
    client = get_account_client(account)
    data = _query_notifications(client, filter, position, limit, sort)

    ids = data.get("ids", [])
    total = data.get("total", 0)

    notifications.extend(get_event_notifications(account, ids))

    return notifications[:limit], total


@frappe.whitelist()
def get_event_notifications(account: str, ids: list[str]) -> list[dict]:
    """Returns a list of event notifications for the specified account and IDs."""

    client = get_account_client(account)

    notifications = {}
    for notification in fetch_notifications(client, ids):
        notification = format_event_notification(account, notification)
        notifications[notification["id"]] = notification

    return [notifications[id] for id in ids if id in notifications]


@frappe.whitelist()
def delete_event_notifications(account: str, ids: list[str]) -> None:
    """Deletes event notifications for the specified account and ID(s)."""

    client = get_account_client(account)
    result = chunked_set(
        client, lambda b, chunk: b.calendars.calendar_event_notification.set(destroy=chunk), ids
    )

    if result.not_destroyed:
        error_messages = []
        for id, error in result.not_destroyed.items():
            error_messages.append(f"{id}: {format_set_error(error)}")
        frappe.throw(
            _("Event Notification Deletion Error(s):<br>{0}").format("<br>".join(error_messages)),
            title=_("Event Notification Deletion Error"),
        )


def fetch_notifications(
    client: SuiteJMAPClient, ids: list[str] | None = None, properties: list[str] | None = None
) -> list[dict]:
    """Fetches raw notification objects, always naming the properties (``[]`` means "no
    preference", not "no properties" — an empty set would fetch nothing usable). jmaplib
    chunks oversized id lists itself, carrying the properties on every chunk."""

    properties = properties or EVENT_NOTIFICATION_PROPERTIES

    with client.batch() as b:
        if ids:
            h = b.calendars.calendar_event_notification.get(ids=ids, properties=properties)
        else:
            h = b.calendars.calendar_event_notification.get(properties=properties)

    return [n.to_wire() for n in h.result.items]


def _query_notifications(
    client: SuiteJMAPClient,
    filter: dict | None = None,
    position: int = 0,
    limit: int = 50,
    sort: list[dict] | None = None,
) -> dict:
    """Queries notification ids with the old service's pagination loop; returns {"ids", "total"}."""

    ids = []
    total = None
    batch_size = min(limit, client.capabilities.limits.max_objects_in_get)
    sort = sort or [{"property": "created", "isAscending": True}]

    while len(ids) < limit:
        current_batch_size = min(batch_size, limit - len(ids))

        # An explicit ``filter=None`` serializes as ``"filter": null``, which Stalwart
        # rejects with ``notRequest`` — omit the argument instead (UNSET), like the old
        # transport did for every None argument.
        filter_kwargs = {"filter": filter} if filter is not None else {}
        with client.batch() as b:
            h = b.calendars.calendar_event_notification.query(
                position=position,
                limit=current_batch_size,
                sort=sort,
                calculate_total=total is None,
                **filter_kwargs,
            )
        response = h.result

        ids.extend(response.ids)

        if total is None:
            total = response.total

        if len(response.ids) < current_batch_size or (total is not None and len(ids) >= total):
            break

        position += len(response.ids)

    return {"ids": ids[:limit], "total": total}


def format_event_notification(account: str, notification: dict) -> dict:
    """Formats event notification data for display."""

    calendar_event_id = notification.get("calendarEventId", "")
    calendar_event = f"{account}|{calendar_event_id}" if calendar_event_id else None
    changed_by = notification.get("changedBy", {})
    event = json.dumps(notification.get("event", {}), indent=2)
    event_patch = json.dumps(notification.get("eventPatch", {}), indent=2)

    return {
        "name": f"{account}|{notification['id']}",
        "account": account,
        "id": notification["id"],
        "draft": notification.get("isDraft", False),
        "type": notification.get("type", "").title(),
        "created_utc": normalize_utc_z(notification["created"]),
        "comment": notification.get("comment", ""),
        "calendar_event": calendar_event,
        "calendar_event_id": calendar_event_id,
        "changed_by_name": changed_by.get("name"),
        "changed_by_email": changed_by.get("email"),
        "changed_by_principal_id": changed_by.get("principalId"),
        "changed_by_schedule_id": changed_by.get("scheduleId"),
        "event": event,
        "event_patch": event_patch,
        "creation": normalize_utc_z(notification["created"]),
        "modified": normalize_utc_z(notification["created"]),
    }


def has_permission(doc: Document, ptype: str, user: str | None = None) -> bool:
    if doc.doctype != "Event Notification":
        return False

    return bool(get_user_for_jmap_account(doc.account, raise_exception=False))
