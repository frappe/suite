from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.meet.api.meeting import get_public_meeting_preview
from suite.meet.http.routes import (
    default_invite_room,
    my_rooms,
    room_link_availability,
    rooms_post,
    set_default_invite_room,
)
from suite.meet.links import LinkError


class IntegrationTestMyRooms(IntegrationTestCase):
    def setUp(self):
        self.owner = self._user("my-rooms-owner@example.com")
        self.cohost = self._user("my-rooms-cohost@example.com")
        self.outsider = self._user("my-rooms-outsider@example.com")
        self.manager = self._user("my-rooms-manager@example.com", roles=("System Manager",))

    def tearDown(self):
        frappe.set_user("Administrator")

    def test_lists_rooms_the_user_owns_or_cohosts_newest_first(self):
        owned = self._room(self.owner, title="Sales team")
        cohosted = self._room(self.outsider, title="Design crit")
        cohosted.add_user_to_table("co_hosts", self.owner, save=True, ignore_permissions=True)
        self._room(self.outsider, title="Someone else's room")

        frappe.set_user(self.owner)
        rooms = my_rooms()

        self.assertEqual([room["name"] for room in rooms], [cohosted.name, owned.name])
        self.assertEqual(rooms[1]["title"], "Sales team")
        self.assertEqual(rooms[0]["owner"], self.outsider)

    def test_a_system_manager_sees_only_their_own_rooms(self):
        mine = self._room(self.manager)
        self._room(self.owner)

        frappe.set_user(self.manager)

        self.assertEqual([room["name"] for room in my_rooms()], [mine.name])

    def test_shows_at_most_three_rooms(self):
        for _ in range(4):
            self._room(self.cohost)

        frappe.set_user(self.cohost)

        self.assertEqual(len(my_rooms()), 3)

    def test_guests_are_refused(self):
        frappe.set_user("Guest")

        with self.assertRaises(frappe.AuthenticationError):
            my_rooms()

    def test_each_user_can_replace_and_clear_their_own_default(self):
        owned = self._room(self.owner)
        shared = self._room(self.cohost)
        shared.add_user_to_table("co_hosts", self.owner, save=True, ignore_permissions=True)

        frappe.set_user(self.owner)
        set_default_invite_room(owned.name)
        set_default_invite_room(shared.name)
        self.assertEqual(default_invite_room()["room"], shared.name)
        self.assertTrue(default_invite_room()["meeting_url"].endswith(f"/meet/{shared.name}"))

        frappe.set_user(self.cohost)
        self.assertIsNone(default_invite_room()["room"])
        set_default_invite_room(shared.name)

        frappe.set_user(self.owner)
        set_default_invite_room(None)
        self.assertIsNone(default_invite_room()["meeting_url"])
        frappe.set_user(self.cohost)
        self.assertEqual(default_invite_room()["room"], shared.name)

    def test_members_cannot_choose_a_room_and_removed_cohosts_lose_the_default(self):
        room = self._room(self.owner)
        room.add_user_to_table("members", self.outsider, save=True, ignore_permissions=True)
        room.add_user_to_table("co_hosts", self.cohost, save=True, ignore_permissions=True)

        frappe.set_user(self.outsider)
        with self.assertRaises(frappe.PermissionError):
            set_default_invite_room(room.name)

        frappe.set_user(self.cohost)
        set_default_invite_room(room.name)
        frappe.set_user(self.owner)
        room.allow_controlled_update("co_hosts")
        room.set("co_hosts", [])
        room.save(ignore_permissions=True)

        frappe.set_user(self.cohost)
        self.assertIsNone(default_invite_room()["meeting_url"])

    def test_calendar_offers_all_eligible_rooms_before_a_pick(self):
        owned = [self._room(self.owner, title=title) for title in ("One", "Two", "Three", "Four")]
        shared = self._room(self.cohost, title="Shared")
        shared.add_user_to_table("co_hosts", self.owner, save=True, ignore_permissions=True)
        unrelated = self._room(self.outsider)
        unrelated.add_user_to_table("members", self.owner, save=True, ignore_permissions=True)

        frappe.set_user(self.owner)
        invite = default_invite_room()
        self.assertIsNone(invite["room"])
        self.assertCountEqual([room["room"] for room in invite["rooms"]], [r.name for r in [*owned, shared]])
        self.assertEqual(len(my_rooms()), 3)

    def test_invalid_and_reserved_links_cannot_create_a_meet(self):
        frappe.set_user(self.owner)
        for status, links in (
            ("invalid", ("ab", "a" * 41, "-team", "team-", "sales--team", "Sales-team", "sales_team")),
            (
                "reserved",
                (
                    "scheduled",
                    "recordings",
                    "new",
                    "join",
                    "settings",
                    "api",
                    "rooms",
                    "meet",
                    "admin",
                    "help",
                    "abcd-efgh-ijkl",
                ),
            ),
        ):
            for link in links:
                with self.subTest(link=link):
                    self.assertEqual(room_link_availability(link), {"status": status})
                    with self.assertRaises(LinkError):
                        rooms_post("open", title="Rejected", link=link)
        self.assertEqual(my_rooms(), [])

    def test_existing_room_codes_cannot_be_claimed(self):
        frappe.set_user(self.owner)
        room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert(set_name="legacy-code")
        self.assertEqual(room_link_availability(room.name), {"status": "taken"})
        with self.assertRaisesRegex(LinkError, "Already taken"):
            rooms_post("open", link=room.name)

    def test_a_claimed_link_opens_its_meet_and_stays_bound_to_it(self):
        frappe.set_user(self.owner)
        code = rooms_post("restricted", title="Sales team", link="sales-team-link")["code"]
        self.assertEqual(code, "sales-team-link")
        self.assertEqual(my_rooms()[0]["name"], code)
        set_default_invite_room(code)
        self.assertTrue(default_invite_room()["meeting_url"].endswith("/meet/sales-team-link"))
        self.assertTrue(default_invite_room()["rooms"][0]["meeting_url"].endswith("/meet/sales-team-link"))

        frappe.set_user(self.outsider)
        self.assertEqual(room_link_availability("sales-team-link"), {"status": "taken"})
        with self.assertRaisesRegex(LinkError, "Already taken"):
            rooms_post("open", link="sales-team-link")
        self.assertEqual(my_rooms(), [])

        frappe.set_user(self.owner)
        self.assertEqual(get_public_meeting_preview("sales-team-link"), {"title": "Sales team"})

    def test_concurrent_link_claim_is_rejected_without_creating_a_room(self):
        frappe.set_user(self.owner)
        rooms_post("open", title="Original room", link="shared-address")

        frappe.set_user(self.outsider)
        with patch("suite.meet.links.link_status", return_value="available"):
            with self.assertRaisesRegex(LinkError, "Already taken"):
                rooms_post("open", link="shared-address")

        self.assertEqual(my_rooms(), [])
        frappe.set_user(self.owner)
        self.assertEqual(get_public_meeting_preview("shared-address"), {"title": "Original room"})

    def _user(self, email: str, roles: tuple[str, ...] = ()) -> str:
        if not frappe.db.exists("User", email):
            frappe.get_doc(
                {"doctype": "User", "email": email, "first_name": email.split("@")[0], "enabled": 1}
            ).insert(ignore_permissions=True)
        user = frappe.get_doc("User", email)
        user.add_roles("Suite User", *roles)
        frappe.defaults.clear_user_default("meet_default_invite_room", email)
        for room in frappe.get_all("Meet Room", filters={"owner": email}, pluck="name"):
            frappe.delete_doc("Meet Room", room, force=True, ignore_permissions=True)
        return email

    def _room(self, owner: str, title: str | None = None):
        frappe.set_user(owner)
        room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open", "title": title})
        room.insert(ignore_permissions=True)
        frappe.set_user("Administrator")
        return room
