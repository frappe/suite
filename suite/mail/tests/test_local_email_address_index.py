# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""The local email-address index's contracts: it holds exactly the current set of local users' and
JMAP accounts' addresses, each once, and its matches lead every suggestion list ahead of the
account's own correspondents."""

import contextlib
import shutil
import tempfile
import unittest
from unittest import mock

import frappe

from suite.mail.events import refresh_local_email_addresses
from suite.mail.store import (
    get_email_address_index,
    get_local_email_address_index,
    rebuild_local_email_address_index,
    search_email_addresses,
)


class OnDiskIndexTestCase(unittest.TestCase):
    """Real Tantivy indexes in a throwaway directory, without the site or Redis a lock needs."""

    def setUp(self):
        path = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, path, ignore_errors=True)

        patches = (
            mock.patch("suite.store.search_store.get_search_base_path", return_value=path),
            mock.patch("suite.store.search_store.write_lock", lambda *a, **k: contextlib.nullcontext()),
        )
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def emails(self, addresses):
        return [address["email"] for address in addresses]


class ReplaceAddresses(OnDiskIndexTestCase):
    """``replace_addresses`` — the index ends up holding exactly the addresses given."""

    def test_addresses_left_out_are_no_longer_suggested(self):
        index = get_local_email_address_index()
        index.replace_addresses([{"email": "jane@example.com"}, {"email": "john@example.com"}])
        index.replace_addresses([{"email": "john@example.com"}])

        self.assertEqual(self.emails(index.search_email_addresses("jane")), [])
        self.assertEqual(self.emails(index.search_email_addresses("john")), ["john@example.com"])

    def test_an_address_given_twice_is_suggested_once_with_its_name(self):
        # A user's email that is also an account's name: the account carries no display name.
        index = get_local_email_address_index()
        index.replace_addresses(
            [{"name": "Jane Doe", "email": "jane@example.com"}, {"email": "Jane@Example.com"}]
        )

        self.assertEqual(
            index.search_email_addresses("jane"), [{"name": "Jane Doe", "email": "jane@example.com"}]
        )

    def test_an_account_name_that_is_not_an_address_is_skipped(self):
        index = get_local_email_address_index()
        index.replace_addresses([{"email": "Support Team"}, {"email": "support@example.com"}])

        self.assertEqual(self.emails(index.search_email_addresses("support")), ["support@example.com"])


class SearchEmailAddresses(OnDiskIndexTestCase):
    """``search_email_addresses`` — local addresses lead, the account's own fill the rest."""

    def setUp(self):
        super().setUp()
        get_local_email_address_index().replace_addresses(
            [{"name": "Jane Doeringer", "email": "jane.doeringer@example.com"}]
        )
        get_email_address_index("account").index_addresses(
            [
                {"name": "John Doe", "email": "john.doe@example.org"},
                {"name": "Ann Doe", "email": "ann@example.org"},
                {"name": "Jane Doeringer", "email": "Jane.Doeringer@example.com"},
            ]
        )

    def test_a_local_address_leads_even_a_better_correspondent_match(self):
        self.assertEqual(
            self.emails(search_email_addresses("account", "doe")),
            ["jane.doeringer@example.com", "ann@example.org", "john.doe@example.org"],
        )

    def test_the_limit_counts_local_and_correspondent_addresses_together(self):
        self.assertEqual(
            self.emails(search_email_addresses("account", "doe", limit=2)),
            ["jane.doeringer@example.com", "ann@example.org"],
        )

    def test_correspondents_still_match_when_no_local_address_does(self):
        self.assertEqual(self.emails(search_email_addresses("account", "ann")), ["ann@example.org"])


class RebuildLocalEmailAddressIndex(OnDiskIndexTestCase):
    """``rebuild_local_email_address_index`` — enabled users' emails and every account's name, once each."""

    def rebuild(self, users, accounts):
        def get_all(doctype, **kwargs):
            if doctype == "User":
                return [frappe._dict(user) for user in users]
            return accounts

        with mock.patch("suite.mail.store.frappe.get_all", side_effect=get_all):
            rebuild_local_email_address_index(in_background=False)

        return get_local_email_address_index()

    def test_users_and_accounts_are_suggested_once_each(self):
        index = self.rebuild(
            users=[{"full_name": "Jane Doe", "email": "jane@example.com"}],
            accounts=["jane@example.com", "support@example.com"],
        )

        self.assertEqual(
            index.search_email_addresses("example"),
            [
                {"name": "Jane Doe", "email": "jane@example.com"},
                {"name": None, "email": "support@example.com"},
            ],
        )


class RefreshLocalEmailAddresses(unittest.TestCase):
    """``refresh_local_email_addresses`` — rebuilds only when a suggested address could change."""

    def refresh(self, method, changed=()):
        doc = mock.Mock()
        doc.has_value_changed.side_effect = lambda field: field in changed

        with mock.patch("suite.mail.store.rebuild_local_email_address_index") as rebuild:
            refresh_local_email_addresses(doc, method)

        return rebuild.called

    def test_name_email_or_status_change_rebuilds(self):
        for field in ("email", "full_name", "enabled"):
            with self.subTest(field=field):
                self.assertTrue(self.refresh("on_update", changed=(field,)))

    def test_unrelated_change_does_not_rebuild(self):
        self.assertFalse(self.refresh("on_update", changed=("last_login",)))

    def test_deletion_rebuilds(self):
        self.assertTrue(self.refresh("on_trash"))
