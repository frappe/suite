"""Typed transport for business storage administration."""

from typing import NotRequired, TypedDict

import frappe

from suite.composition.http import Route


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
    buffer: bool
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


class RefreshInput(TypedDict):
    pass


class LimitInput(TypedDict):
    users: list[str]
    cap_bytes: int | None
    buffer: NotRequired[bool]


class DefaultInput(TypedDict):
    cap_bytes: int | None


class BufferInput(TypedDict):
    users: list[str]
    grant: bool


class LimitResult(TypedDict):
    user: str
    success: bool
    error: str | None


ROUTES = (
    Route(
        "PATCH",
        "storage/buffers",
        "storage_buffers",
        body=BufferInput,
        output=list[LimitResult],
        kind="mutation",
        public_name="storage.setBuffers",
        errors=(frappe.PermissionError, frappe.ValidationError),
    ),
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
        "POST",
        "storage/refresh",
        "storage_refresh",
        body=RefreshInput,
        output=StorageReport,
        kind="mutation",
        public_name="storage.refresh",
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
        errors=(frappe.PermissionError, frappe.ValidationError),
    ),
    Route(
        "PATCH",
        "storage/default",
        "storage_default",
        body=DefaultInput,
        output=StorageReport,
        kind="mutation",
        public_name="storage.setDefault",
        errors=(frappe.PermissionError, frappe.ValidationError),
    ),
)


@frappe.whitelist(methods=["GET"])
def storage_get() -> StorageReport:
    from suite.composition.admin_storage import report

    return report()


@frappe.whitelist(methods=["POST"])
def storage_refresh() -> StorageReport:
    from suite.composition.admin_storage import report

    return report(refresh=True)


@frappe.whitelist(methods=["PATCH"])
def storage_limits(users: list[str], cap_bytes: int | None, buffer: bool | None = None) -> list[LimitResult]:
    from suite.suite_core.storage import update_limits

    return update_limits(users, cap_bytes, buffer)


@frappe.whitelist(methods=["PATCH"])
def storage_default(cap_bytes: int | None) -> StorageReport:
    from suite.suite_core.storage import set_default

    set_default(cap_bytes)
    return storage_get()


@frappe.whitelist(methods=["PATCH"])
def storage_buffers(users: list[str], grant: bool) -> list[LimitResult]:
    from suite.suite_core.storage import update_buffers

    return update_buffers(users, grant=grant)
