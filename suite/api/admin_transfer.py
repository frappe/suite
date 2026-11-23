"""Suite User offboarding transport delegates retained-tree policy to Drive."""

from typing import Literal, TypedDict

import frappe

from suite import drive
from suite.composition.http import Route


class PreviewInput(TypedDict):
    user: str
    to_user: str | None
    to_drive: str | None


class TransferInput(PreviewInput):
    fingerprint: str
    confirm_access: bool


class InheritedGrant(TypedDict):
    principal: str
    role: int


class DestinationCapacity(TypedDict):
    stored_bytes: int
    mail_bytes: int | None
    reserved_bytes: int
    current_bytes: int | None
    projected_bytes: int | None
    cap_bytes: int | None
    buffer_bytes: int
    effective_threshold_bytes: int | None
    complete: bool
    blocker: Literal["personal_limit", "unknown_usage", "drive_limit"] | None


class TransferPreview(TypedDict):
    destination_capacity: DestinationCapacity
    source_root: str
    destination: str
    destination_user: str | None
    folder_title: str
    destination_title: str
    bytes: int
    item_count: int
    fingerprint: str
    inherited_grants: list[InheritedGrant]


class TransferItem(TypedDict):
    node: str
    title: str
    success: bool
    error: str | None


class TransferResult(TypedDict):
    results: list[TransferItem]
    remaining: int
    complete: bool


class SharedDrive(TypedDict):
    id: str
    title: str


ROUTES = (
    Route(
        "GET",
        "admin/shared-drives",
        "shared_drives_list",
        output=list[SharedDrive],
        kind="query",
        public_name="admin.sharedDrives.list",
        errors=(frappe.PermissionError,),
    ),
    Route(
        "GET",
        "users/{user}/drive-transfer",
        "user_transfer_preview",
        query=PreviewInput,
        output=TransferPreview,
        kind="query",
        public_name="users.previewTransfer",
        errors=(
            frappe.PermissionError,
            drive.DriveConflict,
            drive.DriveForbidden,
            drive.DriveNotFound,
            drive.DriveOverQuota,
        ),
    ),
    Route(
        "POST",
        "users/{user}/drive-transfer",
        "user_transfer",
        body=TransferInput,
        output=TransferResult,
        kind="mutation",
        public_name="users.transferDrive",
        errors=(
            frappe.PermissionError,
            drive.DriveConflict,
            drive.DriveForbidden,
            drive.DriveNotFound,
            drive.DriveOverQuota,
        ),
    ),
)


@frappe.whitelist(methods=["GET"])
def user_transfer_preview(
    user: str, to_user: str | None = None, to_drive: str | None = None
) -> TransferPreview:
    result = drive.preview_user_transfer(user, to_user, to_drive)
    return {field: result[field] for field in TransferPreview.__annotations__}


@frappe.whitelist(methods=["POST"])
def user_transfer(
    user: str, to_user: str | None, to_drive: str | None, fingerprint: str, confirm_access: bool
) -> TransferResult:
    return drive.transfer_user_drive(user, to_user, to_drive, fingerprint, confirm_access=confirm_access)


@frappe.whitelist(methods=["GET"])
def shared_drives_list() -> list[SharedDrive]:
    return drive.list_shared_drives()
