"""Provider-boundary expectations for batched, stale and incomplete usage."""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite import mail


class Provider:
    def __init__(self, *, count=501, missing=None):
        self.count = count
        self.missing = missing
        self.batches = []

    def call(self, method, **args):
        if method == "site.ping":
            return {"limits": {"max_disk_gb": 100}}
        if method == "mail.accounts.list_accounts":
            emails = [f"user-{index}@example.test" for index in range(self.count)]
            return {
                "items": [
                    {"email": email} for email in emails[args["start"] : args["start"] + args["limit"]]
                ],
                "total": self.count,
            }
        if method == "mail.groups.list_groups":
            return {"items": [{"email": "group@example.test"}], "total": 1}
        if method == "mail.groups.get_group":
            return {"used_disk_bytes": 900}
        if method == "mail.accounts.get_quotas":
            self.batches.append(args["emails"])
            return {
                email: {"used_disk_bytes": None if email == self.missing else 100} for email in args["emails"]
            }
        raise AssertionError(method)


class TestAdminStorage(IntegrationTestCase):
    def test_more_than_five_hundred_accounts_are_batched_and_groups_count(self):
        provider = Provider()
        with patch("suite.mail.storage.get_client", return_value=provider):
            report = mail.storage_measurements({}, refresh=True)
        self.assertEqual([len(batch) for batch in provider.batches], [500, 1])
        self.assertEqual(report["site_mail"], 51000)
        self.assertEqual(report["allowance"], 100_000_000_000)
        self.assertFalse(report["stale"])

    def test_a_null_measurement_retains_its_last_value_and_success_time(self):
        provider = Provider(count=1, missing="user-0@example.test")
        previous = {"entries": {"user-0@example.test": {"bytes": 123, "fetched_at": "2026-01-01T00:00:00"}}}
        with patch("suite.mail.storage.get_client", return_value=provider):
            report = mail.storage_measurements(previous, refresh=True)
        self.assertEqual(report["site_mail"], 1023)
        self.assertEqual(report["entries"]["user-0@example.test"], previous["entries"]["user-0@example.test"])
        self.assertTrue(report["stale"])

    def test_a_retained_account_without_any_measurement_makes_the_site_total_unknown(self):
        with patch(
            "suite.mail.storage.get_client", return_value=Provider(count=1, missing="user-0@example.test")
        ):
            report = mail.storage_measurements({}, refresh=True)
        self.assertIsNone(report["site_mail"])
        self.assertTrue(report["stale"])

    def test_an_outage_retains_successful_values_but_marks_them_stale(self):
        previous = {"site_mail": 1000, "allowance": 100_000_000_000, "fetched_at": "2026-01-01T00:00:00"}
        with patch("suite.mail.storage.get_client", side_effect=frappe.ValidationError("offline")):
            report = mail.storage_measurements(previous, refresh=True)
        self.assertEqual(report["site_mail"], 1000)
        self.assertEqual(report["allowance"], 100_000_000_000)
        self.assertTrue(report["stale"])

    def test_admin_refresh_bypasses_the_six_hour_success_cache(self):
        provider = Provider(count=0)
        with patch("suite.mail.storage.get_client", return_value=provider):
            report = mail.storage_measurements({}, refresh=True)
        with patch("suite.mail.storage.get_client", side_effect=AssertionError("cache should avoid network")):
            self.assertEqual(mail.storage_measurements(report), report)
        with patch("suite.mail.storage.get_client", return_value=Provider(count=1)):
            refreshed = mail.storage_measurements(report, refresh=True)
        self.assertEqual(refreshed["site_mail"], 1000)
