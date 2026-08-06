from unittest.mock import patch

from frappe.tests import UnitTestCase

from suite.drive.api.notifications import send_share_email


class TestShareEmail(UnitTestCase):
    @patch("suite.drive.api.notifications.drive_logo_inline_images", return_value=[])
    @patch("suite.drive.api.notifications.frappe.sendmail")
    def test_send_share_email_queues_email(self, sendmail, _inline_images):
        send_share_email("user@example.com", "A file was shared", "/drive/file-1", "file")

        sendmail.assert_called_once()
        self.assertNotIn("now", sendmail.call_args.kwargs)
