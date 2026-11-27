# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""A list read that a draft's save overtakes still holds the draft.

Saving a draft again replaces it on the server under a new id, in the same thread. A read of the
list that found the draft just before the save, and fetched it just after, used to find nothing,
and the row dropped out of Drafts until the next read."""

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch

from frappe.tests import UnitTestCase

from suite.mail.doctype.mail_message import mail_message


def draft(id: str, words: str) -> dict:
    return {"id": id, "thread_id": "t", "received_at": "2026-11-23T12:00:00Z", "draft": 1, "preview": words}


class Server:
    """One draft in one thread, saved again the moment the list first reads its messages."""

    def __init__(self):
        self.emails = {"old": draft("old", "before the edit")}
        self.thread = ["old"]
        self.saved = False

    def handle(self, items: list[dict]):
        return SimpleNamespace(
            result=SimpleNamespace(items=[SimpleNamespace(to_wire=lambda i=i: i) for i in items], total=1),
            ref_ids=lambda: None,
            ref_list=lambda _: None,
        )

    @contextmanager
    def batch(self):
        email = SimpleNamespace(
            query=lambda **_: self.handle([{"id": self.thread[-1]}]),
            get=lambda **_: self.handle([{"id": self.thread[-1], "threadId": "t"}]),
        )
        thread = SimpleNamespace(get=lambda **_: self.handle([{"id": "t", "emailIds": list(self.thread)}]))
        yield SimpleNamespace(mail=SimpleNamespace(email=email, thread=thread))

    def get_messages(self, account: str, ids: list[str]) -> list[dict]:
        if not self.saved:
            self.saved = True
            self.emails = {"new": draft("new", "after the edit")}
            self.thread = ["new"]
        return [self.emails[id] for id in ids if id in self.emails]

    def get_thread_email_ids(self, account: str, thread_ids: list[str]) -> dict[str, list[str]]:
        return {"t": list(self.thread)} if "t" in thread_ids else {}


class TestThreadReadDuringSave(UnitTestCase):
    def test_a_draft_saved_while_the_list_was_read_is_in_it_as_saved(self):
        server = Server()
        with (
            patch.object(mail_message, "get_account_client", return_value=server),
            patch.object(mail_message, "get_messages", side_effect=server.get_messages),
            patch.object(mail_message, "get_thread_email_ids", side_effect=server.get_thread_email_ids),
        ):
            conversations = mail_message.fetch_threads("account", {"inMailbox": "drafts"})

        self.assertEqual([m["preview"] for m in conversations["t"]], ["after the edit"])
