# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Suite's roles open Suite's apps, not Desk: Desk comes only from a role that grants it itself."""

from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from suite.utils.user import assign_role


def new_user(*roles: str) -> frappe.model.document.Document:
    user = frappe.new_doc("User")
    user.email = f"user-roles-{uuid4().hex[:8]}@example.com"
    user.first_name = "User Roles Test"
    for role in roles:
        user.append("roles", {"role": role})
    return user


class TestDeskAccess(IntegrationTestCase):
    def test_new_user_is_a_suite_user_without_desk_access(self):
        user = new_user().insert(ignore_permissions=True)

        self.assertIn("Suite User", frappe.get_roles(user.name))
        self.assertEqual(user.user_type, "Website User")

    def test_suite_admin_has_no_desk_access(self):
        user = new_user("Suite Admin").insert(ignore_permissions=True)

        self.assertEqual(user.user_type, "Website User")

    def test_system_manager_has_desk_access(self):
        user = new_user("System Manager").insert(ignore_permissions=True)

        self.assertEqual(user.user_type, "System User")

    def test_role_created_on_the_fly_has_no_desk_access(self):
        role = f"Fresh Role {uuid4().hex[:8]}"

        assign_role(new_user(), role)

        self.assertEqual(frappe.db.get_value("Role", role, "desk_access"), 0)
