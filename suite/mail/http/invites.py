"""Editing and sending an existing invitation."""

from typing import NotRequired, TypedDict, cast

import frappe
from frappe import _
from frappe.utils import escape_html, validate_email_address

from suite.composition.http import BadRequest, Route
from suite.mail.http.shapes import Flag
from suite.mail.utils.dt import from_utc_z, to_utc_z
from suite.suite_core.administration import require_admin


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
    combined_cap_bytes: int | None
    send_invite: Flag
    disable_receiving: Flag
    is_verified: Flag
    groups: str | None
    mailing_lists: str | None


class UpdateInvite(InviteName):
    expires_at: str | None
    combined_cap_bytes: int | None
    account: NotRequired[str]
    is_admin: NotRequired[bool]


@frappe.whitelist(methods=["GET"])
def invite(name: str) -> Invite:
    require_admin()
    doc = frappe.get_doc("Mail Account Request", name)
    doc.check_permission("read")
    return cast(
        Invite,
        {
            **{field: doc.get(field) for field in Invite.__annotations__},
            "expires_at": to_utc_z(doc.expires_at),
            "combined_cap_bytes": doc.combined_cap_bytes or None,
        },
    )


@frappe.whitelist(methods=["PATCH"])
def update_invite(
    name: str,
    expires_at: str | None,
    combined_cap_bytes: int | None,
    account: str | None = None,
    is_admin: bool | None = None,
) -> None:
    require_admin()
    from suite.suite_core.storage import state

    state(lock=True)
    frappe.db.get_value("Mail Account Request", name, "name", for_update=True)
    doc = frappe.get_doc("Mail Account Request", name)
    doc.check_permission("write")
    if doc.is_verified:
        frappe.throw(_("This invitation has already been accepted"), BadRequest)
    from frappe.utils import add_to_date, get_datetime, now_datetime

    from suite.suite_core.storage import validate_cap

    expiry = from_utc_z(expires_at)
    if not expiry or get_datetime(expiry) > add_to_date(now_datetime(), days=7):
        frappe.throw(_("Invitation expiry must be within seven days"), BadRequest)
    doc.update({"expires_at": expiry, "combined_cap_bytes": validate_cap(combined_cap_bytes) or 0})
    if account is not None or is_admin is not None:
        if doc.suite_user:
            frappe.throw(
                _("Recover or delete the partially created account before changing its invitation identity"),
                BadRequest,
            )
        if account is not None:
            doc.account = account.strip().lower()
        if is_admin is not None:
            doc.is_admin = int(is_admin)
    doc.save()


@frappe.whitelist(methods=["POST"])
def send_invite(name: str) -> None:
    require_admin()
    from suite.suite_core.storage import state

    state(lock=True)
    frappe.db.get_value("Mail Account Request", name, "name", for_update=True)
    doc = frappe.get_doc("Mail Account Request", name)
    doc.check_permission("write")
    # The controller refuses these too, but as plain validation errors; checking
    # first lets the route answer 400 with the controller's own messages.
    if doc.is_verified:
        frappe.throw(_("This invitation has already been accepted"), BadRequest)
    if not doc.backup_email:
        frappe.throw(_("Backup Email is required."), BadRequest)
    backup_email = doc.backup_email.strip().lower()
    if not validate_email_address(backup_email):
        frappe.throw(_("{0} is not a valid Email Address").format(escape_html(backup_email)), BadRequest)
    # §4.1: a resent link replaces the previous credential; never extend its predecessor.
    from frappe.utils import add_to_date, now

    doc.set_request_key()
    doc.expires_at = add_to_date(now(), days=7)
    doc.save()
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
