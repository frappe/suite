from io import BytesIO
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite import drive
from suite.composition.admin_storage import report
from suite.suite_core.storage import state
from suite.tests.utils import ensure_user


class TestAdminStorageReport(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.user = f"storage-report-{frappe.generate_hash(length=6)}@example.com"
        ensure_user(self.user)
        doc, _policy, _measurements = state()
        kept = {"policy": doc.policy, "measurements": doc.measurements}
        self.addCleanup(frappe.db.set_value, "Suite Storage State", "site", kept)

    def test_a_users_total_is_their_stored_drive_plus_mail_and_counts_a_reservation_once(self):
        root = drive.ensure_personal_root(self.user)
        drive.store_file(root, "stored.bin", BytesIO(frappe.generate_hash(length=2000).encode()))
        drive.create_storage_reservation(root, f"report-{frappe.generate_hash(length=6)}", 500)
        frappe.db.set_value(
            "Suite Storage State",
            "site",
            {
                "policy": frappe.as_json({"users": {self.user: {"cap": 20000}}}),
                "measurements": frappe.as_json(
                    {"site_mail": 9000, "allowance": 0, "personal": {self.user: 8000}}
                ),
            },
        )

        with patch("suite.composition.admin_storage.is_suite_cloud_configured", return_value=True):
            row = next(user for user in report()["users"] if user["name"] == self.user)

        self.assertEqual(
            (row["drive_bytes"], row["reserved_bytes"], row["mail_bytes"], row["combined_bytes"]),
            (2000, 500, 8000, 10000),
        )
        self.assertEqual((row["cap_bytes"], row["effective_cap_bytes"]), (20000, 22000))
