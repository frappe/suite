# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""Migration tests for the Meet reservation backfill.

Covers what ARCHITECTURE.md rule 7.7 requires of a migration: reruns, partial
progress, and failure safety. Every assertion is made through the `suite.drive`
facade or a plain read, never by writing a Drive table.
"""

import uuid
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite import drive
from suite.meet.doctype.meet_recording.meet_recording import recording_storage_reservation_key
from suite.meet.patches.backfill_recording_storage_reservations import execute

PATCH_MODULE = "suite.meet.patches.backfill_recording_storage_reservations"


class IntegrationTestRecordingReservationBackfill(IntegrationTestCase):
    owner = "backfill-owner@example.com"

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        if not frappe.db.exists("User", self.owner):
            frappe.get_doc(
                {
                    "doctype": "User",
                    "email": self.owner,
                    "first_name": "Backfill Owner",
                    "enabled": 1,
                    "new_password": frappe.generate_hash(length=20),
                }
            ).insert(ignore_permissions=True)
        self.root = drive.personal_root_for(self.owner) or drive.ensure_personal_root(self.owner)
        self.used_before = self._used()
        self.rooms = []
        self.recordings = []

    def tearDown(self):
        frappe.set_user("Administrator")
        for name in self.recordings:
            drive.release_storage_reservation(None, recording_storage_reservation_key(name))
            frappe.db.delete("Meet Recording", name)
        for room in self.rooms:
            frappe.delete_doc("Meet Room", room, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDown()

    def _used(self) -> int:
        return int(frappe.db.get_value("Drive Root", self.root, "used_bytes") or 0)

    def _recording(self, *, status: str, budget_bytes: int = 0, upload_size: int = 0) -> str:
        room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert(
            ignore_permissions=True
        )
        self.rooms.append(room.name)
        recording = frappe.get_doc(
            {
                "doctype": "Meet Recording",
                "meet_room": room.name,
                "room_owner": self.owner,
                "initiated_by": self.owner,
                "status": "Pending",
                "recorder_job_id": frappe.generate_hash(length=32),
                "request_id": str(uuid.uuid4()),
                "budget_bytes": budget_bytes,
                "upload_size": upload_size,
            }
        ).insert(ignore_permissions=True)
        self.recordings.append(recording.name)
        frappe.db.set_value("Meet Recording", recording.name, "status", status, update_modified=False)
        frappe.db.commit()
        return recording.name

    def _reservation(self, name: str):
        return drive.get_storage_reservation(recording_storage_reservation_key(name))

    def _budget(self, name: str) -> int:
        return int(frappe.db.get_value("Meet Recording", name, "budget_bytes") or 0)

    def test_first_run_charges_live_recordings_and_releases_terminal_ones(self):
        live = self._recording(status="Recording", budget_bytes=500)
        processing = self._recording(status="Processing", budget_bytes=900, upload_size=300)
        terminal = self._recording(status="Ready", budget_bytes=700)

        execute()

        self.assertEqual(self._reservation(live).root, self.root)
        self.assertEqual(self._reservation(live).reserved_bytes, 500)
        self.assertEqual(self._reservation(processing).reserved_bytes, 300)
        self.assertIsNone(self._reservation(terminal))
        self.assertEqual(self._used(), self.used_before + 800)

    def test_a_terminal_recording_never_provisions_a_root(self):
        terminal = self._recording(status="Cancelled", budget_bytes=700)

        with (
            patch(f"{PATCH_MODULE}.drive.personal_root_for", return_value=None),
            patch(f"{PATCH_MODULE}.drive.ensure_personal_root", return_value=None) as ensure_root,
            patch("frappe.log_error"),
        ):
            execute()
            after_terminal = [call.args[0] for call in ensure_root.call_args_list]

            live = self._recording(status="Recording", budget_bytes=100)
            ensure_root.reset_mock()
            execute()
            after_live = [call.args[0] for call in ensure_root.call_args_list]

        self.assertNotIn(self.owner, after_terminal)
        self.assertIn(self.owner, after_live)
        self.assertIsNone(self._reservation(terminal))
        self.assertIsNone(self._reservation(live))
        self.assertEqual(self._used(), self.used_before)

    def test_rerun_is_idempotent_and_never_rebinds_or_double_charges(self):
        live = self._recording(status="Recording", budget_bytes=500)
        execute()
        charged = self._used()
        bound = self._reservation(live).root

        execute()
        execute()

        self.assertEqual(self._reservation(live).root, bound)
        self.assertEqual(self._reservation(live).reserved_bytes, 500)
        self.assertEqual(self._used(), charged)

    def test_rerun_keeps_the_binding_even_when_the_owner_root_has_changed(self):
        live = self._recording(status="Recording", budget_bytes=500)
        execute()
        bound = self._reservation(live).root

        # Stand in for a same-email replacement identity: the patch resolves a
        # different Active root, and must still not move a charged reservation.
        with patch(f"{PATCH_MODULE}.drive.personal_root_for", return_value="some-other-root"):
            execute()

        self.assertEqual(self._reservation(live).root, bound)
        self.assertEqual(self._used(), self.used_before + 500)

    def test_rerun_corrects_a_changed_budget_on_the_bound_root(self):
        live = self._recording(status="Recording", budget_bytes=500)
        execute()
        frappe.db.set_value("Meet Recording", live, "budget_bytes", 800, update_modified=False)

        execute()

        self.assertEqual(self._reservation(live).reserved_bytes, 800)
        self.assertEqual(self._used(), self.used_before + 800)

        frappe.db.set_value("Meet Recording", live, "budget_bytes", 200, update_modified=False)
        execute()

        self.assertEqual(self._reservation(live).reserved_bytes, 200)
        self.assertEqual(self._used(), self.used_before + 200)

    def test_one_failure_keeps_partial_progress_and_the_rerun_finishes_the_rest(self):
        good = self._recording(status="Recording", budget_bytes=500)
        bad = self._recording(status="Recording", budget_bytes=400)
        real_bind = drive.bind_legacy_storage_reservation

        def fail_on_bad(root, key, reserved_bytes):
            if key == recording_storage_reservation_key(bad):
                raise RuntimeError("injected backfill failure")
            return real_bind(root, key, reserved_bytes)

        with (
            patch(f"{PATCH_MODULE}.drive.bind_legacy_storage_reservation", side_effect=fail_on_bad),
            patch("frappe.log_error") as log_error,
        ):
            execute()

        log_error.assert_called()
        self.assertEqual(self._reservation(good).reserved_bytes, 500)
        self.assertIsNone(self._reservation(bad))
        self.assertEqual(self._used(), self.used_before + 500)

        execute()

        self.assertEqual(self._reservation(bad).reserved_bytes, 400)
        self.assertEqual(self._used(), self.used_before + 900)
