# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import email
import email.charset
from email.message import Message
from unittest import mock

from frappe.tests import UnitTestCase

from suite.calendar.doctype.calendar_event.invitations import _build_mime

ICS = (
    "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nSUMMARY:{title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
)
HTML = "<html><body><h1>{title}</h1><p>{description}</p></body></html>"

# Python's own default for utf-8: base64 bodies. Frappe changes it to quoted-printable for the
# whole process when it builds its first email, so the test sets it back.
STDLIB_UTF8_CHARSET = {"utf-8": (email.charset.BASE64, email.charset.BASE64, None)}


def build_invite(title: str = "Project Discussion", description: str = "Agenda") -> Message:
    with mock.patch.dict(email.charset.CHARSETS, STDLIB_UTF8_CHARSET):
        raw = _build_mime(
            "Jane Doe",
            "jane@example.com",
            "guest@example.org",
            f"Invitation: {title}",
            HTML.format(title=title, description=description),
            ICS.format(title=title),
            "REQUEST",
        )
    return email.message_from_string(raw)


def text_parts(message: Message) -> dict[str, Message]:
    parts = [part for part in message.walk() if part.get_content_maintype() == "text"]
    return {f"{part.get_content_type()} {part.get_content_disposition() or 'body'}": part for part in parts}


class TestCalendarInviteMime(UnitTestCase):
    """How an invitation email encodes its text parts and names itself."""

    def test_ascii_text_parts_are_7bit(self):
        parts = text_parts(build_invite())

        self.assertEqual(
            set(parts),
            {"text/plain body", "text/html body", "text/calendar body", "text/calendar attachment"},
        )
        for name, part in parts.items():
            with self.subTest(part=name):
                self.assertEqual(part["Content-Transfer-Encoding"], "7bit")
                self.assertEqual(part.get_content_charset(), "utf-8")

    def test_non_ascii_text_parts_are_quoted_printable(self):
        title = "Réunion d'équipe ☕"

        for name, part in text_parts(build_invite(title=title)).items():
            with self.subTest(part=name):
                self.assertEqual(part["Content-Transfer-Encoding"], "quoted-printable")
                self.assertIn(title, part.get_payload(decode=True).decode("utf-8"))

    def test_an_ascii_line_longer_than_smtp_allows_is_quoted_printable(self):
        description = "x" * 1200

        html = text_parts(build_invite(description=description))["text/html body"]

        self.assertEqual(html["Content-Transfer-Encoding"], "quoted-printable")
        self.assertIn(description, html.get_payload(decode=True).decode("utf-8"))

    def test_the_calendar_parts_keep_their_itip_method(self):
        parts = text_parts(build_invite())

        self.assertEqual(parts["text/calendar body"].get_param("method"), "REQUEST")
        self.assertEqual(parts["text/calendar body"].get_param("component"), "VEVENT")
        self.assertEqual(parts["text/calendar attachment"].get_param("method"), "REQUEST")
        self.assertEqual(parts["text/calendar attachment"].get_filename(), "invite.ics")

    def test_the_message_id_ends_with_the_sender_domain(self):
        message_id = build_invite()["Message-ID"]

        self.assertRegex(message_id, r"^<[^@<>]+@example\.com>$")
