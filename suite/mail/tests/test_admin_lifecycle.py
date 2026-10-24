"""Business account outcomes against an independent provider/JMAP boundary."""

from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, now_datetime
from frappe.utils.password import check_password

from suite import mail
from suite.composition.access import (
    AccountSetupRequired,
    PasswordChangeRequired,
    before_login,
    require_access,
)
from suite.mail.api.account import create_account as accept_invitation
from suite.mail.api.admin import add_member, disable_members, enable_members
from suite.mail.directory import provision_account
from suite.mail.doctype.user_settings.user_settings import UserSettings
from suite.mail.events import update_password
from suite.mail.http.invites import send_invite, update_invite
from suite.suite_core.account_state import read, require_temporary_valid, write
from suite.suite_core.administration import update_user
from suite.tests.utils import ensure_user


def start_session(user: str) -> None:
    sessions = frappe.qb.DocType("Sessions")
    (
        frappe.qb.into(sessions)
        .columns(sessions.user, sessions.sid, sessions.sessiondata, sessions.status)
        .insert(user, uuid4().hex, "{}", "Active")
    ).run()


class Provider:
    """Accounts reject unknown secrets/disabled access; deletion discards all content."""

    def __init__(self):
        self.accounts = {}
        self.emails = []
        self.created = 0
        self.fail = None

    def call(self, method, **args):
        if method == self.fail:
            raise frappe.ValidationError("provider unavailable")
        if method == "tenant.ping":
            return {"limits": {"max_disk_gb": 100}}
        if method == "mail.domains.list_domains":
            return [{"domain": "company.frappe.cloud", "enabled": True, "is_verified": True}]
        if method == "mail.domains.get_domain":
            return {"domain": "company.frappe.cloud", "enabled": True, "is_verified": True}
        if method == "email.send_email":
            self.emails.append(args)
            return {"status": "Sent", "error": None}
        email = args.get("email")
        if method == "mail.accounts.create_account":
            if email in self.accounts:
                raise frappe.DuplicateEntryError
            self.created += 1
            self.accounts[email] = {
                **args,
                "content": [],
                "enabled": True,
                "app_password": f"app-secret-{self.created}",
            }
            return dict(self.accounts[email])
        if email not in self.accounts:
            raise frappe.DoesNotExistError
        account = self.accounts[email]
        if method == "mail.accounts.get_account":
            return dict(account)
        if method == "mail.accounts.set_account_enabled":
            account["enabled"] = args["enabled"]
            return dict(account)
        if method == "mail.accounts.set_password":
            account["password"] = args["password"]
            return None
        if method == "mail.accounts.rotate_app_password":
            account["app_password"] += "-rotated"
            return {"app_password": account["app_password"]}
        if method == "mail.accounts.delete_account":
            del self.accounts[email]
            return None
        raise AssertionError(method)

    def authenticates(self, address, password):
        account = self.accounts.get(address, {})
        return bool(account.get("enabled") and account.get("password") == password)


class TestAdminLifecycle(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.provider = Provider()
        for target in (
            "suite.mail.directory.get_client",
            "suite.mail.account_lifecycle.get_client",
            "suite.mail.suite_cloud.get_client",
        ):
            self.enterContext(patch(target, return_value=self.provider))
        for target in (
            "suite.mail.api.admin.is_suite_cloud_configured",
            "suite.mail.doctype.mail_account_request.mail_account_request.is_suite_cloud_configured",
            "suite.suite_core.utils.is_suite_cloud_configured",
            "suite.composition.access.is_suite_cloud_configured",
        ):
            self.enterContext(patch(target, return_value=True))
        self.enterContext(
            patch(
                "suite.mail.doctype.mail_account_request.mail_account_request.is_jmap_server_configured",
                return_value=True,
            )
        )
        # These are the network adapter: the real Document and credentials are
        # still saved. Account setup/roles/root/access policy are not mocked.
        self.enterContext(patch.object(UserSettings, "validate_jmap_settings"))
        self.enterContext(patch.object(UserSettings, "on_update"))
        self.enterContext(patch("suite.mail.provider_health", return_value={"suspended": False}))
        self.enterContext(patch("suite.mail.events.is_suite_cloud_configured", return_value=True))
        self.username = f"employee-{frappe.generate_hash(length=8)}"
        self.address = f"{self.username}@company.frappe.cloud"

    def create(self):
        return add_member(self.username, "company.frappe.cloud", False, False, "", first_name="Employee")

    def test_direct_creation_returns_a_suite_only_secret_and_blocks_normal_access(self):
        result = self.create()
        self.assertTrue(result["success"], result)
        user = result["user"]
        self.assertEqual(check_password(user, result["temporary_password"]), user)
        self.assertFalse(self.provider.authenticates(self.address, result["temporary_password"]))
        self.assertFalse(self.provider.accounts[self.address]["enabled"])
        self.assertTrue(read(user)["must_change_password"])
        self.assertGreater(read(user)["temporary_expires_at"], now_datetime())
        with self.set_user(user):
            with self.assertRaises(PasswordChangeRequired):
                require_access(user, method="suite.mail.api.mail.get_threads")
            require_access(user, method="frappe.core.doctype.user.user.update_password")

    def test_replacement_invalidates_predecessor_and_expiry_blocks_login(self):
        first = self.create()
        second = mail.administer_account("replace_temporary", user=first["user"])
        with self.assertRaises(frappe.AuthenticationError):
            check_password(first["user"], first["temporary_password"])
        self.assertEqual(check_password(first["user"], second["temporary_password"]), first["user"])
        write(first["user"], temporary_expires_at=add_to_date(now_datetime(), days=-1))
        with self.assertRaises(frappe.AuthenticationError):
            require_temporary_valid(first["user"])

    def test_uncertain_setup_retries_its_own_account_without_duplicate_creation(self):
        self.provider.fail = "mail.accounts.set_account_enabled"
        first = self.create()
        self.assertFalse(first["success"])
        self.assertEqual(read(self.address)["status"], "Setup failed")
        with self.assertRaises(AccountSetupRequired):
            require_access(self.address)
        self.provider.fail = None
        retry = self.create()
        self.assertTrue(retry["success"], retry)
        self.assertEqual(self.provider.created, 1)

    def test_failed_provisioning_retry_keeps_the_creation_time_cap_snapshot(self):
        from suite.suite_core.storage import set_default, state

        set_default(4_000_000_000)
        self.provider.fail = "mail.accounts.set_account_enabled"
        first = self.create()
        self.assertFalse(first["success"])
        set_default(6_000_000_000)
        self.provider.fail = None
        retry = self.create()
        self.assertTrue(retry["success"], retry)
        _doc, policy, _measurements = state()
        self.assertEqual(policy["users"][retry["user"]]["cap"], 4_000_000_000)

    def test_an_edited_pending_invitation_cap_is_persisted_before_failed_setup(self):
        from suite.mail.utils.dt import to_utc_z
        from suite.suite_core.storage import set_default, state

        set_default(4_000_000_000)
        add_member(self.username, "company.frappe.cloud", False, True, "contact@example.test")
        name = frappe.db.get_value("Mail Account Request", {"account": self.address}, "name")
        request = frappe.get_doc("Mail Account Request", name)
        update_invite(name, to_utc_z(request.expires_at), 5_000_000_000)
        request.reload()
        set_default(6_000_000_000)
        self.provider.fail = "mail.accounts.set_account_enabled"
        frappe.db.savepoint("failed_invitation_acceptance")
        with self.set_user("Guest"), self.assertRaises(frappe.ValidationError):
            accept_invitation(request.request_key, "Employee", "", "Chosen-invite-passphrase-55!")
        # Failed HTTP acceptance rolls back locally; a workflow caller which
        # retains setup progress must already have the invitation's policy.
        _doc, policy, _measurements = state()
        self.assertEqual(policy["users"][self.address]["cap"], 5_000_000_000)
        frappe.db.rollback(save_point="failed_invitation_acceptance")
        self.assertFalse(frappe.db.exists("User", self.address))
        self.provider.fail = None
        with self.set_user("Guest"):
            accept_invitation(request.request_key, "Employee", "", "Chosen-invite-passphrase-55!")
        _doc, policy, _measurements = state()
        self.assertEqual(policy["users"][self.address]["cap"], 5_000_000_000)
        self.assertEqual(self.provider.created, 1)

    def test_another_operation_cannot_claim_or_delete_an_existing_provider_account(self):
        self.provider.accounts[self.address] = {
            "email": self.address,
            "description": "other owner",
            "content": ["retained"],
        }
        with self.assertRaises(frappe.ValidationError):
            provision_account(self.address, "unused", operation="different")
        self.assertEqual(self.provider.accounts[self.address]["content"], ["retained"])

    def test_deletion_and_address_reuse_preserve_the_old_identity_and_root(self):
        first = self.create()
        old_user = first["user"]
        root = frappe.db.get_value("Drive Root", {"user": old_user, "kind": "Personal"}, "name")
        update_user(old_user, enabled=False)
        deleted = mail.administer_account("delete", user=old_user, confirmation=self.address)
        self.assertTrue(deleted["success"], deleted)
        second = self.create()
        self.assertTrue(second["success"], second)
        self.assertNotEqual(second["user"], old_user)
        self.assertEqual(self.provider.accounts[self.address]["content"], [])
        self.assertEqual(frappe.db.get_value("User", old_user, "enabled"), 0)
        self.assertTrue(frappe.db.exists("Drive Root", root))
        old_form = frappe.local.form_dict
        try:
            frappe.local.form_dict = frappe._dict(usr=self.address)
            before_login(None)
            self.assertEqual(frappe.form_dict.usr, second["user"])
        finally:
            frappe.local.form_dict = old_form

    def test_recreation_leaves_user_disabled_and_failed_deletion_blocks_reuse(self):
        first = self.create()
        update_user(first["user"], enabled=False)
        self.provider.fail = "mail.accounts.delete_account"
        failed = mail.administer_account("delete", user=first["user"], confirmation=self.address)
        self.assertFalse(failed["success"])
        with self.assertRaises(frappe.ValidationError):
            mail.administer_account("recreate", user=first["user"], address=self.address)
        self.provider.fail = None
        self.assertTrue(
            mail.administer_account("delete", user=first["user"], confirmation=self.address)["success"]
        )
        result = mail.administer_account("recreate", user=first["user"], address=self.address)
        self.assertTrue(result["success"], result)
        self.assertEqual(frappe.db.get_value("User", first["user"], "enabled"), 0)

    def test_normal_user_cannot_issue_credentials_or_recreate_or_delete_mail(self):
        normal = f"normal-{frappe.generate_hash(length=8)}@example.test"
        ensure_user(normal)
        with self.set_user(normal):
            for action, arguments in (
                ("replace_temporary", {"user": normal}),
                ("recreate", {"user": normal, "address": self.address}),
                ("delete", {"user": normal, "confirmation": self.address}),
                ("onboarding_options", {}),
            ):
                with self.subTest(action=action), self.assertRaises(frappe.PermissionError):
                    mail.administer_account(action, **arguments)

    def test_bulk_disabling_keeps_successes_and_returns_safe_failed_target_outcomes(self):
        first = self.create()
        self.username += "-second"
        second = self.create()
        call = self.provider.call

        def provider_failure(method, **args):
            if method == "mail.accounts.set_account_enabled" and args.get("email") == first["user"]:
                raise RuntimeError("provider credential secret-do-not-disclose")
            return call(method, **args)

        with patch.object(self.provider, "call", side_effect=provider_failure):
            results = disable_members([second["user"], first["user"]])
        self.assertEqual([row["success"] for row in results], [True, False])
        self.assertNotIn("secret-do-not-disclose", results[1]["error"])
        self.assertIsNone(results[0]["error"])
        self.assertEqual(frappe.db.get_value("User", first["user"], "enabled"), 1)
        self.assertEqual(frappe.db.get_value("User", second["user"], "enabled"), 0)
        self.assertTrue(disable_members([first["user"]])[0]["success"])

    def test_disabling_ends_only_that_users_sessions_and_keeps_their_mailbox(self):
        disabled = self.create()["user"]
        self.username += "-second"
        kept = self.create()["user"]
        for user in (disabled, kept):
            start_session(user)
        self.provider.accounts[self.address]["enabled"] = True

        self.assertTrue(disable_members([disabled])[0]["success"])

        self.assertEqual(frappe.db.count("Sessions", {"user": disabled}), 0)
        self.assertEqual(frappe.db.count("Sessions", {"user": kept}), 1)
        self.assertFalse(self.provider.accounts[self.address]["enabled"])
        self.assertIn(self.address, self.provider.accounts)

    def test_bulk_reactivation_preserves_disabled_failed_setup_and_enables_ready_users(self):
        first = self.create()
        self.username += "-second"
        second = self.create()
        disable_members([first["user"], second["user"]])
        write(first["user"], status="Setup failed")
        results = enable_members([first["user"], second["user"]])
        self.assertEqual([row["success"] for row in results], [False, True])
        self.assertEqual(frappe.db.get_value("User", first["user"], "enabled"), 0)
        self.assertEqual(frappe.db.get_value("User", second["user"], "enabled"), 1)

    def test_bulk_disabling_reports_self_disable_without_discarding_another_users_success(self):
        admin = add_member(self.username, "company.frappe.cloud", True, False, "", first_name="Admin")
        self.username += "-second"
        normal = self.create()
        with self.set_user(admin["user"]):
            results = disable_members([normal["user"], admin["user"]])
        self.assertEqual([row["success"] for row in results], [True, False])
        self.assertEqual(frappe.db.get_value("User", admin["user"], "enabled"), 1)
        self.assertEqual(frappe.db.get_value("User", normal["user"], "enabled"), 0)

    def test_bulk_disabling_cannot_remove_the_last_active_admin(self):
        first = add_member(self.username, "company.frappe.cloud", True, False, "", first_name="Admin")
        self.username += "-second"
        second = add_member(self.username, "company.frappe.cloud", True, False, "", first_name="Admin")
        frappe.db.delete(
            "Has Role", {"role": "Suite Admin", "parent": ["not in", [first["user"], second["user"]]]}
        )
        results = disable_members([first["user"], second["user"]])
        self.assertEqual([row["success"] for row in results], [True, False])
        self.assertEqual(frappe.db.get_value("User", second["user"], "enabled"), 1)

    def test_first_password_change_enables_mail_but_cannot_reuse_the_temporary_password(self):
        created = self.create()
        user = created["user"]
        permanent = "Unique-permanent-passphrase-43!"
        with (
            self.set_user(user),
            patch.object(
                frappe.local, "login_manager", SimpleNamespace(check_password=check_password), create=True
            ),
        ):
            with self.assertRaises(frappe.ValidationError):
                update_password(created["temporary_password"], old_password=created["temporary_password"])
            update_password(permanent, old_password=created["temporary_password"])
            require_access(user)
        self.assertFalse(read(user)["must_change_password"])
        self.assertEqual(check_password(user, permanent), user)
        self.assertTrue(self.provider.authenticates(self.address, permanent))

    def test_an_invitation_sent_to_contact_email_uses_a_snapshot_and_replaces_old_links(self):
        from suite.mail.utils.dt import to_utc_z
        from suite.suite_core.storage import set_default

        set_default(4_000_000_000)
        result = add_member(self.username, "company.frappe.cloud", False, True, "contact@example.test")
        self.assertTrue(result["success"])
        self.assertEqual(len(self.provider.emails), 1)
        name = frappe.db.get_value("Mail Account Request", {"account": self.address}, "name")
        request = frappe.get_doc("Mail Account Request", name)
        old_key = request.request_key
        first_email = self.provider.emails[0]
        self.assertEqual(first_email["email_type"], "account-invite")
        self.assertEqual(first_email["recipient"], "contact@example.test")
        self.assertTrue(first_email["params"]["link"].endswith(f"/mail/signup/{old_key}"))

        set_default(6_000_000_000)
        self.assertEqual(request.combined_cap_bytes, 4_000_000_000)
        update_invite(name, to_utc_z(request.expires_at), 5_000_000_000, is_admin=True)
        request.reload()
        self.assertNotEqual(request.request_key, old_key)
        replaced = request.request_key
        send_invite(name)
        request.reload()
        self.assertNotEqual(request.request_key, replaced)
        self.assertEqual(len(self.provider.emails), 2)
        resent_email = self.provider.emails[1]
        self.assertEqual(resent_email["email_type"], "account-invite")
        self.assertEqual(resent_email["recipient"], "contact@example.test")
        self.assertTrue(resent_email["params"]["link"].endswith(f"/mail/signup/{request.request_key}"))
        with self.set_user("Guest"):
            with self.assertRaises(frappe.DoesNotExistError):
                accept_invitation(old_key, "Employee", "", "Chosen-invite-passphrase-55!")
            accept_invitation(request.request_key, "Employee", "", "Chosen-invite-passphrase-55!")
            with self.assertRaises(frappe.ValidationError):
                accept_invitation(request.request_key, "Employee", "", "Different-password-55!")
        self.assertTrue(self.provider.authenticates(self.address, "Chosen-invite-passphrase-55!"))
        self.assertFalse(read(self.address)["must_change_password"])
        self.assertIn("Suite Admin", frappe.get_roles(self.address))

    def test_supplied_domain_onboarding_requires_no_customer_dns_and_preserves_business_identity(self):
        frappe.db.set_single_value("Suite Settings", "is_onboarded", 0)
        admin = f"first-admin-{frappe.generate_hash(length=8)}@contact.example.test"
        ensure_user(admin)
        frappe.get_doc("User", admin).add_roles("Suite Admin")
        with self.set_user(admin):
            options = mail.administer_account("onboarding_options")
            self.assertEqual(options["domains"], ["company.frappe.cloud"])
            result = mail.administer_account(
                "onboard", address=self.address, password="Chosen-business-passphrase-77!"
            )
            self.assertTrue(result["success"], result)
            self.assertEqual(frappe.session.user, admin)
            self.assertEqual(mail.administer_account("onboarding_options")["account"], self.address)
        self.assertTrue(frappe.db.exists("User", admin))
        self.assertEqual(self.provider.created, 1)
