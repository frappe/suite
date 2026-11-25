# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import shutil
import tempfile
from unittest import mock

import frappe
from frappe.tests import IntegrationTestCase

from suite.mail.doctype.jmap_account import jmap_account
from suite.mail.doctype.user_settings.test_user_settings import make_user
from suite.mail.patches import set_default_message_cache_quota
from suite.mail.store import Entity, quota
from suite.store.data_store import DataStore

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class IntegrationTestJMAPAccount(IntegrationTestCase):
    """
    Integration tests for JMAP Account.
    Use this class for testing interactions between multiple components.
    """

    def insert_account(self, account_id: str, quota_mb: int = 512) -> None:
        """Insert the row alone: the document's hooks would reach a JMAP server."""

        doc = frappe.new_doc("JMAP Account")
        doc.update(
            {
                "name": account_id,
                "account_id": account_id,
                "_name": account_id,
                "message_cache_quota_mb": quota_mb,
            }
        )
        doc.db_insert()

    def get_quota(self, account_id: str) -> int:
        return frappe.db.get_value("JMAP Account", account_id, "message_cache_quota_mb")

    def member_of(self, account_id: str):
        return mock.patch.object(jmap_account, "get_user_jmap_accounts", return_value=[account_id])

    def test_quota_patch_gives_an_account_at_zero_the_default(self):
        self.insert_account("quota-patch-zero", 0)

        set_default_message_cache_quota.execute()

        self.assertEqual(self.get_quota("quota-patch-zero"), 512)

    def test_quota_patch_keeps_a_quota_already_set(self):
        self.insert_account("quota-patch-custom", 2048)

        set_default_message_cache_quota.execute()

        self.assertEqual(self.get_quota("quota-patch-custom"), 2048)

    def test_a_suite_user_cannot_read_the_quota(self):
        self.insert_account("quota-read")

        with self.set_user(make_user("quota-reader")), self.member_of("quota-read"):
            doc = frappe.get_doc("JMAP Account", "quota-read")
            doc.apply_fieldlevel_read_permissions()

            self.assertIsNone(doc.get("message_cache_quota_mb"))

    def test_a_suite_user_cannot_change_the_quota(self):
        self.insert_account("quota-write")

        with self.set_user(make_user("quota-writer")), self.member_of("quota-write"):
            doc = frappe.get_doc("JMAP Account", "quota-write")
            doc.message_cache_quota_mb = 4096
            doc.save()

        self.assertEqual(self.get_quota("quota-write"), 512)

    def test_a_suite_admin_can_change_the_quota(self):
        self.insert_account("quota-admin")
        admin = make_user("quota-admin")
        frappe.get_doc("User", admin).add_roles("Suite Admin")

        with self.set_user(admin):
            doc = frappe.get_doc("JMAP Account", "quota-admin")
            doc.message_cache_quota_mb = 4096
            doc.save()

        self.assertEqual(self.get_quota("quota-admin"), 4096)

    def test_the_daily_job_covers_accounts_with_and_without_a_limit(self):
        self.insert_account("quota-job-limited", 512)
        self.insert_account("quota-job-unlimited", 0)

        stores = [("mail", "quota-job-limited"), ("mail", "quota-job-unlimited")]
        with (
            mock.patch.object(quota, "list_namespaces", return_value=stores),
            mock.patch.object(quota, "enqueue_job") as enqueue,
        ):
            quota.enforce_message_cache_quotas()

        queued = {}
        for call in enqueue.call_args_list:
            queued |= call.kwargs["quotas"]

        self.assertEqual(queued["quota-job-limited"], 512)
        self.assertEqual(queued["quota-job-unlimited"], 0)

    def test_the_form_reports_the_cache_size_in_mb(self):
        self.insert_account("quota-size")
        path = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, path, ignore_errors=True)
        store = DataStore(base_path=path, namespace=("mail", "quota-size"))
        store.set(Entity.EMAIL, "a", "x" * (3 * 1024 * 1024))

        with mock.patch.object(jmap_account, "get_data_store", return_value=store):
            size = frappe.get_doc("JMAP Account", "quota-size").message_cache_size_mb

        self.assertEqual(size, 3.0)
