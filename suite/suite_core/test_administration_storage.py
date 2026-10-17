"""Independent combined-limit expectations and business administration access."""

from unittest import TestCase
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.suite_core.administration import guard_user_change, list_users, require_admin, update_user
from suite.suite_core.storage import check_addition, effective_limit, set_default, state, validate_cap
from suite.tests.utils import ensure_user

GB = 1_000_000_000


class TestCombinedStorage(TestCase):
    def check(self, *, cap=10 * GB, buffer=False, site=100 * GB, mail=8 * GB, drive=2 * GB, delta=1):
        check_addition(
            {"users": {"alice": {"cap": cap, "buffer": buffer}}},
            {"allowance": site, "site_mail": mail, "personal": {"alice": mail}},
            user="alice",
            site_drive=drive,
            personal_drive=drive,
            delta=delta,
        )

    def test_mail_consumes_capacity_for_drive_without_becoming_a_mail_limit(self):
        self.assertRaisesRegex(frappe.ValidationError, "user's storage cap", self.check)

    def test_explicit_buffer_adds_one_decimal_gb_to_a_ten_gb_cap(self):
        self.check(buffer=True, delta=GB)
        self.assertRaises(frappe.ValidationError, self.check, buffer=True, delta=GB + 1)

    def test_uncapped_user_still_cannot_spend_site_headroom_twice(self):
        self.check(cap=None, mail=100 * GB, drive=9 * GB, delta=GB)
        self.assertRaisesRegex(
            frappe.ValidationError,
            "site allowance",
            self.check,
            cap=None,
            mail=100 * GB,
            drive=9 * GB,
            delta=GB + 1,
        )

    def test_shared_write_checks_site_not_personal_usage(self):
        check_addition(
            {},
            {"allowance": 100 * GB, "site_mail": 0},
            user=None,
            site_drive=109 * GB,
            personal_drive=0,
            delta=GB,
        )

    def test_missing_measurements_are_not_zero(self):
        self.assertRaises(frappe.ValidationError, self.check, mail=None)
        self.assertRaises(frappe.ValidationError, self.check, site=None)

    def test_cleanup_does_not_require_a_measurement(self):
        check_addition({}, {}, user="alice", site_drive=0, personal_drive=0, delta=0)

    def test_a_byte_neutral_move_can_leave_an_over_allowance_site(self):
        check_addition(
            {"users": {"alice": {"cap": 10 * GB}}},
            {"allowance": 100 * GB, "site_mail": 120 * GB, "personal": {"alice": 0}},
            user="alice",
            site_drive=3 * GB,
            personal_drive=0,
            delta=3 * GB,
            site_delta=0,
        )

    def test_a_byte_neutral_move_still_checks_destination_personal_capacity(self):
        with self.assertRaisesRegex(frappe.ValidationError, "user's storage cap"):
            check_addition(
                {"users": {"alice": {"cap": 10 * GB}}},
                {"allowance": 100 * GB, "site_mail": 120 * GB, "personal": {"alice": 9 * GB}},
                user="alice",
                site_drive=3 * GB,
                personal_drive=0,
                delta=3 * GB,
                site_delta=0,
            )

    def test_cap_validation_and_byte_rounding(self):
        self.assertEqual(effective_limit(11, True), 12)
        self.assertIsNone(effective_limit(None, True))
        self.assertIsNone(validate_cap(None))
        for value in (True, -1, 0, 1.5, "100"):
            self.assertRaises(frappe.ValidationError, validate_cap, value)


class TestAdministrationAccess(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        self.admin = "admin-policy-test@example.test"
        self.normal = "normal-policy-test@example.test"
        self.technical = "technical-policy-test@example.test"
        with self.set_user("Administrator"):
            for user in (self.admin, self.normal, self.technical):
                ensure_user(user)
            frappe.get_doc("User", self.admin).add_roles("Suite Admin")
            frappe.get_doc("User", self.technical).add_roles("System Manager")
        frappe.local.request_cache.clear()

    def test_a_business_admin_without_system_manager_can_read_users(self):
        with self.set_user(self.admin):
            self.assertEqual(require_admin(), self.admin)
            self.assertIn(self.normal, {row["name"] for row in list_users()})

    def test_normal_users_and_technical_managers_cannot_read_or_mutate_policy(self):
        for user in (self.normal, self.technical):
            with self.subTest(user=user), self.set_user(user):
                self.assertRaises(frappe.PermissionError, list_users)
                self.assertRaises(frappe.PermissionError, set_default, GB)

    def test_an_admin_cannot_disable_their_own_account(self):
        with self.set_user(self.admin):
            self.assertRaises(frappe.ValidationError, guard_user_change, self.admin, enabled=False)

    def test_the_last_active_business_admin_cannot_be_demoted(self):
        frappe.db.delete("Has Role", {"role": "Suite Admin", "parent": ["!=", self.admin]})
        with self.set_user("Administrator"):
            self.assertRaises(frappe.ValidationError, guard_user_change, self.admin, is_admin=False)

    def test_future_user_default_is_snapshotted_not_retroactively_applied(self):
        with self.set_user("Administrator"):
            set_default(4 * GB)
            ensure_user("first-default-test@example.test")
            set_default(6 * GB)
            ensure_user("second-default-test@example.test")
            _doc, policy, _measurements = state()
        self.assertEqual(policy["users"]["first-default-test@example.test"]["cap"], 4 * GB)
        self.assertEqual(policy["users"]["second-default-test@example.test"]["cap"], 6 * GB)

    def test_disabling_and_reactivating_restores_the_same_personal_root(self):
        root = frappe.db.get_value("Drive Root", {"user": self.normal, "kind": "Personal"}, "name")
        with (
            self.set_user(self.admin),
            patch("suite.suite_core.utils.is_suite_cloud_configured", return_value=False),
        ):
            update_user(self.normal, enabled=False)
            self.assertEqual(frappe.db.get_value("Drive Root", root, "state"), "Archived")
            update_user(self.normal, enabled=True)
            self.assertEqual(frappe.db.get_value("Drive Root", root, "state"), "Active")
            self.assertEqual(
                frappe.db.get_value("Drive Root", {"user": self.normal, "kind": "Personal"}, "name"), root
            )

    def test_guest_cannot_read_or_change_business_policy(self):
        with self.set_user("Guest"):
            self.assertRaises(frappe.PermissionError, require_admin)

    def test_recovery_administrator_can_administer_without_mail_configuration(self):
        with self.set_user("Administrator"):
            self.assertEqual(require_admin(), "Administrator")
