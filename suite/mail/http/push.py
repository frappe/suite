"""User-owned push subscription operations."""

from typing import NotRequired, TypedDict

import frappe

from suite.composition.http import Route, RouteKind
from suite.mail.doctype.push_subscription.push_subscription import (
    add_push_subscription,
    fetch_push_subscriptions,
    renew_push_subscription,
)
from suite.mail.doctype.push_subscription.push_subscription import (
    bulk_delete as delete_push_subscriptions,
)


class UserInput(TypedDict):
    user: str


class ListInput(UserInput):
    page: NotRequired[int]
    limit: NotRequired[int]


class CreateInput(UserInput):
    device_client_id: NotRequired[str | None]
    url: NotRequired[str | None]
    types: NotRequired[list[str] | None]


class RenewInput(UserInput):
    id: str


class DeleteInput(TypedDict):
    names: list[str]


class Subscription(TypedDict):
    user: str
    id: str
    name: str
    device_client_id: str
    expires: str | None
    types: str
    creation: str
    modified: str


_OPERATIONS: tuple[tuple[str, str, RouteKind, str, object, object], ...] = (
    (
        "/api/method/suite.mail.doctype.push_subscription.push_subscription.fetch_push_subscriptions",
        "fetch_push_subscriptions",
        "query",
        "push.list",
        ListInput,
        list[Subscription],
    ),
    (
        "/api/method/suite.mail.doctype.push_subscription.push_subscription.add_push_subscription",
        "add_push_subscription",
        "mutation",
        "push.create",
        CreateInput,
        str,
    ),
    (
        "/api/method/suite.mail.doctype.push_subscription.push_subscription.renew_push_subscription",
        "renew_push_subscription",
        "mutation",
        "push.renew",
        RenewInput,
        type(None),
    ),
    (
        "/api/method/suite.mail.doctype.push_subscription.push_subscription.bulk_delete",
        "delete_push_subscriptions",
        "mutation",
        "push.delete",
        DeleteInput,
        type(None),
    ),
)


CONTRACT_ROUTES = tuple(
    Route(
        "POST",
        path,
        handler,
        kind=kind,
        public_name=public_name,
        body=body,
        output=output,
        envelope="message",
        errors=(frappe.PermissionError, frappe.ValidationError),
    )
    for path, handler, kind, public_name, body, output in _OPERATIONS
)
