# Copyright (c) 2026, Asif and Contributors
# See license.txt
"""Custom share notification — branded subject + SPA link.

The previous flow piped recipient notifications through Frappe's
generic share path, which rendered as "Asif shared a document Sheet
'Title' with you" and pointed the click destination at the Desk form
view of the Sheet doctype (a raw JSON blob, not the SPA). These tests
pin the new behaviour: pass notify=False to frappe.share.add so the
generic one doesn't fire, then dispatch our own Notification Log + an
email body whose link routes to /sheets?id=…
"""

from __future__ import annotations

import unittest
from unittest import mock


class CustomShareNotification(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("suite.sheets.api.frappe")
        self.frappe = patcher.start()
        self.addCleanup(patcher.stop)
        self.frappe.session.user = "alice@example.com"
        self.frappe.has_permission.return_value = True
        # Recipient lookup (`enabled` check) — return 1 so share proceeds.
        # `name` is a docname for these, but production also calls get_value
        # with a filter *dict* (share_sheet's DocShare write-flag pre-read).
        # Dicts are unhashable, so anything this table doesn't model falls
        # through to None instead of raising.
        _values = {
            ("User", "bob@example.com", "enabled"):  1,
            ("User", "alice@example.com", "full_name"): "Alice",
        }

        def _get_value(dt, name, field=None, *args, **kwargs):
            try:
                return _values.get((dt, name, field))
            except TypeError:
                return None

        self.frappe.db.get_value.side_effect = _get_value
        # frappe.get_doc("Sheet", name) → mock title
        sheet_doc = mock.Mock()
        sheet_doc.title = "Q3 Forecast"
        # Notification Log creation also goes through get_doc; route that
        # to a fresh Mock so we can inspect what was inserted.
        self.notification_payload = {}

        def _get_doc_dispatch(*args, **kwargs):
            if args and args[0] == "Sheet":
                return sheet_doc
            # Inserting a Notification Log: dict payload.
            if args and isinstance(args[0], dict):
                self.notification_payload.update(args[0])
                m = mock.Mock()
                m.insert = mock.Mock()
                return m
            return mock.Mock()

        self.frappe.get_doc.side_effect = _get_doc_dispatch
        self.frappe.utils.get_url.return_value = "https://test.example"
        self.frappe.utils.escape_html.side_effect = lambda s: s

    def test_share_uses_notify_false_so_frappe_default_does_not_fire(self):
        from suite.sheets import api

        api.share_sheet("SH-1", "bob@example.com", write=0)
        # The first positional+keyword arg combo to share.add carries
        # notify — assert it's explicitly False so the generic
        # "shared a document Sheet …" notification never fires.
        kwargs = self.frappe.share.add.call_args.kwargs
        self.assertEqual(kwargs.get("notify"), False)

    def test_in_app_notification_has_branded_subject_with_title(self):
        from suite.sheets import api

        api.share_sheet("SH-1", "bob@example.com", write=0)
        self.assertIn("Q3 Forecast", self.notification_payload.get("subject", ""))
        self.assertIn("sheet", self.notification_payload.get("subject", "").lower())
        self.assertEqual(self.notification_payload["for_user"], "bob@example.com")
        self.assertEqual(self.notification_payload["from_user"], "alice@example.com")

    def test_role_text_reflects_write_permission(self):
        from suite.sheets import api

        api.share_sheet("SH-1", "bob@example.com", write=0)
        self.assertIn("can view", self.notification_payload["subject"])
        self.notification_payload.clear()

        api.share_sheet("SH-1", "bob@example.com", write=1)
        self.assertIn("can edit", self.notification_payload["subject"])

    def test_email_body_links_to_the_spa_not_the_desk(self):
        from suite.sheets import api

        api.share_sheet("SH-1", "bob@example.com", write=0)
        kwargs = self.frappe.sendmail.call_args.kwargs
        message = kwargs.get("message", "")
        # The link must go to the SPA route, not /app/sheet/<hash>.
        self.assertIn("/sheets?id=SH-1", message)
        self.assertNotIn("/app/sheet/", message)
        # Recipient and queue posture
        self.assertEqual(kwargs.get("recipients"), ["bob@example.com"])
        self.assertEqual(kwargs.get("now"), False)

    def test_notification_failure_does_not_rollback_the_share(self):
        # If frappe.sendmail or the Notification Log insert throws, the
        # share must still succeed — the DocShare row has already
        # committed and the recipient already has access.
        from suite.sheets import api

        self.frappe.sendmail.side_effect = RuntimeError("smtp dead")
        # Should NOT raise. share.add must have already been called.
        api.share_sheet("SH-1", "bob@example.com", write=0)
        self.frappe.share.add.assert_called_once()
        # And the failure was logged for observability.
        self.frappe.log_error.assert_called_once()

    def test_everyone_share_does_not_send_a_per_user_notification(self):
        # everyone=1 shares aren't addressed to a specific user, so no
        # personalised notification makes sense. The original notify=False
        # path on the everyone branch is already correct; this guards
        # that we didn't accidentally introduce a notification dispatch
        # there.
        from suite.sheets import api

        api.share_sheet("SH-1", everyone=1, write=1)
        self.frappe.sendmail.assert_not_called()
