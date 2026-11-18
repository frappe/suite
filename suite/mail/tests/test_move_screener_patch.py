"""Which accounts the Screener move reaches, with no mail server involved."""

from unittest import mock

import frappe
from frappe.tests import IntegrationTestCase

from suite.mail.patches import move_screener_to_unscreened_keyword as patch
from suite.tests.utils import ensure_user


class TestMoveScreenerPatch(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.addCleanup(frappe.db.rollback)
        self.user = f"move-screener-{frappe.generate_hash(length=8)}@example.test"
        ensure_user(self.user)
        settings = frappe.db.get_value("User Settings", {"user": self.user})
        self.account = frappe.generate_hash(length=12)
        frappe.get_doc(
            {"doctype": "JMAP Account", "account_id": self.account, "_name": self.user, "is_personal": 1}
        ).db_insert()
        frappe.get_doc(
            {"doctype": "User Account", "user": self.user, "user_settings": settings, "account": self.account}
        ).insert(ignore_permissions=True)

    def move(self, mail_server: mock.Mock) -> tuple[mock.Mock, mock.Mock]:
        """Run the job for the account; returns the retry and error-log mocks."""
        with (
            mock.patch.object(patch, "build_automation_sieve", mail_server),
            mock.patch.object(patch, "get_mailbox_id_by_name", mail_server),
            mock.patch.object(patch.frappe, "enqueue") as enqueue,
            mock.patch.object(patch, "log_mail_error") as log_mail_error,
            # The job commits per account; the test rows must stay in the test's transaction.
            mock.patch.object(frappe.db, "commit"),
            mock.patch.object(frappe.db, "rollback"),
        ):
            patch.move_screeners([self.account], attempt=len(patch.RETRY_DELAYS))
        return enqueue, log_mail_error

    def test_account_of_a_disabled_user_is_skipped_without_an_error(self):
        frappe.db.set_value("User", self.user, "enabled", 0)
        mail_server = mock.Mock(side_effect=frappe.ValidationError("User is disabled"))

        enqueue, log_mail_error = self.move(mail_server)

        mail_server.assert_not_called()
        enqueue.assert_not_called()
        log_mail_error.assert_not_called()

    def test_account_of_a_deleted_user_is_skipped_without_an_error(self):
        frappe.db.delete("User", {"name": self.user})
        frappe.clear_document_cache("User", self.user)
        mail_server = mock.Mock(side_effect=frappe.ValidationError("User does not exist"))

        _, log_mail_error = self.move(mail_server)

        mail_server.assert_not_called()
        log_mail_error.assert_not_called()

    def test_failure_for_an_enabled_user_is_still_logged(self):
        mail_server = mock.Mock(side_effect=ConnectionError("mail server unreachable"))

        _, log_mail_error = self.move(mail_server)

        log_mail_error.assert_called_once()
        self.assertIn(self.account, log_mail_error.call_args.args[0])
