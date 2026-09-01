# Copyright (c) 2025, Frappe and Contributors
# See license.txt

import frappe
from frappe.exceptions import ValidationError
from frappe.tests import IntegrationTestCase
from frappe.tests.test_api import FrappeAPITestCase

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class IntegrationTestMeetRoom(IntegrationTestCase):
    """
    Integration tests for MeetRoom.
    Use this class for testing interactions between multiple components.
    """

    def test_generic_save_cannot_enable_e2ee(self):
        room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert()
        room.e2ee_enabled = True

        with self.assertRaisesRegex(ValidationError, "dedicated meeting policy"):
            room.save()

    def test_cohost_cannot_promote_through_generic_document_save(self):
        owner = frappe.session.user
        cohost = self._ensure_user("room-cohost@example.com", "Room Cohost")
        target = self._ensure_user("room-target@example.com", "Room Target")
        room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert()
        room.add_user_to_table("co_hosts", cohost, save=True, ignore_permissions=True)
        room.add_user_to_table("members", target, save=True, ignore_permissions=True)
        frappe.set_user(cohost)
        room = frappe.get_doc("Meet Room", room.name)
        room.append("co_hosts", {"user": target})

        with self.assertRaisesRegex(ValidationError, "dedicated meeting methods"):
            room.save()

        frappe.set_user(owner)
        room.reload()
        self.assertNotIn(target, room.get_co_hosts())

    def test_member_cannot_change_room_settings(self):
        member = self._ensure_user("room-member@example.com", "Room Member")
        room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert()
        room.add_user_to_table("members", member, save=True, ignore_permissions=True)
        frappe.set_user(member)
        room = frappe.get_doc("Meet Room", room.name)
        room.host_only_chat = 1

        with self.assertRaises(frappe.PermissionError):
            room.save()

    def test_global_guest_policy_cannot_be_bypassed(self):
        room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open", "allow_guest": 0}).insert()
        frappe.db.set_single_value("Meet Settings", "allow_guest", 0)
        frappe.clear_cache(doctype="Meet Settings")
        room.allow_guest = 1

        with self.assertRaisesRegex(ValidationError, "dedicated meeting methods"):
            room.save()
        with self.assertRaisesRegex(ValidationError, "disabled globally"):
            room.update_settings(allow_guest=1)

    def test_participant_tables_require_dedicated_methods(self):
        user = self._ensure_user("room-waiting@example.com", "Room Waiting")
        room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "restricted"}).insert()
        room.append("waiting_room", {"user": user})

        with self.assertRaisesRegex(ValidationError, "dedicated meeting methods"):
            room.save()

        room.reload()
        room.add_waiting_room_user(user, save=True)
        room.reload()
        self.assertEqual(room.get_waiting_room(), [user])

    def test_room_api_methods_are_post_only(self):
        room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert()

        for method_name in (
            "approve_join_request",
            "approve_all_join_requests",
            "reject_join_request",
            "get_waiting_room_details",
            "ban_guest",
            "promote_to_cohost",
            "enable_e2ee",
            "update_settings",
        ):
            with self.subTest(method=method_name):
                method = getattr(room, method_name)
                fn = getattr(method, "__func__", method)
                self.assertEqual(set(frappe.allowed_http_methods_for_whitelisted_func[fn]), {"POST"})

    def test_every_access_field_rejects_generic_document_updates(self):
        user = self._ensure_user("room-protected@example.com", "Room Protected")
        mutations = {
            "owner": lambda room: room.set("owner", user),
            "title": lambda room: room.set("title", "Changed outside the room API"),
            "calendar_event": lambda room: room.set("calendar_event", "event-1"),
            "allow_guest": lambda room: room.set("allow_guest", not room.allow_guest),
            "meeting_type": lambda room: room.set("meeting_type", "restricted"),
            "host_only_chat": lambda room: room.set("host_only_chat", 1),
            "members": lambda room: room.append("members", {"user": user}),
            "co_hosts": lambda room: room.append("co_hosts", {"user": user}),
            "waiting_room": lambda room: room.append("waiting_room", {"user": user}),
            "banned_users": lambda room: room.append("banned_users", {"user": user}),
        }

        for fieldname, mutate in mutations.items():
            with self.subTest(fieldname=fieldname):
                room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert()
                mutate(room)
                with self.assertRaisesRegex(ValidationError, "dedicated meeting methods"):
                    room.save()

    def _ensure_user(self, email: str, first_name: str) -> str:
        if not frappe.db.exists("User", email):
            frappe.get_doc(
                {
                    "doctype": "User",
                    "email": email,
                    "first_name": first_name,
                    "enabled": 1,
                    "new_password": "password",
                }
            ).insert(ignore_permissions=True)
        return email


class TestMeetRoomAPI(FrappeAPITestCase):
    version = "v2"

    def test_document_method_route(self):
        room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert()

        response = self.post(
            self.resource("Meet Room", room.name, "method", "get_waiting_room_details"),
            {"sid": self.sid},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["data"], {"meeting_id": room.name, "waiting_users": []})

    def test_document_method_returns_the_mutated_room(self):
        room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "restricted"}).insert()
        room.append("waiting_room", {"user": "guest:test", "user_name": "Test Guest"})
        room.allow_controlled_update("waiting_room")
        room.save()

        response = self.post(
            self.resource("Meet Room", room.name, "method", "approve_join_request"),
            {"sid": self.sid, "user_id": "guest:test"},
        )

        self.assertEqual(response.status_code, 200)
        returned_room = response.json["docs"][0]
        self.assertEqual(returned_room["waiting_room"], [])
        self.assertIn("guest:test", [row["user"] for row in returned_room["members"]])

    def test_removed_module_method_is_not_routable(self):
        response = self.post(
            self.method("suite.meet.api.meeting.get_meeting_e2ee_details"),
            {"sid": self.sid, "meeting_id": "missing"},
        )

        self.assertNotEqual(response.status_code, 200)
