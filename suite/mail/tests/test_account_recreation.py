"""Recreating a deleted Mail account, with Suite Cloud and the mail server faked at the network."""

from base64 import b64decode
from unittest.mock import patch
from uuid import uuid4

import frappe
import httpx
from frappe.tests import IntegrationTestCase
from jmap.testing.fake import FakeJMAPServer

from suite import mail
from suite.mail.api.admin import add_member, retry_account_creation
from suite.mail.jmap import DEFAULT_TIMEOUT, get_account_client, get_jmap_client, provisioning
from suite.mail.tests.test_admin_lifecycle import Provider
from suite.suite_core.account_state import read
from suite.suite_core.administration import update_user

SERVER_URL = "https://jmap.example.com"
URNS = (
    "urn:ietf:params:jmap:core",
    "urn:ietf:params:jmap:mail",
    "urn:ietf:params:jmap:submission",
    "urn:ietf:params:jmap:sieve",
)
# The folders the server opens an account with, under the server's own names.
DEFAULT_FOLDERS = {
    "inbox": "Inbox",
    "drafts": "Drafts",
    "sent": "Sent Items",
    "junk": "Junk Mail",
    "trash": "Deleted Items",
}
# What the server sets on an object that the client does not send.
SERVER_SET = {
    "Mailbox": {"parentId": None, "sortOrder": 0, "isSubscribed": True, "totalEmails": 0, "unreadEmails": 0},
    "SieveScript": {"isActive": False},
}


class MailServer(FakeJMAPServer):
    """One personal account at a time, holding its folders and Sieve scripts."""

    def __init__(self, address: str):
        super().__init__(
            capabilities={urn: {} for urn in URNS}, accounts={}, primary_accounts={}, username=address
        )
        self.address = address
        self.objects: dict[tuple[str, str], dict[str, dict]] = {}
        for kind in ("Mailbox", "SieveScript"):
            self.handle(f"{kind}/get", lambda arguments, _server, kind=kind: self.get(kind, arguments))
            self.handle(f"{kind}/set", lambda arguments, _server, kind=kind: self.set(kind, arguments))
        self.handle("SieveScript/query", lambda arguments, _server: self.query(arguments))
        self.handle("Identity/get", lambda arguments, _server: {**arguments, "state": "s", "list": []})

    def open_account(self) -> str:
        """List a new, empty account in place of the last, as the server does for a recreated address."""

        account = uuid4().hex
        self.accounts = {
            account: {
                "name": self.address,
                "isPersonal": True,
                "isReadOnly": False,
                "accountCapabilities": {urn: {} for urn in URNS},
            }
        }
        self.primary_accounts = dict.fromkeys(URNS, account)
        self.objects[account, "Mailbox"] = {
            role: {**SERVER_SET["Mailbox"], "id": role, "name": name, "role": role}
            for role, name in DEFAULT_FOLDERS.items()
        }
        self.objects[account, "SieveScript"] = {}
        return account

    def add_shared_account(self) -> str:
        """List an account the user shares with others, next to their own."""

        account = uuid4().hex
        self.accounts[account] = {**self.accounts[self.primary_accounts[URNS[0]]], "isPersonal": False}
        self.objects[account, "Mailbox"] = {}
        self.objects[account, "SieveScript"] = {}
        return account

    def fail_folder_changes(self, *, after: int = 0) -> None:
        """Refuse every folder change once ``after`` more have gone through."""

        if not after:
            self.fail("Mailbox/set", "serverFail")
            return

        change_folders = self.handlers["Mailbox/set"]

        def count_down(arguments: dict, server: FakeJMAPServer) -> dict:
            nonlocal after
            result = dict(change_folders(arguments, server))
            after -= 1
            if not after:
                self.fail("Mailbox/set", "serverFail")
            return result

        self.handle("Mailbox/set", count_down)

    def recover(self) -> None:
        self.errors.clear()

    def stored(self, account: str, kind: str) -> list[dict]:
        return list(self.objects[account, kind].values())

    def get(self, kind: str, arguments: dict) -> dict:
        found = self.stored(arguments["accountId"], kind)
        if (ids := arguments.get("ids")) is not None:
            found = [value for value in found if value["id"] in ids]
        return {"accountId": arguments["accountId"], "state": "s", "list": found, "notFound": []}

    def query(self, arguments: dict) -> dict:
        wanted = arguments.get("filter") or {}
        ids = [
            script["id"]
            for script in self.stored(arguments["accountId"], "SieveScript")
            if all(script.get(key) == value for key, value in wanted.items())
        ]
        return {
            "accountId": arguments["accountId"],
            "queryState": "q",
            "position": 0,
            "ids": ids,
            "total": len(ids),
        }

    def set(self, kind: str, arguments: dict) -> dict:
        objects = self.objects[arguments["accountId"], kind]
        created = {}
        for creation, value in (arguments.get("create") or {}).items():
            created[creation] = {"id": uuid4().hex}
            objects[created[creation]["id"]] = {**SERVER_SET[kind], **value, **created[creation]}
        for object_id, changes in (arguments.get("update") or {}).items():
            objects[object_id].update(changes)
        if active := arguments.get("onSuccessActivateScript"):
            active = created[active[1:]]["id"] if active.startswith("#") else active
            for script in objects.values():
                script["isActive"] = script["id"] == active
        return {
            "accountId": arguments["accountId"],
            "oldState": "s",
            "newState": "s",
            "created": created,
            "updated": dict.fromkeys(arguments.get("update") or {}),
            "destroyed": [],
        }


class TestAccountRecreation(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.provider = Provider()
        for target in (
            "suite.mail.directory.get_client",
            "suite.mail.account_lifecycle.get_client",
            "suite.mail.suite_cloud.get_client",
        ):
            self.enterContext(patch(target, return_value=self.provider))
        for target in (
            "suite.mail.api.admin.is_suite_cloud_configured",
            "suite.mail.doctype.mail_account_request.mail_account_request.is_suite_cloud_configured",
            "suite.suite_core.utils.is_suite_cloud_configured",
            "suite.composition.access.is_suite_cloud_configured",
            "suite.mail.events.is_suite_cloud_configured",
        ):
            self.enterContext(patch(target, return_value=True))
        self.enterContext(patch("suite.mail.provider_health", return_value={"suspended": False}))

        username = f"employee-{frappe.generate_hash(length=8)}"
        self.address = f"{username}@company.frappe.cloud"
        self.server = MailServer(self.address)
        self.server.open_account()
        frappe.db.set_single_value("Mail Settings", "server_url", SERVER_URL)
        frappe.clear_document_cache("Mail Settings")
        frappe.local.request_cache.clear()
        # Suite Cloud is the Provider above, so every HTTP request left is one to the mail server.
        self.enterContext(
            patch.object(
                httpx.HTTPTransport, "handle_request", lambda _transport, request: self.server.route(request)
            )
        )
        self.addCleanup(frappe.cache.delete_value, "jmap:sessions")

        created = add_member(username, "company.frappe.cloud", False, False, "", first_name="Employee")
        self.assertTrue(created["success"], created)
        self.user = created["user"]
        update_user(self.user, enabled=False)
        deleted = mail.administer_account("delete", user=self.user, confirmation=self.address)
        self.assertTrue(deleted["success"], deleted)
        frappe.local.request_cache.clear()  # the recreation is a request of its own

    def test_an_admin_recreates_a_deleted_mail_account_for_a_user_who_stays_disabled(self):
        account = self.server.open_account()

        result = mail.administer_account("recreate", user=self.user, address=self.address)

        self.assertTrue(result["success"], result)
        self.assertEqual(read(self.user)["status"], "Password change required")
        self.assertEqual(frappe.db.get_value("User", self.user, "enabled"), 0)
        self.assert_set_up(account)

    def test_a_recreation_that_failed_before_any_folder_was_made_can_be_retried(self):
        account = self.server.open_account()
        self.server.fail_folder_changes()

        self.assert_setup_failed()
        self.assertTrue(frappe.db.exists("JMAP Account", account))
        self.assertNotIn("archive", self.roles(account))

        shared = self.server.add_shared_account()  # first listed now, so the retry is what inserts its row
        self.retry()
        self.assert_set_up(account)
        # The setup reaches the user's own account only, not what they share with others.
        self.assertEqual(self.server.stored(shared, "Mailbox"), [])
        self.assertEqual(self.server.stored(shared, "SieveScript"), [])

    def test_a_retry_finishes_a_setup_that_stopped_halfway_without_repeating_it(self):
        account = self.server.open_account()
        self.server.fail_folder_changes(after=1)  # the Archive folder is made, the renames are refused

        self.assert_setup_failed()
        self.assertIn("archive", self.roles(account))

        self.retry()
        self.assert_set_up(account)
        names = {mailbox["role"]: mailbox["name"] for mailbox in self.server.stored(account, "Mailbox")}
        self.assertEqual(
            names,
            {
                "inbox": "Inbox",
                "drafts": "Drafts",
                "sent": "Sent",
                "junk": "Spam",
                "trash": "Trash",
                "archive": "Archive",
            },
        )

    def test_a_recreation_whose_filter_script_was_refused_fails_and_a_retry_finishes_it(self):
        account = self.server.open_account()
        self.server.fail("SieveScript/set", "serverFail")

        self.assert_setup_failed()
        self.assertEqual(self.server.stored(account, "SieveScript"), [])

        self.retry()
        self.assert_set_up(account)

    def test_a_new_member_whose_filter_script_was_refused_can_be_retried(self):
        account = self.server.open_account()
        self.server.fail("SieveScript/set", "serverFail")

        result = self.add_member("new-" + self.address.split("@", 1)[0])

        self.assertFalse(result["success"], result)
        self.assertEqual(result["status"], "Setup failed")
        request = frappe.db.get_value("Mail Account Request", {"account": result["user"]}, "name")
        self.server.recover()
        frappe.local.request_cache.clear()  # a retry is a request of its own

        retried = retry_account_creation(request)

        self.assertTrue(retried["success"], retried)
        self.assert_set_up(account)

    def test_a_new_member_is_not_held_back_by_a_shared_account_without_filter_scripts(self):
        account = self.server.open_account()
        shared = self.server.add_shared_account()
        self.server.accounts[shared]["accountCapabilities"] = {urn: {} for urn in URNS[:3]}

        result = self.add_member(f"another-{frappe.generate_hash(length=8)}")

        self.assertTrue(result["success"], result)
        self.assert_set_up(account)
        self.assertEqual(self.roles(shared).count("archive"), 1)

    def test_a_retry_at_another_address_signs_in_with_that_address(self):
        self.server.open_account()
        self.server.fail_folder_changes()
        self.assert_setup_failed()

        self.address = f"other-{self.address}"
        signed_in = set()
        self.server.intercept = lambda request: signed_in.add(
            b64decode(request.headers["Authorization"].split()[1]).decode().split(":")[0]
        )
        self.retry()

        self.assertEqual(signed_in, {self.address})

    def test_a_disabled_user_cannot_reach_their_mail_outside_their_own_account_setup(self):
        account = self.server.open_account()
        self.assertTrue(self.recreate()["success"])

        # Still in the request that set the account up, asking as the setup asked.
        for attempt in (
            lambda: get_jmap_client(self.user, ignore_permissions=False, timeout=DEFAULT_TIMEOUT),
            lambda: get_account_client(account),
        ):
            with self.assertRaisesRegex(frappe.ValidationError, "disabled"):
                attempt()
            with provisioning("someone-else@example.test"):
                with self.assertRaisesRegex(frappe.ValidationError, "disabled"):
                    attempt()

    def add_member(self, username: str) -> dict:
        return add_member(username, "company.frappe.cloud", False, False, "", first_name="Employee")

    def recreate(self) -> dict:
        return mail.administer_account("recreate", user=self.user, address=self.address)

    def assert_setup_failed(self) -> None:
        self.assertFalse(self.recreate()["success"])
        self.assertEqual(read(self.user)["status"], "Setup failed")

    def retry(self) -> None:
        self.server.recover()
        frappe.local.request_cache.clear()  # a retry is a request of its own
        result = self.recreate()
        self.assertTrue(result["success"], result)

    def roles(self, account: str) -> list[str | None]:
        return [mailbox.get("role") for mailbox in self.server.stored(account, "Mailbox")]

    def assert_set_up(self, account: str) -> None:
        """One Archive folder and one active automation script, however many attempts it took."""

        self.assertEqual(self.roles(account).count("archive"), 1)
        scripts = self.server.stored(account, "SieveScript")
        self.assertEqual(
            [(script["name"], script["isActive"]) for script in scripts], [("frappe_mail_automation", True)]
        )
