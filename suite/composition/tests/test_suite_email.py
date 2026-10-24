import os
import subprocess
import sys
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.mail.suite_cloud import SuiteCloudUnavailableError
from suite.mail.tests.fake_suite_cloud import fake_suite_cloud
from suite.suite_core import suite_email
from suite.suite_core.suite_email import EmailNotSentError

RECIPIENT = "someone@example.test"
PARAMS = {"link": "https://acme.example.test/mail/reset-password/abc"}
LOCAL = {"subject": "Reset Password", "template": "reset_password", "args": PARAMS}


class TestSuiteEmailProvider(IntegrationTestCase):
    def connect(self, connected: bool = True) -> None:
        settings = (
            {
                "suite_cloud_url": "https://cloud.example.test",
                "suite_cloud_tenant": "tenant",
                "suite_cloud_secret": "secret",
            }
            if connected
            else {"suite_cloud_url": "", "suite_cloud_tenant": "", "suite_cloud_secret": ""}
        )
        self.enterContext(self.change_settings("Suite Settings", **settings))
        frappe.local.request_cache.clear()

    def test_mail_provider_module_resolves_in_a_fresh_process(self) -> None:
        env = os.environ.copy()
        env["PYTHONPATH"] = os.pathsep.join(sys.path)
        subprocess.run(
            [
                sys.executable,
                "-c",
                "from importlib import import_module; "
                "provider = import_module('suite.mail'); "
                "assert callable(provider.is_configured) and callable(provider.send_email)",
            ],
            check=True,
            env=env,
        )

    def test_unconfigured_mail_provider_uses_the_local_email_account(self) -> None:
        self.connect(connected=False)
        with patch("frappe.sendmail") as sendmail, patch("frappe.enqueue") as enqueue:
            suite_email.send("password-reset", RECIPIENT, PARAMS, LOCAL)
            suite_email.enqueue("password-reset", RECIPIENT, PARAMS, LOCAL)

        immediate, queued = sendmail.call_args_list
        self.assertEqual(immediate.kwargs, {"recipients": [RECIPIENT], "now": True, **LOCAL})
        self.assertEqual(queued.kwargs, {"recipients": [RECIPIENT], **LOCAL})
        enqueue.assert_not_called()

    def test_the_declared_mail_provider_sends_the_templated_email(self) -> None:
        self.connect()
        with fake_suite_cloud() as cloud, patch("frappe.sendmail") as sendmail:
            suite_email.send("password-reset", RECIPIENT, PARAMS, LOCAL)

        (sent,) = cloud.emails
        self.assertEqual(
            (sent["email_type"], sent["recipient"], sent["params"]),
            ("password-reset", RECIPIENT, PARAMS),
        )
        self.assertTrue(sent["request_key"])
        sendmail.assert_not_called()

    def test_a_cloud_refusal_keeps_the_core_error_type(self) -> None:
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

    def test_cloud_unavailability_keeps_its_type_and_retries_with_the_queued_key(self) -> None:
        self.connect()
        with patch("frappe.enqueue") as enqueue:
            suite_email.enqueue("drive-share", RECIPIENT, PARAMS, LOCAL)

        method, kwargs = enqueue.call_args.args[0], enqueue.call_args.kwargs
        self.assertEqual(method, "suite.suite_core.suite_email.send_in_background")
        self.assertTrue(kwargs.pop("enqueue_after_commit"))
        request_key = kwargs["request_key"]
        unavailable = SuiteCloudUnavailableError("Suite Cloud is unreachable; try again shortly.")
        with fake_suite_cloud() as cloud:
            with patch.object(cloud, "send_email", side_effect=unavailable):
                with self.assertRaises(frappe.RetryBackgroundJobError) as raised:
                    suite_email.send_in_background(**kwargs)
                self.assertIs(raised.exception.__cause__, unavailable)
            suite_email.send_in_background(**kwargs)

        self.assertEqual(cloud.emails[-1]["request_key"], request_key)
