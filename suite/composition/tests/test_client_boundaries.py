"""API migration boundaries keep permission checks and bounded pagination."""

from unittest import TestCase
from unittest.mock import MagicMock, patch

import frappe

from suite.api import preferences
from suite.mail.api import mail


class TestClientBoundaries(TestCase):
    def test_preferences_save_only_known_fields_through_document_permissions(self):
        document = MagicMock()
        with patch.object(preferences, "frappe") as framework:
            framework.session.user = "me@example.test"
            framework.get_doc.return_value = document
            framework.throw.side_effect = frappe.ValidationError
            preferences.update_preferences(first_name="Faris", user_image=None)
            document.check_permission.assert_any_call("write")
            document.update.assert_called_once_with({"first_name": "Faris", "user_image": None})
            document.save.assert_called_once()
            for change in ({"roles": []}, {"first_name": []}, {"language": None}):
                with self.assertRaises(frappe.ValidationError):
                    preferences.update_preferences(**change)
            document.save.assert_called_once()

    def test_unified_folder_ends_at_the_fetch_bound_without_repeating_an_earlier_window(self):
        with (
            patch.object(mail, "get_user_jmap_accounts", return_value=[{"name": "a", "_name": "Work"}]),
            patch.object(mail, "get_threads") as threads,
        ):
            self.assertEqual(
                mail.get_unified_threads("inbox", 25, start=500), {"rows": [], "has_more": False}
            )
            threads.assert_not_called()

    def test_cross_account_search_does_not_refetch_after_the_bound(self):
        with (
            patch.object(mail, "get_user_jmap_accounts", return_value=[{"name": "a", "_name": "Work"}]),
            patch.object(mail, "search_messages") as search,
        ):
            self.assertEqual(mail._search_all_accounts({"text": "hello"}, 25, 500), ([], 0))
            search.assert_not_called()

    def test_single_account_search_returns_explicit_rows_and_total(self):
        with (
            patch.object(mail, "normalize_filter", return_value={"text": "hello"}),
            patch.object(mail, "search_messages", return_value=([{"id": "a"}], 42)),
            patch.object(mail, "add_user_images_to_emails"),
            patch.object(mail, "_tag_search_results"),
        ):
            self.assertEqual(
                mail.search_mails("account", {"text": "hello"}), {"rows": [{"id": "a"}], "total": 42}
            )
