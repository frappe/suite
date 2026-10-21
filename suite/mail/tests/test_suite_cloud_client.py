import json
from unittest.mock import patch

import frappe
import requests
from frappe.tests import UnitTestCase

from suite.mail.suite_cloud import (
    SuiteCloudAddressError,
    SuiteCloudClient,
    SuiteCloudCredentialsError,
    SuiteCloudUnavailableError,
    verb_for,
)

BASE = "https://cloud.frappemail.com/api/v2/method/suite_cloud.api."


def _response(status: int, payload: dict | None = None, text: str | None = None) -> requests.Response:
    response = requests.Response()
    response.status_code = status
    response._content = (text if text is not None else json.dumps(payload or {})).encode()
    return response


def _frappe_error(status: int, exc_type: str, message: str) -> requests.Response:
    """What Frappe's v2 handler sends for a thrown exception."""

    return _response(status, {"errors": [{"type": exc_type, "message": f"<b>{message}</b>"}]})


class TestSuiteCloudClient(UnitTestCase):
    def setUp(self) -> None:
        self.client = SuiteCloudClient("https://cloud.frappemail.com", "key", "secret")
        self.addCleanup(patch.stopall)
        patch("suite.mail.suite_cloud.log_mail_error").start()

    def _call(self, response: requests.Response, method: str = "mail.domains.get_domain", **params):
        params = params or {"domain": "acme.com", "description": None}
        with patch.object(self.client.session, "request", return_value=response) as request:
            result = self.client.call(method, **params)
        self.request = request.call_args
        return result

    def test_the_session_carries_the_site_credentials(self) -> None:
        self.assertEqual(self.client.session.headers["Authorization"], "Tenant key:secret")

    def test_a_read_is_a_get_with_the_query_string(self) -> None:
        self._call(_response(200, {"data": {"domain": "acme.com"}}))
        self.assertEqual(self.request.args, ("GET", f"{BASE}mail.domains.get_domain"))
        self.assertEqual(self.request.kwargs["params"], {"domain": "acme.com"})  # None is dropped
        self.assertFalse(self.request.kwargs["allow_redirects"])

    def test_a_read_with_a_list_is_a_query_with_a_json_body(self) -> None:
        self._call(
            _response(200, {"data": {}}), "mail.accounts.get_quotas", emails=["a@acme.com", "b@acme.com"]
        )
        self.assertEqual(self.request.args, ("QUERY", f"{BASE}mail.accounts.get_quotas"))
        self.assertEqual(json.loads(self.request.kwargs["data"]), {"emails": ["a@acme.com", "b@acme.com"]})
        self.assertNotIn("params", self.request.kwargs)

    def test_a_write_sends_the_verb_its_name_says_with_a_json_body(self) -> None:
        self._call(
            _response(200, {"data": {}}), "mail.domains.update_domain", domain="acme.com", enabled=False
        )
        self.assertEqual(self.request.args, ("PATCH", f"{BASE}mail.domains.update_domain"))
        self.assertEqual(json.loads(self.request.kwargs["data"]), {"domain": "acme.com", "enabled": False})

    def test_verbs_follow_the_method_name(self) -> None:
        cases = {
            "tenant.ping": "GET",
            "mail.domains.list_domains": "GET",
            "mail.domains.check_domain": "GET",
            "mail.accounts.update_account": "PATCH",
            "mail.groups.set_members": "PUT",
            "mail.accounts.set_password": "PUT",
            "mail.accounts.delete_account": "DELETE",
            "mail.mailing_lists.remove_recipients": "DELETE",
            "mail.accounts.create_account": "POST",
            "mail.domains.verify_dns_records": "POST",
        }
        for method, verb in cases.items():
            self.assertEqual(verb_for(method), verb, method)

    def test_success_unwraps_data(self) -> None:
        self.assertEqual(self._call(_response(200, {"data": {"domain": "acme.com"}})), {"domain": "acme.com"})

    def test_a_delete_answers_nothing(self) -> None:
        self.assertIsNone(
            self._call(_response(204, text=""), "mail.domains.delete_domain", domain="acme.com")
        )
        self.assertEqual(self.request.args[0], "DELETE")

    def test_errors_are_raised_as_the_type_suite_cloud_named(self) -> None:
        cases = [
            (409, "DuplicateEntryError", frappe.DuplicateEntryError),
            (429, "TooManyRequestsError", frappe.TooManyRequestsError),
            (404, "DoesNotExistError", frappe.DoesNotExistError),
            (422, "ClusterRejectedError", frappe.ValidationError),
            (422, "ValidationError", frappe.ValidationError),
            (400, "InvalidInputError", frappe.ValidationError),
            (403, "TenantSuspendedError", frappe.PermissionError),
        ]
        for status, exc_type, expected in cases:
            with self.subTest(exc_type=exc_type), self.assertRaisesRegex(expected, "^Refused by the cloud$"):
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
        for response in (
            _frappe_error(401, "TenantAuthError", "Tenant authentication failed."),
            _response(403),
        ):
            with self.assertRaisesRegex(SuiteCloudCredentialsError, "check Suite Settings"):
                self._call(response)

    def test_address_refusals_point_at_the_allowed_list(self) -> None:
        with self.assertRaisesRegex(SuiteCloudAddressError, "allowed addresses"):
            self._call(
                _frappe_error(
                    403, "TenantAddressError", "Tenant x does not accept requests from this address."
                )
            )

    def test_server_failures_are_unavailable(self) -> None:
        for status, exc_type in (
            (500, "InternalError"),
            (502, "ClusterFailedError"),
            (502, "ClusterMisconfiguredError"),
            (503, "ClusterUnavailableError"),
            (503, "StalwartUnavailableError"),
        ):
            with self.subTest(exc_type), self.assertRaises(SuiteCloudUnavailableError):
                self._call(_frappe_error(status, exc_type, "The mail server is not reachable right now."))

    def test_a_mail_server_failure_type_wins_over_its_status(self) -> None:
        # A 409 alone would raise a duplicate; only the mapping by name makes it unavailable.
        for exc_type in ("ClusterFailedError", "ClusterUnavailableError", "ClusterMisconfiguredError"):
            with self.subTest(exc_type), self.assertRaises(SuiteCloudUnavailableError):
                self._call(_frappe_error(409, exc_type, "Refused by the cloud"))

    def test_unreachable_is_unavailable(self) -> None:
        with (
            patch.object(self.client.session, "request", side_effect=requests.ConnectionError("down")),
            self.assertRaises(SuiteCloudUnavailableError),
        ):
            self.client.call("tenant.ping")
