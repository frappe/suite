"""Business account outcomes against an independent provider/JMAP boundary."""

import json
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase
from frappe.tests.utils import change_settings
from frappe.utils import add_to_date, now_datetime
from frappe.utils.password import check_password

from suite import mail
from suite.composition.access import (
    AccountSetupRequired,
    PasswordChangeRequired,
    before_login,
    require_access,
)
from suite.mail.account_lifecycle import invalidate_measurements
from suite.mail.api.account import create_account as accept_invitation
from suite.mail.api.account import get_account_request, set_reset_password_key
from suite.mail.api.admin import (
    add_member,
    disable_members,
    enable_members,
    get_account_requests,
    remove_failed_creation,
    retry_account_creation,
)
from suite.mail.directory import provision_account
from suite.mail.doctype.user_settings.user_settings import UserSettings
from suite.mail.events import update_password
from suite.mail.http.invites import send_invite, update_invite
from suite.suite_core.account_state import read, require_temporary_valid, write
from suite.suite_core.administration import update_user
from suite.suite_core.storage import (
    check_addition,
    initialize_user_limit,
    personal_mail_usage,
    state,
    update_limits,
)
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
        self.used_bytes = {}

    def call(self, method, **args):
        # Refusals come back like the real client's: thrown, so each leaves a message behind.
        if method == self.fail:
            frappe.throw("The mail server did not accept the change: Invalid value for enum type Locale.")
        if method == "tenant.ping":
            return {"limits": {"max_disk_gb": 100}}
        if method == "mail.domains.list_domains":
            return [{"domain": "company.frappe.cloud", "enabled": True, "is_verified": True}]
        if method == "mail.domains.get_domain":
            return {"domain": "company.frappe.cloud", "enabled": True, "is_verified": True}
        if method == "email.send_email":
            self.emails.append(args)
            return {"status": "Sent", "error": None}
        if method == "mail.meta.get_account_options":
            return {
                "locales": [{"value": "en-US", "label": "English"}],
                "time_zones": [{"value": "UTC", "label": "UTC"}],
            }
        if method == "mail.accounts.list_accounts":
            emails = list(self.accounts)[args["start"] : args["start"] + args["limit"]]
            return {"items": [{"email": email} for email in emails], "total": len(self.accounts)}
        if method == "mail.groups.list_groups":
            return {"items": [], "total": 0}
        if method == "mail.accounts.get_quotas":
            return {email: {"used_disk_bytes": self.used_bytes.get(email, 0)} for email in args["emails"]}
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
            frappe.throw(f"Account {email} was not found.", frappe.DoesNotExistError)
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
            if not account["enabled"]:  # minting signs in as the account
                frappe.throw("The mail server did not accept Suite Cloud's credentials.")
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
            "suite.mail.storage.get_client",
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
            require_access(self.address, method="suite.mail.http.routes.inbox_summary")
        self.provider.fail = None
        retry = self.create()
        self.assertTrue(retry["success"], retry)
        self.assertEqual(self.provider.created, 1)

    def test_a_changed_mailbox_blocks_additions_until_the_next_refresh(self):
        from suite.mail.account_lifecycle import invalidate_measurements
        from suite.suite_core.storage import check_addition, state

        result = self.create()
        doc, _policy, _measurements = state(lock=True)
        doc.measurements = json.dumps({"allowance": 100, "site_mail": 0, "personal": {result["user"]: 0}})
        doc.save(ignore_permissions=True)
        invalidate_measurements(result["user"], self.address)

        _doc, policy, measurements = state()
        measurements["site_mail"] = 0
        addition = {"site_drive": 0, "personal_drive": 0, "delta": 1}
        with self.assertRaisesRegex(frappe.ValidationError, "Mail usage is unavailable"):
            check_addition(policy, measurements, user=result["user"], **addition)
        # Everyone the refresh did not list still has no mailbox, so nothing to wait for.
        check_addition(policy, measurements, user="no-mailbox@example.test", **addition)

    def commit_and_run_jobs(self):
        """Stand in for the commit and a worker: run the after-commit pushes, then the jobs they queued."""
        queued = []
        with patch("frappe.enqueue", side_effect=lambda method, **_options: queued.append(method)):
            frappe.db.after_commit.run()
        for method in queued:
            frappe.get_attr(method)()

    def test_a_new_member_can_add_drive_files_as_soon_as_the_change_is_committed(self):
        from suite import drive

        mail.refresh_storage()
        self.provider.used_bytes[self.address] = 300
        user = self.create()["user"]
        self.commit_and_run_jobs()

        root = drive.personal_root_for(user) or drive.ensure_personal_root(user)
        with self.set_user(user):
            drive.store_file(root, "first-day.txt", BytesIO(b"uploaded right after joining"))
        _doc, _policy, measurements = state()
        self.assertEqual(measurements["personal"][user], 300)

    def test_the_measured_mailbox_still_counts_against_a_new_members_cap(self):
        from suite import drive

        mail.refresh_storage()
        self.provider.used_bytes[self.address] = 10_900
        user = self.create()["user"]
        update_limits([user], 10_000)
        self.commit_and_run_jobs()

        root = drive.personal_root_for(user) or drive.ensure_personal_root(user)
        with self.set_user(user), self.assertRaisesRegex(drive.DriveOverQuota, "user's storage cap"):
            drive.store_file(root, "too-big.txt", BytesIO(b"x" * 200))

    def test_a_refresh_that_cannot_be_queued_keeps_the_change_and_leaves_additions_to_the_hourly_refresh(
        self,
    ):
        from suite import drive
        from suite.composition.admin_jobs import refresh_storage

        mail.refresh_storage()
        user = self.create()["user"]
        with patch("frappe.enqueue", side_effect=RuntimeError("redis down")) as enqueue:
            frappe.db.after_commit.run()
        self.assertTrue(enqueue.called)

        self.assertEqual(frappe.db.get_value("User Settings", {"user": user}, "username"), self.address)
        self.assertIn(self.address, self.provider.accounts)
        root = drive.personal_root_for(user) or drive.ensure_personal_root(user)
        with self.set_user(user), self.assertRaisesRegex(frappe.ValidationError, "unavailable"):
            drive.store_file(root, "too-soon.txt", BytesIO(b"usage is unknown"))

        with patch("suite.composition.admin_jobs.is_suite_cloud_configured", return_value=True):
            refresh_storage()
        with self.set_user(user):
            drive.store_file(root, "after-the-hour.txt", BytesIO(b"usage is known"))

    def test_a_locked_save_keeps_what_a_worker_committed_after_this_transaction_began(self):
        self.use_committed_storage_row()

        _doc, _policy, before = state()  # opens this transaction's snapshot
        self.assertNotIn("from_worker", before)
        with self.secondary_connection():
            frappe.db.set_value(
                "Suite Storage State", "site", "measurements", json.dumps({**before, "from_worker": 1})
            )
            frappe.db.commit()
        _doc, _policy, snapshot = state()
        self.assertNotIn("from_worker", snapshot)  # a plain read here cannot see the worker's update

        doc, _policy, latest = state(lock=True)
        doc.measurements = json.dumps({**latest, "from_this_save": 1})
        doc.save(ignore_permissions=True)

        _doc, _policy, saved = state()
        self.assertEqual((saved.get("from_worker"), saved.get("from_this_save")), (1, 1))

    def test_a_drive_addition_can_lock_the_storage_row_during_every_provider_call_of_a_refresh(self):
        self.use_committed_storage_row()
        self.commit_unknown_usage()
        attempts, refusals = [], []

        def try_to_lock():
            attempts.append(1)
            with self.secondary_connection():
                try:
                    frappe.db.sql(
                        "SELECT name FROM `tabSuite Storage State` WHERE name = 'site' FOR UPDATE NOWAIT"
                    )
                except Exception as error:  # the refresh would swallow it as a provider failure
                    refusals.append(error)
                finally:
                    frappe.db.rollback()

        with self.before_each_provider_call(try_to_lock):
            mail.refresh_storage()

        self.assertTrue(attempts)
        self.assertEqual(refusals, [])

    def test_a_mailbox_change_committed_during_a_refresh_keeps_additions_paused_until_the_next_one(self):
        self.use_committed_storage_row()
        self.commit_unknown_usage()
        holder = "changed-during-refresh@example.test"

        with self.before_each_provider_call(
            lambda: self.once_from_another_connection(
                lambda: invalidate_measurements(holder, "changed-during-refresh@company.frappe.cloud")
            )
        ):
            mail.refresh_storage()
        frappe.db.commit()

        self.assertEqual(self.errors_from_another_connection, [])
        _doc, _policy, measurements = state()
        self.assertIsNone(personal_mail_usage(measurements, holder))
        self.assert_additions_paused()

        mail.refresh_storage()
        frappe.db.commit()
        self.assert_additions_admitted()

    def test_a_cap_saved_during_a_refresh_queues_another_refresh_that_ends_the_pause(self):
        self.use_committed_storage_row()
        self.commit_unknown_usage()
        capped = "capped-during-refresh@example.test"

        with self.before_each_provider_call(
            lambda: self.once_from_another_connection(
                lambda: initialize_user_limit(capped, cap=5, use_default=False)
            )
        ):
            mail.refresh_storage()
        frappe.db.commit()

        self.assertEqual(self.errors_from_another_connection, [])
        self.assert_additions_paused()
        self.assertEqual(self.queued, ["suite.mail.storage.refresh"])

        frappe.get_attr(self.queued.pop())()
        frappe.db.commit()
        self.assert_additions_admitted()
        self.assertEqual(state()[1]["users"][capped], {"cap": 5})
        self.assertEqual(self.queued, [])  # a refresh nothing raced with queues no other

    def test_a_refresh_nothing_raced_with_saves_its_measurements_and_ends_the_pause(self):
        self.use_committed_storage_row()
        self.provider.accounts[self.address] = {"enabled": True}
        self.provider.used_bytes[self.address] = 300
        self.commit_unknown_usage()
        self.assert_additions_paused()

        mail.refresh_storage()
        frappe.db.commit()

        _doc, _policy, measurements = state()
        self.assertEqual(measurements["site_mail"], 300)
        self.assertEqual(measurements["allowance"], 100_000_000_000)
        self.assert_additions_admitted()
        self.assertEqual(self.queued, [])

    def use_committed_storage_row(self):
        """Let a test commit the storage row from two connections, and undo that afterwards.

        Refresh jobs are collected in `queued`: a real worker would write to the row mid-test.
        """
        frappe.db.rollback()  # the row commits below, and earlier tests' writes must not commit with it
        original = frappe.db.get_value(
            "Suite Storage State", "site", ["policy", "measurements", "modified"], as_dict=True
        )
        self.addCleanup(self.restore_storage_state, original)
        self.queued = []
        self.enterContext(
            patch("frappe.enqueue", side_effect=lambda method, **_options: self.queued.append(method))
        )
        state()
        frappe.db.commit()
        with self.secondary_connection():  # the helper's first use leaves its new connection current
            frappe.db.sql("SET SESSION innodb_lock_wait_timeout = 1")  # a blocked write fails fast
        frappe.local.db = self._primary_connection
        self.errors_from_another_connection = []
        self.ran_from_another_connection = False

    def commit_unknown_usage(self):
        frappe.db.set_value("Suite Storage State", "site", "measurements", "{}")
        mail.refresh_storage()
        invalidate_measurements("earlier-change@example.test", "earlier-change@company.frappe.cloud")
        frappe.db.commit()
        self.queued.clear()

    def before_each_provider_call(self, action):
        call = self.provider.call

        def act_then_call(method, **args):
            action()
            return call(method, **args)

        return patch.object(self.provider, "call", act_then_call)

    def once_from_another_connection(self, change):
        """Commit one change as another request would. The refresh would swallow its failure, so note it."""
        if self.ran_from_another_connection:
            return
        self.ran_from_another_connection = True
        with self.secondary_connection():
            try:
                change()
                frappe.db.commit()
            except Exception as error:
                self.errors_from_another_connection.append(error)
                frappe.db.rollback()

    def assert_additions_paused(self):
        _doc, policy, measurements = state()
        with self.assertRaisesRegex(frappe.ValidationError, "unavailable"):
            check_addition(policy, measurements, user=None, site_drive=0, personal_drive=0, delta=1)

    def assert_additions_admitted(self):
        _doc, policy, measurements = state()
        check_addition(policy, measurements, user=None, site_drive=0, personal_drive=0, delta=1)

    def restore_storage_state(self, original):
        """Undo what the test committed. Runs after the rollback that releases the row's lock."""
        frappe.db.rollback()
        if original:
            frappe.db.set_value("Suite Storage State", "site", original, update_modified=False)
        else:
            frappe.db.delete("Suite Storage State", {"name": "site"})
        frappe.db.commit()
        self._secondary_connection.close()

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

    def test_a_weak_password_is_refused_before_setup_and_leaves_the_invitation_open(self):
        from suite.mail.account_setup import AccountSetupFailed

        self.enterContext(
            change_settings("System Settings", enable_password_policy=1, minimum_password_score=2)
        )
        add_member(self.username, "company.frappe.cloud", False, True, "contact@example.test")
        key = frappe.db.get_value("Mail Account Request", {"account": self.address}, "request_key")
        with self.set_user("Guest"), self.assertRaises(frappe.ValidationError) as refused:
            accept_invitation(key, "Employee", "", "abcabcabc")
        # A plain refusal, which the form shows, not a setup stage that failed.
        self.assertNotIsInstance(refused.exception, AccountSetupFailed)
        self.assertEqual(self.provider.created, 0)
        with self.set_user("Guest"):
            accept_invitation(key, "Employee", "", "Chosen-invite-passphrase-55!")
        self.assertTrue(frappe.db.exists("User", self.address))

    def failed_creation(self):
        frappe.clear_messages()
        self.provider.fail = "mail.accounts.create_account"
        result = self.create()
        self.provider.fail = None
        return result, frappe.db.get_value("Mail Account Request", {"account": self.address}, "name")

    def test_a_failed_direct_creation_reports_its_reason_and_is_listed_under_failed(self):
        result, name = self.failed_creation()
        self.assertFalse(result["success"])
        self.assertIn("did not accept the change", result["error"])
        printed = " ".join(str(m) for m in frappe.local.message_log)
        self.assertNotIn("was not found", printed)
        self.assertNotIn("did not accept", printed)  # it travels in `error`, not as a toast
        logged = frappe.get_all("Error Log", pluck="method", order_by="creation desc", limit=5)
        self.assertIn(f"[Mail] Account setup failed for {self.address}", logged)
        self.assertIn(name, [r["name"] for r in get_account_requests(search=self.username)["items"]])
        self.assertEqual(get_account_requests(search=self.username, status="Pending")["items"], [])
        failed = get_account_requests(search=self.username, status="Setup failed")["items"]
        self.assertEqual([(r["name"], r["status"]) for r in failed], [(name, "Setup failed")])

    def test_a_failed_direct_creation_can_be_retried_into_one_account(self):
        _result, name = self.failed_creation()
        retried = retry_account_creation(name)
        self.assertTrue(retried["success"], retried)
        self.assertTrue(retried["temporary_password"])
        self.assertEqual(self.provider.created, 1)
        self.assertEqual(frappe.db.get_value("User", retried["user"], "first_name"), "Employee")
        self.assertEqual(get_account_requests(search=self.username, status="Setup failed")["items"], [])

    def test_a_retry_after_an_early_failure_keeps_what_the_admin_chose(self):
        # Fails before any Suite user exists, the case nothing else can recover the choices from.
        with patch(
            "suite.mail.doctype.mail_account_request.mail_account_request.is_jmap_server_configured",
            side_effect=frappe.ValidationError("The JMAP server is not configured."),
        ):
            result = add_member(
                self.username,
                "company.frappe.cloud",
                False,
                False,
                "",
                first_name="Nisha",
                last_name="Patel",
                locale="en-US",
                time_zone="Asia/Kolkata",
            )
        self.assertFalse(result["success"], result)
        self.assertFalse(frappe.db.exists("User", self.address))
        name = frappe.db.get_value("Mail Account Request", {"account": self.address}, "name")
        listed = get_account_requests(search=self.username, status="Setup failed")["items"]
        self.assertEqual([row["name"] for row in listed], [name])

        retried = retry_account_creation(name)

        self.assertTrue(retried["success"], retried)
        user = frappe.db.get_value("User", retried["user"], ["first_name", "last_name", "time_zone"])
        self.assertEqual(user, ("Nisha", "Patel", "Asia/Kolkata"))
        account = self.provider.accounts[self.address]
        self.assertEqual((account.get("locale"), account.get("time_zone")), ("en-US", "Asia/Kolkata"))

    def test_a_creation_that_failed_after_locking_its_account_can_be_retried(self):
        self.provider.fail = "mail.accounts.set_account_enabled"
        self.assertFalse(self.create()["success"])
        self.provider.fail = None
        self.provider.accounts[self.address]["enabled"] = False  # locked, as a later failure leaves it
        name = frappe.db.get_value("Mail Account Request", {"account": self.address}, "name")
        retried = retry_account_creation(name)
        self.assertTrue(retried["success"], retried)
        self.assertEqual(self.provider.created, 1)
        self.assertFalse(self.provider.accounts[self.address]["enabled"])  # locked until the password change

    def test_removing_a_failed_creation_deletes_its_user_request_and_own_account_only(self):
        self.provider.fail = "mail.accounts.set_account_enabled"  # after the account was made
        self.assertFalse(self.create()["success"])
        self.provider.fail = None
        name = frappe.db.get_value("Mail Account Request", {"account": self.address}, "name")
        user = frappe.db.get_value("Mail Account Request", name, "suite_user")
        self.assertIn(self.address, self.provider.accounts)
        remove_failed_creation(name)
        self.assertNotIn(self.address, self.provider.accounts)
        self.assertFalse(frappe.db.exists("Mail Account Request", name))
        self.assertFalse(frappe.db.exists("User", user))

        # An account at the address that this creation did not make stays.
        _result, name = self.failed_creation()
        self.provider.accounts[self.address] = {"email": self.address, "description": "other owner"}
        remove_failed_creation(name)
        self.assertIn(self.address, self.provider.accounts)

    def test_an_invitation_cannot_be_removed_as_a_failed_creation(self):
        with patch("frappe.sendmail"):
            add_member(self.username, "company.frappe.cloud", False, True, "contact@example.test")
        name = frappe.db.get_value("Mail Account Request", {"account": self.address}, "name")
        with self.assertRaises(frappe.ValidationError):
            remove_failed_creation(name)
        self.assertTrue(frappe.db.exists("Mail Account Request", name))

    def test_direct_creation_needs_a_first_name(self):
        with self.assertRaises(frappe.ValidationError):
            add_member(self.username, "company.frappe.cloud", False, False, "", first_name=" ")
        self.assertFalse(frappe.db.exists("Mail Account Request", {"account": self.address}))

    def test_a_refused_acceptance_shows_the_real_reason_not_the_lookup(self):
        with patch("frappe.sendmail"):
            add_member(self.username, "company.frappe.cloud", False, True, "contact@example.test")
        key = frappe.db.get_value("Mail Account Request", {"account": self.address}, "request_key")
        self.provider.fail = "mail.accounts.create_account"
        frappe.clear_messages()
        with self.set_user("Guest"), self.assertRaises(frappe.ValidationError):
            accept_invitation(key, "Priya", "", "Chosen-invite-passphrase-55!")
        printed = " ".join(str(m) for m in frappe.local.message_log)
        self.assertIn("did not accept the change", printed)
        self.assertNotIn("was not found", printed)

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

    def test_an_expired_reset_link_cannot_replace_a_temporary_password(self):
        created = self.create()
        user = created["user"]
        expiry = frappe.db.get_single_value("System Settings", "reset_password_link_expiry_duration")
        self.addCleanup(
            frappe.db.set_single_value, "System Settings", "reset_password_link_expiry_duration", expiry
        )
        frappe.db.set_single_value("System Settings", "reset_password_link_expiry_duration", 60)
        key = set_reset_password_key(user)
        frappe.db.set_value("User", user, "last_reset_password_key_generated_on", "2000-01-01 00:00:00")

        with self.set_user("Guest"):
            self.assertEqual(
                update_password("Unique-permanent-passphrase-43!", key=key),
                "The reset password link has been expired",
            )
        self.assertTrue(read(user)["must_change_password"])
        self.assertEqual(check_password(user, created["temporary_password"]), user)

    def test_an_invitation_gives_the_provider_the_workspace_and_inviter(self):
        frappe.db.set_single_value("Suite Settings", "workspace_name", "Acme")
        frappe.db.set_single_value("Suite Settings", "workspace_logo", "/files/acme.png")
        add_member(self.username, "company.frappe.cloud", False, True, "contact@example.test")

        params = self.provider.emails[-1]["params"]
        self.assertEqual(params["workspace_name"], "Acme")
        self.assertTrue(params["workspace_logo"].endswith("/files/acme.png"))
        self.assertTrue(params["workspace_logo"].startswith("http"))
        self.assertEqual(params["invited_by_name"], frappe.utils.get_fullname(frappe.session.user))

    def test_the_invitation_email_escapes_workspace_and_inviter_names(self):
        html = frappe.get_template("templates/emails/account_invitation.html").render(
            workspace_name="<b>Acme</b>",
            logo_embed="logo.png",
            heading="<i>Sam</i> invited you",
            description="",
            link="https://example.test",
            button="Accept",
            note="",
            footer="Sent for <u>Acme</u>",
        )
        self.assertNotIn("<b>Acme", html)
        self.assertNotIn("<i>Sam", html)
        self.assertNotIn("<u>Acme", html)
        self.assertIn("&lt;b&gt;Acme", html)

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
        self.assertTrue(first_email["params"]["link"].endswith(f"/join/{old_key}"))

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
        self.assertTrue(resent_email["params"]["link"].endswith(f"/join/{request.request_key}"))
        with self.set_user("Guest"):
            with self.assertRaises(frappe.DoesNotExistError):
                accept_invitation(old_key, "Employee", "", "Chosen-invite-passphrase-55!")
            accept_invitation(request.request_key, "Employee", "", "Chosen-invite-passphrase-55!")
            with self.assertRaises(frappe.ValidationError):
                accept_invitation(request.request_key, "Employee", "", "Different-password-55!")
        self.assertTrue(self.provider.authenticates(self.address, "Chosen-invite-passphrase-55!"))
        self.assertFalse(read(self.address)["must_change_password"])
        self.assertIn("Suite Admin", frappe.get_roles(self.address))

    def test_an_invitation_carries_the_workspace_and_inviter_names(self):
        frappe.db.set_single_value("Suite Settings", "workspace_name", "Northwind")
        inviter = f"maya-{frappe.generate_hash(length=8)}@company.frappe.cloud"
        ensure_user(inviter)
        frappe.get_doc("User", inviter).add_roles("Suite Admin")
        with (
            patch("suite.suite_core.suite_email._email_provider", return_value=None),
            patch("frappe.sendmail") as sendmail,
            self.set_user(inviter),
        ):
            result = add_member(self.username, "company.frappe.cloud", False, True, "contact@example.test")
        self.assertTrue(result["success"])
        sendmail.assert_called_once()
        self.assertEqual(sendmail.call_args.kwargs["recipients"], ["contact@example.test"])
        # Without a provider, the site sends it in the organisation's name, on Suite.
        subject = sendmail.call_args.kwargs["subject"]
        self.assertIn("Northwind", subject)
        self.assertIn("Suite", subject)
        self.assertNotIn("Frappe Mail", subject)
        key = frappe.db.get_value("Mail Account Request", {"account": self.address}, "request_key")
        with self.set_user("Guest"):
            shown = get_account_request(key)
        self.assertEqual((shown["workspace_name"], shown["account"]), ("Northwind", self.address))
        self.assertTrue(shown["invited_by_name"].startswith("maya-"))

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
