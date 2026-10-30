from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.mail.tests.fake_suite_cloud import fake_suite_cloud
from suite.suite_core import suite_email
from suite.suite_core.patches import drop_notification_email_account
from suite.suite_core.suite_email import EmailNotSentError

RECIPIENT = "someone@example.test"
PARAMS = {"link": "https://acme.example.test/mail/reset-password/abc"}
LOCAL = {"subject": "Reset Password", "template": "reset_password", "args": PARAMS}


class TestSuiteEmail(IntegrationTestCase):
    def connect(self, connected: bool = True) -> None:
        url, tenant, secret = (
            ("https://cloud.example.test", "tenant", "secret") if connected else ("", "", "")
        )
        settings = {"suite_cloud_url": url, "suite_cloud_tenant": tenant, "suite_cloud_secret": secret}
        self.enterContext(self.change_settings("Suite Settings", **settings))
        frappe.local.request_cache.clear()

    def test_suite_cloud_sends_the_email_by_its_type_and_parameters(self) -> None:
        self.connect()
        with fake_suite_cloud() as cloud, patch("frappe.sendmail") as sendmail:
            suite_email.send("password-reset", RECIPIENT, PARAMS, LOCAL)

        (sent,) = cloud.emails
        self.assertEqual(
            (sent["email_type"], sent["recipient"], sent["params"]), ("password-reset", RECIPIENT, PARAMS)
        )
        self.assertTrue(sent["request_key"])
        sendmail.assert_not_called()  # the site renders nothing itself

    def test_an_email_suite_cloud_did_not_send_raises_to_the_caller(self) -> None:
        self.connect()
        with fake_suite_cloud() as cloud:
            refused = {"status": "Failed", "error": "550 No such user"}
            with patch.object(cloud, "send_email", return_value=refused):
                self.assertRaisesRegex(
                    EmailNotSentError,
                    "550 No such user",
                    suite_email.send,
                    "password-reset",
                    RECIPIENT,
                    PARAMS,
                    LOCAL,
                )

    def test_a_site_without_suite_cloud_sends_it_through_its_own_email_account(self) -> None:
        self.connect(connected=False)
        with patch("frappe.sendmail") as sendmail:
            suite_email.send("password-reset", RECIPIENT, PARAMS, LOCAL)
            suite_email.enqueue("password-reset", RECIPIENT, PARAMS, LOCAL)

        now, queued = sendmail.call_args_list
        self.assertEqual(now.kwargs, {"recipients": [RECIPIENT], "now": True, **LOCAL})
        self.assertEqual(queued.kwargs, {"recipients": [RECIPIENT], **LOCAL})  # Email Queue retries it

    def test_a_notice_is_sent_after_the_request_and_tried_again_with_one_key(self) -> None:
        self.connect()
        with patch("frappe.enqueue") as enqueue:
            suite_email.enqueue("drive-share", RECIPIENT, PARAMS, LOCAL)

        method, kwargs = enqueue.call_args.args[0], enqueue.call_args.kwargs
        self.assertEqual(method, "suite.suite_core.suite_email.send_in_background")
        self.assertTrue(kwargs.pop("enqueue_after_commit"))
        with fake_suite_cloud() as cloud:
            refused = {"status": "Failed", "error": "421 Try later"}
            with patch.object(cloud, "send_email", return_value=refused):
                self.assertRaises(frappe.RetryBackgroundJobError, suite_email.send_in_background, **kwargs)
            throttled = frappe.TooManyRequestsError("Too many requests")
            with patch.object(cloud, "send_email", side_effect=throttled):
                self.assertRaises(frappe.RetryBackgroundJobError, suite_email.send_in_background, **kwargs)
            suite_email.send_in_background(**kwargs)

        self.assertEqual(cloud.emails[-1]["request_key"], kwargs["request_key"])

    def test_the_patch_drops_only_the_old_notification_account(self) -> None:
        for connected, email_id, kept in (
            (True, "notification@acme.example.test", False),
            (True, "alerts@acme.example.test", True),
            (False, "notification@acme.example.test", True),  # the site's own: Suite Cloud never set it up
        ):
            with self.subTest(email_id=email_id, connected=connected):
                self.connect(connected)
                if frappe.db.exists("Email Account", "Notifications"):
                    frappe.delete_doc("Email Account", "Notifications", force=True)
                frappe.get_doc(
                    {
                        "doctype": "Email Account",
                        "email_account_name": "Notifications",
                        "email_id": email_id,
                        "smtp_server": "mail.example.test",
                        "enable_outgoing": 1,
                        "no_smtp_authentication": 1,
                    }
                ).insert()

                drop_notification_email_account.execute()

                self.assertEqual(bool(frappe.db.exists("Email Account", "Notifications")), kept)
