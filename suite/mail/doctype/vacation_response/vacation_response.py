# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from datetime import datetime

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, get_datetime

from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.utils.dt import from_utc_z, normalize_utc_z, to_utc_z
from suite.mail.utils.html_to_text import html_to_text


class VacationResponse(Document):
    """An account's auto-reply, one per account and named after it.

    The reply is sent by the Vacation block of the account's automation Sieve script, so it runs
    alongside screening, blocked senders, categories and folder rules. Stalwart's own
    VacationResponse is left off: the server runs one script at a time, and turning that one on
    stopped the automation script.
    """

    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        account: DF.Link
        enabled: DF.Check
        from_date: DF.Datetime | None
        html_body: DF.TextEditor | None
        subject: DF.Data | None
        text_body: DF.Code | None
        to_date: DF.Datetime | None
    # end: auto-generated types

    def validate(self) -> None:
        if self.enabled and self.from_date and self.to_date:
            if get_datetime(self.from_date) >= get_datetime(self.to_date):
                frappe.throw(_("To Date must be after From Date."))

        # Where there is an HTML body it is authoritative, so both parts say the same thing rather
        # than the text being a flattened trace of it.
        if derived := html_to_text(self.html_body):
            self.text_body = derived
        else:
            self.html_body = None

    def on_update(self) -> None:
        # Skipped during migrate (no JMAP round-trips) and when a caller paused builds.
        if frappe.flags.in_migrate or frappe.flags.get("skip_automation_sieve_build"):
            return

        from suite.mail.doctype.sieve_script.sieve_script import build_automation_sieve

        # Raised, so a reply the script could not take is not saved as if it would be sent. Turned
        # on, the automation script is activated: the reply is a block of it.
        build_automation_sieve(self.account, activate=bool(self.enabled), raise_exception=True)


@frappe.whitelist()
def get_vacation_response(account: str) -> dict:
    """Returns the vacation response settings for the given account."""

    get_user_for_jmap_account(account, raise_exception=True)
    fields = ["enabled", "from_date", "to_date", "subject", "text_body", "html_body", "creation", "modified"]
    vr = frappe.db.get_value("Vacation Response", account, fields, as_dict=True) or {}

    return {
        "account": account,
        "enabled": cint(vr.get("enabled")),
        "from_date": to_utc_z(vr.get("from_date")),
        "to_date": to_utc_z(vr.get("to_date")),
        "subject": vr.get("subject"),
        "text_body": vr.get("text_body"),
        "html_body": vr.get("html_body"),
        "creation": str(vr["creation"]) if vr.get("creation") else None,
        "modified": str(vr["modified"]) if vr.get("modified") else None,
    }


@frappe.whitelist()
def update_vacation_response(
    account: str,
    enabled: bool | int,
    from_date: datetime | str | None = None,
    to_date: datetime | str | None = None,
    subject: str | None = None,
    text_body: str | None = None,
    html_body: str | None = None,
) -> None:
    """Updates the vacation response settings for the given account."""

    get_user_for_jmap_account(account, raise_exception=True)

    if frappe.db.exists("Vacation Response", account):
        doc = frappe.get_doc("Vacation Response", account)
    else:
        doc = frappe.new_doc("Vacation Response")
        doc.account = account

    # The API speaks UTC: naive values are read as UTC, and stored as system time, as Frappe keeps
    # datetimes.
    doc.update(
        {
            "enabled": cint(enabled),
            "from_date": from_utc_z(normalize_utc_z(from_date)),
            "to_date": from_utc_z(normalize_utc_z(to_date)),
            "subject": subject,
            "text_body": text_body,
            "html_body": html_body,
        }
    )
    doc.save()


def get_vacation_reply(account: str) -> frappe._dict | None:
    """The account's auto-reply while it is on, for the automation script: its window as UTC
    ``...Z`` timestamps, its subject and its bodies. None while it is off."""

    vr = frappe.db.get_value(
        "Vacation Response",
        {"name": account, "enabled": 1},
        ["from_date", "to_date", "subject", "text_body", "html_body"],
        as_dict=True,
    )
    if not vr:
        return None

    vr.from_date = to_utc_z(vr.from_date)
    vr.to_date = to_utc_z(vr.to_date)
    return vr


def has_permission(doc: Document, ptype: str, user: str | None = None) -> bool:
    if doc.doctype != "Vacation Response" or not doc.get("account"):
        return False

    return bool(get_user_for_jmap_account(doc.account, raise_exception=False))
