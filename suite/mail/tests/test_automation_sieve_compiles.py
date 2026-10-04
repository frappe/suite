# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import unittest
from unittest.mock import patch
from urllib.parse import urljoin

import frappe
import requests
from frappe.tests import IntegrationTestCase

JMAP_CORE = "urn:ietf:params:jmap:core"
JMAP_SIEVE = "urn:ietf:params:jmap:sieve"


def render_automation_script() -> str:
    """The automation script for an account using every block the generator writes, with the lookups
    it would make over JMAP stubbed out. Paths and keywords carry quotes and backslashes."""

    from suite.mail.doctype.sieve_script import sieve_script

    screened = [
        frappe._dict(email="rejected@example.org", action="Reject"),
        frappe._dict(email="@rejected.example.org", action="Reject"),
        frappe._dict(email="spammer@example.org", action="Spam"),
        frappe._dict(email="boss@example.org", action="Accepted"),
        frappe._dict(email="@partner.example.org", action="Accepted"),
    ]
    rules = {
        "emails_from": "team@example.org, *@clients.example.org",
        "subject_contains": 'invoice, "urgent"',
        "match_if": "all",
        "mark_as_read": True,
        "add_star": True,
    }

    with (
        patch.object(sieve_script, "get_mailboxes", return_value=[{"id": "m1", "_name": "Gold"}]),
        patch.object(sieve_script, "get_mailbox_automation_rules", return_value=rules),
        patch.object(sieve_script, "get_mailbox_path", return_value='Clients/"VIP" \\ Gold'),
        patch.object(sieve_script, "get_effective_screened_email_addresses", return_value=screened),
        patch.object(sieve_script, "get_junk_mailbox_path", return_value="Junk Mail"),
        patch.object(sieve_script, "is_screening_enabled", return_value=True),
        patch.object(sieve_script, "get_screening_mailbox_path", return_value="Screener"),
        patch.object(sieve_script, "get_inbox_mailbox_path", return_value="INBOX"),
        patch.object(sieve_script, "get_account_emails", return_value=["me@example.org"]),
    ):
        return sieve_script._build_automation_content("account")


class TestAutomationSieveCompiles(IntegrationTestCase):
    """The automation script the app generates compiles on the mail server.

    The generator's own tests read the gate with a small model of Sieve, which cannot tell whether the
    server accepts the script — a missing `require`, an extension the server does not offer, a string
    it parses differently — and a script the server rejects fails the whole upload, leaving the account
    on its previous script. Validated as the admin in the site config's `mail` (the Stalwart container
    in CI); skipped where there is none.
    """

    @classmethod
    def setUpClass(cls):
        mail = frappe.conf.get("mail") or {}
        if not (mail.get("server_url") and mail.get("username") and mail.get("password")):
            raise unittest.SkipTest("No mail server admin in the site config.")

        super().setUpClass()

        cls.http = requests.Session()
        cls.http.auth = (mail["username"], mail["password"])
        cls.http.verify = bool(mail.get("verify_ssl"))

        response = cls.http.get(urljoin(mail["server_url"], "/.well-known/jmap"), timeout=30)
        response.raise_for_status()
        cls.session = response.json()
        cls.account_id = cls.session["primaryAccounts"][JMAP_SIEVE]

    def validate(self, script: str) -> dict | None:
        """The server's error for the script (RFC 9661 `SieveScript/validate`), or None if it compiles."""

        upload = self.http.post(
            self.session["uploadUrl"].replace("{accountId}", self.account_id),
            data=script.encode(),
            headers={"Content-Type": "application/sieve"},
            timeout=30,
        )
        upload.raise_for_status()

        call = [
            "SieveScript/validate",
            {"accountId": self.account_id, "blobId": upload.json()["blobId"]},
            "0",
        ]
        response = self.http.post(
            self.session["apiUrl"], json={"using": [JMAP_CORE, JMAP_SIEVE], "methodCalls": [call]}, timeout=30
        )
        response.raise_for_status()

        ((method, result, _call_id),) = response.json()["methodResponses"]
        self.assertEqual(method, "SieveScript/validate", result)
        return result["error"]

    def test_the_generated_script_compiles(self):
        script = render_automation_script()
        self.assertIsNone(self.validate(script), script)

    def test_a_script_missing_a_require_does_not(self):
        # Keeps the check above honest: `:create` needs the `mailbox` extension declared.
        self.assertIsNotNone(self.validate('require ["fileinto"];\nfileinto :create "Screener";\n'))
