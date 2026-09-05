from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.tests import UnitTestCase

from suite.drive._core.principals import (
    Principals,
    make_ticket,
    parse_link_header,
    ticket_ok,
    valid_link_principals,
)
from suite.drive.framework import principals_for_request

TOKEN_A = "AbCdEfGhIjKlMnOpQrSt12"
TOKEN_B = "zYxWvUtSrQpOnMlKjIhG98"


class TestLinkHeader(UnitTestCase):
    def test_absent_and_empty_headers_add_no_links(self):
        self.assertEqual(valid_link_principals(None), ())
        self.assertEqual(valid_link_principals(""), ())
        self.assertEqual(valid_link_principals("   "), ())

    def test_twenty_raw_items_are_allowed_before_filtering_or_deduplication(self):
        header = ",".join([TOKEN_A] * 10 + ["bad"] * 10)
        self.assertEqual(valid_link_principals(header), (f"$LINK:{TOKEN_A}",))

    def test_twenty_one_raw_items_raise_even_when_all_are_invalid_or_duplicates(self):
        for header in (",".join(["bad"] * 21), ",".join([TOKEN_A] * 21)):
            with self.subTest(header=header), self.assertRaises(frappe.ValidationError):
                valid_link_principals(header)

    def test_parser_is_strict_and_deduplicates_valid_survivors(self):
        exp = "1999999999"
        mac = "a" * 64
        header = ",".join(
            (
                TOKEN_A,
                f" {TOKEN_A}.{exp}.{mac} ",
                TOKEN_B,
                f"{TOKEN_B}.{exp}.{'A' * 64}",
                f"{TOKEN_B}.not-digits.{mac}",
                f"{TOKEN_B}.{exp}.{mac}.extra",
                "é" * 22,
            )
        )

        parsed = parse_link_header(header)

        self.assertEqual(tuple(item.principal for item in parsed), (f"$LINK:{TOKEN_A}", f"$LINK:{TOKEN_B}"))
        self.assertEqual((parsed[0].exp, parsed[0].mac), (exp, mac))
        self.assertIsNone(parsed[1].exp)

    @patch("suite.drive._core.principals.get_encryption_key", return_value="site-secret")
    @patch("suite.drive._core.principals.time.time", return_value=1_700_000_000)
    def test_ticket_is_bound_to_token_hash_and_expiry(self, _time, _key):
        ticket = make_ticket(TOKEN_A, "hash-one", 1_700_000_100)
        exp, mac = ticket.split(".")

        self.assertTrue(ticket_ok(TOKEN_A, "hash-one", exp, mac))
        self.assertFalse(ticket_ok(TOKEN_B, "hash-one", exp, mac))
        self.assertFalse(ticket_ok(TOKEN_A, "hash-two", exp, mac))
        self.assertFalse(ticket_ok(TOKEN_A, "hash-one", "1699999999", mac))


class TestRequestPrincipals(UnitTestCase):
    def setUp(self):
        super().setUp()
        self.request = SimpleNamespace(headers={})
        frappe.local.request = self.request

    def tearDown(self):
        del frappe.local.request
        super().tearDown()

    @patch("suite.drive.framework.frappe.session")
    def test_guest_has_only_the_public_open_principal(self, session):
        session.user = "Guest"
        self.assertEqual(principals_for_request().own, ())
        self.assertEqual(principals_for_request().open, ("$PUBLIC",))

    @patch("suite.drive.framework.frappe.session")
    def test_guest_request_carries_only_links_from_its_current_header(self, session):
        session.user = "Guest"
        self.request.headers = {"X-Drive-Links": f"{TOKEN_A},{TOKEN_B}"}
        first = principals_for_request()
        self.request.headers = {}
        second = principals_for_request()

        self.assertEqual(first.open, ("$PUBLIC", f"$LINK:{TOKEN_A}", f"$LINK:{TOKEN_B}"))
        self.assertEqual(second.open, ("$PUBLIC",))

    @patch("suite.drive.framework.frappe.session")
    def test_request_retains_ticket_proof_separately_from_principal(self, session):
        session.user = "Guest"
        exp, mac = "1999999999", "b" * 64
        self.request.headers = {"X-Drive-Links": f"{TOKEN_A}.{exp}.{mac}"}

        principals = principals_for_request()

        self.assertEqual(principals.open, ("$PUBLIC", f"$LINK:{TOKEN_A}"))
        self.assertEqual(principals.ticket_for(f"$LINK:{TOKEN_A}"), (exp, mac))

    @patch("suite.drive.framework.is_drive_admin", return_value=False)
    @patch("suite.drive.framework.frappe.cache")
    @patch("suite.drive.framework.frappe.session")
    def test_signed_in_identity_keeps_groups_and_general_in_own_pass(self, session, cache, _is_admin):
        session.user = "user@example.com"
        cache.return_value.hget.return_value = ("alpha", "beta")

        principals = principals_for_request()

        self.assertEqual(
            principals.own,
            ("user@example.com", "$GROUP:alpha", "$GROUP:beta", "$GENERAL"),
        )
        self.assertEqual(principals.open, ("$PUBLIC",))

    @patch("suite.drive.framework.is_drive_admin", return_value=True)
    @patch("suite.drive.framework.frappe.cache")
    @patch("suite.drive.framework.frappe.session")
    def test_admin_status_is_carried_structurally(self, session, cache, _is_admin):
        session.user = "Administrator"
        cache.return_value.hget.return_value = ()
        self.assertTrue(principals_for_request().is_admin)
