"""REST adapters for Calendar event windows."""

from __future__ import annotations

from typing import NotRequired, TypedDict
from urllib.parse import urlparse

import frappe
from frappe import _
from frappe.utils import get_system_timezone, get_url

from suite.calendar.api import get_calendar_events
from suite.composition.http import BadRequest, Route
from suite.mail.doctype.user_account.user_account import (
    get_user_jmap_accounts,
    is_jmap_account_belongs_to_user,
)

Given = str | int | float | bool | list | dict | None


class Conferencing(TypedDict):
    meeting_id: str
    url: str


class EventLink(TypedDict):
    uid: str
    href: str | None
    content_type: str | None


class CalendarEvent(TypedDict, total=False):
    name: str
    account: str
    id: str
    uid: str
    title: str
    start: str
    duration: str
    time_zone: str
    status: str
    description: str
    show_without_time: int
    recurrence_id: str | None
    recurrence_rule: str
    master_id: str
    master_start: str
    master_duration: str
    links: list[EventLink]
    participants: list[dict]
    conferencing: Conferencing | None


EventsQuery = TypedDict(
    "EventsQuery",
    {"from": str, "to": str, "account": NotRequired[str]},
)


ROUTES = (
    Route(
        "GET",
        "events",
        "events_get",
        errors=(BadRequest, frappe.PermissionError),
        query=EventsQuery,
        output=list[CalendarEvent],
    ),
)


@frappe.whitelist(methods=["GET"])
def events_get(to: Given = None, account: Given = None, **kwargs: Given) -> list[CalendarEvent]:
    from_value = _required_text(kwargs.get("from"), "from")
    to_value = _required_text(to, "to")
    if account is None:
        accounts = get_user_jmap_accounts()
    else:
        named = _required_text(account, "account")
        if not is_jmap_account_belongs_to_user(named):
            frappe.throw(_("That Calendar account is not available"), frappe.PermissionError)
        accounts = [named]

    events: list[CalendarEvent] = []
    for account_id in accounts:
        rows = get_calendar_events(account_id, from_value, to_value, get_system_timezone())
        for row in rows:
            row["conferencing"] = _conferencing(row.get("links") or [])
            events.append(row)
    events.sort(
        key=lambda event: (
            event.get("start") or "",
            event.get("account") or "",
            event.get("id") or "",
        )
    )
    return events


def _conferencing(links: list[dict]) -> Conferencing | None:
    site = urlparse(get_url())
    for link in links:
        href = link.get("href")
        if not isinstance(href, str) or not href:
            continue
        parsed = urlparse(href)
        if parsed.netloc and (parsed.scheme, parsed.netloc) != (site.scheme, site.netloc):
            continue
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) == 2 and parts[0] == "meet" and parts[1]:
            return {"meeting_id": parts[1], "url": href}
    return None


@frappe.whitelist(allow_guest=True, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
def unknown() -> None:
    raise frappe.DoesNotExistError(_("That Calendar address does not exist"))


def _required_text(value: Given, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        frappe.throw(_("Calendar argument {0} is required").format(name), BadRequest)
    return value
