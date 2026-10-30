from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.drive.api.notifications import mark_as_read, send_share_email
from suite.tests.utils import ensure_user

RECIPIENT = "drive-notifications-recipient@example.com"
OTHER_USER = "drive-notifications-other@example.com"


class TestShareEmail(UnitTestCase):
    @patch("suite.drive.api.notifications.drive_logo_inline_images", return_value=[])
    @patch("suite.suite_core.suite_email.is_suite_cloud_configured", return_value=False)
    @patch("suite.suite_core.suite_email.frappe.sendmail")
    def test_send_share_email_queues_email(self, sendmail, _configured, _inline_images):
        send_share_email("user@example.com", "Ana", "file", "report.pdf", "/drive/file-1")

        sendmail.assert_called_once()
        self.assertNotIn("now", sendmail.call_args.kwargs)
        self.assertEqual(
            sendmail.call_args.kwargs["args"]["message"], 'Ana shared a file with you: "report.pdf"'
        )
        self.assertTrue(sendmail.call_args.kwargs["args"]["link"].endswith("/drive/file-1"))


class TestMarkAsRead(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(RECIPIENT)
        ensure_user(OTHER_USER)

    def setUp(self):
        self.notification = frappe.get_doc(
            {
                "doctype": "Drive Notification",
                "to_user": RECIPIENT,
                "from_user": OTHER_USER,
                "message": "A file was shared with you",
                "read": 0,
            }
        ).insert(ignore_permissions=True)

    def test_recipient_can_mark_own_notification_as_read(self):
        with self.set_user(RECIPIENT):
            mark_as_read(name=self.notification.name)

        self.assertTrue(frappe.db.get_value("Drive Notification", self.notification.name, "read"))

    def test_other_user_cannot_mark_notification_as_read(self):
        with self.set_user(OTHER_USER):
            mark_as_read(name=self.notification.name)

        self.assertFalse(frappe.db.get_value("Drive Notification", self.notification.name, "read"))

    def test_mark_all_only_touches_own_notifications(self):
        with self.set_user(OTHER_USER):
            mark_as_read(all=True)

        self.assertFalse(frappe.db.get_value("Drive Notification", self.notification.name, "read"))
