"""Public signup defaults and personal provider preferences."""

from contextlib import nullcontext
from unittest.mock import Mock, patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.mail import account_lifecycle
from suite.mail.api.account import create_account
from suite.mail.http.preferences import regional_preferences, update_regional_preferences

OPTIONS = {
    "locales": [{"value": "en-US", "label": "English"}, {"value": "fr-FR", "label": "French"}],
    "time_zones": [{"value": "UTC", "label": "UTC"}, {"value": "Europe/Paris", "label": "Paris"}],
}


class TestRegionalPreferences(IntegrationTestCase):
    def setUp(self) -> None:
        super().setUp()
        frappe.db.savepoint("regional_test")
        self.addCleanup(frappe.db.rollback, save_point="regional_test")
        previous_user = frappe.session.user
        previous_request = getattr(frappe.local, "request", None)
        previous_form = frappe.local.form_dict
        self.addCleanup(setattr, frappe.session, "user", previous_user)
        self.addCleanup(setattr, frappe.local, "request", previous_request)
        self.addCleanup(setattr, frappe.local, "form_dict", previous_form)
        self.enterContext(patch("suite.mail.http.preferences._", side_effect=lambda value: value))

    def test_signup_supplies_defaults_and_keeps_supported_explicit_values(self) -> None:
        for supplied, site_zone, expected in [
            ({}, "Europe/Paris", ("en-US", "Europe/Paris")),
            ({}, "invalid", ("en-US", "UTC")),
            ({"locale": "invalid", "time_zone": "invalid"}, "Europe/Paris", ("en-US", "Europe/Paris")),
            ({"locale": "fr-FR", "time_zone": "UTC"}, "Europe/Paris", ("fr-FR", "UTC")),
        ]:
            with self.subTest(supplied=supplied):
                request = Mock(request_key="key", is_verified=False, account="person@example.test")
                with (
                    patch("frappe.get_last_doc", return_value=request),
                    patch("frappe.db", new=Mock()),
                    patch("suite.suite_core.storage.state"),
                    patch("suite.mail.api.account.user_context", return_value=nullcontext()),
                    patch("suite.mail.directory.get_account_metadata", return_value=OPTIONS),
                    patch("suite.mail.api.account.get_system_timezone", return_value=site_zone),
                ):
                    create_account("key", "Person", "", "password", **supplied)
                request.create_account.assert_called_once_with("Person", "", "password", *expected)

    def test_provider_contract_uses_patch_and_reads_an_independent_response(self) -> None:
        import json

        import requests

        from suite.mail.suite_cloud import SuiteCloudClient

        client = SuiteCloudClient("https://provider.example.test", "tenant", "test-secret")
        response = requests.Response()
        response.status_code = 200
        response._content = b'{"data":{"locale":"fr-FR","time_zone":"Europe/Paris"}}'
        with (
            patch("suite.mail.directory.get_account_metadata", return_value=OPTIONS),
            patch("suite.mail.suite_cloud.get_client", return_value=client),
            patch.object(client.session, "request", return_value=response) as request,
        ):
            self._insert_settings("regional-person@example.test", "personal@example.test")
            frappe.session.user = "regional-person@example.test"
            update_regional_preferences("fr-FR", "Europe/Paris")
            self.assertEqual(
                request.call_args.args,
                (
                    "PATCH",
                    "https://provider.example.test/api/v2/method/suite_cloud.api.mail.accounts.update_account",
                ),
            )
            self.assertEqual(
                json.loads(request.call_args.kwargs["data"]),
                {"email": "personal@example.test", "locale": "fr-FR", "time_zone": "Europe/Paris"},
            )
            result = regional_preferences()
            self.assertEqual((result["locale"], result["time_zone"]), ("fr-FR", "Europe/Paris"))
            self.assertEqual(request.call_args.args[0], "GET")
            self.assertEqual(request.call_args.kwargs["params"], {"email": "personal@example.test"})
            with self.assertRaises(frappe.ValidationError):
                update_regional_preferences("invalid", "UTC")
            self.assertEqual(request.call_count, 2)

    def _insert_settings(self, user: str, username: str | None) -> None:
        # Seed the database boundary without provisioning an external mailbox.
        frappe.get_doc(
            {"doctype": "User Settings", "name": user, "user": user, "username": username}
        ).db_insert()

    def test_request_boundary_ignores_foreign_targets_and_resolves_only_session_username(self) -> None:
        from frappe.handler import execute_cmd

        self._insert_settings("regional-person@example.test", "personal@example.test")
        self._insert_settings("regional-other@example.test", "other@example.test")
        for account in ("personal-account", "shared-account"):
            frappe.get_doc(
                {
                    "doctype": "User Account",
                    "name": "regional-" + account,
                    "user_settings": "regional-person@example.test",
                    "user": "regional-person@example.test",
                    "account": account,
                }
            ).db_insert()
        client = Mock()
        client.call.return_value = {"locale": "en-US", "time_zone": "UTC"}
        with (
            patch("suite.mail.directory.get_account_metadata", return_value=OPTIONS),
            patch("suite.mail.suite_cloud.get_client", return_value=client),
        ):
            for method, handler in [
                ("GET", "regional_preferences"),
                ("PATCH", "update_regional_preferences"),
            ]:
                with self.subTest(method=method):
                    frappe.local.request = Mock(method=method)
                    frappe.local.form_dict = frappe._dict(
                        email="other@example.test",
                        user="regional-other@example.test",
                        account="shared-account",
                        locale="fr-FR",
                        time_zone="Europe/Paris",
                    )
                    frappe.session.user = "Guest"
                    with self.assertRaises(frappe.PermissionError):
                        execute_cmd("suite.mail.http.preferences." + handler)
                    client.call.assert_not_called()
                    frappe.session.user = "regional-person@example.test"
                    execute_cmd("suite.mail.http.preferences." + handler)
                    self.assertEqual(client.call.call_args.kwargs["email"], "personal@example.test")
                    client.reset_mock()
                    frappe.session.user = "regional-missing@example.test"
                    with self.assertRaises(frappe.ValidationError):
                        execute_cmd("suite.mail.http.preferences." + handler)
                    client.call.assert_not_called()

    def test_accepting_an_invite_preserves_existing_user_timezone(self) -> None:
        from suite.mail.doctype.mail_account_request.mail_account_request import MailAccountRequest

        user = "regional-existing@example.test"
        frappe.get_doc(
            {"doctype": "User", "name": user, "email": user, "time_zone": "Europe/Paris"}
        ).db_insert()
        self._insert_settings(user, "personal@example.test")
        invitation = frappe.get_doc(
            {
                "doctype": "Mail Account Request",
                "name": "regional-invite",
                "is_verified": 1,
                "suite_user": user,
                "account": "personal@example.test",
                "backup_email": "backup@example.test",
            }
        )
        module = "suite.mail.doctype.mail_account_request.mail_account_request."
        with (
            patch.object(MailAccountRequest, "validate_expired"),
            patch.object(MailAccountRequest, "validate_account"),
            patch.object(MailAccountRequest, "db_set"),
            patch.object(MailAccountRequest, "_surviving", return_value=[]),
            patch(module + "is_suite_cloud_configured"),
            patch(module + "is_jmap_server_configured"),
            patch("suite.suite_core.account_state.read", return_value={"status": "Setup failed"}),
            patch("suite.suite_core.account_state.write"),
            patch.object(account_lifecycle, "provision"),
            patch.object(account_lifecycle, "invalidate_measurements"),
            patch("suite.mail.directory.update_password"),
            patch("suite.mail.directory.set_account_enabled"),
            patch("frappe.utils.get_url", return_value="http://suite.test"),
        ):
            invitation.create_account("Existing", "Person", "password", "en-US", "UTC")
        self.assertEqual(frappe.db.get_value("User", user, "time_zone"), "Europe/Paris")

    def test_retry_does_not_replace_admin_selected_provider_preferences(self) -> None:
        from suite.mail.directory import provision_account

        client = Mock()
        client.call.side_effect = [
            {"description": "Suite setup invite-1", "locale": "fr-FR", "time_zone": "Europe/Paris"},
            None,
            {"app_password": "new-secret"},
        ]
        with patch("suite.mail.directory.get_client", return_value=client):
            result = provision_account(
                "personal@example.test", "password", operation="invite-1", locale="en-US", time_zone="UTC"
            )
        self.assertEqual((result["locale"], result["time_zone"]), ("fr-FR", "Europe/Paris"))
        self.assertEqual(
            [call.args[0] for call in client.call.call_args_list],
            ["mail.accounts.get_account", "mail.accounts.set_password", "mail.accounts.rotate_app_password"],
        )
