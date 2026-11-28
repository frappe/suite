# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""The auto-reply as a block of the account's automation Sieve script: it answers mail while the
rest of the script still screens, blocks, files and gives mail its category."""

import email
import unittest

import frappe

from suite.mail.tests.sieve_interpreter import KEEP, Delivery, Message, deliver
from suite.mail.tests.test_automation_sieve_compiles import VACATION_REPLY, render_automation_script

UNSUBSCRIBE = {"List-Unsubscribe": "<https://shop.example/unsubscribe/42>"}


def _deliver(sender: str, headers: dict | None = None, spamtest: int = 1, now: str = "2026-11-25T12:00:00Z"):
    script = render_automation_script(vacation=VACATION_REPLY)
    return deliver(script, Message((("From", f"Sender <{sender}>"), *(headers or {}).items()), spamtest, now))


class AutoReplyInTheAutomationScript(unittest.TestCase):
    def test_a_blocked_sender_still_goes_to_junk_and_gets_no_reply(self):
        delivery = _deliver("spammer@example.org")
        self.assertEqual(delivery, Delivery("Junk Mail", frozenset({"$junk"})))

    def test_a_sender_on_a_blocked_domain_gets_no_reply(self):
        self.assertIsNone(_deliver("anyone@spammers.example.org").reply)

    def test_mail_the_server_calls_spam_gets_no_reply(self):
        self.assertIsNone(_deliver("stranger@else.example", spamtest=7).reply)

    def test_a_new_sender_is_still_screened_and_gets_the_reply(self):
        delivery = _deliver("stranger@else.example")
        self.assertEqual((delivery.mailbox, delivery.flags), (KEEP, {"unscreened"}))
        self.assertIsNotNone(delivery.reply)

    def test_an_accepted_sender_keeps_the_category_and_gets_the_reply(self):
        delivery = _deliver("boss@example.org", UNSUBSCRIBE)
        self.assertEqual((delivery.mailbox, delivery.flags), ("INBOX", {"category_promotions"}))
        self.assertIsNotNone(delivery.reply)

    def test_mail_a_folder_rule_files_gets_the_reply(self):
        delivery = _deliver("team@example.org", {"Subject": "invoice", "Auto-Submitted": "auto-generated"})
        self.assertEqual(delivery.mailbox, 'Clients/"VIP" \\ Gold')
        self.assertIsNotNone(delivery.reply)

    def test_no_reply_before_the_window_opens_or_once_it_closes(self):
        self.assertIsNone(_deliver("boss@example.org", now="2026-11-20T08:59:59Z").reply)
        self.assertIsNotNone(_deliver("boss@example.org", now="2026-11-20T09:00:00Z").reply)
        self.assertIsNone(_deliver("boss@example.org", now="2026-12-01T09:00:00Z").reply)

    def test_a_reply_with_no_window_answers_at_any_time(self):
        reply = frappe._dict(VACATION_REPLY, from_date=None, to_date=None)
        script = render_automation_script(vacation=reply)
        message = Message((("From", "Boss <boss@example.org>"),), now="2031-01-01T00:00:00Z")
        self.assertIsNotNone(deliver(script, message).reply)

    def test_the_reply_carries_the_message_as_written(self):
        reply = email.message_from_string(_deliver("boss@example.org").reply)
        parts = {part.get_content_type(): part for part in reply.walk() if not part.is_multipart()}
        self.assertEqual(parts["text/plain"].get_payload(decode=True).decode(), VACATION_REPLY.text_body)
        self.assertEqual(parts["text/html"].get_payload(decode=True).decode(), VACATION_REPLY.html_body)

    def test_no_reply_block_while_the_reply_is_off(self):
        self.assertIsNone(deliver(render_automation_script(), Message((("From", "b@example.org"),))).reply)
