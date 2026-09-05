from unittest.mock import call, patch

import frappe
from frappe.tests import UnitTestCase

from suite.drive._core.errors import DriveNotFound, DriveOverQuota
from suite.drive._core.quota import (
    ADMIT_SQL,
    RELEASE_SQL,
    admit,
    effective_quota,
    preflight,
    release,
    root_for_node,
)


class TestQuotaContract(UnitTestCase):
    @patch("suite.drive._core.quota.frappe.get_cached_doc")
    def test_effective_quota_prefers_override_then_kind_default(self, get_settings):
        get_settings.return_value = frappe._dict(default_personal_quota=100, shared_quota=200)

        self.assertEqual(effective_quota({"kind": "Personal", "quota_bytes": 50}), 50)
        self.assertEqual(effective_quota({"kind": "Personal", "quota_bytes": 0}), 100)
        self.assertEqual(effective_quota({"kind": "Shared", "quota_bytes": 0}), 200)

    def test_unknown_root_kind_is_not_treated_as_personal(self):
        with self.assertRaises(frappe.ValidationError):
            effective_quota({"kind": "Unknown", "quota_bytes": 0})

    @patch("suite.drive._core.quota.effective_quota", return_value=100)
    def test_preflight_is_read_only_and_uses_declared_bytes(self, _effective):
        preflight({"used_bytes": 60}, 40)
        with self.assertRaises(DriveOverQuota):
            preflight({"used_bytes": 60}, 41)

    @patch("suite.drive._core.quota._", side_effect=lambda message: message)
    @patch("suite.drive._core.quota.effective_quota", return_value=100)
    @patch("suite.drive._core.quota.frappe.db.get_value")
    @patch("suite.drive._core.quota.frappe.db.sql")
    def test_admit_is_one_conditional_counter_update(self, sql, get_value, _effective, _translate):
        get_value.return_value = frappe._dict(name="root", kind="Personal", quota_bytes=0)
        sql.side_effect = [None, [(1,)]]

        admit("root", 25)

        self.assertEqual(
            sql.call_args_list[0],
            call(ADMIT_SQL, {"root": "root", "delta": 25, "effective_quota": 100}),
        )
        self.assertEqual(sql.call_args_list[1], call("SELECT ROW_COUNT()"))

    @patch("suite.drive._core.quota._", side_effect=lambda message: message)
    @patch("suite.drive._core.quota.effective_quota", return_value=100)
    @patch("suite.drive._core.quota.frappe.db.get_value")
    @patch("suite.drive._core.quota.frappe.db.sql")
    def test_admit_refuses_a_lost_size_race(self, sql, get_value, _effective, _translate):
        get_value.return_value = frappe._dict(name="root", kind="Personal", quota_bytes=0)
        sql.side_effect = [None, [(0,)]]

        with self.assertRaises(DriveOverQuota):
            admit("root", 25)

    @patch("suite.drive._core.quota.frappe.db.sql")
    @patch("suite.drive._core.quota.frappe.db.get_value")
    def test_zero_admission_does_not_depend_on_changed_row_count(self, get_value, sql):
        admit("root", 0)
        get_value.assert_not_called()
        sql.assert_not_called()

    @patch("suite.drive._core.quota.frappe.db.sql")
    def test_release_uses_a_floored_decrement(self, sql):
        release("root", 12)
        sql.assert_called_once_with(RELEASE_SQL, {"root": "root", "delta": 12})
        self.assertIn("GREATEST", RELEASE_SQL)

    @patch("suite.drive._core.quota.validate_root_pair")
    def test_malformed_root_pair_is_not_an_accounting_target(self, validate_pair):
        validate_pair.side_effect = frappe.ValidationError("malformed")
        with self.assertRaises(DriveNotFound):
            root_for_node({"name": "root", "kind": "root"})
        validate_pair.assert_called_once_with("root")
