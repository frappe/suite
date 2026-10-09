"""Record sensitive workflow outcomes without request payloads, credentials, or exception text."""

import frappe


def record(action: str, target: str | None, outcome: str) -> None:
    try:
        frappe.logger("suite_admin", allow_site=True).info(
            {
                "actor": frappe.session.user,
                "action": action,
                "target": target,
                "outcome": outcome,
            }
        )
    except Exception:
        # Logging failure must not undo an external credential revocation.
        pass
