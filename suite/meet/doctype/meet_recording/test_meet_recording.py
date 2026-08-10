# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import json

import frappe
from frappe.exceptions import ValidationError
from frappe.tests import IntegrationTestCase

from suite.meet.doctype.meet_recording.meet_recording import (
    ALLOWED_TRANSITIONS,
    get_permission_query_conditions,
    has_permission,
)


class TestMeetRecording(IntegrationTestCase):
    def test_recording_policy_defaults_off(self):
        self.assertEqual(frappe.get_meta("Meet Settings").get_field("enable_recording").default, "0")

    def test_recording_doctype_is_private(self):
        meta = frappe.get_meta("Meet Recording")
        self.assertFalse(meta.index_web_pages_for_search)
        self.assertEqual({permission.role for permission in meta.permissions}, {"System Manager"})

    def test_room_owner_has_read_only_access(self):
        doc = frappe.new_doc("Meet Recording")
        doc.room_owner = "owner@example.com"

        self.assertTrue(has_permission(doc, "read", "owner@example.com"))
        self.assertFalse(has_permission(doc, "write", "owner@example.com"))
        self.assertFalse(has_permission(doc, "delete", "owner@example.com"))
        self.assertFalse(has_permission(doc, "read", "initiator@example.com"))
        self.assertIn("room_owner", get_permission_query_conditions("owner@example.com"))
        self.assertFalse(has_permission(doc, "read", "Guest"))
        self.assertEqual(get_permission_query_conditions("Guest"), "1 = 0")

    def test_recording_must_start_pending_for_room_owner(self):
        room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert()
        recording = frappe.get_doc(
            {
                "doctype": "Meet Recording",
                "meet_room": room.name,
                "room_owner": room.owner,
                "initiated_by": room.owner,
                "status": "Recording",
                "estimated_seconds": 3600,
                "estimated_bytes": 1,
                "budget_bytes": 1,
                "recorder_job_id": frappe.generate_hash(),
                "request_id": frappe.generate_hash(),
                "drive_home_folder": "missing",
            }
        )
        with self.assertRaisesRegex(ValidationError, "begin in Pending"):
            recording.insert(ignore_links=True)

    def test_recording_owner_must_match_room(self):
        room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert()
        recording = frappe.get_doc(
            {
                "doctype": "Meet Recording",
                "meet_room": room.name,
                "room_owner": "Guest",
                "initiated_by": room.owner,
                "status": "Pending",
                "estimated_seconds": 3600,
                "estimated_bytes": 1,
                "budget_bytes": 1,
                "recorder_job_id": frappe.generate_hash(),
                "request_id": frappe.generate_hash(),
                "drive_home_folder": "missing",
            }
        )
        with self.assertRaisesRegex(ValidationError, "must match"):
            recording.insert(ignore_links=True)

    def test_recording_state_transition_matrix(self):
        room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert()
        statuses = (
            "Pending",
            "Recording",
            "Interrupted",
            "Stopping",
            "Processing",
            "Ready",
            "Partial",
            "Failed",
        )

        for source in statuses:
            for target in statuses:
                if source == target:
                    continue
                with self.subTest(source=source, target=target):
                    recording = self._recording_in_status(room, source)
                    self._prepare_target(recording, target)
                    allowed = target in ALLOWED_TRANSITIONS.get(source, set())
                    if allowed:
                        recording.save(ignore_permissions=True)
                        self.assertEqual(recording.status, target)
                    else:
                        with self.assertRaisesRegex(
                            ValidationError, "Invalid recording state transition|terminal recording"
                        ):
                            recording.save(ignore_permissions=True)

    def test_terminal_recording_cannot_be_modified(self):
        room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert()
        recording = self._recording_in_status(room, "Failed")
        recording.captured_bytes = 1

        with self.assertRaisesRegex(ValidationError, "terminal recording cannot be modified"):
            recording.save(ignore_permissions=True)

    def test_recording_identity_and_operation_ids_are_immutable(self):
        room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert()
        recording = self._recording_in_status(room, "Recording")
        recording.request_id = frappe.generate_hash()

        with self.assertRaisesRegex(ValidationError, "Recording identity cannot change"):
            recording.save(ignore_permissions=True)

        recording.reload()
        recording.grant_jti = "original-grant"
        recording.save(ignore_permissions=True)
        recording.grant_jti = "replacement-grant"
        with self.assertRaisesRegex(ValidationError, "operation identifiers cannot change"):
            recording.save(ignore_permissions=True)

    def test_transition_requires_exact_revision_and_newer_recorder_sequence(self):
        room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert()
        recording = self._recording_in_status(room, "Recording")
        recording.status = "Interrupted"
        recording.state_revision += 2
        recording.recorder_event_sequence += 1
        with self.assertRaisesRegex(ValidationError, "revision must increase by one"):
            recording.save(ignore_permissions=True)

        recording.reload()
        recording.status = "Interrupted"
        recording.state_revision += 1
        with self.assertRaisesRegex(ValidationError, "newer recorder event"):
            recording.save(ignore_permissions=True)

    def _recording_in_status(self, room, status: str):
        recording = frappe.get_doc(
            {
                "doctype": "Meet Recording",
                "meet_room": room.name,
                "room_owner": room.owner,
                "initiated_by": room.owner,
                "status": "Pending",
                "estimated_seconds": 3600,
                "estimated_bytes": 1024,
                "budget_bytes": 1024,
                "recorder_job_id": frappe.generate_hash(),
                "request_id": frappe.generate_hash(),
                "drive_home_folder": "missing",
            }
        ).insert(ignore_links=True)
        if status != "Pending":
            values = self._state_values(status)
            values.update({"status": status, "state_revision": 1, "recorder_event_sequence": 1})
            frappe.db.set_value("Meet Recording", recording.name, values, update_modified=False)
            recording.reload()
        return recording

    def _prepare_target(self, recording, status: str):
        recording.status = status
        recording.state_revision = int(recording.state_revision or 0) + 1
        recording.recorder_event_sequence = int(recording.recorder_event_sequence or 0) + 1
        for fieldname, value in self._state_values(status).items():
            recording.set(fieldname, value)
        recording.flags.ignore_links = True

    def _state_values(self, status: str) -> dict:
        values = {}
        if status in ("Recording", "Interrupted", "Stopping", "Processing", "Ready", "Partial"):
            values.update({"started_at": "2026-08-01 00:00:00", "max_ends_at": "2026-08-01 04:00:00"})
        if status in ("Processing", "Ready", "Partial"):
            values.update({"ended_at": "2026-08-01 00:01:00", "end_reason": "host_stop"})
        if status in ("Ready", "Partial"):
            values.update(
                {
                    "artifact": "missing-artifact",
                    "artifact_size": 1024,
                    "artifact_duration": 60,
                    "artifact_sha256": "a" * 64,
                }
            )
        if status == "Partial":
            values["capture_gaps"] = json.dumps(
                [
                    {
                        "started_at": "2026-08-01 00:00:10",
                        "ended_at": "2026-08-01 00:00:20",
                        "reason": "capture_interrupted",
                    }
                ]
            )
        elif status == "Ready":
            values["capture_gaps"] = "[]"
        if status == "Failed":
            values["failure_code"] = "capture_failed"
        return values
