# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe.tests.utils import whitelist_for_tests

E2E_HOST_EMAIL = "meet-e2e-host@example.com"
E2E_HOST_PASSWORD = "MeetE2EHost!2026"


@whitelist_for_tests(methods=["POST"])
def provision_host() -> dict[str, str]:
    frappe.only_for("System Manager")

    if frappe.db.exists("User", E2E_HOST_EMAIL):
        user = frappe.get_doc("User", E2E_HOST_EMAIL)
        user.enabled = 1
        user.new_password = E2E_HOST_PASSWORD
        user.save(ignore_permissions=True)
    else:
        user = frappe.get_doc(
            {
                "doctype": "User",
                "email": E2E_HOST_EMAIL,
                "first_name": "Meet E2E Host",
                "enabled": 1,
                "send_welcome_email": 0,
                "new_password": E2E_HOST_PASSWORD,
            }
        )
        user.insert(ignore_permissions=True)

    user.add_roles("Suite User")
    return {"email": E2E_HOST_EMAIL, "password": E2E_HOST_PASSWORD}


@whitelist_for_tests()
def clear_create_rate_limit() -> None:
    """Clear meeting creation, join meeting as guest rate limit cache."""
    keys = frappe.cache.get_keys("rl:suite.meet.api.meeting.join_meeting_as_guest:*")
    keys += frappe.cache.get_keys("rl:suite.meet.api.meeting.create:*")
    for key in keys:
        frappe.cache.set(key, 0)  # nosemgrep
