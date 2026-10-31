"""Typed transport for business storage administration."""

from typing import TypedDict

import frappe

from suite.composition.http import BadRequest, Route, refusals_as_bad_request


class StorageUser(TypedDict):
    name: str
    email: str
    full_name: str
    user_image: str | None
    enabled: bool
    is_admin: bool
    drive_bytes: int
    reserved_bytes: int
    mail_bytes: int | None
    combined_bytes: int | None
    cap_bytes: int | None
    effective_cap_bytes: int | None
    mail_fetched_at: str | None


class StorageRoot(TypedDict):
    name: str
    user: str | None
    kind: str
    state: str
    stored_bytes: int
    reserved_bytes: int
    quota_bytes: int
    effective_quota_bytes: int


class StorageReport(TypedDict):
    cloud: bool
    drive_bytes: int
    personal_drive_bytes: int
    shared_drive_bytes: int
    group_mail_bytes: int | None
    pending_invitations: int
    reserved_bytes: int
    mail_bytes: int | None
    combined_bytes: int | None
    allowance_bytes: int | None
    effective_allowance_bytes: int | None
    stale: bool
    fetched_at: str | None
    default_cap_bytes: int | None
    users: list[StorageUser]
    roots: list[StorageRoot]


class LimitInput(TypedDict):
    users: list[str]
    cap_bytes: int | None


class DefaultInput(TypedDict):
    cap_bytes: int | None


class LimitResult(TypedDict):
    user: str
    success: bool
    error: str | None


ROUTES = (
    Route(
        "GET",
        "storage",
        "storage_get",
        output=StorageReport,
        kind="query",
        public_name="storage.get",
        errors=(frappe.PermissionError,),
    ),
    Route(
        "PATCH",
        "storage/limits",
        "storage_limits",
        body=LimitInput,
        output=list[LimitResult],
        kind="mutation",
        public_name="storage.setLimits",
        errors=(BadRequest, frappe.PermissionError),
    ),
    Route(
        "PATCH",
        "storage/default",
        "storage_default",
        body=DefaultInput,
        output=StorageReport,
        kind="mutation",
        public_name="storage.setDefault",
        errors=(BadRequest, frappe.PermissionError),
    ),
)


@frappe.whitelist(methods=["GET"])
def storage_get() -> StorageReport:
    from suite.composition.admin_storage import report

    return report()


@frappe.whitelist(methods=["PATCH"])
@refusals_as_bad_request
def storage_limits(users: list[str], cap_bytes: int | None) -> list[LimitResult]:
    from suite.suite_core.storage import update_limits

    return update_limits(users, cap_bytes)


@frappe.whitelist(methods=["PATCH"])
@refusals_as_bad_request
def storage_default(cap_bytes: int | None) -> StorageReport:
    from suite.suite_core.storage import set_default

    set_default(cap_bytes)
    return storage_get()
