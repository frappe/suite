"""Editing and sending an existing invitation."""

from typing import TypedDict

import frappe

from suite.composition.http import Route
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
    return {
        **{field: doc.get(field) for field in Invite.__annotations__},
        "expires_at": to_utc_z(doc.expires_at),
    }


@frappe.whitelist(methods=["PATCH"])
def update_invite(name: str, expires_at: str | None, quota_gb: float | None) -> None:
    doc = frappe.get_doc("Mail Account Request", name)
    doc.check_permission("write")
    if doc.is_verified:
        frappe.throw("This invitation has already been accepted")
    doc.update({"expires_at": from_utc_z(expires_at), "quota_gb": quota_gb})
    doc.save()


@frappe.whitelist(methods=["POST"])
def send_invite(name: str) -> None:
    doc = frappe.get_doc("Mail Account Request", name)
    doc.check_permission("write")
    doc.send_verification_email()


ROUTES = (
    Route(
        "GET", "admin/invites/{name}", "invite", kind="query", public_name="admin.invites.get", output=Invite
    ),
    Route(
        "PATCH",
        "admin/invites/{name}",
        "update_invite",
        kind="mutation",
        public_name="admin.invites.update",
        body=UpdateInvite,
        output=type(None),
    ),
    Route(
        "POST",
        "admin/invites/{name}/send",
        "send_invite",
        kind="mutation",
        public_name="admin.invites.send",
        body=InviteName,
        output=type(None),
    ),
)
