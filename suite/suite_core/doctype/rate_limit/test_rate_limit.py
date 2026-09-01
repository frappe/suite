# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite.suite_core.doctype.rate_limit.rate_limit import create_rate_limit
from suite.utils.rate_limiter import _is_trusted_socket_request, dynamic_rate_limit

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]

PROBE_IP = "203.0.113.7"


# Two rate-limited endpoints where one calls the other, standing in for the real pairs that do
# (api.edit_calendar_event -> calendar_event.update_calendar_event). Module-level so their declared
# path is importable, which is what a Rate Limit row has to reference.
@dynamic_rate_limit()
def probe_inner() -> str:
    return "inner"


@dynamic_rate_limit()
def probe_outer() -> str:
    return probe_inner()


@dynamic_rate_limit(trusted_socket_bypass=True)
def probe_trusted_socket() -> str:
    return "trusted"


OUTER_PATH = f"{__name__}.probe_outer"
INNER_PATH = f"{__name__}.probe_inner"
TRUSTED_SOCKET_PATH = f"{__name__}.probe_trusted_socket"
PROBE_PATHS = (OUTER_PATH, INNER_PATH, TRUSTED_SOCKET_PATH)


class UnitTestRateLimit(UnitTestCase):
    """
    Unit tests for RateLimit.
    Use this class for testing individual functions and methods.
    """

    def test_socket_bypass_requires_matching_secret(self):
        with (
            patch("frappe.get_request_header", return_value="trusted-secret"),
            patch("frappe.realtime.get_socketio_secret", return_value="trusted-secret"),
        ):
            self.assertTrue(_is_trusted_socket_request())

        with (
            patch("frappe.get_request_header", return_value="wrong-secret"),
            patch("frappe.realtime.get_socketio_secret", return_value="trusted-secret"),
        ):
            self.assertFalse(_is_trusted_socket_request())


class IntegrationTestRateLimit(IntegrationTestCase):
    """
    Integration tests for RateLimit.
    Use this class for testing interactions between multiple components.
    """

    def setUp(self) -> None:
        for path in PROBE_PATHS:
            # Every row for a path applies, so clear first: a leftover from an earlier test would
            # stack a second identical limit and charge the counter twice per call.
            frappe.db.delete("Rate Limit", {"method_path": path})
            # ignore_in_developer_mode is off: a developer bench must still exercise the counters.
            create_rate_limit(method_path=path, limit=1000, seconds=60, ignore_in_developer_mode=False)
            frappe.cache.hdel("rate_limits", path)
        self._reset_counters()

    def tearDown(self) -> None:
        # The rows go with the test transaction; the redis counters and cache do not.
        self._reset_counters()
        for path in PROBE_PATHS:
            frappe.cache.hdel("rate_limits", path)

    def test_nested_endpoints_charge_their_own_bucket(self):
        """An endpoint delegating to another spends one hit from each, not two from its own."""

        # frappe's v1 dispatcher publishes the called path in form_dict.cmd.
        self._dispatch(OUTER_PATH)

        self.assertEqual(self._counter(OUTER_PATH), 1)
        self.assertEqual(self._counter(INNER_PATH), 1)

    def test_limits_apply_when_the_request_carries_no_command(self):
        """frappe's v2 dispatcher calls the method directly, leaving form_dict.cmd unset."""

        self._dispatch(None)

        self.assertEqual(self._counter(OUTER_PATH), 1)
        self.assertEqual(self._counter(INNER_PATH), 1)

    def test_limits_apply_when_dispatched_under_an_alias(self):
        """override_whitelisted_methods leaves the caller's alias in form_dict.cmd.

        No Rate Limit row can name that alias - `validate_method_path` resolves the path through
        `frappe.get_attr`, and an alias like `mail.api.outbound.send` is not importable - so a limit
        keyed on the request's command would simply not be found.
        """

        self._dispatch("legacy.alias.probe_outer")

        self.assertEqual(self._counter(OUTER_PATH), 1)
        self.assertEqual(self._counter(INNER_PATH), 1)

    def test_trusted_socket_request_bypasses_configured_limit(self):
        with patch("suite.utils.rate_limiter._is_trusted_socket_request", return_value=True):
            self._dispatch(TRUSTED_SOCKET_PATH, probe_trusted_socket)

        self.assertEqual(self._counter(TRUSTED_SOCKET_PATH), 0)

    def test_untrusted_request_still_uses_configured_limit(self):
        self._dispatch(TRUSTED_SOCKET_PATH, probe_trusted_socket)

        self.assertEqual(self._counter(TRUSTED_SOCKET_PATH), 1)

    def _dispatch(self, cmd: str | None, endpoint=probe_outer) -> None:
        """Calls probe_outer as a request dispatched under `cmd`."""

        builder = EnvironBuilder(path=f"/api/method/{cmd}", method="POST")
        previous_request = getattr(frappe.local, "request", None)
        previous_cmd = frappe.form_dict.cmd
        frappe.local.request = Request(builder.get_environ())
        frappe.local.request_ip = PROBE_IP
        frappe.form_dict.cmd = cmd
        try:
            endpoint()
        finally:
            frappe.form_dict.cmd = previous_cmd
            if previous_request is None:
                delattr(frappe.local, "request")
            else:
                frappe.local.request = previous_request

    @staticmethod
    def _counter_key(path: str, seconds: int = 60) -> bytes:
        # Mirrors the key frappe.rate_limiter.rate_limit builds for an IP-based limit.
        return frappe.cache.make_key(f"rl:{path}:{PROBE_IP}") + f":{seconds}".encode()

    def _counter(self, path: str) -> int:
        value = frappe.cache.get(self._counter_key(path))
        return int(value) if value else 0

    def _reset_counters(self) -> None:
        for path in PROBE_PATHS:
            frappe.cache.delete(self._counter_key(path))
