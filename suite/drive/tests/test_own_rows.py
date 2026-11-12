"""Drive Settings, Favourite and Recent rows belong to their own user.

Suite User holds read and write on all three doctypes, so every case goes
through Frappe's generic `frappe.client` calls, which any signed-in user can
reach, and checks that the row hooks refuse what the role alone would allow.
"""

import frappe
from frappe import client
from frappe.tests import IntegrationTestCase
from frappe.utils import now_datetime

from suite import drive
from suite.tests.utils import ensure_user

OWNER = "own-rows-owner@example.com"
OTHER = "own-rows-other@example.com"
MANAGER = "own-rows-manager@example.com"
ADMIN = "own-rows-admin@example.com"
DOCTYPES = ("Drive Settings", "Drive Favourite", "Drive Recent")


class TestOwnRows(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for user, roles in (
            (OWNER, ("Suite User",)),
            (OTHER, ("Suite User",)),
            (MANAGER, ("Suite User", "System Manager")),
            (ADMIN, ("Suite User", "Suite Admin")),
        ):
            ensure_user(user)
            frappe.get_doc("User", user).add_roles(*roles)

        frappe.db.commit()

    def setUp(self):
        super().setUp()
        self.addCleanup(frappe.db.rollback)
        self.addCleanup(frappe.set_user, "Administrator")
        self.node = drive.personal_root_for(OWNER) or drive.ensure_personal_root(OWNER)
        self.rows = {doctype: self.row(doctype, OWNER, self.node) for doctype in DOCTYPES}

    def test_another_user_lists_none_of_the_owners_rows(self):
        frappe.set_user(OTHER)
        for doctype in DOCTYPES:
            with self.subTest(doctype):
                self.assertEqual(self.listed(doctype, OWNER), [])

    def test_another_user_cannot_read_the_owners_rows(self):
        frappe.set_user(OTHER)
        for doctype, name in self.rows.items():
            with self.subTest(doctype), self.assertRaises(frappe.PermissionError):
                client.get(doctype, name)

    def test_another_user_cannot_save_the_owners_rows(self):
        saved = {doctype: frappe.get_doc(doctype, name).as_dict() for doctype, name in self.rows.items()}

        frappe.set_user(OTHER)
        for doctype, values in saved.items():
            with self.subTest(doctype), self.assertRaises(frappe.PermissionError):
                client.save(values)

    def test_another_user_cannot_take_the_owners_rows_by_naming_themselves(self):
        saved = {doctype: frappe.get_doc(doctype, name).as_dict() for doctype, name in self.rows.items()}

        frappe.set_user(OTHER)
        for doctype, values in saved.items():
            with self.subTest(doctype), self.assertRaises(frappe.PermissionError):
                client.save({**values, "user": OTHER})

        frappe.set_user("Administrator")
        for doctype, name in self.rows.items():
            self.assertEqual(frappe.db.get_value(doctype, name, "user"), OWNER)

    def test_another_user_cannot_insert_a_row_for_the_owner(self):
        frappe.set_user(OTHER)
        for doctype in DOCTYPES:
            values = {"doctype": doctype, "user": OWNER, "node": self.node, "opened_at": now_datetime()}
            with self.subTest(doctype), self.assertRaises(frappe.PermissionError):
                client.insert(values)

    def test_another_user_cannot_name_their_settings_after_someone_else(self):
        frappe.set_user(OTHER)
        settings = frappe.get_doc({"doctype": "Drive Settings", "name": MANAGER, "user": OTHER})
        settings.flags.name_set = True
        with self.assertRaises(frappe.ValidationError):
            settings.insert()

        frappe.set_user("Administrator")
        self.assertFalse(frappe.db.exists("Drive Settings", MANAGER))

    def test_another_user_cannot_delete_the_owners_rows(self):
        frappe.set_user(OTHER)
        for doctype, name in self.rows.items():
            with self.subTest(doctype), self.assertRaises(frappe.PermissionError):
                client.delete(doctype, name)

        frappe.set_user("Administrator")
        for doctype, name in self.rows.items():
            self.assertTrue(frappe.db.exists(doctype, name))

    def test_the_owner_lists_reads_and_saves_their_own_rows(self):
        frappe.set_user(OWNER)
        for doctype, name in self.rows.items():
            with self.subTest(doctype):
                self.assertEqual(self.listed(doctype, OWNER), [name])
                row = client.get(doctype, name)
                self.assertEqual(row["user"], OWNER)
                client.save(row)

    def test_the_owner_deletes_their_own_favourite_and_recent(self):
        frappe.set_user(OWNER)
        for doctype in ("Drive Favourite", "Drive Recent"):
            client.delete(doctype, self.rows[doctype])

            self.assertFalse(frappe.db.exists(doctype, self.rows[doctype]))

    def test_a_system_manager_without_suite_admin_is_held_to_their_own_rows(self):
        mine = self.row("Drive Settings", MANAGER, None)

        frappe.set_user(MANAGER)
        self.assertEqual(self.listed("Drive Settings", MANAGER), [mine])
        for doctype, name in self.rows.items():
            with self.subTest(doctype), self.assertRaises(frappe.PermissionError):
                client.get(doctype, name)

            self.assertEqual(self.listed(doctype, OWNER), [])

    def test_a_suite_admin_lists_reads_and_saves_the_owners_rows(self):
        frappe.set_user(ADMIN)
        for doctype, name in self.rows.items():
            with self.subTest(doctype):
                self.assertEqual(self.listed(doctype, OWNER), [name])
                row = client.get(doctype, name)
                self.assertEqual(row["user"], OWNER)
                client.save(row)

    @staticmethod
    def row(doctype: str, user: str, node: str | None) -> str:
        if doctype == "Drive Settings" and frappe.db.exists(doctype, user):
            return user

        values = {"doctype": doctype, "user": user}
        if doctype != "Drive Settings":
            values["node"] = node

        if doctype == "Drive Recent":
            values["opened_at"] = now_datetime()

        return frappe.get_doc(values).insert(ignore_permissions=True).name

    @staticmethod
    def listed(doctype: str, user: str) -> list:
        rows = client.get_list(doctype, fields=["name"], filters={"user": user}, limit_page_length=0)
        return [row["name"] for row in rows]
