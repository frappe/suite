# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from unittest.mock import call, patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.mail.events import rename_own_identities

EMAIL = "identity-sync@example.test"


class TestIdentityNamesFollowTheUsersName(IntegrationTestCase):
    def setUp(self) -> None:
        if not frappe.db.exists("User", EMAIL):
            frappe.get_doc(
                {"doctype": "User", "email": EMAIL, "first_name": "Maya", "last_name": "Chen"}
            ).insert(ignore_permissions=True)
        self.user = frappe.get_doc("User", EMAIL)
        self.enterContext(patch("suite.mail.events.is_jmap_configured", return_value=True))
        self.enqueue = self.enterContext(patch("frappe.enqueue"))

    def tearDown(self) -> None:
        frappe.set_user("Administrator")

    def renames(self) -> list:
        return [
            c for c in self.enqueue.call_args_list if c.args[0] == "suite.mail.events.rename_own_identities"
        ]

    def test_a_name_change_queues_the_rename_after_commit(self) -> None:
        self.user.last_name = "Chen-Li"
        self.user.save(ignore_permissions=True)

        self.assertEqual(
            self.renames(),
            [
                call(
                    "suite.mail.events.rename_own_identities",
                    user=EMAIL,
                    old_name="Maya Chen",
                    new_name="Maya Chen-Li",
                    enqueue_after_commit=True,
                )
            ],
        )

    def test_a_save_without_a_name_change_queues_nothing(self) -> None:
        self.user.time_zone = "America/Los_Angeles"
        self.user.save(ignore_permissions=True)

        self.assertEqual(self.renames(), [])

    def test_only_own_identities_still_carrying_the_old_name_are_renamed(self) -> None:
        identities = [
            {"id": "a", "email": EMAIL, "name": "Maya Chen", "replyTo": None, "bcc": None},
            {"id": "b", "email": EMAIL, "name": "Maya at Northwind", "replyTo": None, "bcc": None},
            {"id": "c", "email": "sales@example.test", "name": "Maya Chen", "replyTo": None, "bcc": None},
        ]
        participants = [
            {"id": "p", "calendarAddress": f"mailto:{EMAIL}", "name": "Maya Chen"},
            {"id": "q", "calendarAddress": "mailto:sales@example.test", "name": "Maya Chen"},
        ]
        with (
            patch(
                "suite.mail.doctype.user_account.user_account.get_user_jmap_accounts", return_value=["acc"]
            ),
            patch("suite.mail.jmap.get_cached_identities", return_value=identities),
            patch("suite.mail.jmap.get_cached_participant_identities", return_value=participants),
            patch("suite.mail.jmap.invalidate_jmap_identities_cache"),
            patch("suite.mail.doctype.identity.identity.update_identity") as update_identity,
            patch(
                "suite.mail.doctype.participant_identity.participant_identity.update_participant_identity"
            ) as update_participant_identity,
        ):
            rename_own_identities(EMAIL, "Maya Chen", "Maya Chen-Li")

        update_identity.assert_called_once_with("acc", "a", "Maya Chen-Li", None, None, None, None)
        self.assertEqual(
            update_participant_identity.call_args_list, [call("acc", "p", "Maya Chen-Li", EMAIL)]
        )
