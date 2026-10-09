"""Suite User offboarding transport delegates retained-tree policy to Drive."""

from typing import TypedDict

import frappe

from suite import drive
from suite.composition.http import Route


class PreviewInput(TypedDict):
    user: str
    destination: str


class TransferInput(PreviewInput):
    fingerprint: str
    confirm_access: bool


class InheritedGrant(TypedDict):
    principal: str
    role: int


class TransferPreview(TypedDict):
    source_root: str
    destination: str
    destination_user: str | None
    bytes: int
    item_count: int
    fingerprint: str
    inherited_grants: list[InheritedGrant]


class TransferItem(TypedDict):
    node: str
    success: bool
    error: str | None


class TransferResult(TypedDict):
    results: list[TransferItem]
    remaining: int
    complete: bool


ROUTES = (
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
def user_transfer_preview(user: str, destination: str) -> TransferPreview:
    result = drive.preview_user_transfer(user, destination)
    return {field: result[field] for field in TransferPreview.__annotations__}


@frappe.whitelist(methods=["POST"])
def user_transfer(user: str, destination: str, fingerprint: str, confirm_access: bool) -> TransferResult:
    return drive.transfer_user_drive(user, destination, fingerprint, confirm_access=confirm_access)
