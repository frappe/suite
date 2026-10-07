# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.mail.api.admin import get_group, set_group_receiving_enabled, set_member_receiving_enabled
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestReceivingDisabled(StalwartIntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.send_only = cls.create_member(disable_receiving=True)
        cls.member = cls.create_member()
        cls.colleague = cls.create_member()
        # On all: mail that did get through must show in the inbox, not sit unseen in Screening.
        for member in (cls.send_only, cls.member, cls.colleague):
            cls.disable_screening(member)

    def test_a_send_only_account_sends_like_any_other(self):
        self.deliver_mail(self.send_only, self.colleague)

    def test_mail_addressed_to_a_send_only_account_bounces_back_to_the_sender(self):
        self.assert_member_takes_no_mail(self.send_only)

    def test_an_admin_stops_and_restores_an_accounts_receiving(self):
        self.deliver_mail(self.colleague, self.member)

        with self.set_user("Administrator"):
            set_member_receiving_enabled(self.member.email, False)
        self.assert_member_takes_no_mail(self.member)

        with self.set_user("Administrator"):
            set_member_receiving_enabled(self.member.email, True)
        self.deliver_mail(self.colleague, self.member)

    def test_a_group_created_unable_to_receive_bounces_its_mail(self):
        self.assert_group_takes_no_mail(self.create_group(disable_receiving=True))

    def test_an_admin_stops_and_restores_a_groups_receiving(self):
        group = self.create_group()
        self.assert_group_takes_mail(group)

        with self.set_user("Administrator"):
            set_group_receiving_enabled(group, False)
        self.assert_group_takes_no_mail(group)

        with self.set_user("Administrator"):
            set_group_receiving_enabled(group, True)
        self.assert_group_takes_mail(group)

    # --- helpers ------------------------------------------------------------------

    def assert_mail_bounces(self, address: str) -> str:
        """The colleague's mail to ``address`` comes back as a delivery failure; returns its subject."""

        subject = f"Unwanted {unique_name('subject')}"
        result = self.send_mail(self.colleague, address, subject=subject)
        self.assertEqual(result["status"], "Submitted", result.get("error"))

        # The failure notice is what tells mail that was turned away from mail that is only slow.
        self.wait_until(
            lambda: any(
                t["from_email"].lower().startswith("mailer-daemon@") and address in t["preview"]
                for t in self.get_inbox_threads(self.colleague)
            ),
            timeout=60,
            message=f"No delivery failure came back for mail sent to {address}.",
        )
        return subject

    def assert_member_takes_no_mail(self, member: frappe._dict) -> None:
        subject = self.assert_mail_bounces(member.email)
        self.assertNotIn(subject, [t["subject"] for t in self.get_inbox_threads(member)])

    def assert_group_takes_no_mail(self, group: str) -> None:
        held = self.group_disk_use(group)
        self.assert_mail_bounces(group)
        self.assertEqual(self.group_disk_use(group), held)

    def assert_group_takes_mail(self, group: str) -> None:
        """A group's mail goes to a mailbox of its own, so its disk use is what shows an arrival."""

        held = self.group_disk_use(group)
        result = self.send_mail(self.colleague, group, subject=f"Wanted {unique_name('subject')}")
        self.assertEqual(result["status"], "Submitted", result.get("error"))
        self.wait_until(
            lambda: self.group_disk_use(group) > held,
            timeout=60,
            message=f"Mail sent to {group} did not reach the group's mailbox.",
        )

    def group_disk_use(self, group: str) -> int:
        with self.set_user("Administrator"):
            return get_group(group)["quota"]["used"]
