"""Configured admission and last-Admin invariants across independent site transactions."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from suite import drive
from suite.suite_core.administration import list_users, update_user
from suite.suite_core.storage import state
from suite.tests.utils import ensure_user


class TestAdminRaces(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.storage, _policy, _measurements = state(lock=True)
        self.old_policy = self.storage.policy
        self.old_measurements = self.storage.measurements
        self.users = [f"admin-race-{uuid4().hex}@example.test" for _ in range(2)]
        for user in self.users:
            ensure_user(user)
        self.roots = [frappe.db.get_value("Drive Root", {"user": user}, "name") for user in self.users]
        self.storage.reload()

    def tearDown(self):
        frappe.db.rollback()
        frappe.set_user("Administrator")
        with patch("suite.suite_core.utils.is_suite_cloud_configured", return_value=False):
            for root, user in zip(self.roots, self.users, strict=True):
                frappe.db.delete("Drive Storage Reservation", {"root": root})
                frappe.db.delete("Drive Grant", {"node": root})
                frappe.db.delete("Drive Root", root)
                frappe.db.delete("Drive Node", root)
                frappe.delete_doc("User", user, ignore_permissions=True, force=True)
        frappe.db.set_value(
            "Suite Storage State",
            "site",
            {
                "policy": self.old_policy,
                "measurements": self.old_measurements,
            },
        )
        if hasattr(self, "old_roles"):
            frappe.db.delete("Has Role", {"role": "Suite Admin"})
            for role in self.old_roles:
                frappe.get_doc({"doctype": "Has Role", **role}).db_insert()
        frappe.db.commit()
        super().tearDown()

    def race(self, operation, *, prime_users=False):
        site = frappe.local.site
        barrier = Barrier(2)
        connections = []

        def attempt(index):
            frappe.init(site, force=True)
            frappe.connect()
            frappe.set_user(self.users[index])
            try:
                connections.append((frappe.session.user, frappe.db.sql("SELECT CONNECTION_ID()")[0][0]))
                if prime_users:
                    list_users()
                barrier.wait(timeout=10)
                for retry in range(3):
                    try:
                        operation(index)
                        frappe.db.commit()
                        return "completed"
                    except frappe.QueryDeadlockError:
                        # Drive documents whole-transaction retry when different
                        # roots acquire their own locks before the site lock.
                        frappe.db.rollback()
                        if retry == 2:
                            raise
                    except frappe.ValidationError:
                        frappe.db.rollback()
                        return "refused"
            finally:
                frappe.destroy()

        frappe.db.commit()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(attempt, index) for index in range(2)]
            results = [future.result(timeout=30) for future in futures]
        frappe.db.rollback()
        self.assertEqual({actor for actor, _connection in connections}, set(self.users))
        self.assertEqual(len({connection for _actor, connection in connections}), 2)
        return results

    def test_separate_roots_cannot_both_spend_the_same_configured_site_headroom(self):
        for user in self.users:
            self.assertIn("Suite User", frappe.get_roles(user))
            self.assertNotIn("Suite Admin", frappe.get_roles(user))
            self.assertNotIn("System Manager", frappe.get_roles(user))
        stored = sum(row[0] for row in frappe.db.sql("SELECT used_bytes FROM `tabDrive Root`"))
        # The allowance accounts for pre-existing test-site content; Mail
        # leaves exactly ten bytes of effective space.
        allowance = (int(stored) + 100) * 10
        self.storage.measurements = frappe.as_json(
            {
                "allowance": allowance,
                "site_mail": allowance + allowance // 10 - int(stored) - 10,
                "personal": dict.fromkeys(self.users, 0),
            }
        )
        self.storage.save(ignore_permissions=True)
        keys = [f"configured-race:{uuid4().hex}" for _ in range(2)]
        with patch("suite.suite_core.utils.is_suite_cloud_configured", return_value=True):
            results = self.race(
                lambda index: drive.create_storage_reservation(self.roots[index], keys[index], 6)
            )
        self.assertEqual(sorted(results), ["completed", "refused"])
        self.assertEqual(sum(drive.get_storage_usage(root)["used_bytes"] for root in self.roots), 6)

    def test_concurrent_demotions_cannot_remove_both_remaining_active_admins(self):
        self.old_roles = frappe.get_all("Has Role", filters={"role": "Suite Admin"}, fields=["*"])
        frappe.db.delete("Has Role", {"role": "Suite Admin"})
        for user in self.users:
            frappe.get_doc("User", user).add_roles("Suite Admin")
            self.assertNotIn("System Manager", frappe.get_roles(user))
        results = self.race(
            lambda index: update_user(self.users[1 - index], is_admin=False), prime_users=True
        )
        self.assertEqual(sorted(results), ["completed", "refused"])
        remaining = [row for row in list_users() if row["name"] in self.users and row["is_admin"]]
        self.assertEqual(len(remaining), 1)
