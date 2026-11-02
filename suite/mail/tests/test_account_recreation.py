"""Recreating a deleted Mail account, with Suite Cloud and the mail server faked at the network."""

from contextlib import nullcontext
from unittest.mock import patch
from uuid import uuid4

import frappe
import httpx
from frappe.tests import IntegrationTestCase
from jmap.testing.fake import FakeJMAPServer

from suite import mail
from suite.mail.api.admin import add_member
from suite.mail.jmap import get_jmap_client, provisioning
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
DEFAULT_ROLES = ("inbox", "drafts", "sent", "junk", "trash")
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
            role: {**SERVER_SET["Mailbox"], "id": role, "name": role.title(), "role": role}
            for role in DEFAULT_ROLES
        }
        self.objects[account, "SieveScript"] = {}
        return account

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
        roles = {mailbox.get("role") for mailbox in self.server.stored(account, "Mailbox")}
        self.assertIn("archive", roles)
        scripts = self.server.stored(account, "SieveScript")
        self.assertEqual(
            [(script["name"], script["isActive"]) for script in scripts], [("frappe_mail_automation", True)]
        )

    def test_a_disabled_user_cannot_reach_their_mail_outside_their_own_account_setup(self):
        self.server.open_account()
        self.assertTrue(mail.administer_account("recreate", user=self.user, address=self.address)["success"])
        frappe.local.request_cache.clear()

        for scope in (nullcontext(), provisioning("someone-else@example.test")):
            with self.subTest(scope=scope), scope, self.assertRaisesRegex(frappe.ValidationError, "disabled"):
                get_jmap_client(self.user, ignore_permissions=True)
