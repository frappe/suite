# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""The delivery-status parser's contract: a `message/delivery-status` part splits into the
report's own fields and one entry per recipient, with the RFC 3464 type prefixes stripped."""

import unittest

from suite.mail.utils.delivery_status import parse_delivery_status

STALWART_DSN = (
    b"Reporting-MTA: dns;localhost\r\n"
    b"Arrival-Date: Fri, 7 Aug 2026 06:40:18 +0000\r\n"
    b"Original-Envelope-Id: 019fdaf3-511f-75c2-b039-dff4061483d6\r\n"
    b"\r\n"
    b"Original-Recipient: rfc822;sagarsharma.s312@gmail.com\r\n"
    b"Final-Recipient: rfc822;sagarsharma.s312@gmail.com\r\n"
    b"Action: failed\r\n"
    b"Status: 5.7.26\r\n"
    b"Diagnostic-Code: smtp;550 Unauthenticated email from example.com is not accepted due\r\n"
    b" to domain's DMARC policy. - gsmtp\r\n"
    b"Remote-MTA: dns;gmail-smtp-in.l.google.com\r\n"
)


class ParseDeliveryStatus(unittest.TestCase):
    def test_report_fields_come_from_the_per_message_group(self):
        report = parse_delivery_status(STALWART_DSN)
        self.assertEqual(report["reporting_mta"], "localhost")
        self.assertEqual(report["arrival_date"], "Fri, 7 Aug 2026 06:40:18 +0000")

    def test_recipient_fields_are_parsed_with_type_prefixes_stripped(self):
        report = parse_delivery_status(STALWART_DSN)
        self.assertEqual(len(report["recipients"]), 1)
        recipient = report["recipients"][0]
        self.assertEqual(recipient["email"], "sagarsharma.s312@gmail.com")
        self.assertEqual(recipient["action"], "failed")
        self.assertEqual(recipient["status"], "5.7.26")
        self.assertEqual(recipient["remote_mta"], "gmail-smtp-in.l.google.com")

    def test_folded_diagnostic_code_is_unfolded(self):
        recipient = parse_delivery_status(STALWART_DSN)["recipients"][0]
        self.assertEqual(
            recipient["diagnostic_code"],
            "550 Unauthenticated email from example.com is not accepted due"
            " to domain's DMARC policy. - gsmtp",
        )

    def test_multiple_recipient_groups_yield_one_entry_each(self):
        report = parse_delivery_status(
            "Reporting-MTA: dns;mx.example.com\n"
            "\n"
            "Final-Recipient: rfc822;a@example.com\n"
            "Action: failed\n"
            "Status: 5.1.1\n"
            "\n"
            "Final-Recipient: rfc822;b@example.com\n"
            "Action: delayed\n"
            "Status: 4.4.1\n"
            "Will-Retry-Until: Sat, 8 Aug 2026 06:40:18 +0000\n"
        )
        self.assertEqual(
            [(r["email"], r["action"]) for r in report["recipients"]],
            [("a@example.com", "failed"), ("b@example.com", "delayed")],
        )
        self.assertEqual(report["recipients"][1]["will_retry_until"], "Sat, 8 Aug 2026 06:40:18 +0000")

    def test_falls_back_to_original_recipient_when_final_is_absent(self):
        report = parse_delivery_status("Original-Recipient: rfc822;a@example.com\nAction: failed\n")
        self.assertEqual(report["recipients"][0]["email"], "a@example.com")

    def test_action_is_lower_cased(self):
        report = parse_delivery_status("Final-Recipient: rfc822;a@example.com\nAction: FAILED\n")
        self.assertEqual(report["recipients"][0]["action"], "failed")

    def test_untyped_values_are_kept_verbatim(self):
        report = parse_delivery_status(
            "Final-Recipient: a@example.com\n"
            "Action: failed\n"
            "Diagnostic-Code: mailbox is full; try again later\n"
        )
        recipient = report["recipients"][0]
        self.assertEqual(recipient["email"], "a@example.com")
        self.assertEqual(recipient["diagnostic_code"], "mailbox is full; try again later")

    def test_empty_or_garbage_content_yields_no_recipients(self):
        for content in (b"", "not a dsn at all", "just text\nwith lines\n"):
            report = parse_delivery_status(content)
            self.assertEqual(report["recipients"], [])
