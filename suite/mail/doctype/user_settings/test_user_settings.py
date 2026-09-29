# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import PropertyMock, patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.mail.doctype.user_settings.user_settings import UserSettings
from suite.mail.utils.user import DEFAULT_UNDO_SEND_PERIOD, get_undo_send_period


def make_user(prefix: str) -> str:
    return (
        frappe.get_doc(
            doctype="User",
            email=f"{prefix}-{frappe.generate_hash(length=6)}@example.test",
            first_name=prefix.title(),
            send_welcome_email=0,
            roles=[{"role": "Suite User"}],
        )
        .insert(ignore_permissions=True)
        .name
    )


@contextmanager
def jmap_server_reporting(accounts: dict[str, dict]):
    """Stand in for the JMAP server: the user's connection lists ``accounts`` and the
    per-account mailbox setup that normally runs over JMAP is a no-op."""

    module = "suite.mail.doctype.jmap_account.jmap_account"
    connection = SimpleNamespace(accounts=accounts)
    with (
        patch.object(UserSettings, "connection", new_callable=PropertyMock, return_value=connection),
        patch(f"{module}.create_archive_mailbox"),
        patch(f"{module}.rename_default_mailboxes"),
        patch(f"{module}.build_automation_sieve"),
    ):
        yield


# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class IntegrationTestUserSettings(IntegrationTestCase):
    """
    Integration tests for UserSettings.
    Use this class for testing interactions between multiple components.
    """

    def test_undo_send_period(self):
        # Every user's plain Send is held for their own period. Anything off the list (no settings
        # row yet, a direct DB edit) falls back to the default, so the hold is never 0 or unbounded.
        user = frappe.get_doc(
            doctype="User",
            email=f"undo-send-{frappe.generate_hash(length=6)}@example.test",
            first_name="Undo",
            send_welcome_email=0,
        ).insert(ignore_permissions=True)
        settings = frappe.db.get_value("User Settings", {"user": user.name})
        self.assertTrue(settings, "User Settings should be created with the user.")
        self.assertEqual(get_undo_send_period(user.name), DEFAULT_UNDO_SEND_PERIOD)

        frappe.db.set_value("User Settings", settings, "undo_send_period", "30")
        self.assertEqual(get_undo_send_period(user.name), 30)

        frappe.db.set_value("User Settings", settings, "undo_send_period", "7")
        self.assertEqual(get_undo_send_period(user.name), DEFAULT_UNDO_SEND_PERIOD)

        self.assertEqual(get_undo_send_period("nobody@example.test"), DEFAULT_UNDO_SEND_PERIOD)

        # The form itself only offers the listed periods.
        doc = frappe.get_doc("User Settings", settings)
        doc.undo_send_period = "7"
        self.assertRaises(frappe.ValidationError, doc.save)

    def test_sync_accounts_needs_jmap_credentials(self):
        user = make_user("sync")
        settings = frappe.get_doc("User Settings", {"user": user})

        with self.assertRaises(frappe.ValidationError):
            settings.sync_accounts()

    def test_sync_accounts_only_by_someone_who_can_edit_the_settings(self):
        owner = make_user("owner")
        stranger = make_user("stranger")
        settings = frappe.get_doc("User Settings", {"user": owner})

        with self.set_user(stranger), self.assertRaises(frappe.PermissionError):
            settings.sync_accounts()

    def test_sync_accounts_mirrors_the_servers_account_list(self):
        # Syncing links the user to every account the server reports, creating the shared JMAP
        # Account on first sight, and drops links to accounts the server no longer lists.
        user = make_user("sync")
        settings = frappe.get_doc("User Settings", {"user": user})
        account_id = frappe.generate_hash(length=8)
        account = {account_id: {"name": user, "isPersonal": True, "isReadOnly": False}}

        with jmap_server_reporting(account):
            settings.sync_accounts()

        self.assertTrue(frappe.db.exists("JMAP Account", account_id))
        self.assertTrue(frappe.db.exists("User Account", {"user": user, "account": account_id}))

        with jmap_server_reporting({}):
            settings.sync_accounts()

        self.assertFalse(frappe.db.exists("User Account", {"user": user, "account": account_id}))
