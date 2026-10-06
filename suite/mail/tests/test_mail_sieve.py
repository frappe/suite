# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from unittest import mock

import frappe

from suite.mail.api.mail import create_mailbox, get_mailboxes, get_threads
from suite.mail.api.sieve import (
    create_automation_script,
    create_sieve_script,
    delete_sieve_script,
    get_sieve_scripts,
    rebuild_automation_script_for_account,
    update_sieve_script,
)
from suite.mail.doctype.sieve_script.sieve_script import AUTOMATION_SCRIPT_NAME
from suite.mail.jmap import SuiteJMAPClient, get_account_client
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestMailSieve(StalwartIntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.member = cls.create_member()
        cls.sender = cls.create_member()
        cls.account = cls.personal_account(cls.member)
        cls.disable_screening(cls.member)

    def _scripts(self) -> dict[str, dict]:
        with self.set_user(self.member.email):
            return {s["_name"]: s for s in get_sieve_scripts(self.account)}

    def test_sieve_script_crud(self):
        name = unique_name("script")
        with self.set_user(self.member.email):
            create_sieve_script(self.account, name, 'require ["fileinto"];\nkeep;\n', active=False)

        script = self._scripts()[name]
        self.assertFalse(script["active"])
        self.assertIn("keep;", script["content"])

        with self.set_user(self.member.email):
            update_sieve_script(
                self.account, script["id"], name, 'require ["fileinto"];\ndiscard;\n', active=True
            )
        script = self._scripts()[name]
        self.assertTrue(script["active"])
        self.assertIn("discard;", script["content"])

        with self.set_user(self.member.email):
            # An active script cannot be deleted - deactivate it first, then restore the
            # automation script as the active one for later tests.
            update_sieve_script(
                self.account, script["id"], name, 'require ["fileinto"];\ndiscard;\n', active=False
            )
            create_automation_script(self.account, active=True)
            delete_sieve_script(self.account, script["id"])
        self.assertNotIn(name, self._scripts())

    def test_script_content_travels_inside_the_request(self):
        # Stalwart offers RFC 9404, so a save uploads the script in the request and names its blob
        # as `#script` - a creation reference the server has to resolve in a create and in an
        # update alike. With the upload endpoint closed off, content that reads back got there
        # no other way.
        name = unique_name("inline")
        closed = mock.patch.object(
            SuiteJMAPClient, "upload", side_effect=AssertionError("the upload endpoint was used")
        )
        with self.set_user(self.member.email):
            self.assertIn("blob", get_account_client(self.account).capabilities.attrs)

            with closed:
                create_sieve_script(self.account, name, 'require ["fileinto"];\nkeep;\n', active=False)
            created = self._scripts()[name]
            self.assertIn("keep;", created["content"])

            with closed:
                update_sieve_script(
                    self.account, created["id"], name, 'require ["fileinto"];\ndiscard;\n', active=False
                )
            updated = self._scripts()[name]
            self.assertEqual(updated["id"], created["id"])
            self.assertIn("discard;", updated["content"])
            self.assertNotIn("keep;", updated["content"])

            delete_sieve_script(self.account, created["id"])

    def test_invalid_script_rejected(self):
        with self.set_user(self.member.email):
            self.assertRaises(
                frappe.ValidationError,
                create_sieve_script,
                self.account,
                unique_name("broken"),
                "if address { this is not sieve",
                True,
            )

    def test_automation_rule_files_inbound_mail(self):
        # A mailbox automation rule (from a specific sender -> file into the mailbox, mark read).
        folder = unique_name("filtered")
        with self.set_user(self.member.email):
            create_mailbox(
                self.account,
                folder,
                automation_rules={
                    "emails_from": self.sender.email,
                    "subject_contains": "",
                    "match_if": "any",
                    "mark_as_read": True,
                    "add_star": False,
                },
            )
            automation = self._scripts()[AUTOMATION_SCRIPT_NAME]
            self.assertTrue(automation["active"])
            self.assertIn(self.sender.email, automation["content"])
            self.assertIn(folder, automation["content"])

            mailbox_id = next(m["id"] for m in get_mailboxes(self.account) if m["_name"] == folder)

        subject = f"Filtered {unique_name('subject')}"
        result = self.send_mail(self.sender, self.member.email, subject=subject)
        self.assertEqual(result["status"], "Submitted", result.get("error"))

        def filed():
            with self.set_user(self.member.email):
                threads, _ = get_threads(self.account, mailbox_id, limit=20)
                return next((t for t in threads if t["subject"] == subject), None)

        thread = self.wait_until(
            filed, timeout=60, message="Inbound mail was not filed by the automation rule."
        )
        self.assertTrue(thread["seen"])  # the rule marks it read
        self.assertNotIn(subject, [t["subject"] for t in self.get_inbox_threads(self.member)])

        # The rebuild endpoint regenerates the same script from its backups.
        with self.set_user(self.member.email):
            rebuild_automation_script_for_account(self.account)
        rebuilt = self._scripts()[AUTOMATION_SCRIPT_NAME]
        self.assertIn(self.sender.email, rebuilt["content"])
