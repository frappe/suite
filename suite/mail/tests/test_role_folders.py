# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""The folders Mail files into by role (Inbox, Archive, Junk, Trash): found, adopted or made, against
jmap.testing.FakeJMAPServer standing in for Stalwart, which refuses two sibling folders of one name."""

from unittest import mock

import frappe
from frappe.tests import UnitTestCase
from jmap.testing.fake import FakeJMAPServer

from suite.mail import filing, jmap
from suite.mail.tests.test_jmap_client import _client, _server

ACCOUNT = "acct"


class FakeMailboxes:
    """A Mailbox/set that keeps its folders, refusing a new one whose name a sibling already has."""

    def __init__(self, server: FakeJMAPServer, *mailboxes: dict):
        self.mailboxes = [{"parentId": None, "role": None, **m} for m in mailboxes]
        server.handle("Mailbox/set", self.set)

    def set(self, arguments: dict, _server: FakeJMAPServer) -> dict:
        created, not_created, updated = {}, {}, {}
        for key, mailbox in (arguments.get("create") or {}).items():
            mailbox = {"parentId": None, "role": None, **mailbox, "id": f"new-{key}"}
            if self.named(mailbox["name"], mailbox["parentId"]):
                not_created[key] = {"type": "alreadyExists"}
                continue
            self.mailboxes.append(mailbox)
            created[key] = {"id": mailbox["id"]}
        for id, patch in (arguments.get("update") or {}).items():
            next(m for m in self.mailboxes if m["id"] == id).update(patch)
            updated[id] = None
        return {
            "oldState": "s1",
            "newState": "s2",
            "created": created,
            "notCreated": not_created,
            "updated": updated,
        }

    def named(self, name: str, parent: str | None = None) -> list[dict]:
        return [
            m for m in self.mailboxes if m["parentId"] == parent and m["name"].casefold() == name.casefold()
        ]


class RoleFolders(UnitTestCase):
    def setUp(self):
        self.server = _server()
        client = _client(self.server)
        for name, value in {
            "get_account_client": lambda _account: client,
            "get_cached_mailboxes": lambda _account: self.folders.mailboxes,
            "invalidate_jmap_mailboxes_cache": lambda _account: None,
        }.items():
            patcher = mock.patch.object(jmap, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def archive(self) -> str | None:
        return jmap.get_mailbox_id_by_role(
            ACCOUNT, "archive", create_if_not_exists=True, raise_exception=True
        )

    def test_a_folder_of_that_name_without_a_role_takes_the_role(self):
        # Imported mail left an "Archive" with no role; a new "Archive" beside it would be refused.
        self.folders = FakeMailboxes(self.server, {"id": "i", "name": "Archive"})

        self.assertEqual(self.archive(), "i")
        self.assertEqual([(m["id"], m["role"]) for m in self.folders.named("Archive")], [("i", "archive")])

    def test_with_no_such_folder_one_is_made(self):
        self.folders = FakeMailboxes(self.server, {"id": "a", "name": "Inbox", "role": "inbox"})

        archive = self.archive()

        self.assertEqual(
            [(m["id"], m["role"]) for m in self.folders.named("Archive")], [(archive, "archive")]
        )

    def test_a_subfolder_of_that_name_is_left_as_it_is(self):
        self.folders = FakeMailboxes(
            self.server, {"id": "p", "name": "Projects"}, {"id": "sub", "name": "Archive", "parentId": "p"}
        )

        archive = self.archive()

        self.assertNotEqual(archive, "sub")
        self.assertIsNone(self.folders.named("Archive", "p")[0]["role"])
        self.assertEqual(self.folders.named("Archive")[0]["role"], "archive")

    def test_a_folder_already_holding_the_role_is_used_as_it_is(self):
        self.folders = FakeMailboxes(
            self.server, {"id": "x", "name": "Old mail", "role": "archive"}, {"id": "i", "name": "Archive"}
        )

        self.assertEqual(self.archive(), "x")
        self.assertIsNone(self.folders.named("Archive")[0]["role"])


class FilingWithoutAFolder(UnitTestCase):
    """An account whose Archive can be neither found nor made can still trash mail, and is told why it
    can't archive it rather than given a server error."""

    def setUp(self):
        self.server = _server()
        self.server.respond(
            "Email/get",
            {"state": "s", "notFound": [], "list": [{"id": "q", "mailboxIds": {"in": True}, "keywords": {}}]},
        )
        self.server.handle(
            "Email/set",
            lambda arguments, _server: {
                "oldState": "s1",
                "newState": "s2",
                "updated": dict.fromkeys(arguments.get("update") or {}),
            },
        )
        client = _client(self.server)
        roles = {"inbox": "in", "archive": None, "sent": None, "drafts": None, "junk": "jk", "trash": "tr"}
        for target, name, value in (
            (filing, "get_user_for_jmap_account", lambda *_a, **_k: "user"),
            (filing, "get_account_client", lambda _account: client),
            (filing, "account_roles", lambda *_a, **_k: roles),
            (
                frappe.get_module("suite.mail.doctype.mail_message.mail_message"),
                "_remove_cached_messages",
                lambda *_a: None,
            ),
        ):
            patcher = mock.patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def sets(self) -> list[dict]:
        return [
            call[1]["update"]
            for request in self.server.requests
            for call in request["methodCalls"]
            if call[0] == "Email/set"
        ]

    def test_trash_still_works(self):
        filed = filing.file_messages(ACCOUNT, ["q"], "trash")

        self.assertEqual(filed["updated"], ["q"])
        self.assertEqual(self.sets(), [{"q": {"mailboxIds": {"tr": True}}}])

    def test_archive_is_refused_with_the_folder_named(self):
        with self.assertRaisesRegex(frappe.ValidationError, "Archive"):
            filing.file_messages(ACCOUNT, ["q"], "archive")
        self.assertEqual(self.sets(), [])
