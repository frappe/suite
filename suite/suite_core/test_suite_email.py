from unittest.mock import Mock, patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.suite_core import suite_email
from suite.suite_core.patches import drop_notification_email_account
from suite.suite_core.suite_email import EmailDeliveryUnavailableError, EmailNotSentError

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

    def use_provider(self, provider: Mock) -> None:
        self.enterContext(patch("frappe.get_hooks", return_value=["test.email_provider"]))
        self.enterContext(patch("suite.suite_core.suite_email.import_module", return_value=provider))

    def test_configured_provider_receives_the_email_type_and_parameters(self) -> None:
        provider = Mock()
        provider.is_configured.return_value = True
        self.use_provider(provider)
        with patch("frappe.sendmail") as sendmail:
            suite_email.send("password-reset", RECIPIENT, PARAMS, LOCAL)

        email_type, recipient, params, request_key = provider.send_email.call_args.args
        self.assertEqual((email_type, recipient, params), ("password-reset", RECIPIENT, PARAMS))
        self.assertTrue(request_key)
        sendmail.assert_not_called()

    def test_a_provider_refusal_is_raised_to_the_waiting_caller(self) -> None:
        provider = Mock()
        provider.is_configured.return_value = True
        provider.send_email.side_effect = EmailNotSentError("550 No such user")
        self.use_provider(provider)

        self.assertRaisesRegex(
            EmailNotSentError,
            "550 No such user",
            suite_email.send,
            "password-reset",
            RECIPIENT,
            PARAMS,
            LOCAL,
        )

    def test_an_unconfigured_provider_uses_the_sites_email_account(self) -> None:
        provider = Mock()
        provider.is_configured.return_value = False
        self.use_provider(provider)
        with patch("frappe.sendmail") as sendmail:
            suite_email.send("password-reset", RECIPIENT, PARAMS, LOCAL)
            suite_email.enqueue("password-reset", RECIPIENT, PARAMS, LOCAL)

        now, queued = sendmail.call_args_list
        self.assertEqual(now.kwargs, {"recipients": [RECIPIENT], "now": True, **LOCAL})
        self.assertEqual(queued.kwargs, {"recipients": [RECIPIENT], **LOCAL})
        provider.send_email.assert_not_called()

    def test_no_provider_uses_the_sites_email_account(self) -> None:
        self.enterContext(patch("frappe.get_hooks", return_value=[]))
        with patch("frappe.sendmail") as sendmail:
            suite_email.send("password-reset", RECIPIENT, PARAMS, LOCAL)

        sendmail.assert_called_once_with(recipients=[RECIPIENT], now=True, **LOCAL)

    def test_multiple_provider_hooks_are_rejected(self) -> None:
        self.enterContext(patch("frappe.get_hooks", return_value=["one", "two"]))

        with self.assertRaisesRegex(RuntimeError, "at most one"):
            suite_email.send("password-reset", RECIPIENT, PARAMS, LOCAL)

    def test_a_notice_is_sent_after_commit_and_retries_with_one_key(self) -> None:
        provider = Mock()
        provider.is_configured.return_value = True
        self.use_provider(provider)
        with patch("frappe.enqueue") as enqueue:
            suite_email.enqueue("drive-share", RECIPIENT, PARAMS, LOCAL)

        method, kwargs = enqueue.call_args.args[0], enqueue.call_args.kwargs
        self.assertEqual(method, "suite.suite_core.suite_email.send_in_background")
        self.assertTrue(kwargs.pop("enqueue_after_commit"))
        provider.send_email.side_effect = [
            EmailNotSentError("421 Try later"),
            EmailDeliveryUnavailableError("Temporarily unavailable"),
            frappe.TooManyRequestsError("Too many requests"),
            None,
        ]
        for _ in range(3):
            self.assertRaises(frappe.RetryBackgroundJobError, suite_email.send_in_background, **kwargs)
        suite_email.send_in_background(**kwargs)

        self.assertEqual(provider.send_email.call_args_list[-1].args[3], kwargs["request_key"])

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
