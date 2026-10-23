import unittest
from unittest import mock
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from suite.api import account


class AccountTestBase(unittest.TestCase):
    def setUp(self):
        self.frappe = self.enterContext(mock.patch("suite.api.account.frappe"))
        self.frappe.session.user = "alice@example.com"
        self.enterContext(mock.patch("suite.api.account._", side_effect=lambda s: s))
        self.admin = self.enterContext(
            mock.patch("suite.api.account.require_admin", return_value="alice@example.com")
        )
        self.enterContext(mock.patch("suite.suite_core.administration.require_admin", self.admin))
        self.enterContext(mock.patch("suite.suite_core.administration.frappe", self.frappe))
        self.enterContext(mock.patch("suite.suite_core.utils.is_suite_cloud_configured", return_value=False))


class GuardedEndpoints(AccountTestBase):
    def test_denied_business_administration_has_no_side_effect(self):
        self.admin.side_effect = RuntimeError("not allowed")
        endpoints = {
            "mark_onboarded": lambda: account.mark_onboarded(),
            "update_workspace": lambda: account.update_workspace("Acme"),
            "invite_users": lambda: account.invite_users("bob@example.com"),
            "get_users": lambda: account.get_users(),
            "get_pending_invites": lambda: account.get_pending_invites(),
        }
        for name, call in endpoints.items():
            with self.subTest(endpoint=name):
                with self.assertRaises(RuntimeError):
                    call()
        self.frappe.get_all.assert_not_called()
        self.frappe.get_single.assert_not_called()
        self.frappe.db.set_single_value.assert_not_called()


class MarkOnboarded(AccountTestBase):
    def setUp(self):
        super().setUp()
        self.engine = self.enterContext(
            mock.patch("frappe.desk.page.setup_wizard.setup_wizard.complete_app_setup")
        )
        self.suite_wizard = self.enterContext(
            mock.patch("suite.api.account.uses_suite_setup_wizard", return_value=True)
        )
        self.enterContext(mock.patch("suite.api.account.build_setup_args", return_value={"country": "India"}))
        self.frappe.is_setup_complete.return_value = False

    def test_runs_engine_when_suite_is_the_wizard_and_setup_is_open(self):
        account.mark_onboarded(timezone="Asia/Kolkata")
        self.admin.assert_called_once_with()
        self.engine.assert_called_once_with(country="India")
        self.frappe.db.set_single_value.assert_called_once_with("Suite Settings", "is_onboarded", 1)

    def test_skips_engine_unless_suite_wizard_and_setup_open(self):
        for suite_wizard, site_setup_complete in ((True, True), (False, False)):
            with self.subTest(suite_wizard=suite_wizard, site_setup_complete=site_setup_complete):
                self.suite_wizard.return_value = suite_wizard
                self.frappe.is_setup_complete.return_value = site_setup_complete
                account.mark_onboarded(timezone="Asia/Kolkata")
                self.engine.assert_not_called()

    def test_provider_readiness_failure_cannot_mark_a_configured_site_onboarded(self):
        with (
            mock.patch("suite.suite_core.utils.is_suite_cloud_configured", return_value=True),
            mock.patch(
                "suite.composition.admin_onboarding.require_readiness", side_effect=RuntimeError("not ready")
            ),
        ):
            with self.assertRaises(RuntimeError):
                account.mark_onboarded()
        self.engine.assert_not_called()
        self.frappe.db.set_single_value.assert_not_called()


class ValidateWorkspaceLogo(AccountTestBase):
    def setUp(self):
        super().setUp()
        self.frappe.throw.side_effect = RuntimeError

    def test_allows_empty_logo(self):
        account.validate_workspace_logo("")
        self.frappe.throw.assert_not_called()

    def test_allows_public_raster_file_attached_to_suite_settings(self):
        self.frappe.db.get_value.return_value = mock.Mock(
            name="FILE-0001", attached_to_doctype="Suite Settings", attached_to_name="Suite Settings"
        )
        account.validate_workspace_logo("/files/logo.png")
        self.frappe.throw.assert_not_called()

    def test_rejects_paths_outside_public_files(self):
        for logo in ("https://evil.example/logo.png", "/private/files/logo.png"):
            with self.subTest(logo=logo):
                with self.assertRaises(RuntimeError):
                    account.validate_workspace_logo(logo)

    def test_rejects_non_raster_extensions(self):
        with self.assertRaises(RuntimeError):
            account.validate_workspace_logo("/files/logo.svg")

    def test_rejects_missing_files(self):
        self.frappe.db.get_value.return_value = None
        with self.assertRaises(RuntimeError):
            account.validate_workspace_logo("/files/logo.png")

    def test_accepts_the_callers_new_logo_without_granting_settings_write_permission(self):
        self.frappe.db.get_value.return_value = mock.Mock(
            name="FILE-0002", owner="alice@example.com", attached_to_doctype=None, attached_to_name=None
        )
        account.validate_workspace_logo("/files/logo.png")
        self.frappe.db.set_value.assert_called_once()

    def test_cannot_claim_another_users_unattached_public_file(self):
        self.frappe.db.get_value.return_value = mock.Mock(
            name="FILE-0003", owner="bob@example.com", attached_to_doctype=None, attached_to_name=None
        )
        with self.assertRaises(RuntimeError):
            account.validate_workspace_logo("/files/logo.png")
        self.frappe.db.set_value.assert_not_called()


class InviteUsers(AccountTestBase):
    def test_passes_server_derived_roles_and_suite_redirect(self):
        invite = self.enterContext(mock.patch("frappe.core.api.user_invitation.invite_by_email"))
        self.frappe.get_hooks.return_value = {"allowed_roles": {"System Manager": ["Suite User"]}}
        self.frappe.get_roles.return_value = ["System Manager"]
        account.invite_users("bob@example.com")
        invite.assert_called_once_with(
            emails="bob@example.com",
            roles=["Suite User"],
            redirect_to_path="/suite",
            app_name="suite",
        )


class GetUsers(AccountTestBase):
    def test_flags_suite_admins_as_business_admins(self):
        self.frappe.get_all.side_effect = [
            [
                {
                    "name": "alice@example.com",
                    "email": "alice@example.com",
                    "full_name": "Alice",
                    "user_image": None,
                    "enabled": 1,
                },
                {
                    "name": "bob@example.com",
                    "email": "bob@example.com",
                    "full_name": "Bob",
                    "user_image": None,
                    "enabled": 0,
                },
            ],
            ["alice@example.com"],
        ]

        users = account.get_users()

        self.assertEqual([u["is_admin"] for u in users], [True, False])
        self.assertEqual([u["enabled"] for u in users], [True, False])
        self.frappe.get_all.assert_any_call(
            "Has Role", filters={"role": "Suite Admin", "parenttype": "User"}, pluck="parent"
        )


class GetUsersOnSite(IntegrationTestCase):
    def test_lists_members_who_have_no_desk_access(self):
        member = frappe.new_doc("User")
        member.email = f"member-{uuid4().hex[:8]}@example.com"
        member.first_name = "Member"
        member.insert(ignore_permissions=True)
        self.assertEqual(member.user_type, "Website User")

        self.assertIn(member.name, [user["name"] for user in account.get_users()])
