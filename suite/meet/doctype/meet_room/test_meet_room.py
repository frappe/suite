# Copyright (c) 2025, Frappe and Contributors
# See license.txt

import frappe
from frappe.exceptions import ValidationError
from frappe.tests import IntegrationTestCase

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
