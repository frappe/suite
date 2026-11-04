import frappe

from suite.content import log
from suite.sheets.content import APP, turn_on


def execute() -> None:
    """Turn Sheets' collaboration on, which it then stays; a first turn-on pauses conversion until the owner unpauses it after the restart."""
    already_on = log.mode(APP) == "on"
    turn_on()
    if not already_on:
        row = {"parent": "Suite Collab Settings", "parentfield": "apps", "app": APP}
        frappe.db.set_value("Suite Collab App", row, "conversion_paused", 1)
        frappe.clear_document_cache("Suite Collab Settings", "Suite Collab Settings")
