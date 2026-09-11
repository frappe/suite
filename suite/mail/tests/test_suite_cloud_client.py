import json
from unittest.mock import patch

import frappe
import requests
from frappe.tests import UnitTestCase

from suite.mail.suite_cloud import SuiteCloudClient, SuiteCloudCredentialsError, SuiteCloudUnavailableError


def _response(status: int, payload: dict | None = None, text: str | None = None) -> requests.Response:
    response = requests.Response()
    response.status_code = status
    response._content = (text if text is not None else json.dumps(payload or {})).encode()
    return response


def _frappe_error(status: int, exc_type: str, message: str) -> requests.Response:
    """What Frappe sends for a thrown exception: the type, and the message wrapped twice."""

    server_messages = json.dumps([json.dumps({"message": message})])
    return _response(status, {"exc_type": exc_type, "_server_messages": server_messages})


class TestSuiteCloudClient(UnitTestCase):
    def setUp(self) -> None:
        self.client = SuiteCloudClient("https://cloud.frappemail.com", "key", "secret")
        self.addCleanup(patch.stopall)
        patch("suite.mail.suite_cloud.log_mail_error").start()

    def _call(self, response: requests.Response):
        with patch.object(self.client.session, "post", return_value=response) as post:
            result = self.client.call("mail.domains.get_domain", domain="acme.com", description=None)
        self.assertEqual(
            post.call_args.args[0],
            "https://cloud.frappemail.com/api/method/suite_cloud.api.mail.domains.get_domain",
        )
        self.assertEqual(json.loads(post.call_args.kwargs["data"]), {"domain": "acme.com"})  # None is dropped
        return result

    def test_success_unwraps_message(self) -> None:
        self.assertEqual(
            self._call(_response(200, {"message": {"domain": "acme.com"}})), {"domain": "acme.com"}
        )

    def test_errors_are_raised_as_the_type_suite_cloud_named(self) -> None:
        cases = [
            (417, "DuplicateEntryError", frappe.DuplicateEntryError),
            (429, "TooManyRequestsError", frappe.TooManyRequestsError),
            (404, "DoesNotExistError", frappe.DoesNotExistError),
            (422, "StalwartRejected", frappe.ValidationError),
            (417, "ValidationError", frappe.ValidationError),
            (403, "SiteSuspendedError", frappe.PermissionError),
        ]
        for status, exc_type, expected in cases:
            with self.subTest(exc_type=exc_type), self.assertRaisesRegex(expected, "Refused by the cloud"):
                self._call(_frappe_error(status, exc_type, "Refused by the cloud"))

    def test_status_code_decides_without_a_type(self) -> None:
        cases = [
            (404, frappe.DoesNotExistError),
            (409, frappe.DuplicateEntryError),
            (429, frappe.TooManyRequestsError),
            (400, frappe.ValidationError),
        ]
        for status, expected in cases:
            with self.subTest(status=status), self.assertRaises(expected):
                self._call(_response(status, text="not json"))

    def test_bad_credentials_keep_the_settings_hint(self) -> None:
        for response in (_frappe_error(401, "SiteAuthError", "Site authentication failed."), _response(403)):
            with self.assertRaisesRegex(SuiteCloudCredentialsError, "check Mail Settings"):
                self._call(response)

    def test_server_failures_are_unavailable(self) -> None:
        for status in (500, 502, 503):
            with self.subTest(status=status), self.assertRaises(SuiteCloudUnavailableError):
                self._call(_response(status, {"exc_type": "StalwartUnavailableError"}))

    def test_unreachable_is_unavailable(self) -> None:
        with (
            patch.object(self.client.session, "post", side_effect=requests.ConnectionError("down")),
            self.assertRaises(SuiteCloudUnavailableError),
        ):
            self.client.call("site.ping")
