# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import time
from unittest.mock import patch

import frappe
import jwt
from frappe.client import delete as delete_document
from frappe.tests import IntegrationTestCase

from suite.meet.api.meeting import (
    approve_all_join_requests,
    approve_join_request,
    get_approved_guest_connection_details,
    get_guest_sfu_connection_details,
    get_public_meeting_preview,
    get_sfu_connection_details,
    get_sfu_presence_preview_token,
    get_waiting_room,
    join_meeting,
    join_meeting_as_guest,
    promote_to_cohost,
    refresh_sfu_token,
    reject_join_request,
)
from suite.meet.utils.user import set_guest_session


class IntegrationTestMeetingApi(IntegrationTestCase):
    def setUp(self):
        frappe.conf.sfu_secret = "test-sfu-secret"
        frappe.db.set_single_value("Meet Settings", "allow_guest", 1)
        frappe.clear_cache(doctype="Meet Settings")

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

    def test_presence_preview_token_includes_required_participant_claims(self):
        frappe.set_user(self.host_email)

        result = get_sfu_presence_preview_token(self.meeting.name)
        decoded = jwt.decode(result["auth_token"], frappe.conf.sfu_secret, algorithms=["HS256"])

        self.assertEqual(decoded["user_name"], "Host")
        self.assertTrue(decoded["is_host"])
        self.assertFalse(decoded["is_cohost"])
        self.assertFalse(decoded["is_guest"])

    def test_sfu_connection_details_include_disabled_global_recording_setting(self):
        self.meeting.add_user_to_table("members", self.host_email, save=True, ignore_permissions=True)
        frappe.db.set_single_value("Meet Settings", "enable_recording", 0)
        frappe.clear_cache(doctype="Meet Settings")
        self.addCleanup(frappe.clear_cache, doctype="Meet Settings")
        frappe.set_user(self.host_email)

        result = get_sfu_connection_details(self.meeting.name)

        self.assertFalse(result["recording_enabled"])

    def test_sfu_token_reserved_extra_claims_cannot_be_overridden(self):
        from suite.meet.api.meeting import _generate_sfu_token

        for claim, value in (
            ("site", "other.example.com"),
            ("iat", 1),
            ("exp", 2),
        ):
            with self.subTest(claim=claim), self.assertRaises(frappe.ValidationError):
                _generate_sfu_token("user-a", "all-hands", **{claim: value})

    def test_full_sfu_token_has_exact_server_issued_claims(self):
        self.meeting.add_user_to_table("members", self.host_email, save=True, ignore_permissions=True)
        frappe.set_user(self.host_email)

        now = int(time.time())
        with patch("suite.meet.api.meeting.time.time", return_value=now):
            result = get_sfu_connection_details(self.meeting.name)
        decoded = jwt.decode(result["auth_token"], frappe.conf.sfu_secret, algorithms=["HS256"])

        self.assertEqual(
            set(decoded),
            {
                "user_id",
                "meeting_id",
                "site",
                "scope",
                "exp",
                "iat",
                "user_name",
                "user_avatar",
                "is_host",
                "is_cohost",
                "e2ee_required",
            },
        )
        self.assertEqual(decoded["site"], frappe.local.site)
        self.assertEqual(decoded["iat"], now)
        self.assertEqual(decoded["exp"], now + 3600)
        self.assertEqual(decoded["scope"], "full")

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

    def test_banned_member_cannot_refresh_sfu_token(self):
        self.meeting.add_user_to_table("members", self.member_email, save=True, ignore_permissions=True)
        self.meeting.add_user_to_table("banned_users", self.member_email, save=True, ignore_permissions=True)
        frappe.set_user(self.member_email)

        with self.assertRaises(frappe.PermissionError):
            refresh_sfu_token(self.meeting.name)

    def test_approved_guest_session_cannot_cross_meet_rooms(self):
        guest_id = f"guest_{frappe.generate_hash(length=16)}"
        set_guest_session(
            guest_id,
            {"guest_id": guest_id, "guest_name": "Room A Guest", "meeting_id": self.meeting.name},
        )
        other_room = self._create_meeting(self.host_email, meeting_type="restricted")
        other_room.add_user_to_table("members", guest_id, save=True, ignore_permissions=True)
        frappe.set_user("Guest")

        with self.assertRaises(frappe.PermissionError):
            get_approved_guest_connection_details(other_room.name, guest_id)

    def test_approved_guest_rechecks_current_guest_policy(self):
        frappe.set_user("Guest")
        waiting = join_meeting_as_guest(self.meeting.name, "Policy Guest")
        guest_id = waiting["guest_id"]
        frappe.set_user(self.host_email)
        approve_join_request(self.meeting.name, guest_id)

        frappe.db.set_single_value("Meet Settings", "allow_guest", 0)
        frappe.clear_cache(doctype="Meet Settings")
        frappe.set_user("Guest")
        with self.assertRaises(frappe.PermissionError):
            get_approved_guest_connection_details(self.meeting.name, guest_id)

    def test_approved_guest_rechecks_room_guest_policy(self):
        frappe.set_user("Guest")
        waiting = join_meeting_as_guest(self.meeting.name, "Room Policy Guest")
        guest_id = waiting["guest_id"]
        frappe.set_user(self.host_email)
        approve_join_request(self.meeting.name, guest_id)
        self.meeting.db_set("allow_guest", 0)

        frappe.set_user("Guest")
        with self.assertRaises(frappe.PermissionError):
            get_approved_guest_connection_details(self.meeting.name, guest_id)

    def test_expired_or_deleted_guest_session_cannot_reconnect(self):
        frappe.set_user("Guest")
        waiting = join_meeting_as_guest(self.meeting.name, "Expired Guest")
        guest_id = waiting["guest_id"]
        frappe.set_user(self.host_email)
        approve_join_request(self.meeting.name, guest_id)
        frappe.cache.delete_value(f"guest_session:{guest_id}")

        frappe.set_user("Guest")
        with self.assertRaisesRegex(frappe.ValidationError, "not found or expired"):
            get_approved_guest_connection_details(self.meeting.name, guest_id)

    def test_rejected_guest_session_cannot_reconnect(self):
        frappe.set_user("Guest")
        waiting = join_meeting_as_guest(self.meeting.name, "Rejected Guest")
        guest_id = waiting["guest_id"]
        frappe.set_user(self.host_email)
        reject_join_request(self.meeting.name, guest_id)

        frappe.set_user("Guest")
        with self.assertRaises(frappe.ValidationError):
            get_approved_guest_connection_details(self.meeting.name, guest_id)

    def test_guest_connection_details_recheck_ban_and_session(self):
        self.meeting.db_set("meeting_type", "open")
        frappe.set_user("Guest")
        joined = join_meeting_as_guest(self.meeting.name, "Banned Guest")

        frappe.set_user(self.host_email)
        room = frappe.get_doc("Meet Room", self.meeting.name)
        room.add_user_to_table("banned_users", joined["guest_id"], save=True, ignore_permissions=True)
        frappe.set_user("Guest")

        with self.assertRaises(frappe.PermissionError):
            get_guest_sfu_connection_details(self.meeting.name, joined["auth_token"])

    def test_waiting_room_apis_reject_member_and_outsider(self):
        self._join_waiting(self.member_email)

        for user in (self.member_email, self.outsider_email):
            with self.subTest(user=user):
                frappe.set_user(user)
                with self.assertRaises(frappe.ValidationError):
                    get_waiting_room(self.meeting.name)
                with self.assertRaises(frappe.ValidationError):
                    approve_join_request(self.meeting.name, self.member_email)
                with self.assertRaises(frappe.ValidationError):
                    reject_join_request(self.meeting.name, self.member_email)
                with self.assertRaises(frappe.ValidationError):
                    approve_all_join_requests(self.meeting.name)
                with self.assertRaises(frappe.ValidationError):
                    promote_to_cohost(self.meeting.name, self.member_email)
                with self.assertRaises(frappe.ValidationError):
                    frappe.get_doc("Meet Room", self.meeting.name).update_settings(host_only_chat=1)

        self.meeting.reload()
        self.assertIn(self.member_email, self.meeting.get_waiting_room())
        self.assertNotIn(self.member_email, self.meeting.get_members())

    def test_approval_atomically_moves_waiting_user_to_members(self):
        self._join_waiting(self.member_email)
        frappe.set_user(self.host_email)

        approve_join_request(self.meeting.name, self.member_email)

        self.meeting.reload()
        self.assertNotIn(self.member_email, self.meeting.get_waiting_room())
        self.assertEqual(self.meeting.get_members().count(self.member_email), 1)

    def test_rejection_removes_and_bans_waiting_user_once(self):
        self._join_waiting(self.member_email)
        frappe.set_user(self.host_email)

        reject_join_request(self.meeting.name, self.member_email)

        self.meeting.reload()
        self.assertNotIn(self.member_email, self.meeting.get_waiting_room())
        self.assertEqual(self.meeting.get_table_users("banned_users").count(self.member_email), 1)

    def test_approve_all_moves_every_waiting_user_and_handles_empty_room(self):
        another = "another-member-meet@example.com"
        self._ensure_user(another, "Another")
        self._join_waiting(self.member_email)
        self._join_waiting(another)
        frappe.set_user(self.host_email)

        approve_all_join_requests(self.meeting.name)
        approve_all_join_requests(self.meeting.name)

        self.meeting.reload()
        self.assertEqual(self.meeting.get_waiting_room(), [])
        self.assertTrue({self.member_email, another}.issubset(self.meeting.get_members()))

    def _join_waiting(self, user: str):
        frappe.set_user(user)
        self.assertEqual(join_meeting(self.meeting.name)["status"], "waiting_for_approval")
        self.meeting.reload()

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
