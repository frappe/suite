# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import time
from unittest.mock import patch

import frappe
import jwt
from frappe.client import delete as delete_document
from frappe.tests import IntegrationTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite.meet import guest_access
from suite.meet.api.meeting import (
    check_meeting_access,
    get_approved_guest_connection_details,
    get_public_meeting_preview,
    get_sfu_connection_details,
    get_sfu_presence_preview_token,
    join_meeting,
    join_meeting_as_guest,
    refresh_guest_sfu_token,
    refresh_sfu_token,
    validate_guest_session,
)
from suite.meet.api.schedule import create_meet_link, create_scheduled_meeting
from suite.meet.doctype.meet_room.meet_room import MeetRoom


class IntegrationTestMeetingApi(IntegrationTestCase):
    def setUp(self):
        frappe.conf.sfu_secret = "test-sfu-secret"
        frappe.db.set_single_value("Meet Settings", "allow_guest", 1)
        frappe.clear_cache(doctype="Meet Settings")
        frappe.cache.delete(
            guest_access._fresh_join_rate_key(str(getattr(frappe.local, "request_ip", None) or "unknown"))
        )

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

    def test_scheduling_mutations_are_post_only(self):
        for method in (create_scheduled_meeting, create_meet_link):
            with self.subTest(method=method.__name__):
                self.assertEqual(set(frappe.allowed_http_methods_for_whitelisted_func[method]), {"POST"})

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

    def test_unapproved_user_gets_restricted_preview_without_sfu_token(self):
        frappe.set_user(self.outsider_email)

        result = get_sfu_presence_preview_token(self.meeting.name)

        self.assertEqual(result, {"restricted_preview": True})

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

    def test_non_member_gets_guest_enabled_preview_title_without_read_access(self):
        self.meeting.title = "Quarterly planning"
        self.meeting.allow_controlled_update("title")
        self.meeting.save(ignore_permissions=True)

        frappe.set_user(self.outsider_email)
        with self.assertRaises(frappe.PermissionError):
            frappe.get_doc("Meet Room", self.meeting.name).check_permission("read")

        self.assertEqual(get_public_meeting_preview(self.meeting.name)["title"], "Quarterly planning")

    def test_private_preview_title_requires_participation(self):
        self.meeting.title = "Confidential planning"
        self.meeting.allow_controlled_update("title")
        self.meeting.save(ignore_permissions=True)
        self.meeting.db_set("allow_guest", 0)

        for user in ("Guest", self.outsider_email):
            with self.subTest(user=user):
                frappe.set_user(user)
                with self.assertRaises(frappe.PermissionError):
                    get_public_meeting_preview(self.meeting.name)

        self.meeting.add_user_to_table("members", self.member_email, save=True, ignore_permissions=True)
        frappe.set_user(self.member_email)
        self.assertEqual(
            get_public_meeting_preview(self.meeting.name)["title"],
            "Confidential planning",
        )

    def test_private_and_missing_meeting_access_are_indistinguishable(self):
        self.meeting.db_set("allow_guest", 0)

        frappe.set_user("Guest")
        private_access = check_meeting_access(self.meeting.name)
        missing_access = check_meeting_access("missing-meeting")

        self.assertEqual(private_access, {"allow_guest": False})
        self.assertEqual(missing_access, private_access)

    def test_guest_enabled_meeting_access_returns_public_policy(self):
        self.meeting.db_set("host_only_chat", 1)

        frappe.set_user("Guest")
        self.assertEqual(
            check_meeting_access(self.meeting.name),
            {"allow_guest": True, "host_only_chat": True},
        )

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
        self.assertEqual(result["expires_in"], 300)
        self.assertTrue(result["guest_session_token"])
        raw_lease = frappe.cache.get(f"meet:guest-lease:{frappe.local.site}:{result['guest_id']}")
        self.assertNotIn(result["guest_session_token"], raw_lease.decode())

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
        lease, session_token = guest_access.create_lease(self.meeting.name, "Room A Guest", admitted=True)
        other_room = self._create_meeting(self.host_email, meeting_type="restricted")
        frappe.set_user("Guest")

        with self.assertRaises(frappe.PermissionError):
            get_approved_guest_connection_details(other_room.name, lease.guest_id, session_token)

    def test_public_guest_id_cannot_resume_or_get_approved_connection_details(self):
        frappe.set_user("Guest")
        first = join_meeting_as_guest(self.meeting.name, "Private Guest")

        public_id_join = join_meeting_as_guest(
            self.meeting.name,
            "Private Guest",
            guest_id=first["guest_id"],
        )

        self.assertNotEqual(public_id_join["guest_id"], first["guest_id"])
        with self.assertRaises(frappe.PermissionError):
            get_approved_guest_connection_details(self.meeting.name, first["guest_id"])

    def test_guest_proof_resumes_same_room_principal(self):
        frappe.set_user("Guest")
        first = join_meeting_as_guest(self.meeting.name, "Stable Guest")

        resumed = join_meeting_as_guest(
            self.meeting.name,
            "Changed Name",
            first["guest_id"],
            first["guest_session_token"],
        )

        self.assertEqual(resumed["guest_id"], first["guest_id"])
        self.assertEqual(resumed["guest_name"], "Stable Guest")

    def test_wrong_guest_proof_cannot_get_admitted_token(self):
        self.meeting.db_set("meeting_type", "open")
        frappe.set_user("Guest")
        joined = join_meeting_as_guest(self.meeting.name, "Proof Guest")

        with self.assertRaises(frappe.PermissionError):
            refresh_guest_sfu_token(
                self.meeting.name,
                joined["guest_id"],
                "wrong-private-proof",
            )

    def test_pending_guest_expires_after_thirty_minutes_and_leaves_listing(self):
        now = int(time.time())
        frappe.set_user("Guest")
        with patch("suite.meet.guest_access.time.time", return_value=now):
            waiting = join_meeting_as_guest(self.meeting.name, "Pending Guest")

        frappe.set_user(self.host_email)
        with patch(
            "suite.meet.guest_access.time.time",
            return_value=now + guest_access.PENDING_TTL + 1,
        ):
            result = self.meeting.get_waiting_room_details()

        self.assertNotIn(
            waiting["guest_id"],
            [user["user_id"] for user in result["waiting_users"]],
        )

    def test_expired_pending_guest_can_reconcile_status_with_proof(self):
        now = int(time.time())
        frappe.set_user("Guest")
        with patch("suite.meet.guest_access.time.time", return_value=now):
            waiting = join_meeting_as_guest(self.meeting.name, "Expired Pending Guest")

        with patch(
            "suite.meet.guest_access.time.time",
            return_value=now + guest_access.PENDING_TTL + 1,
        ):
            result = validate_guest_session(
                self.meeting.name,
                waiting["guest_id"],
                waiting["guest_session_token"],
            )

        self.assertEqual(result, {"valid": False, "status": "expired"})
        self.assertGreater(frappe.cache.ttl(guest_access._guest_key(waiting["guest_id"])), 0)
        self.assertLessEqual(
            frappe.cache.ttl(guest_access._guest_key(waiting["guest_id"])),
            guest_access.TERMINAL_TTL,
        )

    def test_expiry_cleanup_does_not_delete_concurrently_admitted_lease(self):
        now = int(time.time())
        with patch("suite.meet.guest_access.time.time", return_value=now):
            pending, session_token = guest_access.create_lease(
                self.meeting.name,
                "Concurrent Guest",
                admitted=False,
            )
            admitted = guest_access.admit(self.meeting.name, pending.guest_id)

        with (
            patch(
                "suite.meet.guest_access.time.time",
                return_value=now + guest_access.PENDING_TTL + 1,
            ),
            patch("suite.meet.guest_access._read", side_effect=[pending, admitted]),
        ):
            authorized = guest_access.authorize(
                self.meeting.name,
                pending.guest_id,
                session_token,
                statuses={"admitted"},
            )

        self.assertEqual(authorized, admitted)
        self.assertIsNotNone(frappe.cache.get(guest_access._guest_key(pending.guest_id)))

    def test_duplicate_guest_admission_preserves_authorization_generation(self):
        pending, _session_token = guest_access.create_lease(
            self.meeting.name,
            "Idempotent Guest",
            admitted=False,
        )

        admitted = guest_access.admit(self.meeting.name, pending.guest_id)
        duplicate = guest_access.admit(self.meeting.name, pending.guest_id)

        self.assertEqual(duplicate, admitted)
        self.assertEqual(duplicate.generation, pending.generation + 1)

    def test_duplicate_terminal_guest_transitions_preserve_generation(self):
        for transition, status in (
            (guest_access.reject, "rejected"),
            (guest_access.ban, "banned"),
        ):
            with self.subTest(status=status):
                pending, _session_token = guest_access.create_lease(
                    self.meeting.name,
                    f"Idempotent {status}",
                    admitted=False,
                )

                terminal = transition(self.meeting.name, pending.guest_id)
                duplicate = transition(self.meeting.name, pending.guest_id)

                self.assertEqual(duplicate, terminal)
                self.assertEqual(duplicate.generation, pending.generation + 1)

    def test_guest_terminal_transitions_cannot_cross(self):
        rejected, _session_token = guest_access.create_lease(
            self.meeting.name,
            "Rejected Guest",
            admitted=False,
        )
        banned, _session_token = guest_access.create_lease(
            self.meeting.name,
            "Banned Guest",
            admitted=False,
        )
        guest_access.reject(self.meeting.name, rejected.guest_id)
        guest_access.ban(self.meeting.name, banned.guest_id)

        with self.assertRaises(guest_access.GuestAccessDenied):
            guest_access.ban(self.meeting.name, rejected.guest_id)
        with self.assertRaises(guest_access.GuestAccessDenied):
            guest_access.reject(self.meeting.name, banned.guest_id)

    def test_guest_proof_is_redacted_before_downstream_endpoint_errors(self):
        original_request = getattr(frappe.local, "request", None)
        original_form_dict = frappe.local.form_dict
        original_request_ip = getattr(frappe.local, "request_ip", None)
        self.addCleanup(setattr, frappe.local, "request", original_request)
        self.addCleanup(setattr, frappe.local, "form_dict", original_form_dict)
        if original_request_ip is not None:
            self.addCleanup(setattr, frappe.local, "request_ip", original_request_ip)
        else:

            def delete_request_ip():
                if hasattr(frappe.local, "request_ip"):
                    delattr(frappe.local, "request_ip")

            self.addCleanup(delete_request_ip)

        frappe.local.request_ip = "127.0.0.1"
        proof = "private-proof-that-must-not-reach-telemetry"
        endpoints = (
            (
                join_meeting_as_guest,
                (self.meeting.name, "Telemetry Guest", "guest_telemetry", proof),
                "suite.meet.api.meeting.validate_guest_name",
            ),
            (
                get_approved_guest_connection_details,
                (self.meeting.name, "guest_telemetry", proof),
                "suite.meet.api.meeting.frappe.db.exists",
            ),
            (
                refresh_guest_sfu_token,
                (self.meeting.name, "guest_telemetry", proof),
                "suite.meet.api.meeting.frappe.db.exists",
            ),
            (
                validate_guest_session,
                (self.meeting.name, "guest_telemetry", proof),
                "suite.meet.api.meeting.guest_access.get_status",
            ),
        )

        for body_type in ("json", "form"):
            for endpoint, args, downstream in endpoints:
                with self.subTest(body_type=body_type, endpoint=endpoint.__name__):
                    builder_args = {
                        "json" if body_type == "json" else "data": {
                            "meeting_id": self.meeting.name,
                            "guest_session_token": proof,
                        }
                    }
                    request = Request(EnvironBuilder(method="POST", **builder_args).get_environ())
                    frappe.local.request = request
                    frappe.local.form_dict = frappe._dict(guest_session_token=proof)

                    def fail_after_redaction(*_args, **_kwargs):
                        context = request.json if request.is_json else request.form
                        self.assertEqual(
                            context["guest_session_token"],
                            "[REDACTED]",
                        )
                        self.assertNotIn(proof, str(context))
                        self.assertEqual(
                            frappe.form_dict.guest_session_token,
                            "[REDACTED]",
                        )
                        raise RuntimeError("downstream infrastructure failed")

                    with (
                        patch("suite.meet.api.meeting._require_trusted_realtime_request"),
                        patch(downstream, side_effect=fail_after_redaction),
                        self.assertRaisesRegex(
                            RuntimeError,
                            "downstream infrastructure failed",
                        ),
                    ):
                        endpoint(*args)

    def test_guest_status_validation_requires_realtime_secret_for_http_requests(self):
        frappe.set_user("Guest")
        waiting = join_meeting_as_guest(self.meeting.name, "Socket Auth Guest")
        previous_request = getattr(frappe.local, "request", None)
        self.addCleanup(setattr, frappe.local, "request", previous_request)

        with patch("frappe.realtime.get_socketio_secret", return_value="trusted-secret"):
            for provided_secret in (None, "wrong-secret"):
                headers = {"X-Frappe-Socket-Secret": provided_secret} if provided_secret else None
                frappe.local.request = Request(EnvironBuilder(method="POST", headers=headers).get_environ())
                with self.assertRaises(frappe.PermissionError):
                    validate_guest_session(
                        self.meeting.name,
                        waiting["guest_id"],
                        waiting["guest_session_token"],
                    )

            frappe.local.request = Request(
                EnvironBuilder(
                    method="POST",
                    headers={"X-Frappe-Socket-Secret": "trusted-secret"},
                ).get_environ()
            )
            self.assertEqual(
                validate_guest_session(
                    self.meeting.name,
                    waiting["guest_id"],
                    waiting["guest_session_token"],
                ),
                {"valid": True, "status": "pending"},
            )

    def test_guest_room_index_has_bounded_ttl_and_atomic_updates_reset_it(self):
        pending, _session_token = guest_access.create_lease(
            self.meeting.name,
            "Indexed Guest",
            admitted=False,
        )
        index_key = guest_access._room_key(self.meeting.name)

        self.assertGreater(frappe.cache.ttl(index_key), guest_access.LEASE_TTL)
        self.assertLessEqual(frappe.cache.ttl(index_key), guest_access.ROOM_INDEX_TTL)

        frappe.cache.expire(index_key, 1)
        guest_access.admit(self.meeting.name, pending.guest_id)

        self.assertGreater(frappe.cache.ttl(index_key), guest_access.LEASE_TTL)
        self.assertLessEqual(frappe.cache.ttl(index_key), guest_access.ROOM_INDEX_TTL)

    def test_fresh_guest_join_rate_limit_rejects_before_room_lookup_and_expires(self):
        previous_ip = getattr(frappe.local, "request_ip", None)
        frappe.local.request_ip = f"guest-rate-{frappe.generate_hash(length=12)}"
        rate_key = guest_access._fresh_join_rate_key(frappe.local.request_ip)
        frappe.cache.delete(rate_key)
        self.addCleanup(setattr, frappe.local, "request_ip", previous_ip)
        self.addCleanup(frappe.cache.delete, rate_key)

        lease, session_token = guest_access.create_lease(
            self.meeting.name,
            "Rate Limited Resume",
            admitted=False,
        )
        for _ in range(guest_access.FRESH_JOIN_RATE_LIMIT):
            guest_access.enforce_fresh_join_rate_limit(frappe.local.request_ip)

        ttl = frappe.cache.ttl(rate_key)
        self.assertGreater(ttl, 0)
        self.assertLessEqual(ttl, guest_access.FRESH_JOIN_RATE_WINDOW)

        frappe.set_user("Guest")
        resumed = join_meeting_as_guest(
            self.meeting.name,
            lease.guest_name,
            lease.guest_id,
            session_token,
        )
        self.assertEqual(resumed["guest_id"], lease.guest_id)

        with (
            patch("suite.meet.api.meeting.frappe.db.exists") as room_exists,
            self.assertRaises(frappe.RateLimitExceededError),
        ):
            join_meeting_as_guest(self.meeting.name, "Limited Guest")
        room_exists.assert_not_called()

        frappe.cache.expire(rate_key, 0)
        self.assertEqual(frappe.cache.exists(rate_key, shared=True), 0)
        guest_access.enforce_fresh_join_rate_limit(frappe.local.request_ip)
        self.assertGreater(frappe.cache.ttl(rate_key), 0)

    def test_guest_jwt_is_capped_by_five_minutes_and_remaining_lease(self):
        now = int(time.time())
        self.meeting.db_set("meeting_type", "open")
        frappe.set_user("Guest")
        with (
            patch("suite.meet.guest_access.time.time", return_value=now),
            patch("suite.meet.api.meeting.time.time", return_value=now),
        ):
            joined = join_meeting_as_guest(self.meeting.name, "Short Token Guest")
        decoded = jwt.decode(joined["auth_token"], frappe.conf.sfu_secret, algorithms=["HS256"])
        self.assertEqual(joined["expires_in"], 300)
        self.assertEqual(decoded["exp"], now + 300)

        near_expiry = now + guest_access.LEASE_TTL - 120
        with (
            patch("suite.meet.guest_access.time.time", return_value=near_expiry),
            patch("suite.meet.api.meeting.time.time", return_value=near_expiry),
        ):
            refreshed = refresh_guest_sfu_token(
                self.meeting.name,
                joined["guest_id"],
                joined["guest_session_token"],
            )
        decoded = jwt.decode(
            refreshed["auth_token"],
            frappe.conf.sfu_secret,
            algorithms=["HS256"],
            options={"verify_iat": False},
        )
        self.assertEqual(refreshed["expires_in"], 120)
        self.assertEqual(decoded["exp"], now + guest_access.LEASE_TTL)

    def test_approved_guest_rechecks_current_guest_policy(self):
        frappe.set_user("Guest")
        waiting = join_meeting_as_guest(self.meeting.name, "Policy Guest")
        guest_id = waiting["guest_id"]
        frappe.set_user(self.host_email)
        self.meeting.approve_join_request(guest_id)

        frappe.db.set_single_value("Meet Settings", "allow_guest", 0)
        frappe.clear_cache(doctype="Meet Settings")
        frappe.set_user("Guest")
        with self.assertRaises(frappe.PermissionError):
            get_approved_guest_connection_details(self.meeting.name, guest_id, waiting["guest_session_token"])

    def test_approved_guest_rechecks_room_guest_policy(self):
        frappe.set_user("Guest")
        waiting = join_meeting_as_guest(self.meeting.name, "Room Policy Guest")
        guest_id = waiting["guest_id"]
        frappe.set_user(self.host_email)
        self.meeting.approve_join_request(guest_id)
        self.meeting.db_set("allow_guest", 0)

        frappe.set_user("Guest")
        with self.assertRaises(frappe.PermissionError):
            get_approved_guest_connection_details(self.meeting.name, guest_id, waiting["guest_session_token"])

    def test_expired_or_deleted_guest_session_cannot_reconnect(self):
        frappe.set_user("Guest")
        waiting = join_meeting_as_guest(self.meeting.name, "Expired Guest")
        guest_id = waiting["guest_id"]
        frappe.set_user(self.host_email)
        self.meeting.approve_join_request(guest_id)
        frappe.set_user("Guest")
        with (
            patch(
                "suite.meet.guest_access.time.time",
                return_value=int(time.time()) + guest_access.LEASE_TTL + 1,
            ),
            self.assertRaises(frappe.PermissionError),
        ):
            get_approved_guest_connection_details(self.meeting.name, guest_id, waiting["guest_session_token"])

    def test_rejected_guest_session_cannot_reconnect(self):
        frappe.set_user("Guest")
        waiting = join_meeting_as_guest(self.meeting.name, "Rejected Guest")
        guest_id = waiting["guest_id"]
        frappe.set_user(self.host_email)
        self.meeting.reject_join_request(guest_id)

        frappe.set_user("Guest")
        self.assertEqual(
            validate_guest_session(
                self.meeting.name,
                guest_id,
                waiting["guest_session_token"],
            ),
            {"valid": False, "status": "rejected"},
        )
        self.assertGreater(frappe.cache.ttl(guest_access._guest_key(guest_id)), 0)
        self.assertLessEqual(
            frappe.cache.ttl(guest_access._guest_key(guest_id)),
            guest_access.TERMINAL_TTL,
        )
        with self.assertRaises(frappe.PermissionError):
            get_approved_guest_connection_details(self.meeting.name, guest_id, waiting["guest_session_token"])

    def test_guest_status_validation_fails_closed_without_valid_proof_or_redis(self):
        frappe.set_user("Guest")
        waiting = join_meeting_as_guest(self.meeting.name, "Status Proof Guest")

        self.assertEqual(
            validate_guest_session(
                self.meeting.name,
                waiting["guest_id"],
                "wrong-private-proof",
            ),
            {"valid": False},
        )
        with (
            patch("suite.meet.guest_access.frappe.cache.get", side_effect=ConnectionError),
            self.assertRaises(ConnectionError),
        ):
            validate_guest_session(
                self.meeting.name,
                waiting["guest_id"],
                waiting["guest_session_token"],
            )

    def test_guest_connection_details_recheck_ban_and_session(self):
        self.meeting.db_set("meeting_type", "open")
        frappe.set_user("Guest")
        joined = join_meeting_as_guest(self.meeting.name, "Banned Guest")

        frappe.set_user(self.host_email)
        self.meeting.ban_guest(joined["guest_id"])
        frappe.set_user("Guest")

        self.assertEqual(
            validate_guest_session(
                self.meeting.name,
                joined["guest_id"],
                joined["guest_session_token"],
            ),
            {"valid": False, "status": "banned"},
        )
        with self.assertRaises(frappe.PermissionError):
            refresh_guest_sfu_token(
                self.meeting.name,
                joined["guest_id"],
                joined["guest_session_token"],
            )

    def test_guest_admission_never_writes_participant_child_rows(self):
        frappe.set_user("Guest")
        waiting = join_meeting_as_guest(self.meeting.name, "Ephemeral Guest")
        frappe.set_user(self.host_email)

        self.meeting.approve_join_request(waiting["guest_id"])

        self.meeting.reload()
        self.assertNotIn(waiting["guest_id"], self.meeting.get_members())
        self.assertNotIn(waiting["guest_id"], self.meeting.get_waiting_room())
        self.assertNotIn(waiting["guest_id"], self.meeting.get_table_users("banned_users"))

    def test_redis_failure_creates_no_guest_or_room_mutation(self):
        frappe.set_user("Guest")
        with (
            patch("suite.meet.guest_access.frappe.cache.pipeline", side_effect=ConnectionError),
            self.assertRaises(ConnectionError),
        ):
            join_meeting_as_guest(self.meeting.name, "Unavailable Redis")

        self.meeting.reload()
        self.assertFalse(any(user.startswith("guest_") for user in self.meeting.get_members()))
        self.assertFalse(any(user.startswith("guest_") for user in self.meeting.get_waiting_room()))

    def test_waiting_room_apis_reject_member_and_outsider(self):
        self._join_waiting(self.member_email)

        for user in (self.member_email, self.outsider_email):
            with self.subTest(user=user):
                frappe.set_user(user)
                with self.assertRaises(frappe.ValidationError):
                    self.meeting.get_waiting_room_details()
                with self.assertRaises(frappe.ValidationError):
                    self.meeting.approve_join_request(self.member_email)
                with self.assertRaises(frappe.ValidationError):
                    self.meeting.reject_join_request(self.member_email)
                with self.assertRaises(frappe.ValidationError):
                    self.meeting.approve_all_join_requests()
                with self.assertRaises(frappe.ValidationError):
                    self.meeting.promote_to_cohost(self.member_email)
                with self.assertRaises(frappe.ValidationError):
                    frappe.get_doc("Meet Room", self.meeting.name).update_settings(host_only_chat=1)

        self.meeting.reload()
        self.assertIn(self.member_email, self.meeting.get_waiting_room())
        self.assertNotIn(self.member_email, self.meeting.get_members())

    def test_host_can_promote_authenticated_member_to_cohost(self):
        self.meeting.add_user_to_table("members", self.member_email, save=True, ignore_permissions=True)
        frappe.set_user(self.host_email)

        with patch("suite.meet.doctype.meet_room.meet_room.frappe.publish_realtime") as publish:
            result = self.meeting.promote_to_cohost(self.member_email)

        self.meeting.reload()
        self.assertEqual(result["user_id"], self.member_email)
        self.assertIn(self.member_email, self.meeting.get_co_hosts())
        publish.assert_any_call(
            "meeting:cohost_promoted",
            message={"meeting": self.meeting.name, "user": self.member_email},
            user=self.member_email,
            after_commit=True,
        )

        frappe.set_user(self.member_email)
        frappe.get_doc("Meet Room", self.meeting.name).check_permission("read")
        refreshed = refresh_sfu_token(self.meeting.name)
        decoded = jwt.decode(refreshed["auth_token"], frappe.conf.sfu_secret, algorithms=["HS256"])
        self.assertTrue(decoded["is_cohost"])

    def test_cohost_cannot_promote_member_to_cohost(self):
        self.meeting.add_user_to_table("members", self.member_email, save=True, ignore_permissions=True)
        self.meeting.add_user_to_table("members", self.outsider_email, save=True, ignore_permissions=True)
        self.meeting.add_user_to_table("co_hosts", self.outsider_email, save=True, ignore_permissions=True)
        frappe.set_user(self.outsider_email)

        with self.assertRaisesRegex(frappe.ValidationError, "Only the meeting host"):
            self.meeting.promote_to_cohost(self.member_email)

        self.meeting.reload()
        self.assertNotIn(self.member_email, self.meeting.get_co_hosts())

    def test_host_cannot_promote_unauthenticated_member_to_cohost(self):
        unauthenticated_users = ("guest_123", "missing-user@example.com")
        for user in unauthenticated_users:
            self.meeting.add_user_to_table("members", user, save=True, ignore_permissions=True)

        frappe.set_user(self.host_email)
        for user in unauthenticated_users:
            with self.subTest(user=user):
                with self.assertRaisesRegex(frappe.ValidationError, "Only authenticated users"):
                    self.meeting.promote_to_cohost(user)

    def test_approval_atomically_moves_waiting_user_to_members(self):
        self._join_waiting(self.member_email)
        frappe.set_user(self.host_email)

        self.meeting.approve_join_request(self.member_email)

        self.meeting.reload()
        self.assertNotIn(self.member_email, self.meeting.get_waiting_room())
        self.assertEqual(self.meeting.get_members().count(self.member_email), 1)

    def test_rejection_removes_and_bans_waiting_user_once(self):
        self._join_waiting(self.member_email)
        frappe.set_user(self.host_email)

        self.meeting.reject_join_request(self.member_email)

        self.meeting.reload()
        self.assertNotIn(self.member_email, self.meeting.get_waiting_room())
        self.assertEqual(self.meeting.get_table_users("banned_users").count(self.member_email), 1)

    def test_approve_all_moves_every_waiting_user_and_handles_empty_room(self):
        another = "another-member-meet@example.com"
        self._ensure_user(another, "Another")
        self._join_waiting(self.member_email)
        self._join_waiting(another)
        frappe.set_user(self.host_email)

        self.meeting.approve_all_join_requests()
        self.meeting.approve_all_join_requests()

        self.meeting.reload()
        self.assertEqual(self.meeting.get_waiting_room(), [])
        self.assertTrue({self.member_email, another}.issubset(self.meeting.get_members()))

    def test_approve_all_does_not_reenter_single_guest_endpoint(self):
        waiting = join_meeting_as_guest(self.meeting.name, "Bulk Guest")
        frappe.set_user(self.host_email)

        with patch.object(
            MeetRoom,
            "approve_join_request",
            side_effect=AssertionError("bulk approval re-entered the single endpoint"),
        ):
            self.meeting.approve_all_join_requests()

        self.assertIn(
            waiting["guest_id"],
            [lease.guest_id for lease in guest_access.list_admitted(self.meeting.name)],
        )

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
