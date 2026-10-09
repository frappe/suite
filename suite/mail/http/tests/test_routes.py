from types import SimpleNamespace
from unittest.mock import Mock, patch

import frappe
from frappe.tests import UnitTestCase

from suite.composition.http import BadRequest
from suite.composition.tests.http_conformance import HttpConformanceMixin
from suite.mail.http import invites, routes
from suite.mail.http.framework import HTTP


def setUpModule():
    if not getattr(frappe.local, "initialised", False):
        frappe.init(site="")


class TestHttpConformance(HttpConformanceMixin, UnitTestCase):
    HTTP = HTTP


class TestHandlers(UnitTestCase):
    @patch.object(routes, "get_all_inbox_unread_count", return_value=9)
    def test_inbox_summary_adapts_the_existing_all_account_count(self, unread):
        self.assertEqual(routes.inbox_summary(), {"unread": 9})
        unread.assert_called_once_with()


class TestInviteRefusals(UnitTestCase):
    def invite(self, **fields):
        return SimpleNamespace(
            **{
                "is_verified": 0,
                "is_expired": False,
                "backup_email": "backup@example.com",
                "check_permission": Mock(),
                "save": Mock(),
                "set_request_key": Mock(),
                "send_verification_email": Mock(),
                **fields,
            }
        )

    def test_an_accepted_invite_cannot_be_edited(self):
        doc = self.invite(is_verified=1)
        with patch.object(invites.frappe, "get_doc", return_value=doc):
            with self.assertRaises(BadRequest) as refused:
                invites.update_invite("invite", "2026-10-07T00:00:00Z", 5)
        self.assertEqual(refused.exception.http_status_code, 400)
        doc.save.assert_not_called()

    def test_resending_an_expired_invite_replaces_its_link_before_sending(self):
        doc = self.invite(is_expired=True)
        with patch.object(invites.frappe, "get_doc", return_value=doc):
            invites.send_invite("invite")
        doc.set_request_key.assert_called_once_with()
        doc.save.assert_called_once_with()
        doc.send_verification_email.assert_called_once_with()
        self.assertGreater(frappe.utils.get_datetime(doc.expires_at), frappe.utils.now_datetime())

    def test_an_invite_without_a_valid_backup_email_is_not_sent(self):
        for backup_email in (None, "not-an-email"):
            doc = self.invite(backup_email=backup_email)
            with self.subTest(backup_email=backup_email):
                with patch.object(invites.frappe, "get_doc", return_value=doc):
                    with self.assertRaises(BadRequest):
                        invites.send_invite("invite")
                doc.send_verification_email.assert_not_called()
