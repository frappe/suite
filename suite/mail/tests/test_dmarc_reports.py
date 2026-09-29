# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.mail.api import admin
from suite.mail.tests.test_suite_cloud_directory import DOMAIN, SuiteCloudTestCase


class TestDmarcReports(SuiteCloudTestCase):
    def test_reports_and_summary_come_from_suite_cloud(self) -> None:
        first = self.fake.add_dmarc_report(DOMAIN)
        self.fake.add_dmarc_report(DOMAIN, reporter="yahoo.com", date_range_end="2026-09-18T00:00:00Z")

        page = admin.get_dmarc_reports()
        self.assertEqual(page["total"], 2)
        self.assertEqual([r["reporter"] for r in page["items"]], ["yahoo.com", "google.com"])
        row = page["items"][1]
        self.assertEqual(
            (row["id"], row["domain"], row["messages"], row["passed"], row["failed"]),
            (first["name"], DOMAIN, 5, 3, 2),
        )
        self.assertEqual(
            (row["pass_rate"], row["policy"]["p"], row["date_range_end"]),
            (60, "reject", "2026-09-17T00:00:00Z"),
        )
        self.assertEqual(admin.get_dmarc_reports(txt="yahoo")["total"], 1)
        self.assertEqual(admin.get_dmarc_reports(domain_id=DOMAIN, page_length=20)["total"], 2)
        self.assertEqual(self.fake.calls[-1][1]["days"], 30)  # the list takes the summary's window
        self.assertEqual(admin.get_dmarc_reports(days=90)["total"], 2)
        self.assertRaises(frappe.ValidationError, admin.get_dmarc_reports, days=45)
        self.assertEqual(admin.get_dmarc_reports(days=0)["total"], 2)  # everything held, no window
        self.assertRaises(frappe.DoesNotExistError, admin.get_dmarc_reports, domain_id="nobody.test")
        self.assertEqual(admin.get_dmarc_reports(domain_id=f"  {DOMAIN.upper()} ")["total"], 2)
        self.assertEqual(admin.get_dmarc_summary(domain_id="")["totals"]["reports"], 2)
        self.assertRaises(frappe.DoesNotExistError, admin.get_dmarc_report, "  ")

        report = admin.get_dmarc_report(first["name"])
        self.assertEqual(
            (report["subject"], report["to"], report["version"]),
            (first["subject"], [f"postmaster@{DOMAIN}"], 1.0),
        )
        self.assertIs(report["policy"]["testing_mode"], False)
        self.assertEqual([r["source_ip"] for r in report["records"]], ["203.0.113.5", "198.51.100.9"])
        self.assertEqual(report["records"][1]["disposition"], "reject")
        self.assertRaises(frappe.DoesNotExistError, admin.get_dmarc_report, "c1-missing")

        summary = admin.get_dmarc_summary(days=30)
        self.assertEqual((summary["totals"]["messages"], summary["totals"]["pass_rate"]), (10, 60))
        self.assertEqual(summary["domains"][0]["domain"], DOMAIN)
        self.assertEqual([s["source_ip"] for s in summary["sources"]], ["203.0.113.5", "198.51.100.9"])
        self.assertEqual(summary["sources"][1]["pass_rate"], 0)
        self.assertRaises(frappe.ValidationError, admin.get_dmarc_summary, days=45)

    def test_nothing_fetched_yet_reads_as_empty(self) -> None:
        self.assertEqual(admin.get_dmarc_reports(), {"items": [], "total": 0})
        self.assertEqual(admin.get_dmarc_summary()["totals"]["pass_rate"], None)

    def test_reads_need_an_admin(self) -> None:
        frappe.set_user("Guest")
        self.assertRaises(frappe.PermissionError, admin.get_dmarc_summary)
