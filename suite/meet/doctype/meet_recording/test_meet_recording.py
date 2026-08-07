# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe.exceptions import ValidationError
from frappe.tests import IntegrationTestCase

from suite.meet.doctype.meet_recording.meet_recording import (
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
