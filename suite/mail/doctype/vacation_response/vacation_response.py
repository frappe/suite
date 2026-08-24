# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from datetime import datetime

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, today

from suite.mail.doctype.sieve_script.sieve_script import (
    activate_last_active_sieve_script,
    get_active_sieve_script_id,
    set_last_active_sieve_script_id,
)
from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.jmap import get_account_client
from suite.mail.utils.dt import normalize_utc_z
from suite.utils import convert_html_to_text


class VacationResponse(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        account: DF.Link | None
        enabled: DF.Check
        from_date: DF.Datetime | None
        html_body: DF.TextEditor | None
        subject: DF.Data | None
        text_body: DF.Code | None
        to_date: DF.Datetime | None
        user: DF.Link | None
    # end: auto-generated types

    def db_insert(self, *args, **kwargs) -> None:
        raise NotImplementedError

    @frappe.whitelist()
    def load_from_db(self) -> VacationResponse:
        if not self.get("account"):
            frappe.msgprint(_("Please select an account to view vacation response details."), alert=True)
            return super(Document, self).__init__({"creation": today(), "modified": today()})

        vr = get_vacation_response(self.account)
        return super(Document, self).__init__(vr)

    def on_update(self) -> None:
        if not self.get("account"):
            return

        update_vacation_response(
            self.account,
            self.enabled,
            self.from_date,
            self.to_date,
            self.subject,
            self.text_body,
            self.html_body,
        )
        self.reload()

    def delete(self) -> None:
        pass

    @staticmethod
    def get_list(filters=None, page_length=20, **kwargs) -> list:
        pass

    @staticmethod
    def get_count(filters=None, **kwargs):
        pass

    @staticmethod
    def get_stats(**kwargs) -> dict:
        return {}


@frappe.whitelist()
def get_vacation_response(account: str) -> dict:
    """Returns the vacation response settings for the given account."""

    vr = _fetch_vacation_response(account)
    return format_vacation_response(account, vr)


def _fetch_vacation_response(account: str) -> dict:
    """Returns the raw VacationResponse object for the account (a singleton), or {}."""

    client = get_account_client(account)
    with client.batch() as b:
        h = b.vacation.vacation_response.get()

    items = h.result.items
    return items[0].to_wire() if items else {}


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

    enabled = bool(enabled)
    # The API listens UTC: naive values are read as UTC and sent to Stalwart in the ``...Z`` form.
    from_date = normalize_utc_z(from_date)
    to_date = normalize_utc_z(to_date)

    if enabled and (from_date and to_date) and (from_date >= to_date):
        frappe.throw(_("To Date must be after From Date."))

    if not convert_html_to_text(html_body):
        html_body = None

    current_active_sieve_script_id = get_active_sieve_script_id(account)

    previous_vacation_response = _fetch_vacation_response(account)

    client = get_account_client(account)
    with client.batch() as b:
        h = b.vacation.vacation_response.set(
            update={
                "singleton": {
                    "isEnabled": enabled,
                    "fromDate": from_date,
                    "toDate": to_date,
                    "subject": subject,
                    "textBody": text_body,
                    "htmlBody": html_body,
                }
            }
        )

    if h.result.updated:
        if enabled:
            if not previous_vacation_response.get("isEnabled"):
                set_last_active_sieve_script_id(account, current_active_sieve_script_id)
        else:
            activate_last_active_sieve_script(account)


def format_vacation_response(account: str, vr: dict) -> dict:
    """Formats the vacation response data."""

    return {
        "account": account,
        "enabled": cint(vr.get("isEnabled")),
        "from_date": normalize_utc_z(vr.get("fromDate")),
        "to_date": normalize_utc_z(vr.get("toDate")),
        "subject": vr.get("subject"),
        "text_body": vr.get("textBody"),
        "html_body": vr.get("htmlBody"),
        "creation": today(),
        "modified": today(),
    }


def has_permission(doc: Document, ptype: str, user: str | None = None) -> bool:
    if doc.doctype != "Vacation Response" or not doc.get("account"):
        return False

    return bool(get_user_for_jmap_account(doc.account, raise_exception=False))
