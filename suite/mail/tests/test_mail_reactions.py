# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
import unittest
from typing import ClassVar
from unittest import mock

from suite.mail.api import mail as mail_api
from suite.mail.api.mail import collapse_reactions, reaction_recipients, written_messages
from suite.mail.jmap import build_email_draft
from suite.mail.utils.reaction import is_emoji, reaction_bodies, read_reactions

# The fields of a message Gmail really sent when reacting with 😂, as Suite formats it.
GMAIL_REACTION = {
    "in_reply_to": "original@frappe.io",
    "text_body": (
        "😂\n\nAkash Tom reacted via Gmail\n<https://www.google.com/gmail/about/>\n\n"
        "On Wed, 4 Nov 2026 at 16:03, Suite Test <suite@frappe.io> wrote:\n\n> Please ignore.\n>\n"
    ),
    "_text_body": [{"part_id": "1", "type": "text/plain", "disposition": None}],
    "attachments": [
        {"part_id": "2", "filename": None, "type": "text/vnd.google.email-reaction+json", "disposition": None}
    ],
}


def rfc_reaction(body: str, *more_parts: dict, **fields) -> dict:
    return {
        "in_reply_to": "original@frappe.io",
        "text_body": body,
        "_text_body": [{"type": "text/plain", "disposition": "reaction"}, *more_parts],
        "attachments": [],
        **fields,
    }


class ReadingAReaction(unittest.TestCase):
    def test_gmail_marks_it_with_its_own_part_and_opens_the_text_with_the_emoji(self):
        self.assertEqual(read_reactions(GMAIL_REACTION), ["😂"])

    def test_rfc_9078_marks_it_with_the_disposition(self):
        self.assertEqual(read_reactions(rfc_reaction("👍\r\n")), ["👍"])

    def test_rfc_9078_allows_several_emoji_on_the_line_and_drops_what_is_not_one(self):
        self.assertEqual(read_reactions(rfc_reaction("👍 nope 🎉\r\n")), ["👍", "🎉"])

    def test_a_lone_emoji_reply_with_no_marker_is_a_message(self):
        reply = {
            "in_reply_to": "original@frappe.io",
            "text_body": "👍",
            "_text_body": [{"type": "text/plain", "disposition": None}],
            "attachments": [],
        }
        self.assertEqual(read_reactions(reply), [])

    def test_prose_marked_as_a_reaction_is_a_message(self):
        self.assertEqual(read_reactions(rfc_reaction("Thanks, that works for me")), [])

    def test_an_empty_reaction_is_a_blank_message_not_a_withdrawal(self):
        self.assertEqual(read_reactions(rfc_reaction("")), [])

    def test_a_reaction_with_more_text_beside_it_is_a_message(self):
        message = rfc_reaction("👍", {"type": "text/plain", "disposition": None})
        self.assertEqual(read_reactions(message), [])

    def test_a_reaction_with_a_file_attached_is_a_message(self):
        message = {**GMAIL_REACTION, "attachments": [*GMAIL_REACTION["attachments"], {"filename": "a.png"}]}
        self.assertEqual(read_reactions(message), [])

    def test_gmails_part_over_a_written_reply_is_a_message(self):
        self.assertEqual(read_reactions({**GMAIL_REACTION, "text_body": "Looks good to me\n"}), [])

    def test_it_has_to_answer_something(self):
        self.assertEqual(read_reactions({**GMAIL_REACTION, "in_reply_to": None}), [])

    def test_a_message_cached_without_these_fields_is_not_a_reaction(self):
        self.assertEqual(read_reactions({"in_reply_to": "original@frappe.io"}), [])


class WhatCountsAsAnEmoji(unittest.TestCase):
    def test_emoji_of_every_build(self):
        for emoji in [
            "👍",
            "❤️",
            "👍🏽",
            "👨‍👩‍👧‍👦",
            "🇮🇳",
            "1️⃣",
            "👩🏽‍❤️‍💋‍👨🏼",
            "🏴\U000e0067\U000e0062\U000e0065\U000e006e\U000e0067\U000e007f",
        ]:
            self.assertTrue(is_emoji(emoji), emoji)

    def test_not_emoji(self):
        for text in ["", None, "hello", "1", "#", "‍", "👍 👍", "👍!", "👍" * 17]:
            self.assertFalse(is_emoji(text), text)


def mail(id: str, reacts_with: list[str] | None = None, target: str | None = None, **fields) -> dict:
    return {
        "name": f"acct|{id}",
        "id": id,
        "thread_id": "t1",
        "message_id": f"{id}@example.com",
        "in_reply_to": f"{target}@example.com" if target else None,
        "reacts_with": reacts_with or [],
        "from_name": "Ana",
        "from_email": "ana@example.com",
        "received_at": f"2026-11-04T10:00:0{id[-1]}Z",
        "mailboxes": [{"mailbox_id": "inbox"}],
        "seen": 1,
        "junk": 0,
        "flagged": 0,
        "draft": 0,
        **fields,
    }


class FoldingOntoTheTarget(unittest.TestCase):
    def test_a_reaction_leaves_the_thread_for_a_chip_on_its_target(self):
        thread = collapse_reactions([mail("m1"), mail("r2", ["😂"], "m1"), mail("m3")])
        self.assertEqual([m["id"] for m in thread], ["m1", "m3"])
        self.assertEqual(
            thread[0]["reactions"],
            [{"emoji": "😂", "from_name": "Ana", "from_email": "ana@example.com"}],
        )
        self.assertNotIn("reactions", thread[1])

    def test_a_persons_reactions_add_up_rather_than_replace_each_other(self):
        target = collapse_reactions([mail("m1"), mail("r2", ["😂"], "m1"), mail("r3", ["😍"], "m1")])[0]
        self.assertEqual([r["emoji"] for r in target["reactions"]], ["😂", "😍"])

    def test_the_same_emoji_twice_from_one_person_counts_once(self):
        target = collapse_reactions([mail("m1"), mail("r2", ["❤️"], "m1"), mail("r3", ["❤"], "m1")])[0]
        self.assertEqual(len(target["reactions"]), 1)

    def test_the_same_emoji_from_two_people_counts_twice(self):
        other = {"from_email": "Bo@example.com", "from_name": "Bo"}
        target = collapse_reactions(
            [mail("m1"), mail("r2", ["😂"], "m1"), mail("r3", ["😂"], "m1", **other)]
        )[0]
        self.assertEqual(
            [r["from_email"] for r in target["reactions"]], ["ana@example.com", "Bo@example.com"]
        )

    def test_it_lands_on_the_message_it_names_not_the_newest(self):
        thread = collapse_reactions([mail("m1"), mail("m2"), mail("r3", ["😂"], "m1")])
        self.assertIn("reactions", thread[0])
        self.assertNotIn("reactions", thread[1])

    def test_with_no_target_here_it_stays_a_message(self):
        thread = collapse_reactions([mail("m1"), mail("r2", ["😂"], "gone")])
        self.assertEqual([m["id"] for m in thread], ["m1", "r2"])

    def test_a_reaction_to_a_reaction_stays_a_message(self):
        thread = collapse_reactions([mail("r1", ["😂"], "gone"), mail("r2", ["😍"], "r1")])
        self.assertEqual([m["id"] for m in thread], ["r1", "r2"])

    def test_actions_on_the_thread_still_reach_the_folded_mail(self):
        target = collapse_reactions([mail("m1"), mail("r2", ["😂"], "m1", seen=0)])[0]
        self.assertEqual([(c["id"], c["seen"]) for c in target["duplicates"]], [("r2", 0)])

    def test_the_copies_a_reaction_left_are_reached_too(self):
        twin = {"id": "r2-sent"}
        target = collapse_reactions([mail("m1"), mail("r2", ["😂"], "m1", duplicates=[twin])])[0]
        self.assertEqual([c["id"] for c in target["duplicates"]], ["r2", "r2-sent"])


class WhatARowDescribes(unittest.TestCase):
    def raw(self, id: str, target: str | None = None) -> dict:
        reaction = {**GMAIL_REACTION, "in_reply_to": f"{target}@example.com"} if target else {}
        return {"id": id, "message_id": f"{id}@example.com", **reaction}

    def test_reactions_are_left_out(self):
        written = written_messages([self.raw("m1"), self.raw("r2", "m1")])
        self.assertEqual([m["id"] for m in written], ["m1"])

    def test_a_reaction_whose_target_is_not_shown_is_what_there_is_to_describe(self):
        written = written_messages([self.raw("r2", "gone")])
        self.assertEqual([m["id"] for m in written], ["r2"])


def stored(id: str, mailbox: str, at: str, target: str | None = None, **fields) -> dict:
    """A message as the store holds it, the way a list is built from."""

    reaction = {**GMAIL_REACTION, "in_reply_to": f"{target}@example.com"} if target else {}
    return {
        "name": f"acct|{id}",
        "id": id,
        "thread_id": "t1",
        "message_id": f"{id}@example.com",
        "from_name": "Ana",
        "from_email": "ana@example.com",
        "subject": f"Re: Plans {id}",
        "html_body": "",
        "text_body": "",
        "preview": f"preview of {id}",
        "received_at": at,
        "draft": 0,
        "seen": 1,
        "junk": 0,
        "flagged": 0,
        "mailboxes": [{"mailbox_id": mailbox}],
        "recipients": [],
        "reply_to": [],
        "attachments": [],
        **reaction,
        **fields,
    }


class ListRows(unittest.TestCase):
    def rows(self, *conversations: list[dict], limit: int = 50) -> dict:
        with (
            mock.patch.object(
                mail_api,
                "fetch_threads",
                return_value={str(i): c for i, c in enumerate(conversations)},
            ),
            mock.patch.object(
                mail_api, "get_cached_mailboxes", return_value=[{"id": "sent", "role": "sent"}]
            ),
            mock.patch.object(mail_api, "add_user_images_to_emails"),
        ):
            return mail_api.get_threads("acct", "inbox", limit)

    def test_a_reaction_does_not_redate_or_describe_the_row(self):
        row = self.rows(
            [
                stored("m1", "inbox", "2026-11-01T10:00:00Z"),
                stored("r2", "inbox", "2026-11-04T10:00:00Z", target="m1", seen=0),
            ]
        )["rows"][0]
        self.assertEqual(row["id"], "m1")
        self.assertEqual(row["received_at"], "2026-11-01T10:00:00Z")
        self.assertEqual(row["preview"], "preview of m1")
        self.assertEqual(row["seen"], 1)
        self.assertEqual(row["subject"], "Re: Plans m1")
        self.assertEqual([m["id"] for m in row["messages"]], ["m1"])

    def test_a_reaction_to_mail_only_in_sent_does_not_list_it_in_the_inbox(self):
        rows = self.rows(
            [
                stored("m1", "sent", "2026-11-01T10:00:00Z"),
                stored("r2", "inbox", "2026-11-04T10:00:00Z", target="m1"),
            ]
        )["rows"]
        self.assertEqual(rows, [])

    def test_a_page_of_hidden_rows_still_has_more_after_it(self):
        conversation = [
            stored("m1", "sent", "2026-11-01T10:00:00Z"),
            stored("r2", "inbox", "2026-11-04T10:00:00Z", target="m1"),
        ]
        self.assertTrue(self.rows(conversation, limit=1)["has_more"])

    def test_a_reaction_whose_target_is_gone_is_listed_as_the_message_it_then_is(self):
        rows = self.rows([stored("r2", "inbox", "2026-11-04T10:00:00Z", target="gone")])["rows"]
        self.assertEqual([r["id"] for r in rows], ["r2"])


class WhoItGoesTo(unittest.TestCase):
    identities: ClassVar[list[dict]] = [{"email": "me@frappe.io"}]

    def test_the_author_is_addressed_and_the_rest_copied(self):
        rows = reaction_recipients(
            self.identities,
            {
                "from_email": "ana@example.com",
                "from_name": "Ana",
                "recipients": [
                    {"type": "To", "email": "me@frappe.io"},
                    {"type": "Cc", "email": "bo@example.com", "display_name": "Bo"},
                    {"type": "Bcc", "email": "hidden@example.com"},
                ],
            },
            "me@frappe.io",
        )
        self.assertEqual(
            [(r["type"], r["email"]) for r in rows],
            [("To", "ana@example.com"), ("Cc", "bo@example.com")],
        )

    def test_reply_to_stands_in_for_the_author(self):
        rows = reaction_recipients(
            self.identities,
            {
                "from_email": "ana@example.com",
                "reply_to": [{"email": "desk@example.com"}],
                "recipients": [{"type": "To", "email": "me@frappe.io"}],
            },
            "me@frappe.io",
        )
        self.assertEqual([r["email"] for r in rows], ["desk@example.com"])

    def test_on_your_own_mail_it_goes_to_whom_you_sent_it(self):
        rows = reaction_recipients(
            self.identities,
            {
                "from_email": "ME@frappe.io",
                "recipients": [
                    {"type": "Cc", "email": "ana@example.com"},
                    {"type": "Cc", "email": "bo@example.com"},
                ],
            },
            "me@frappe.io",
        )
        self.assertEqual(
            [(r["type"], r["email"]) for r in rows],
            [("To", "ana@example.com"), ("Cc", "bo@example.com")],
        )

    def test_on_mail_only_to_yourself_it_comes_back_to_you(self):
        rows = reaction_recipients(
            self.identities,
            {"from_email": "me@frappe.io", "recipients": [{"type": "To", "email": "me@frappe.io"}]},
            "me@frappe.io",
        )
        self.assertEqual([r["email"] for r in rows], ["me@frappe.io"])


class WhatGoesOut(unittest.TestCase):
    def draft(self) -> dict:
        text_body, html_body = reaction_bodies("😂", "Suite <Test> reacted")
        return build_email_draft(
            from_email="sender@example.com",
            recipients=[{"type": "to", "name": None, "email": "rcpt@example.com"}],
            draft_mailbox_id="mailbox-1",
            queue_name="c1",
            in_reply_to="original@example.com",
            text_body=text_body,
            html_body=html_body,
            reaction="😂",
        )

    def test_it_has_the_shape_gmail_draws_a_chip_for(self):
        structure = self.draft()["bodyStructure"]
        self.assertEqual(structure["type"], "multipart/alternative")
        self.assertEqual(
            [part["type"].split(";")[0] for part in structure["subParts"]],
            ["text/plain", "text/vnd.google.email-reaction+json", "text/html"],
        )

    def test_the_marked_part_names_the_emoji(self):
        draft = self.draft()
        marked = next(p for p in draft["bodyStructure"]["subParts"] if "reaction" in p["type"])
        self.assertEqual(
            json.loads(draft["bodyValues"][marked["partId"]]["value"]), {"emoji": "😂", "version": 1}
        )

    def test_no_part_carries_the_disposition_outlook_makes_an_attachment_of(self):
        self.assertTrue(all("disposition" not in p for p in self.draft()["bodyStructure"]["subParts"]))

    def test_what_is_sent_reads_back_as_the_same_reaction(self):
        draft = self.draft()
        sent = {
            "in_reply_to": "original@example.com",
            "text_body": draft["bodyValues"]["text"]["value"],
            "_text_body": [{"type": "text/plain", "disposition": None}],
            "attachments": [{"filename": None, "type": "text/vnd.google.email-reaction+json"}],
        }
        self.assertEqual(read_reactions(sent), ["😂"])

    def test_the_sender_name_cannot_write_markup_into_the_fallback(self):
        self.assertIn("Suite &lt;Test&gt; reacted", self.draft()["bodyValues"]["html"]["value"])


if __name__ == "__main__":
    unittest.main()
