import frappe
from frappe.tests import IntegrationTestCase

from suite.drive.api.storage import MEGA_BYTE
from suite.meet.patches.backfill_recording_storage_reservations import execute
from suite.tests.utils import ensure_user

OWNER = "storage-reservation-patch@example.com"


class TestBackfillRecordingStorageReservations(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)

    def setUp(self):
        frappe.db.delete("Drive Storage Reservation", {"storage_owner": OWNER})
        frappe.db.delete("Meet Recording", {"room_owner": OWNER})
        frappe.db.set_value("Drive Settings", OWNER, "quota", 1, update_modified=False)

    def test_backfills_lifecycle_amounts_without_quota_admission(self):
        active = self._insert_recording("Recording", 2 * MEGA_BYTE)
        processing_upload = self._insert_recording("Processing", 3 * MEGA_BYTE, upload_size=123)
        processing_budget = self._insert_recording("Processing", 456, upload_size=0)
        terminal = self._insert_recording("Ready", 789)

        execute()
        execute()

        self.assertEqual(self._reserved(active), 2 * MEGA_BYTE)
        self.assertEqual(self._reserved(processing_upload), 123)
        self.assertEqual(self._reserved(processing_budget), 456)
        self.assertIsNone(self._reserved(terminal))

        frappe.db.set_value("Meet Recording", active, "status", "Failed", update_modified=False)
        execute()
        self.assertIsNone(self._reserved(active))

    def _insert_recording(self, status, budget_bytes, upload_size=None):
        recording = frappe.new_doc("Meet Recording")
        recording.name = frappe.generate_hash()
        recording.room_owner = OWNER
        recording.status = status
        recording.budget_bytes = budget_bytes
        recording.upload_size = upload_size
        recording.db_insert()
        return recording.name

    def _reserved(self, recording_name):
        return frappe.db.get_value(
            "Drive Storage Reservation", f"meet-recording:{recording_name}", "reserved_bytes"
        )
