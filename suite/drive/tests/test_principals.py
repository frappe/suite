from unittest.mock import patch

from frappe.tests import UnitTestCase

from suite.drive.framework import principals_for_request


class TestRequestPrincipals(UnitTestCase):
    @patch("suite.drive.framework.frappe.session")
    def test_guest_has_only_the_public_open_principal(self, session):
        session.user = "Guest"
        self.assertEqual(principals_for_request().own, ())
        self.assertEqual(principals_for_request().open, ("$PUBLIC",))

    @patch("suite.drive.framework.is_drive_admin", return_value=False)
    @patch("suite.drive.framework.frappe.cache")
    @patch("suite.drive.framework.frappe.session")
    def test_signed_in_identity_keeps_groups_and_general_in_own_pass(
        self, session, cache, _is_admin
    ):
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
