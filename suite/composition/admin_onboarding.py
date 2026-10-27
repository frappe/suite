"""Confirm real provider-backed readiness before marking business onboarding complete."""

import json

import frappe
from frappe import _

from suite import mail
from suite.suite_core.storage import state


def require_readiness() -> None:
    mail.require_account_ready(frappe.session.user, onboarding=True)
    doc, _policy, previous = state(lock=True)
    measured = mail.storage_measurements(previous, refresh=True)
    if measured.get("allowance") is None:
        frappe.throw(_("Confirm the site's storage allowance before completing onboarding"))
    from suite import drive

    if not any(
        root["user"] == frappe.session.user and root["kind"] == "Personal" and root["state"] == "Active"
        for root in drive.administration_usage()
    ):
        frappe.throw(_("The first Admin's Personal Root is not ready"))
    if measured.get("stale"):
        frappe.throw(_("Provider readiness could not be confirmed. Retry business setup."))
    doc.measurements = json.dumps(measured)
    doc.save(ignore_permissions=True)
