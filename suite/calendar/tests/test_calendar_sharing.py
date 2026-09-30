# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.calendar.api import (
    get_calendar_sharing,
    get_calendars_with_shared,
    search_principals,
    set_calendar_sharing,
)
from suite.calendar.doctype.calendar.calendar import add_calendar, delete_calendars
from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.jmap import get_calendar_service
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestCalendarSharing(StalwartIntegrationTestCase):
    """Sharing a calendar, against what the reader can then see.

    The mail server is the one keeping the rights, so these go through it rather than around it:
    what is asserted is what a second person's own calendar list answers, not what this app
    recorded on the way out.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.owner = cls.create_member()
        cls.owner_account = cls.personal_account(cls.owner)
        cls.reader = cls.create_member()
        cls.reader_account = cls.personal_account(cls.reader)

    def setUp(self):
        with self.set_user(self.owner.email):
            self.calendar_id = add_calendar(self.owner_account, unique_name("cal"))
        self.addCleanup(self._delete_calendar)

    def _delete_calendar(self):
        with self.set_user(self.owner.email):
            delete_calendars(self.owner_account, [self.calendar_id], remove_events=True)

    def _reader_principal(self) -> str:
        with self.set_user(self.owner.email):
            matches = search_principals(self.owner_account, self.reader.email)
        self.assertEqual(len(matches), 1, msg=f"No principal for {self.reader.email}: {matches}")
        return matches[0]["principal_id"]

    def _reader_calendars(self) -> dict[str, dict]:
        # No cache is cleared here on purpose: which calendars are shared with a user is kept for
        # a few minutes, and sharing one with them — or taking it away — is what drops it.
        with self.set_user(self.reader.email):
            return {row["name"]: row for row in get_calendars_with_shared(self.reader_account)}

    def _share(self, role: str) -> None:
        with self.set_user(self.owner.email):
            set_calendar_sharing(
                self.owner_account,
                self.calendar_id,
                [{"principal_id": self._reader_principal(), "role": role}],
            )

    def test_a_reader_sees_a_calendar_shared_with_them(self):
        shared = f"{self.owner_account}|{self.calendar_id}"
        self.assertNotIn(shared, self._reader_calendars())

        self._share("view")

        row = self._reader_calendars().get(shared)
        self.assertIsNotNone(row, msg="The reader does not see the calendar shared with them.")
        self.assertEqual(row["may_write_all"], 0, msg="A shared calendar is the reader's to read.")
        self.assertEqual(row["may_share"], 0, msg="A reader may not share it on.")
        # A calendar's name is the owner's, and a reader who has never named it is sent an empty
        # one: the row says whose calendar it is rather than nothing at all.
        self.assertTrue(row["_name"], msg="The calendar is drawn with no name.")
        # Reached through the mail server's session, as the reader — not through a User Account
        # row, which says who is a member of an account, and which sharing must not need.
        with self.set_user(self.reader.email):
            frappe.db.delete("User Account", {"user": self.reader.email, "account": self.owner_account})
            frappe.local.request_cache.clear()
            resolved = get_user_for_jmap_account(self.owner_account, raise_exception=False)
            self.assertEqual(resolved, self.reader.email)

    def test_unsharing_takes_it_off_the_reader_s_list(self):
        shared = f"{self.owner_account}|{self.calendar_id}"
        self._share("view")
        self.assertIn(shared, self._reader_calendars())

        with self.set_user(self.owner.email):
            set_calendar_sharing(self.owner_account, self.calendar_id, [])

        self.assertNotIn(shared, self._reader_calendars())

    def test_a_role_is_read_back_as_the_role_it_was_saved_as(self):
        principal_id = self._reader_principal()
        for role in ("view",):
            self._share(role)
            with self.set_user(self.owner.email):
                sharing = get_calendar_sharing(self.owner_account, self.calendar_id)
            self.assertTrue(sharing["may_share"], msg="The owner may say who sees their calendar.")
            self.assertEqual(
                [(s["principal_id"], s["role"], s["email"]) for s in sharing["sharees"]],
                [(principal_id, role, self.reader.email)],
            )

    def test_rights_another_client_granted_are_left_alone(self):
        """A combination no role here describes is shown as Custom and carried through a save."""

        principal_id = self._reader_principal()
        with self.set_user(self.owner.email):
            # As another CalDAV client would: read the events, and nothing about free-busy.
            get_calendar_service(self.owner_account)._update(
                {self.calendar_id: {"shareWith": {principal_id: {"mayReadItems": True}}}}
            )
            sharing = get_calendar_sharing(self.owner_account, self.calendar_id)
            self.assertEqual([s["role"] for s in sharing["sharees"]], [None])

            # Saving somebody else's role leaves it as it was.
            set_calendar_sharing(self.owner_account, self.calendar_id, [])
            sharing = get_calendar_sharing(self.owner_account, self.calendar_id)

        self.assertEqual([(s["principal_id"], s["role"]) for s in sharing["sharees"]], [(principal_id, None)])

    def test_a_reader_may_not_say_who_else_sees_it(self):
        self._share("view")
        with self.set_user(self.reader.email):
            self.assertRaises(
                Exception,
                set_calendar_sharing,
                self.owner_account,
                self.calendar_id,
                [],
            )

    def test_the_picker_does_not_offer_you_to_yourself(self):
        with self.set_user(self.owner.email):
            matches = search_principals(self.owner_account, self.owner.username)
        self.assertNotIn(self.owner_account, [match["principal_id"] for match in matches])
