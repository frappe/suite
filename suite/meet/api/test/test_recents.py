"""Recent rooms are personal, deduplicated, and exclude revoked access."""

import frappe
from frappe.tests.utils import FrappeTestCase

from suite.meet.api.recents import get_recent_meetings, record_room_visit


class TestRecents(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self.user = "meet-recents@example.com"
        if not frappe.db.exists("User", self.user):
            frappe.get_doc(
                {"doctype": "User", "email": self.user, "first_name": "Recent", "send_welcome_email": 0}
            ).insert()
        self.room = frappe.get_doc(
            {"doctype": "Meet Room", "title": "Recent room", "meeting_type": "open"}
        ).insert()

    def tearDown(self):
        frappe.set_user("Administrator")

    def test_history_is_personal_and_repeat_visits_update_one_entry(self):
        record_room_visit(self.room.name, "Administrator")
        frappe.set_user(self.user)
        self.assertEqual(get_recent_meetings(), [])
        record_room_visit(self.room.name, self.user)
        record_room_visit(self.room.name, self.user)
        recent = get_recent_meetings()
        self.assertEqual([item["id"] for item in recent], [self.room.name])
        self.assertEqual(recent[0]["title"], "Recent room")
        self.assertEqual(frappe.db.count("Meet Recent Room", {"user": self.user, "room": self.room.name}), 1)

    def test_banned_rooms_are_not_listed(self):
        record_room_visit(self.room.name, self.user)
        self.room.append("banned_users", {"user": self.user})
        self.room.allow_controlled_update("banned_users")
        self.room.save()
        frappe.set_user(self.user)
        self.assertEqual(get_recent_meetings(), [])

    def test_guests_do_not_get_history(self):
        record_room_visit(self.room.name, "Guest")
        frappe.set_user("Guest")
        with self.assertRaises(frappe.AuthenticationError):
            get_recent_meetings()
