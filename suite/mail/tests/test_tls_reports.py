# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.mail.api import admin
from suite.mail.tests.test_suite_cloud_directory import DOMAIN, SuiteCloudTestCase

EXTRA_TEST_RECORD_DEPENDENCIES = ["User"]  # test1@example.com, a member who is no admin


class TestTlsReports(SuiteCloudTestCase):
    def test_reports_and_summary_come_from_suite_cloud(self) -> None:
        first = self.fake.add_tls_report(DOMAIN)
        self.fake.add_tls_report(
            DOMAIN,
            reporter="Microsoft Corporation",
            policies=[
                {"policy_type": "no-policy-found", "policy_domain": DOMAIN, "successful": 20, "failed": 0}
            ],
            failures=[],
            date_range_end="2026-09-18T00:00:00Z",
        )

        page = admin.get_tls_reports()
        self.assertEqual(page["total"], 2)
        self.assertEqual([r["reporter"] for r in page["items"]], ["Microsoft Corporation", "Google Inc."])
        row = page["items"][1]
        self.assertEqual(
            (row["id"], row["domain"], row["sessions"], row["successful"], row["failed"]),
            (first["name"], DOMAIN, 10, 8, 2),
        )
        self.assertEqual(
            (row["success_rate"], row["policy_types"], row["date_range_end"]),
            (80, ["sts"], "2026-09-17T00:00:00Z"),
        )
        self.assertEqual(page["items"][0]["success_rate"], 100)
        self.assertEqual(admin.get_tls_reports(txt="microsoft")["total"], 1)
        self.assertEqual(admin.get_tls_reports(domain_id=DOMAIN, page_length=20)["total"], 2)
        self.assertEqual(self.fake.calls[-1][1]["days"], 30)  # the list takes the summary's window
        self.assertEqual(admin.get_tls_reports(days=0)["total"], 2)  # everything held, no window
        self.assertRaises(frappe.ValidationError, admin.get_tls_reports, days=45)
        self.assertRaises(frappe.DoesNotExistError, admin.get_tls_reports, domain_id="nobody.test")
        self.assertEqual(admin.get_tls_reports(domain_id=f"  {DOMAIN.upper()} ")["total"], 2)
        self.assertRaises(frappe.DoesNotExistError, admin.get_tls_report, "  ")

        report = admin.get_tls_report(first["name"])
        self.assertEqual(
            (report["contact_info"], report["to"]), (first["contact_info"], [f"postmaster@{DOMAIN}"])
        )
        self.assertEqual(
            [(p["policy_type"], p["successful"], p["failed"]) for p in report["policies"]], [("sts", 8, 2)]
        )
        self.assertEqual(
            [(f["result_type"], f["count"]) for f in report["failures"]],
            [("certificate-expired", 1), ("starttls-not-supported", 1)],
        )
        self.assertEqual(report["failures"][0]["receiving_mx_hostname"], "mail.c1.example.test")
        self.assertRaises(frappe.DoesNotExistError, admin.get_tls_report, "c1-missing")

        summary = admin.get_tls_summary(days=30)
        self.assertEqual(
            summary["totals"],
            {"reports": 2, "sessions": 30, "successful": 28, "failed": 2, "success_rate": 93},
        )
        self.assertEqual(summary["domains"][0]["domain"], DOMAIN)
        self.assertEqual(
            [(r["reporter"], r["success_rate"]) for r in summary["reporters"]],
            [("Google Inc.", 80), ("Microsoft Corporation", 100)],
        )
        self.assertEqual(
            summary["failures"][0], {"result_type": "certificate-expired", "reports": 1, "failed": 1}
        )
        self.assertRaises(frappe.ValidationError, admin.get_tls_summary, days=45)

    def test_nothing_fetched_yet_reads_as_empty(self) -> None:
        self.assertEqual(admin.get_tls_reports(), {"items": [], "total": 0})
        summary = admin.get_tls_summary()
        self.assertEqual((summary["totals"]["success_rate"], summary["failures"]), (None, []))

    def test_ids_and_searches_must_be_strings(self) -> None:
        # Frappe checks the annotated types, so a filter never stands in for an id or a search.
        self.assertRaises(frappe.FrappeTypeError, admin.get_tls_report, report_id=["like", "%"])
        self.assertRaises(frappe.FrappeTypeError, admin.get_tls_reports, domain_id=["!=", ""])
        self.assertRaises(frappe.FrappeTypeError, admin.get_tls_reports, txt={"like": "%"})
        self.assertRaises(frappe.FrappeTypeError, admin.get_tls_summary, domain_id=["!=", ""])
        self.assertEqual(self.fake.calls, [])  # nothing reached Suite Cloud

    def test_reads_need_an_admin(self) -> None:
        report = self.fake.add_tls_report(DOMAIN)
        for user in ("test1@example.com", "Guest"):
            with self.set_user(user):
                self.assertRaises(frappe.PermissionError, admin.get_tls_summary)
                self.assertRaises(frappe.PermissionError, admin.get_tls_reports)
                self.assertRaises(frappe.PermissionError, admin.get_tls_report, report["name"])
