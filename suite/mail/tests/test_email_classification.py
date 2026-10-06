# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Email classification: which category a message's headers put it in, and how a message comes by
its category - once, when first fetched from the JMAP server, kept there as a keyword."""

import json
import unittest
from unittest import mock

import httpx
from jmap.auth import BasicAuth
from jmap.core.retry import RetryPolicy
from jmap.testing.fake import FakeJMAPServer

from suite.mail import classification
from suite.mail.api import mail as mail_api
from suite.mail.classification import Category, classify
from suite.mail.doctype.mail_message import mail_message
from suite.mail.jmap import SuiteJMAPClient

CORE = "urn:ietf:params:jmap:core"
MAIL = "urn:ietf:params:jmap:mail"
ACCOUNT = "c9"
USER = "user@example.test"

MAILBOXES = [
    {"id": "inbox", "name": "Inbox", "role": "inbox", "isSubscribed": True},
    {"id": "sent", "name": "Sent", "role": "sent", "isSubscribed": True},
    {"id": "drafts", "name": "Drafts", "role": "drafts", "isSubscribed": True},
    {"id": "junk", "name": "Junk", "role": "junk", "isSubscribed": True},
    {"id": "trash", "name": "Trash", "role": "trash", "isSubscribed": True},
    {"id": "projects", "name": "Projects", "role": None, "isSubscribed": True},
]

NEWSLETTER = {"List-Unsubscribe": "<https://shop.example/unsubscribe/42>"}


def _email(
    id: str = "e1",
    sender: str = "alice@example.org",
    headers: dict[str, str] | None = None,
    mailbox: str = "inbox",
    keywords: dict[str, bool] | None = None,
) -> dict:
    """An Email as the server returns it for `mail_message.EMAIL_PROPERTIES`, plus its headers."""

    return {
        "id": id,
        "blobId": f"b-{id}",
        "threadId": f"t-{id}",
        "mailboxIds": {mailbox: True},
        "keywords": dict(keywords or {}),
        "size": 1024,
        "receivedAt": "2026-10-01T10:00:00Z",
        "sentAt": "2026-10-01T09:59:58Z",
        "hasAttachment": False,
        "subject": "Hello",
        "preview": "Hello there",
        "from": [{"name": None, "email": sender}],
        "to": [{"name": None, "email": USER}],
        "cc": None,
        "bcc": None,
        "replyTo": None,
        "sender": None,
        "messageId": [f"{id}@example.org"],
        "inReplyTo": None,
        "references": None,
        "htmlBody": [],
        "textBody": [],
        "bodyValues": {},
        "attachments": [],
        # Raw, as RFC 8621 gives them: the space after the colon is part of the value.
        "headers": [{"name": name, "value": f" {value}"} for name, value in (headers or {}).items()],
    }


class HeaderLayer(unittest.TestCase):
    """Layer 1 - the category a message's headers put it in."""

    def category(self, sender: str, headers: dict[str, str] | None = None) -> Category:
        return classify(_email(sender=sender, headers=headers))

    def test_mail_a_person_wrote_is_primary(self):
        headers = {"Message-ID": "<1@example.org>", "User-Agent": "Mozilla Thunderbird"}
        self.assertEqual(self.category("alice@example.org", headers), Category.PRIMARY)

    def test_a_post_to_a_mailing_list_is_forums(self):
        headers = {
            "List-Id": "Developers <dev.lists.example.org>",
            "List-Post": "<mailto:dev@lists.example.org>",
            "List-Unsubscribe": "<mailto:dev-leave@lists.example.org>",
            "Precedence": "list",
            "X-Mailman-Version": "2.1.39",
        }
        self.assertEqual(self.category("bob@example.net", headers), Category.FORUMS)

    def test_a_google_groups_message_is_forums(self):
        headers = {
            "Mailing-list": "list team@googlegroups.com; contact team+owners@googlegroups.com",
            "List-ID": "<team.googlegroups.com>",
            "X-Google-Group-Id": "123456789",
        }
        self.assertEqual(self.category("carol@example.com", headers), Category.FORUMS)

    def test_a_repository_notification_is_forums(self):
        headers = {
            "List-ID": "frappe/suite <suite.frappe.github.com>",
            "List-Post": "<mailto:reply+abc@reply.github.com>",
            "List-Unsubscribe": "<https://github.com/notifications/unsubscribe/abc>",
            "Precedence": "list",
        }
        self.assertEqual(self.category("notifications@github.com", headers), Category.FORUMS)

    def test_an_announcement_list_nobody_can_post_to_is_not_forums(self):
        headers = {
            "List-Id": "Announcements <announce.lists.example.org>",
            "List-Post": "NO (posting not allowed on this list)",
            "List-Unsubscribe": "<mailto:announce-leave@lists.example.org>",
            "X-Mailman-Version": "2.1.39",
        }
        self.assertEqual(self.category("announce@lists.example.org", headers), Category.PROMOTIONS)

    def test_a_campaign_is_promotions(self):
        headers = {
            "X-Mailer": "Mailchimp Mailer - **CIDa1b2c3**",
            "X-MC-User": "a1b2c3",
            "List-ID": "a1b2c3mc list <a1b2c3.42.list-id.mcsv.net>",
            "List-Unsubscribe": "<https://shop.us1.list-manage.com/unsubscribe?u=a1b2c3>",
            "Precedence": "bulk",
        }
        self.assertEqual(self.category("hello@shop.example", headers), Category.PROMOTIONS)

    def test_mail_that_can_be_unsubscribed_from_is_promotions(self):
        self.assertEqual(self.category("hello@shop.example", NEWSLETTER), Category.PROMOTIONS)
        self.assertEqual(self.category("no-reply@shop.example", NEWSLETTER), Category.PROMOTIONS)

    def test_a_campaign_is_promotions_even_when_marked_auto_generated(self):
        headers = {"X-SFMC-Stack": "7", "Auto-Submitted": "auto-generated"}
        self.assertEqual(self.category("offers@airline.example", headers), Category.PROMOTIONS)

    def test_mail_from_a_social_network_is_social(self):
        self.assertEqual(self.category("messages-noreply@linkedin.com", NEWSLETTER), Category.SOCIAL)
        self.assertEqual(self.category("notification@facebookmail.com"), Category.SOCIAL)
        # Networks send from subdomains as well.
        self.assertEqual(self.category("pinbot@explore.pinterest.com", NEWSLETTER), Category.SOCIAL)

    def test_a_domain_that_merely_ends_like_a_social_network_is_not_social(self):
        self.assertEqual(self.category("bob@notlinkedin.com"), Category.PRIMARY)

    def test_a_system_notice_is_updates(self):
        headers = {"Auto-Submitted": "auto-generated"}
        self.assertEqual(self.category("backup@server.example", headers), Category.UPDATES)

    def test_a_receipt_is_updates_even_with_an_unsubscribe_link(self):
        self.assertEqual(self.category("billing@saas.example", NEWSLETTER), Category.UPDATES)
        self.assertEqual(self.category("receipts+inv_42@saas.example"), Category.UPDATES)

    def test_mail_from_a_no_reply_address_is_updates(self):
        for sender in ("noreply@bank.example", "no-reply@bank.example", "Do_Not_Reply@bank.example"):
            with self.subTest(sender=sender):
                self.assertEqual(self.category(sender), Category.UPDATES)

    def test_an_automatic_reply_stays_with_the_conversation(self):
        # A vacation reply and a bounce answer something the user sent.
        headers = {"Auto-Submitted": "auto-replied"}
        self.assertEqual(self.category("alice@example.org", headers), Category.PRIMARY)
        self.assertEqual(self.category("MAILER-DAEMON@mx.example.org", headers), Category.PRIMARY)

    def test_headers_are_read_whatever_their_case_and_folding(self):
        headers = {"list-id": "<dev.lists.example.org>", "PRECEDENCE": "List"}
        self.assertEqual(self.category("bob@example.net", headers), Category.FORUMS)

        headers = {"auto-submitted": "Auto-Generated;\r\n type=report"}
        self.assertEqual(self.category("backup@server.example", headers), Category.UPDATES)

    def test_mail_fetched_without_headers_is_still_classified_by_its_sender(self):
        email = _email(sender="noreply@bank.example")
        del email["headers"]

        self.assertEqual(classify(email), Category.UPDATES)


class _Mail:
    """A fake JMAP server holding `emails`, with the caches `mail_message` reads replaced by a dict."""

    def __init__(self, *emails: dict, enabled: bool = True) -> None:
        self.emails = {email["id"]: email for email in emails}
        self.enabled = enabled
        self.refused: set[str] = set()
        self.cache: dict[str, dict] = {}

        self.server = FakeJMAPServer(
            capabilities={CORE: {}, MAIL: {}},
            accounts={ACCOUNT: {"name": USER, "isPersonal": True, "accountCapabilities": {MAIL: {}}}},
            primary_accounts={CORE: ACCOUNT, MAIL: ACCOUNT},
        )
        self.server.handle("Email/get", self._get)
        self.server.handle("Email/set", self._set)

        http = httpx.Client(auth=BasicAuth(USER, "pw"), **self.server.client_kwargs())
        self.client = SuiteJMAPClient.connect(
            "https://jmap.example.com/.well-known/jmap",
            auth=BasicAuth(USER, "pw"),
            http=http,
            experimental=True,
            retry_policy=RetryPolicy(max_attempts=1),
        )

        # No category this site wrote in an earlier test is still awaited.
        classification.take_echoes(ACCOUNT, list(self.emails))

    def _get(self, arguments: dict, _server: FakeJMAPServer) -> dict:
        properties = arguments["properties"]
        return {
            "accountId": ACCOUNT,
            "state": "s1",
            "list": [
                {name: value for name, value in self.emails[id].items() if name in properties}
                for id in arguments["ids"]
                if id in self.emails
            ],
            "notFound": [id for id in arguments["ids"] if id not in self.emails],
        }

    def _set(self, arguments: dict, _server: FakeJMAPServer) -> dict:
        updated, not_updated = {}, {}
        for id, patch in arguments["update"].items():
            if id in self.refused:
                not_updated[id] = {"type": "forbidden"}
                continue

            for path, value in patch.items():
                self.emails[id]["keywords"][path.removeprefix("keywords/")] = value
            updated[id] = None

        return {
            "accountId": ACCOUNT,
            "oldState": "s1",
            "newState": "s2",
            "updated": updated,
            "notUpdated": not_updated,
        }

    def calls(self, method: str) -> list[dict]:
        """The arguments of every `method` call the server has received."""

        return [
            call[1]
            for request in self.server.requests
            for call in request["methodCalls"]
            if call[0] == method
        ]

    def patched(self) -> mock._patch:
        """Stands this fake in for the server, the mailboxes, the cache and Mail Settings."""

        return mock.patch.multiple(
            mail_message,
            get_user_for_jmap_account=mock.Mock(return_value=USER),
            get_account_client=mock.Mock(return_value=mail_message.account_view(self.client, ACCOUNT)),
            get_jmap_client=mock.Mock(return_value=self.client),
            get_cached_mailboxes=mock.Mock(return_value=MAILBOXES),
            _get_cached_messages=lambda account, ids: {id: self.cache.get(id) for id in ids},
            _cache_messages=lambda account, messages: self.cache.update(messages),
            _remove_cached_messages=lambda account, ids: [self.cache.pop(id, None) for id in ids],
            get_sync_state=mock.Mock(return_value="s1"),
            update_sync_state=mock.Mock(),
        )

    def fetch(self, *ids: str) -> list[dict]:
        """`get_messages` for `ids`, or for every email the server holds."""

        with (
            self.patched(),
            mock.patch.object(classification, "get_config", return_value=int(self.enabled)),
        ):
            return mail_message.get_messages(ACCOUNT, list(ids or self.emails))

    def sync(self, *updated: str) -> list[mock.call]:
        """`fetch_changes` over a run of changes that updated `updated`; returns what it announced."""

        self.server.respond(
            "Email/changes",
            {
                "accountId": ACCOUNT,
                "oldState": "s1",
                "newState": "s2",
                "hasMoreChanges": False,
                "created": [],
                "updated": list(updated),
                "destroyed": [],
            },
        )

        with (
            self.patched(),
            mock.patch.object(mail_message, "log_mail_error") as log_mail_error,
            mock.patch.object(mail_message.frappe, "publish_realtime") as publish_realtime,
        ):
            mail_message.fetch_changes(USER, ACCOUNT, email_state="s2")

        log_mail_error.assert_not_called()
        return publish_realtime.call_args_list


def _keywords(message: dict) -> dict:
    return json.loads(message["keywords"])


class ClassifyOnFetch(unittest.TestCase):
    """A message is given its category when it is first fetched from the server."""

    def test_unclassified_mail_is_given_its_category_on_the_server(self):
        mail = _Mail(_email("e1", sender="hello@shop.example", headers=NEWSLETTER))

        mail.fetch()

        self.assertEqual(
            [call["update"] for call in mail.calls("Email/set")],
            [{"e1": {"keywords/category_promotions": True}}],
        )

    def test_the_fetched_message_carries_its_category(self):
        mail = _Mail(_email("e1", sender="hello@shop.example", headers=NEWSLETTER, keywords={"$seen": True}))

        [message] = mail.fetch()

        self.assertEqual(_keywords(message), {"$seen": True, "category_promotions": True})
        self.assertEqual(_keywords(mail.cache["e1"]), {"$seen": True, "category_promotions": True})

    def test_mail_nothing_marks_is_primary(self):
        mail = _Mail(_email("e1", sender="alice@example.org"))

        [message] = mail.fetch()

        self.assertEqual(_keywords(message), {"category_primary": True})

    def test_mail_in_a_folder_of_the_users_is_classified(self):
        mail = _Mail(_email("e1", sender="hello@shop.example", headers=NEWSLETTER, mailbox="projects"))

        [message] = mail.fetch()

        self.assertEqual(_keywords(message), {"category_promotions": True})

    def test_mail_with_a_category_is_not_classified_again(self):
        # Its headers say Promotions; the keyword it already carries is what stands.
        mail = _Mail(
            _email("e1", sender="hello@shop.example", headers=NEWSLETTER, keywords={"category_updates": True})
        )

        [message] = mail.fetch()

        self.assertEqual(mail.calls("Email/set"), [])
        self.assertEqual(_keywords(message), {"category_updates": True})

    def test_only_the_unclassified_mail_of_a_page_is_written(self):
        mail = _Mail(
            _email("e1", sender="alice@example.org", keywords={"category_primary": True}),
            _email("e2", sender="noreply@bank.example"),
        )

        mail.fetch()

        self.assertEqual(
            [call["update"] for call in mail.calls("Email/set")],
            [{"e2": {"keywords/category_updates": True}}],
        )

    def test_mail_the_user_wrote_or_threw_out_is_left_without_a_category(self):
        for mailbox in ("sent", "drafts", "junk", "trash"):
            with self.subTest(mailbox=mailbox):
                mail = _Mail(_email("e1", sender="hello@shop.example", headers=NEWSLETTER, mailbox=mailbox))

                [message] = mail.fetch()

                self.assertEqual(mail.calls("Email/set"), [])
                self.assertEqual(_keywords(message), {})

    def test_a_draft_is_left_without_a_category_wherever_it_is_filed(self):
        mail = _Mail(_email("e1", mailbox="projects", keywords={"$draft": True}))

        mail.fetch()

        self.assertEqual(mail.calls("Email/set"), [])

    def test_cached_mail_is_not_fetched_or_classified_again(self):
        mail = _Mail(_email("e1", sender="hello@shop.example", headers=NEWSLETTER))
        mail.fetch()
        mail.server.requests.clear()

        [message] = mail.fetch()

        self.assertEqual(mail.server.requests, [])
        self.assertEqual(_keywords(message), {"category_promotions": True})

    def test_nothing_is_classified_when_the_setting_is_off(self):
        mail = _Mail(_email("e1", sender="hello@shop.example", headers=NEWSLETTER), enabled=False)

        [message] = mail.fetch()

        self.assertEqual(mail.calls("Email/set"), [])
        self.assertEqual(_keywords(message), {})

    def test_headers_are_only_fetched_when_the_setting_is_on(self):
        on, off = _Mail(_email()), _Mail(_email(), enabled=False)
        on.fetch()
        off.fetch()

        self.assertIn("headers", on.calls("Email/get")[0]["properties"])
        self.assertNotIn("headers", off.calls("Email/get")[0]["properties"])

    def test_mail_the_server_will_not_mark_stays_unclassified(self):
        # A shared mailbox the user may read but not change: the cache must not claim a category
        # the server does not hold.
        mail = _Mail(
            _email("e1", sender="hello@shop.example", headers=NEWSLETTER),
            _email("e2", sender="noreply@bank.example"),
        )
        mail.refused = {"e1"}

        by_id = {message["id"]: message for message in mail.fetch()}

        self.assertEqual(_keywords(by_id["e1"]), {})
        self.assertEqual(_keywords(by_id["e2"]), {"category_updates": True})

    def test_mail_is_still_fetched_when_classifying_it_fails(self):
        mail = _Mail(_email("e1", sender="hello@shop.example", headers=NEWSLETTER))
        mail.server.fail("Email/set", "serverFail")

        with mock.patch.object(classification, "log_mail_error") as log_mail_error:
            [message] = mail.fetch()

        self.assertEqual(message["id"], "e1")
        self.assertEqual(_keywords(message), {})
        log_mail_error.assert_called_once()


class ClassificationEcho(unittest.TestCase):
    """The category this site writes comes back from the server as a change to the message. It is
    not news: the message was cached with its category, and no open client has anything to reload."""

    def test_a_category_this_site_wrote_does_not_evict_or_announce_the_message(self):
        mail = _Mail(_email("e1", sender="hello@shop.example", headers=NEWSLETTER))
        mail.fetch()

        announced = mail.sync("e1")

        self.assertIn("e1", mail.cache)
        self.assertEqual(announced, [])

    def test_a_message_changed_elsewhere_as_well_is_evicted(self):
        # Classified here and, before the changes were fetched, read on another device.
        mail = _Mail(_email("e1", sender="hello@shop.example", headers=NEWSLETTER))
        mail.fetch()
        mail.emails["e1"]["keywords"]["$seen"] = True

        announced = mail.sync("e1")

        self.assertNotIn("e1", mail.cache)
        self.assertEqual(announced, [mock.call("mail_changed", user=USER)])

    def test_a_message_moved_elsewhere_as_well_is_evicted(self):
        mail = _Mail(_email("e1", sender="hello@shop.example", headers=NEWSLETTER))
        mail.fetch()
        mail.emails["e1"]["mailboxIds"] = {"projects": True}

        mail.sync("e1")

        self.assertNotIn("e1", mail.cache)

    def test_only_the_first_change_after_classifying_is_taken_for_the_echo(self):
        mail = _Mail(_email("e1", sender="hello@shop.example", headers=NEWSLETTER))
        mail.fetch()
        mail.sync("e1")

        # Whatever changed it this time was not this site giving it a category.
        announced = mail.sync("e1")

        self.assertNotIn("e1", mail.cache)
        self.assertEqual(announced, [mock.call("mail_changed", user=USER)])

    def test_other_updates_in_the_same_run_are_still_evicted(self):
        mail = _Mail(
            _email("e1", sender="hello@shop.example", headers=NEWSLETTER),
            _email("e2", sender="alice@example.org", keywords={"category_primary": True}),
        )
        mail.fetch()

        announced = mail.sync("e1", "e2")

        self.assertIn("e1", mail.cache)
        self.assertNotIn("e2", mail.cache)
        self.assertEqual(announced, [mock.call("mail_changed", user=USER)])

    def test_an_update_that_is_no_echo_costs_no_extra_request(self):
        mail = _Mail(_email("e1", sender="alice@example.org", keywords={"category_primary": True}))
        mail.fetch()
        mail.server.requests.clear()

        mail.sync("e1")

        self.assertEqual(mail.calls("Email/get"), [])


class CategoryFilter(unittest.TestCase):
    """A list of threads is narrowed to a category by the keyword that marks it."""

    def filter(self, filter_by: str | None) -> dict:
        """The JMAP filter `get_threads` queries the inbox with when asked for `filter_by`."""

        with (
            mock.patch.object(mail_api, "fetch_threads", return_value={}) as fetch_threads,
            mock.patch.object(mail_api, "get_cached_mailboxes", return_value=MAILBOXES),
            mock.patch.object(mail_api, "add_user_images_to_emails"),
        ):
            mail_api.get_threads(ACCOUNT, "inbox", limit=20, filter_by=filter_by)

        return fetch_threads.call_args.args[1]

    def test_each_category_filters_by_its_keyword(self):
        for category in Category:
            with self.subTest(category=category):
                self.assertEqual(
                    self.filter(f"category_{category.value}"),
                    {
                        "operator": "AND",
                        "conditions": [{"inMailbox": "inbox"}, {"hasKeyword": f"category_{category.value}"}],
                    },
                )

    def test_a_keyword_that_is_no_category_is_not_filtered_by(self):
        for filter_by in ("category_spam", "$seen", None):
            with self.subTest(filter_by=filter_by):
                self.assertEqual(self.filter(filter_by), {"inMailbox": "inbox"})
