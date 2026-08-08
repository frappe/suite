# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

from unittest.mock import patch

import frappe
import jwt
from frappe.client import delete as delete_document
from frappe.tests import IntegrationTestCase

from suite.meet.api.meeting import (
    get_public_meeting_preview,
    get_sfu_connection_details,
    get_sfu_presence_preview_token,
    join_meeting,
    join_meeting_as_guest,
)


class IntegrationTestMeetingApi(IntegrationTestCase):
    def setUp(self):
        frappe.conf.sfu_secret = "test-sfu-secret"

        self.host_email = "host-meet@example.com"
        self.member_email = "member-meet@example.com"
        self.outsider_email = "outsider-meet@example.com"

        for email, first_name in (
            (self.host_email, "Host"),
            (self.member_email, "Member"),
            (self.outsider_email, "Outsider"),
        ):
            self._ensure_user(email, first_name)

        self.meeting = self._create_meeting(self.host_email, meeting_type="restricted")

    def test_member_can_get_sfu_connection_details(self):
        self.meeting.add_user_to_table("members", self.member_email, save=True, ignore_permissions=True)

        frappe.set_user(self.member_email)

        result = get_sfu_connection_details(self.meeting.name)

        self.assertEqual(result["user_id"], self.member_email)
        self.assertEqual(result["meeting_id"], self.meeting.name)
        self.assertTrue(result["auth_token"])
        self.assertFalse(result["e2ee_required"])
        self.assertNotIn("e2ee_host_public_key", result)
        self.assertIn("is_host", result)
        self.assertFalse(result["is_host"])
        self.assertIn("is_cohost", result)
        self.assertFalse(result["is_cohost"])

    def test_host_gets_is_host_from_sfu_connection_details(self):
        self.meeting.add_user_to_table("members", self.host_email, save=True, ignore_permissions=True)

        frappe.set_user(self.host_email)

        result = get_sfu_connection_details(self.meeting.name)

        self.assertTrue(result["is_host"])
        self.assertFalse(result["is_cohost"])

        decoded = jwt.decode(
            result["auth_token"],
            frappe.conf.sfu_secret,
            algorithms=["HS256"],
        )

        self.assertEqual(decoded["site"], frappe.local.site)
        self.assertEqual(decoded["meeting_id"], self.meeting.name)

    def test_sfu_connection_details_include_disabled_global_recording_setting(self):
        self.meeting.add_user_to_table("members", self.host_email, save=True, ignore_permissions=True)
        frappe.db.set_single_value("Meet Settings", "enable_recording", 0)
        frappe.clear_cache(doctype="Meet Settings")
        self.addCleanup(frappe.clear_cache, doctype="Meet Settings")
        frappe.set_user(self.host_email)

        result = get_sfu_connection_details(self.meeting.name)

        self.assertFalse(result["recording_enabled"])

    def test_sfu_token_site_claim_keeps_cross_site_meetings_isolated(self):
        """Two sites with meetings of the same name must mint tokens that
        carry different `site` claims so the SFU can route them to distinct
        rooms."""
        from suite.meet.api.meeting import _generate_sfu_token

        token_a = _generate_sfu_token(
            user_id="user-a",
            meeting_id="all-hands",
            site="site-a.example.com",
        )
        token_b = _generate_sfu_token(
            user_id="user-b",
            meeting_id="all-hands",
            site="site-b.example.com",
        )

        decoded_a = jwt.decode(token_a, frappe.conf.sfu_secret, algorithms=["HS256"])
        decoded_b = jwt.decode(token_b, frappe.conf.sfu_secret, algorithms=["HS256"])

        self.assertEqual(decoded_a["meeting_id"], decoded_b["meeting_id"])
        self.assertNotEqual(decoded_a["site"], decoded_b["site"])

    def test_restricted_meeting_non_member_cannot_get_sfu_connection_details(self):
        frappe.set_user(self.outsider_email)

        with self.assertRaises(frappe.PermissionError):
            get_sfu_connection_details(self.meeting.name)

    def test_only_host_and_cohost_can_read_meeting_document(self):
        self.meeting.add_user_to_table("members", self.member_email, save=True, ignore_permissions=True)
        self.meeting.add_user_to_table("co_hosts", self.outsider_email, save=True, ignore_permissions=True)

        frappe.set_user(self.member_email)
        with self.assertRaises(frappe.PermissionError):
            frappe.get_doc("Meet Room", self.meeting.name).check_permission("read")

        for user in (self.host_email, self.outsider_email):
            frappe.set_user(user)
            frappe.get_doc("Meet Room", self.meeting.name).check_permission("read")

    def test_non_member_gets_public_preview_title_without_read_access(self):
        self.meeting.title = "Quarterly planning"
        self.meeting.save(ignore_permissions=True)

        frappe.set_user(self.outsider_email)
        with self.assertRaises(frappe.PermissionError):
            frappe.get_doc("Meet Room", self.meeting.name).check_permission("read")

        self.assertEqual(get_public_meeting_preview(self.meeting.name)["title"], "Quarterly planning")

    def test_meeting_list_only_contains_hosted_or_cohosted_meetings(self):
        self.meeting.add_user_to_table("co_hosts", self.member_email, save=True, ignore_permissions=True)

        frappe.set_user(self.member_email)
        self.assertIn(
            self.meeting.name,
            frappe.get_list("Meet Room", pluck="name"),
        )

        frappe.set_user(self.outsider_email)
        self.assertNotIn(
            self.meeting.name,
            frappe.get_list("Meet Room", pluck="name"),
        )

    def test_only_host_can_delete_meeting_through_frappe_api(self):
        frappe.set_user(self.outsider_email)
        with self.assertRaises(frappe.PermissionError):
            delete_document("Meet Room", self.meeting.name)

        self.assertTrue(frappe.db.exists("Meet Room", self.meeting.name))

        frappe.set_user(self.host_email)
        delete_document("Meet Room", self.meeting.name)

        self.assertFalse(frappe.db.exists("Meet Room", self.meeting.name))

    def test_join_meeting_returns_sfu_connection_details(self):
        """join_meeting bundles SFU JWT so clients skip a second RTT."""
        self.meeting.add_user_to_table("members", self.member_email, save=True, ignore_permissions=True)
        self.meeting.db_set("meeting_type", "open")

        frappe.set_user(self.member_email)
        result = join_meeting(self.meeting.name)

        self.assertEqual(result["status"], "joined")
        self.assertTrue(result.get("auth_token"))
        self.assertEqual(result["user_id"], self.member_email)
        self.assertEqual(result["meeting_id"], self.meeting.name)
        self.assertIn("sfu_url", result)
        self.assertIn("codec_strategy", result)

        decoded = jwt.decode(
            result["auth_token"],
            frappe.conf.sfu_secret,
            algorithms=["HS256"],
        )
        self.assertEqual(decoded["user_id"], self.member_email)
        self.assertEqual(decoded["meeting_id"], self.meeting.name)
        self.assertEqual(decoded.get("scope", "full"), "full")

    def test_guest_join_returns_active_recording_state(self):
        self.meeting.db_set("meeting_type", "open")
        frappe.set_user("Guest")
        recording = {
            "name": "recording-1",
            "status": "Recording",
            "state_revision": 1,
        }

        with patch(
            "suite.meet.api.meeting.get_active_recording_state",
            return_value=recording,
        ):
            result = join_meeting_as_guest(self.meeting.name, "Late Guest")

        self.assertEqual(result["status"], "joined")
        self.assertEqual(result["recording"], recording)

    def test_restricted_waiting_join_does_not_return_full_media_token(self):
        frappe.set_user(self.outsider_email)
        result = join_meeting(self.meeting.name)

        self.assertEqual(result["status"], "waiting_for_approval")
        self.assertNotIn("auth_token", result)
        self.assertIn("lobby_token", result)

        decoded = jwt.decode(
            result["lobby_token"],
            frappe.conf.sfu_secret,
            algorithms=["HS256"],
        )
        self.assertEqual(decoded["scope"], "presence-preview")

    def _ensure_user(self, email: str, first_name: str):
        if frappe.db.exists("User", email):
            return frappe.get_doc("User", email)

        user = frappe.get_doc(
            {
                "doctype": "User",
                "email": email,
                "first_name": first_name,
                "enabled": 1,
                "new_password": "password",
            }
        )
        user.insert(ignore_permissions=True)
        return user

    def _create_meeting(self, owner: str, meeting_type: str = "open"):
        frappe.set_user(owner)
        meeting = frappe.get_doc(
            {
                "doctype": "Meet Room",
                "meeting_type": meeting_type,
                "allow_guest": 1,
            }
        )
        meeting.insert(ignore_permissions=True)
        return meeting
