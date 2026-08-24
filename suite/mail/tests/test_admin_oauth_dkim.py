# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.mail.api.admin import (
    add_oauth_client,
    add_oauth_client_contacts,
    add_oauth_client_redirect_uris,
    delete_dkim_signatures,
    delete_oauth_clients,
    get_dkim_signature,
    get_dkim_signatures,
    get_oauth_client,
    get_oauth_clients,
    remove_oauth_client_contact,
    remove_oauth_client_redirect_uri,
    update_oauth_client,
)
from suite.mail.stalwart import resolve_domain_id
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestAdminOAuthDkim(StalwartIntegrationTestCase):
    def _create_oauth_client(self, **overrides) -> tuple[str, str]:
        client_id = overrides.pop("client_id", unique_name("oauth"))
        oauth_id = add_oauth_client(
            client_id=client_id,
            description=overrides.pop("description", "Test OAuth client"),
            contacts=overrides.pop("contacts", ["owner@backup.example.test"]),
            redirect_uris=overrides.pop("redirect_uris", ["https://app.example.test/callback"]),
            secret=overrides.pop("secret", "s3cret-value"),
            **overrides,
        )
        self._stalwart_cleanups.append(lambda oauth_id=oauth_id: _delete_oauth(oauth_id))
        return oauth_id, client_id

    def test_oauth_client_crud(self):
        oauth_id, client_id = self._create_oauth_client()

        rows = get_oauth_clients(search=client_id)
        self.assertEqual([c["id"] for c in rows], [oauth_id])
        self.assertEqual(rows[0]["client_id"], client_id)

        detail = get_oauth_client(oauth_id)
        self.assertEqual(detail["client_id"], client_id)
        self.assertEqual(detail["contacts"], ["owner@backup.example.test"])
        self.assertEqual(detail["redirect_uris"], ["https://app.example.test/callback"])

        update_oauth_client(oauth_id, description="Updated client")
        self.assertEqual(get_oauth_client(oauth_id)["description"], "Updated client")

        add_oauth_client_contacts(oauth_id, ["second@backup.example.test"])
        self.assertIn("second@backup.example.test", get_oauth_client(oauth_id)["contacts"])
        remove_oauth_client_contact(oauth_id, "owner@backup.example.test")
        self.assertEqual(get_oauth_client(oauth_id)["contacts"], ["second@backup.example.test"])

        add_oauth_client_redirect_uris(oauth_id, ["https://app.example.test/other"])
        self.assertIn("https://app.example.test/other", get_oauth_client(oauth_id)["redirect_uris"])
        remove_oauth_client_redirect_uri(oauth_id, "https://app.example.test/callback")
        self.assertEqual(get_oauth_client(oauth_id)["redirect_uris"], ["https://app.example.test/other"])

        delete_oauth_clients([oauth_id])
        self.assertEqual([c for c in get_oauth_clients() if c["id"] == oauth_id], [])

    def test_dkim_signatures(self):
        # The listing answers cleanly either way; whether signatures exist for a new domain
        # depends on the server's DKIM generation settings.
        domain_id = resolve_domain_id(self.domain)
        signatures = get_dkim_signatures(domain_id=domain_id)
        self.assertIsInstance(signatures, list)
        if not signatures:
            self.skipTest("Server does not generate DKIM signatures for new domains.")

        self.assertTrue(all(s["domain"] == self.domain for s in signatures))

        detail = get_dkim_signature(signatures[0]["id"])
        self.assertEqual(detail["domain"], self.domain)
        self.assertTrue(detail["selector"])
        self.assertTrue(detail["public_key"])
        self.assertTrue(detail["algorithm"])

        # Deleting a throwaway domain's signatures.
        throwaway = self.create_domain()
        throwaway_sigs = get_dkim_signatures(domain_id=resolve_domain_id(throwaway))
        delete_dkim_signatures([s["id"] for s in throwaway_sigs])
        self.assertEqual(get_dkim_signatures(domain_id=resolve_domain_id(throwaway)), [])

    def test_non_admin_cannot_manage_oauth_and_dkim(self):
        member = self.create_member()
        with self.set_user(member.email):
            self.assertRaises(frappe.PermissionError, get_oauth_clients)
            self.assertRaises(frappe.PermissionError, add_oauth_client, unique_name("oauth"))
            self.assertRaises(frappe.PermissionError, get_dkim_signatures)
            self.assertRaises(frappe.PermissionError, delete_dkim_signatures, ["any-id"])


def _delete_oauth(oauth_id: str) -> None:
    from suite.mail.stalwart import manage_delete

    manage_delete("OAuthClient", oauth_id)
