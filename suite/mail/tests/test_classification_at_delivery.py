# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""A message's category as the mail server gives it at delivery, from the account's automation
Sieve script, and the one pass that gives a category to the mail delivered before that."""

import unittest
from unittest import mock

from suite.mail import classification
from suite.mail.classification import backfill
from suite.mail.classification.headers import classify_by_headers
from suite.mail.tests.sieve_interpreter import KEEP, Delivery, Message, deliver
from suite.mail.tests.test_automation_sieve_compiles import render_automation_script
from suite.mail.tests.test_email_classification import ACCOUNT, MAILBOXES, USER, _email, _Mail

LIST_POST = {"List-Post": "<mailto:dev@lists.example.org>", "List-Id": "<dev.lists.example.org>"}
UNSUBSCRIBE = {"List-Unsubscribe": "<https://shop.example/unsubscribe/42>"}
BOUNCE = {"Content-Type": 'multipart/report; report-type=delivery-status; boundary="b1"'}

# What the header rules make of a message: its sender, its headers, and the category it belongs in,
# or None where the headers do not say. Each category is stated here, not read from the rules.
SAMPLES: tuple[tuple[str, str, dict[str, str], str | None], ...] = (
    # Mail a person wrote.
    ("a colleague", "alice@example.org", {}, None),
    ("an automatic reply", "alice@example.org", {"Auto-Submitted": "auto-replied"}, None),
    # A report on mail the user sent.
    ("a bounce", "MAILER-DAEMON@mx.example", BOUNCE, "primary"),
    (
        "a read receipt, its report type quoted and folded",
        "bob@example.org",
        {"Content-Type": 'multipart/report;\r\n\treport-type="disposition-notification"; boundary="b2"'},
        "primary",
    ),
    (
        "a bounce from a no-reply address marked auto-generated",
        "noreply@mx.example",
        {**BOUNCE, "Auto-Submitted": "auto-generated"},
        "primary",
    ),
    (
        "a report on anything else",
        "noreply@mx.example",
        {"Content-Type": "multipart/report; report-type=feedback-report", "Auto-Submitted": "auto-generated"},
        "updates",
    ),
    (
        "a report type on a message that is no report",
        "bob@example.org",
        {"Content-Type": "text/plain; report-type=delivery-status"},
        None,
    ),
    # A social network.
    ("a social network", "notification@facebookmail.com", {}, "social"),
    ("a subdomain of a social network", "jobs@em.linkedin.com", {}, "social"),
    (
        "a social network sending as a list in bulk",
        "Groups@LinkedIn.com",
        {**LIST_POST, **UNSUBSCRIBE, "Precedence": "bulk"},
        "social",
    ),
    ("a domain that only ends like a social network", "alice@notlinkedin.com", {}, None),
    # A discussion list.
    ("a post to a mailing list", "carol@example.org", {**LIST_POST, **UNSUBSCRIBE}, "forums"),
    ("a Google Groups message", "carol@example.org", {"X-Google-Group-Id": "1234"}, "forums"),
    ("a Mailman message", "carol@example.org", {"X-Mailman-Version": "2.1.39"}, "forums"),
    ("an ezmlm message", "carol@example.org", {"Mailing-List": "contact dev-help@example.org"}, "forums"),
    (
        "a repository notification",
        "notifications@github.example",
        {"List-Id": "<repo.github.example>", "Precedence": "list"},
        "forums",
    ),
    (
        "an announcement list nobody can post to",
        "announce@example.org",
        {"List-Post": "NO (posting not allowed)", "List-Id": "<announce.example.org>"},
        "promotions",
    ),
    (
        "a campaign with a list id, sent as bulk",
        "hello@shop.example",
        {"List-Id": "<campaign.shop.example>", "Precedence": "bulk"},
        "promotions",
    ),
    # A campaign tool.
    ("a Mailchimp campaign", "hello@shop.example", {"X-MC-User": "abc123"}, "promotions"),
    ("a campaign named by its mailer", "hello@shop.example", {"X-Mailer": "MailChimp Mailer"}, "promotions"),
    (
        "a campaign marked auto-generated",
        "noreply@shop.example",
        {"X-Campaign-Id": "42", "Auto-Submitted": "auto-generated"},
        "promotions",
    ),
    # A system notice.
    ("a system notice", "cron@server.example", {"Auto-Submitted": "auto-generated"}, "updates"),
    (
        "a system notice with parameters and an unsubscribe link",
        "cron@server.example",
        {"Auto-Submitted": "Auto-Notified; owner-email=ops@server.example", **UNSUBSCRIBE},
        "updates",
    ),
    # A transactional sender.
    ("a receipt with an unsubscribe link", "billing@shop.example", UNSUBSCRIBE, "updates"),
    ("a transactional sender spelled with separators", "Order_s+A17@shop.example", {}, "updates"),
    ("a sender whose name only starts like one", "billingteam@shop.example", {}, None),
    # Mail that was subscribed to.
    ("mail that can be unsubscribed from", "hello@shop.example", UNSUBSCRIBE, "promotions"),
    ("mail with a list id alone", "hello@shop.example", {"List-Id": "<news.shop.example>"}, "promotions"),
    ("a newsletter address", "News-Letters@shop.example", {}, "promotions"),
    ("a no-reply address that can be unsubscribed from", "noreply@shop.example", UNSUBSCRIBE, "promotions"),
    # An automated sender.
    ("a no-reply address", "noreply@bank.example", {}, "updates"),
    ("a no-reply address spelled with separators and a tag", "No-Reply+abc@bank.example", {}, "updates"),
    ("an address that starts with do-not-reply", "do_not_reply.accounts@bank.example", {}, "updates"),
    ("an address with no-reply in the middle", "annoreply@bank.example", {}, None),
    ("a tag that says no-reply", "alice+noreply@example.org", {}, None),
    ("bulk mail", "hello@bank.example", {"PRECEDENCE": "BULK"}, "updates"),
    ("a first-class precedence", "alice@example.org", {"Precedence": "first-class"}, None),
)


def _message(sender: str, headers: dict[str, str], spamtest: int = 1) -> Message:
    return Message((("From", f"Sender <{sender}>"), *headers.items()), spamtest)


def _categories(delivery: Delivery) -> set[str]:
    return {flag.removeprefix("category_") for flag in delivery.flags if flag.startswith("category_")}


class HeaderRules(unittest.TestCase):
    """The header rules give the same category when a site fetches a message and when the mail
    server delivers it."""

    def test_a_fetch_puts_each_message_in_its_category(self):
        for case, sender, headers, category in SAMPLES:
            with self.subTest(case):
                claimed = classify_by_headers(_email(sender=sender, headers=headers))
                self.assertEqual(claimed.value if claimed else None, category)

    def test_delivery_marks_each_message_with_its_category(self):
        block = classification.build_classification_block()
        for case, sender, headers, category in SAMPLES:
            with self.subTest(case):
                delivery = deliver(block, _message(sender, headers))
                self.assertEqual(_categories(delivery), {category} if category else set())

    def test_the_mark_is_the_keyword_a_tab_of_the_inbox_lists_by(self):
        delivery = deliver(classification.build_classification_block(), _message("a@b.example", LIST_POST))
        self.assertEqual(
            classification.tab_filter(classification.Category.FORUMS),
            {"hasKeyword": next(iter(delivery.flags))},
        )


class AutomationScript(unittest.TestCase):
    """The category stays on a message whichever block of the automation script files it."""

    def deliver(self, sender: str, headers: dict[str, str], spamtest: int = 1, classify: bool = True):
        return deliver(render_automation_script(classify), _message(sender, headers, spamtest))

    def test_mail_from_a_new_sender_keeps_its_category_beside_unscreened(self):
        delivery = self.deliver("carol@lists.example.org", LIST_POST)
        self.assertEqual(delivery, Delivery(KEEP, frozenset({"category_forums", "unscreened"})))

    def test_mail_from_an_accepted_sender_reaches_the_inbox_with_its_category(self):
        delivery = self.deliver("boss@example.org", UNSUBSCRIBE)
        self.assertEqual(delivery, Delivery("INBOX", frozenset({"category_promotions"})))

    def test_mail_a_folder_rule_files_keeps_its_category(self):
        headers = {"Subject": 'Your invoice is "urgent"', "Auto-Submitted": "auto-generated"}
        delivery = self.deliver("team@example.org", headers)
        self.assertEqual(delivery.mailbox, 'Clients/"VIP" \\ Gold')
        self.assertEqual(delivery.flags, {"category_updates", "\\Seen", "\\Flagged"})

    def test_mail_from_a_blocked_sender_goes_to_junk(self):
        delivery = self.deliver("spammer@example.org", UNSUBSCRIBE)
        self.assertEqual(delivery.mailbox, "Junk Mail")
        self.assertIn("$junk", delivery.flags)

    def test_mail_the_server_calls_spam_is_left_to_the_server(self):
        delivery = self.deliver("carol@lists.example.org", LIST_POST, spamtest=7)
        self.assertEqual(delivery, Delivery(KEEP, frozenset({"category_forums"})))

    def test_mail_no_rule_claims_is_given_no_category(self):
        delivery = self.deliver("stranger@else.example", {})
        self.assertEqual(delivery, Delivery(KEEP, frozenset({"unscreened"})))

    def test_nothing_is_marked_when_mail_is_not_classified(self):
        delivery = self.deliver("carol@lists.example.org", LIST_POST, classify=False)
        self.assertEqual(delivery, Delivery(KEEP, frozenset({"unscreened"})))

    def test_flags_given_to_keep_would_replace_the_category(self):
        # Keeps the tests above honest: RFC 5232 has `:flags` replace what `addflag` set.
        script = 'require ["imap4flags"];\naddflag "category_forums";\nkeep :flags "unscreened";\n'
        self.assertEqual(deliver(script, _message("a@b.example", {})).flags, {"unscreened"})


def _lists(filter: dict, email: dict) -> bool:
    """Whether `email` matches a JMAP `filter` of mailboxes and keywords, as RFC 8621 reads one."""

    if "operator" in filter:
        matches = [_lists(condition, email) for condition in filter["conditions"]]
        return {"AND": all(matches), "OR": any(matches), "NOT": not any(matches)}[filter["operator"]]
    if "inMailbox" in filter:
        return bool(email["mailboxIds"].get(filter["inMailbox"]))
    if "notKeyword" in filter:
        return not email["keywords"].get(filter["notKeyword"])
    raise AssertionError(f"Not a mailbox or keyword filter: {filter}")


class InboxBackfill(unittest.TestCase):
    """Mail that was in an Inbox before the server gave categories is given one, once."""

    def backfill(self, *emails: dict, user: str | None = USER, refused: tuple[str, ...] = ()) -> _Mail:
        """Run the backfill over a server holding `emails`, two to a batch, which declines to mark
        the `refused` ones."""

        mail = _Mail(*emails)
        mail.refused = set(refused)

        def query(arguments: dict, _server) -> dict:
            ids = [id for id, email in mail.emails.items() if _lists(arguments["filter"], email)]
            position = arguments.get("position", 0)
            return {
                "accountId": ACCOUNT,
                "queryState": "q1",
                "canCalculateChanges": False,
                "position": position,
                "ids": ids[position : position + arguments["limit"]],
            }

        mail.server.handle("Email/query", query)
        with (
            mock.patch.multiple(
                backfill,
                BATCH_SIZE=2,
                get_enabled_account_user=mock.Mock(return_value=user),
                user_context=mock.MagicMock(),
                invalidate_jmap_mailboxes_cache=mock.Mock(),
                get_mailbox_id_by_role=mock.Mock(return_value="inbox"),
                get_account_client=mock.Mock(return_value=mail.client),
                get_cached_mailboxes=mock.Mock(return_value=MAILBOXES),
            ),
            mock.patch.object(classification, "log_mail_error") as log_mail_error,
        ):
            backfill.backfill_inbox(ACCOUNT)

        log_mail_error.assert_not_called()
        return mail

    def categories(self, mail: _Mail) -> dict[str, list[str]]:
        return {
            id: sorted(
                k.removeprefix("category_") for k, on in email["keywords"].items() if on and k != "$draft"
            )
            for id, email in mail.emails.items()
        }

    def test_every_uncategorised_message_in_the_inbox_is_given_its_category(self):
        mail = self.backfill(
            _email("post", headers=LIST_POST),
            _email("offer", headers=UNSUBSCRIBE),
            _email("notice", sender="noreply@bank.example"),
            _email("letter"),
            _email("network", sender="notification@facebookmail.com"),
        )

        self.assertEqual(
            self.categories(mail),
            {
                "post": ["forums"],
                "offer": ["promotions"],
                "notice": ["updates"],
                "letter": ["primary"],
                "network": ["social"],
            },
        )

    def test_mail_with_a_category_keeps_it(self):
        mail = self.backfill(_email("moved", headers=LIST_POST, keywords={"category_updates": True}))

        self.assertEqual(self.categories(mail), {"moved": ["updates"]})
        self.assertEqual(mail.calls("Email/set"), [])

    def test_mail_outside_the_inbox_is_left_alone(self):
        mail = self.backfill(
            _email("filed", headers=LIST_POST, mailbox="projects"),
            _email("thrown", headers=LIST_POST, mailbox="trash"),
        )

        self.assertEqual(self.categories(mail), {"filed": [], "thrown": []})

    def test_mail_that_cannot_be_marked_does_not_hold_up_the_mail_after_it(self):
        # More of them than a batch holds, ahead of mail that can be marked.
        mail = self.backfill(
            _email("refused-1", headers=LIST_POST),
            _email("refused-2", headers=LIST_POST),
            _email("draft", headers=LIST_POST, keywords={"$draft": True}),
            _email("post", headers=LIST_POST),
            refused=("refused-1", "refused-2"),
        )

        self.assertEqual(
            self.categories(mail), {"refused-1": [], "refused-2": [], "draft": [], "post": ["forums"]}
        )

    def test_the_account_of_a_disabled_user_is_not_read(self):
        mail = self.backfill(_email("post", headers=LIST_POST), user=None)

        self.assertEqual(mail.server.requests, [])
        self.assertEqual(self.categories(mail), {"post": []})
