"""Editing and sending an existing invitation."""

from typing import TypedDict, cast

import frappe
from frappe import _
from frappe.utils import escape_html, validate_email_address

from suite.composition.http import BadRequest, Route
from suite.mail.http.shapes import Flag
from suite.mail.utils.dt import from_utc_z, to_utc_z


class InviteName(TypedDict):
    name: str


class Invite(TypedDict):
    name: str
    account: str
    aliases: str | None
    is_admin: Flag
    backup_email: str | None
    invited_by: str | None
    expires_at: str | None
    quota_gb: float | None
    send_invite: Flag
    disable_receiving: Flag
    is_verified: Flag
    groups: str | None
    mailing_lists: str | None


class UpdateInvite(InviteName):
    expires_at: str | None
    quota_gb: float | None


@frappe.whitelist(methods=["GET"])
def invite(name: str) -> Invite:
    doc = frappe.get_doc("Mail Account Request", name)
    doc.check_permission("read")
    return cast(
        Invite,
        {
            **{field: doc.get(field) for field in Invite.__annotations__},
            "expires_at": to_utc_z(doc.expires_at),
        },
    )


@frappe.whitelist(methods=["PATCH"])
def update_invite(name: str, expires_at: str | None, quota_gb: float | None) -> None:
    doc = frappe.get_doc("Mail Account Request", name)
    doc.check_permission("write")
    if doc.is_verified:
        frappe.throw(_("This invitation has already been accepted"), BadRequest)
    doc.update({"expires_at": from_utc_z(expires_at), "quota_gb": quota_gb})
    doc.save()


@frappe.whitelist(methods=["POST"])
def send_invite(name: str) -> None:
    doc = frappe.get_doc("Mail Account Request", name)
    doc.check_permission("write")
    # The controller refuses these too, but as plain validation errors; checking
    # first lets the route answer 400 with the controller's own messages.
    if doc.is_expired:
        frappe.throw(_("This request has expired. Please create a new one."), BadRequest)
    if not doc.backup_email:
        frappe.throw(_("Backup Email is required."), BadRequest)
    backup_email = doc.backup_email.strip().lower()
    if not validate_email_address(backup_email):
        frappe.throw(_("{0} is not a valid Email Address").format(escape_html(backup_email)), BadRequest)
    doc.send_verification_email()


ROUTES = (
    Route(
        "GET",
        "admin/invites/{name}",
        "invite",
        kind="query",
        public_name="admin.invites.get",
        output=Invite,
        errors=(frappe.PermissionError, frappe.DoesNotExistError),
    ),
    Route(
        "PATCH",
        "admin/invites/{name}",
        "update_invite",
        kind="mutation",
        public_name="admin.invites.update",
        body=UpdateInvite,
        output=type(None),
        errors=(BadRequest, frappe.PermissionError, frappe.DoesNotExistError),
    ),
    Route(
        "POST",
        "admin/invites/{name}/send",
        "send_invite",
        kind="mutation",
        public_name="admin.invites.send",
        body=InviteName,
        output=type(None),
        errors=(BadRequest, frappe.PermissionError, frappe.DoesNotExistError),
    ),
)
