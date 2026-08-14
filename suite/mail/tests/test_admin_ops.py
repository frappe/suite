# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.mail.api import admin
from suite.mail.tests.base import StalwartIntegrationTestCase

# Read endpoints a plain member must be locked out of, with representative arguments.
_GATED_CALLS = [
    ("get_overview", ()),
    ("get_domains", ()),
    ("get_enabled_domains", ()),
    ("get_members", ()),
    ("get_member", ("someone@example.test",)),
    ("get_account_requests", ()),
    ("get_accounts", ()),
    ("get_account_options", ()),
    ("get_groups", ()),
    ("get_mailing_lists", ()),
    ("get_roles_list", ()),
    ("get_permissions", ()),
    ("get_oauth_clients", ()),
    ("get_dkim_signatures", ()),
    ("get_queued_messages", ()),
    ("get_queue_recipient_options", ()),
    ("get_reports", ("dmarc", "inbound")),
    ("get_logs", ()),
    ("get_log", ("any-id",)),
    ("get_actions", ()),
    ("run_action", ("ReloadSettings",)),
    ("stream_delivery_test", ("example.test",)),
]


class TestAdminOps(StalwartIntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.member = cls.create_member()
        cls.suite_admin = cls.create_member(is_admin=True)

    def test_overview(self):
        overview = admin.get_overview()

        self.assertGreaterEqual(overview["members"]["total"], 2)  # the two class members
        self.assertGreaterEqual(overview["domains"]["total"], 1)
        self.assertIsInstance(overview["pending_invites"], int)
        self.assertIsInstance(overview["groups"], int)
        self.assertIsInstance(overview["mailing_lists"], int)
        self.assertIsInstance(overview["queued_messages"], int)
        self.assertIsInstance(overview["recent_logs"], list)

    def test_logs(self):
        try:
            page = admin.get_logs(page_length=5)
        except frappe.ValidationError:
            # Stock Stalwart (verified on v0.16.16) answers x:Log/query with serverUnavailable
            # even with enabled Log tracers - the log viewer backend simply is not implemented
            # there, unlike on production builds.
            self.skipTest("Server has no queryable log store.")
        self.assertLessEqual(len(page["logs"]), 5)
        self.assertIsInstance(page["total"], int)

        # The dashboard shows newest entries first; the store's own id order does not
        # guarantee that (see get_logs), so the endpoint must sort the page.
        timestamps = [row["timestamp"] for row in page["logs"]]
        self.assertEqual(timestamps, sorted(timestamps, reverse=True))

        if not page["logs"]:
            self.skipTest("Server has no log entries to page through.")

        entry = admin.get_log(page["logs"][0]["id"])
        self.assertEqual(entry["id"], page["logs"][0]["id"])

        if page["next_anchor"]:
            next_page = admin.get_logs(anchor=page["next_anchor"], page_length=5)
            first_ids = {log["id"] for log in page["logs"]}
            self.assertFalse(first_ids & {log["id"] for log in next_page["logs"]})

    def test_reports_empty_contract(self):
        # A fresh test server has no DMARC/TLS/ARF traffic; the listing must still answer cleanly.
        # ARF reports are inbound-only (no report service exists for the outbound direction).
        for kind, directions in (
            ("dmarc", ("inbound", "outbound")),
            ("tls", ("inbound", "outbound")),
            ("arf", ("inbound",)),
        ):
            for direction in directions:
                with self.subTest(kind=kind, direction=direction):
                    result = admin.get_reports(kind, direction)
                    self.assertIsInstance(result["reports"], list)
                    self.assertIsInstance(result["total"], int)

    def test_actions(self):
        actions = admin.get_actions()
        self.assertTrue(actions)

        by_value = {a["value"]: a for a in actions}
        self.assertIn("PauseMtaQueue", by_value)
        self.assertTrue(by_value["PauseMtaQueue"]["administrator_only"])

        # Administrator-only actions are refused even for a Suite Admin.
        with self.set_user(self.suite_admin.email):
            self.assertRaises(frappe.PermissionError, admin.run_action, "PauseMtaQueue")

    def test_accounts_and_options(self):
        rows = admin.get_accounts(search=self.member.email)
        self.assertIn(self.member.email, [r["email"] for r in rows])

        options = admin.get_account_options()
        self.assertIsInstance(options, dict)
        self.assertTrue(options)

    def test_admin_endpoints_reject_plain_members(self):
        with self.set_user(self.member.email):
            for name, args in _GATED_CALLS:
                with self.subTest(endpoint=name):
                    self.assertRaises(frappe.PermissionError, getattr(admin, name), *args)

    def test_disabled_admin_loses_access(self):
        # A disabled Suite Admin with a live session must not pass the permission gate.
        throwaway_admin = self.create_member(is_admin=True)
        admin.disable_members([throwaway_admin.email])

        with self.set_user(throwaway_admin.email):
            self.assertRaises(frappe.PermissionError, admin.get_overview)
            self.assertRaises(frappe.PermissionError, admin.enable_members, [throwaway_admin.email])
