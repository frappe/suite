# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import csv
import io
import json
from contextlib import ExitStack
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.mail import directory
from suite.mail.api import admin
from suite.mail.suite_cloud import SuiteCloudClient, SuiteCloudUnavailableError, is_suite_cloud_configured
from suite.mail.tests.fake_suite_cloud import FakeSuiteCloud, fake_suite_cloud

DOMAIN = "acme.test"


_enqueue = frappe.enqueue


def run_queued_job_now(method, **kwargs):
    return _enqueue(method, **{**kwargs, "now": True, "enqueue_after_commit": False})


class SuiteCloudTestCase(IntegrationTestCase):
    """The settings point at a Suite Cloud, and every call lands on an in-memory fake."""

    def setUp(self) -> None:
        super().setUp()
        # Each test starts from the same database: a failed creation now keeps its Suite user for
        # a retry, and the class-level rollback alone would hand it to the next test.
        frappe.db.savepoint("suite_cloud_test")
        self.addCleanup(frappe.db.rollback, save_point="suite_cloud_test")
        self._settings = ExitStack()
        self._settings.enter_context(
            self.change_settings("Mail Settings", server_url="https://mail.c1.example.test")
        )
        self._settings.enter_context(
            self.change_settings(
                "Suite Settings",
                suite_cloud_url="https://cloud.example.test",
                suite_cloud_tenant="key",
                suite_cloud_secret="secret",
            )
        )
        frappe.local.request_cache.clear()
        self._fake_context = fake_suite_cloud()
        self.fake: FakeSuiteCloud = self._fake_context.__enter__()
        self.fake.domains__create_domain(DOMAIN, description="Acme")
        self.fake.domains[DOMAIN]["is_verified"] = 1  # live: takes accounts, groups and lists
        # Queued work runs at once: an after-commit hook never fires inside a rolled-back test.
        enqueue = patch("frappe.enqueue", side_effect=run_queued_job_now)
        enqueue.start()
        self.addCleanup(enqueue.stop)
        frappe.set_user("Administrator")

    def tearDown(self) -> None:
        self._fake_context.__exit__(None, None, None)
        self._settings.close()
        frappe.local.request_cache.clear()
        super().tearDown()


class TestClient(IntegrationTestCase):
    def test_configuration_needs_all_three_values(self) -> None:
        with self.change_settings(
            "Suite Settings",
            suite_cloud_url="https://cloud.test",
            suite_cloud_tenant="k",
            suite_cloud_secret="",
        ):
            frappe.local.request_cache.clear()
            self.assertFalse(is_suite_cloud_configured())
        with self.change_settings(
            "Suite Settings",
            suite_cloud_url="https://cloud.test",
            suite_cloud_tenant="k",
            suite_cloud_secret="s",
        ):
            frappe.local.request_cache.clear()
            self.assertTrue(is_suite_cloud_configured())
        frappe.local.request_cache.clear()


class TestSuiteSettings(SuiteCloudTestCase):
    def test_validate_credentials_pings_and_flags_jmap_url_mismatch(self) -> None:
        settings = frappe.get_doc("Suite Settings")
        site = settings.validate_suite_cloud_credentials()
        self.assertEqual(site["tenant"], "acme.frappe.test")
        self.assertEqual(self.fake.calls[-1][0], "tenant.ping")
        self.assertNotIn("expects the JMAP URL", frappe.get_message_log()[-1]["message"])

        # The site is registered on c1; a JMAP URL of another cluster is worth a warning.
        with self.change_settings("Mail Settings", server_url="https://mail.c2.example.test"):
            frappe.local.request_cache.clear()
            settings.validate_suite_cloud_credentials()
            self.assertIn("expects the JMAP URL", frappe.get_message_log()[-1]["message"])
        frappe.local.request_cache.clear()

    def test_workspace_name_and_contact_reach_suite_cloud(self) -> None:
        with self.change_settings(
            "Suite Settings", workspace_name="Acme Corp", contact_email="Admin@Acme.test"
        ):
            self.assertEqual((self.fake.site_title, self.fake.site_contact), ("Acme Corp", "admin@acme.test"))
            overview = admin.get_overview()
            self.assertEqual(overview["workspace"]["name"], "Acme Corp")
            self.assertEqual(
                (overview["site"]["title"], overview["site"]["contact_email"]),
                ("Acme Corp", "admin@acme.test"),
            )
        # Only the fields that changed travel: a save that touches neither sends nothing.
        calls = len(self.fake.calls)
        with self.change_settings("Suite Settings", is_onboarded=1):
            pass
        self.assertEqual([c for c in self.fake.calls[calls:] if c[0] == "tenant.update_tenant_profile"], [])

    def test_validate_credentials_needs_configuration(self) -> None:
        with self.change_settings("Suite Settings", suite_cloud_secret=""):
            frappe.local.request_cache.clear()
            self.assertRaisesRegex(
                frappe.ValidationError,
                "not configured",
                frappe.get_doc("Suite Settings").validate_suite_cloud_credentials,
            )
        frappe.local.request_cache.clear()


class TestDomains(SuiteCloudTestCase):
    def test_an_outage_is_not_passed_off_as_a_site_without_domains(self) -> None:
        self.assertEqual(admin.get_enabled_domains(), [DOMAIN])
        with patch(
            "suite.mail.directory.get_domains",
            side_effect=SuiteCloudUnavailableError("Suite Cloud is unreachable; try again shortly."),
        ):
            self.assertRaisesRegex(SuiteCloudUnavailableError, "unreachable", admin.get_enabled_domains)

    def test_domains_are_listed_added_exported_and_deleted(self) -> None:
        self.fake.domains[DOMAIN]["is_verified"] = 0  # walk the domain from pending to active
        rows = admin.get_domains()["items"]
        self.assertEqual(
            [(r["id"], r["name"], r["status"], r["is_verified"]) for r in rows],
            [(DOMAIN, DOMAIN, "Pending Verification", False)],
        )
        self.assertEqual(admin.get_domains(status="Active")["items"], [])
        self.assertRaisesRegex(frappe.ValidationError, "Unknown domain status", admin.get_domains, status="x")
        # Pending domains are not offered for new objects, and Suite Cloud refuses them anyway.
        self.assertEqual(admin.get_enabled_domains(), [])
        self.assertRaisesRegex(frappe.ValidationError, "not active", admin.add_group, "sales", DOMAIN)

        self.assertEqual(admin.add_domain("Beta.test", description="Beta"), "Beta.test")
        self.assertEqual([r["name"] for r in admin.get_domains(txt="beta")["items"]], ["Beta.test"])
        self.assertRaisesRegex(frappe.ValidationError, "already exists", admin.add_domain, "Beta.test")

        record = admin.get_domain_ownership_record("gamma.test")["ownership_record"]
        self.assertEqual((record["type"], record["fqdn"]), ("TXT", "gamma.test"))

        domain = admin.get_domain(DOMAIN)
        self.assertEqual(
            [g["key"] for g in domain["dns_record_groups"]], ["authentication_records", "discovery_records"]
        )
        spf, srv = domain["dns_records"]
        self.assertEqual((spf["host"], spf["fqdn"], spf["is_mandatory"]), ("@", DOMAIN, True))
        self.assertEqual((spf["priority"], spf["weight"], spf["port"]), (None, None, None))
        self.assertEqual(
            (srv["host"], srv["value"], srv["priority"], srv["weight"], srv["port"]),
            ("_imaps._tcp", "mail.c1.example.test", 0, 1, 993),
        )

        self.assertIn(
            f"_imaps._tcp.{DOMAIN}.\t300\tIN\tSRV\t0 1 993 mail.c1.example.test.",
            admin.get_domain_dns_zone(DOMAIN),
        )
        rows = list(csv.DictReader(io.StringIO(admin.get_domain_dns_csv(DOMAIN))))
        self.assertEqual([r["type"] for r in rows], ["TXT", "SRV"])
        self.assertEqual(json.loads(admin.get_domain_dns_json(DOMAIN))[0]["type"], "TXT")

        self.assertTrue(admin.verify_domain(DOMAIN)["is_verified"])
        self.assertEqual(admin.get_domain(DOMAIN)["status"], "Active")
        self.assertEqual([r["name"] for r in admin.get_domains(status="Active")["items"]], [DOMAIN])
        self.assertEqual(admin.get_enabled_domains(), [DOMAIN])

        updated = admin.update_domain(
            DOMAIN,
            description="Acme Inc",
            catch_all_address=" Inbox@acme.test ",
            sub_addressing=False,
            allow_relaying=True,
        )
        self.assertEqual(
            (
                updated["description"],
                updated["catch_all_address"],
                updated["sub_addressing"],
                updated["allow_relaying"],
            ),
            ("Acme Inc", "inbox@acme.test", False, True),
        )
        self.assertRaises(frappe.ValidationError, admin.update_domain, DOMAIN, catch_all_address="nope")
        self.assertEqual(admin.update_domain(DOMAIN, catch_all_address="")["catch_all_address"], "")

        # Disabling drops the verification, so enabling again lands the domain back in pending.
        self.assertEqual(admin.set_domain_enabled(DOMAIN, False)["status"], "Disabled")
        self.assertEqual(admin.set_domain_enabled(DOMAIN, True)["status"], "Pending Verification")

        admin.delete_domain("Beta.test")
        self.assertEqual([r["name"] for r in admin.get_domains()["items"]], [DOMAIN])
        self.assertEqual(
            admin.get_domains(page_length=20), {"items": admin.get_domains()["items"], "total": 1}
        )
        self.assertRaisesRegex(frappe.ValidationError, "Page length", admin.get_domains, page_length=7)
        self.assertRaises(frappe.DoesNotExistError, admin.get_domain, "Beta.test")


class TestGroupsAndLists(SuiteCloudTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.fake.accounts__create_account(f"alice@{DOMAIN}", "secret-pw", display_name="Alice")
        self.fake.accounts__create_account(f"bob@{DOMAIN}", "secret-pw", display_name="Bob")

    def test_group_crud_and_membership(self) -> None:
        group = admin.add_group("sales", DOMAIN, description="Sales", members=[f"alice@{DOMAIN}"])
        self.assertEqual(group, f"sales@{DOMAIN}")
        self.assertEqual([g["name"] for g in admin.get_groups(search="sal")["items"]], ["sales"])

        detail = admin.get_group(group)
        self.assertEqual([m["email"] for m in detail["members"]], [f"alice@{DOMAIN}"])
        # Group Mail storage is unlimited; it counts toward the site's combined usage only.
        self.assertEqual(self.fake.groups[group]["disk_quota_gb"], 0)
        self.assertEqual(detail["quota"]["total"], 0)
        self.fake.groups[group]["used_disk_bytes"] = 1024
        listed = admin.get_groups()["items"][0]
        self.assertEqual((listed["quota_gb"], listed["used_bytes"]), (0, 1024))
        self.assertRaisesRegex(
            frappe.ValidationError, "unlimited", admin.add_group, "ops", DOMAIN, quota_gb=2
        )

        admin.add_group_members(group, [f"bob@{DOMAIN}"])
        admin.remove_group_member(group, f"alice@{DOMAIN}")
        self.assertEqual([m["email"] for m in admin.get_group(group)["members"]], [f"bob@{DOMAIN}"])

        admin.add_group_email(group, f"Team@{DOMAIN}", description="old name")
        admin.set_group_email_enabled(group, f"team@{DOMAIN}", 0)
        # One alias per call, never the whole set: concurrent edits cannot drop each other's rows.
        self.assertEqual(
            [c[0] for c in self.fake.calls[-2:]],
            ["mail.groups.add_alias", "mail.groups.set_alias_enabled"],
        )
        addresses = admin.get_group(group)["email_addresses"]
        self.assertEqual(
            [(a["email"], a["is_primary"], a["enabled"], a["description"]) for a in addresses],
            [(group, True, True, "Sales"), (f"team@{DOMAIN}", False, False, "old name")],
        )
        self.assertRaisesRegex(frappe.ValidationError, "primary address", admin.add_group_email, group, group)
        admin.remove_group_email(group, f"team@{DOMAIN}")
        self.assertEqual(len(admin.get_group(group)["email_addresses"]), 1)

        admin.update_group(group, description="Sales team")
        self.assertEqual(self.fake.groups[group]["description"], "Sales team")
        self.assertRaisesRegex(frappe.ValidationError, "unlimited", admin.update_group, group, quota_gb=3)

        admin.delete_groups([group])
        self.assertEqual(admin.get_groups(), {"items": [], "total": 0})

    def test_a_group_can_be_kept_from_receiving_and_let_receive_again(self) -> None:
        quiet = admin.add_group("noreply", DOMAIN, disable_receiving=True)
        self.assertTrue(self.fake.groups[quiet]["disable_receiving"])
        self.assertTrue(admin.get_group(quiet)["disable_receiving"])
        # Nobody's group stops receiving unasked.
        sales = admin.add_group("sales", DOMAIN)
        self.assertFalse(self.fake.groups[sales]["disable_receiving"])
        self.assertFalse(admin.get_group(sales)["disable_receiving"])

        admin.set_group_receiving_enabled(sales, False)
        self.assertTrue(self.fake.groups[sales]["disable_receiving"])
        self.assertTrue(admin.get_group(sales)["disable_receiving"])
        admin.set_group_receiving_enabled(sales, True)
        self.assertFalse(self.fake.groups[sales]["disable_receiving"])
        self.assertFalse(admin.get_group(sales)["disable_receiving"])

    def test_only_an_admin_changes_a_groups_receiving(self) -> None:
        sales = admin.add_group("sales", DOMAIN)
        email = "suite-user@backup.test"
        frappe.delete_doc("User", email, force=True, ignore_permissions=True, ignore_missing=True)
        self.addCleanup(
            frappe.delete_doc, "User", email, force=True, ignore_permissions=True, ignore_missing=True
        )
        frappe.get_doc(
            {
                "doctype": "User",
                "email": email,
                "first_name": "Suite",
                "send_welcome_email": 0,
                "roles": [{"role": "Suite User"}],
            }
        ).insert(ignore_permissions=True)
        frappe.set_user(email)
        self.addCleanup(frappe.set_user, "Administrator")

        self.assertRaises(frappe.PermissionError, admin.set_group_receiving_enabled, sales, False)
        self.assertFalse(self.fake.groups[sales]["disable_receiving"])

    def test_a_suite_cloud_that_ignores_the_option_leaves_no_receiving_group(self) -> None:
        create_group, update_group = self.fake.groups__create_group, self.fake.groups__update_group

        def create_as_before_the_option(email, disable_receiving=None, **params):
            return create_group(email, **params)

        def update_as_before_the_option(email, disable_receiving=None, **changes):
            return update_group(email, **changes)

        with patch.object(self.fake, "groups__create_group", create_as_before_the_option):
            self.assertRaisesRegex(
                frappe.ValidationError,
                "Suite Cloud cannot create",
                admin.add_group,
                "noreply",
                DOMAIN,
                disable_receiving=True,
            )
        # The admin asked for an address that takes no mail; an ordinary group is not that.
        self.assertNotIn(f"noreply@{DOMAIN}", self.fake.groups)

        sales = admin.add_group("sales", DOMAIN)
        with patch.object(self.fake, "groups__update_group", update_as_before_the_option):
            self.assertRaisesRegex(
                frappe.ValidationError,
                "Suite Cloud cannot change",
                admin.set_group_receiving_enabled,
                sales,
                False,
            )

    def test_member_endpoints_refuse_targets_that_are_not_members(self) -> None:
        # Administrator is never a mail member; the alias and membership endpoints must say so
        # before doing anything, like the rest of the member API.
        for call in (
            lambda: admin.get_member("Administrator"),
            lambda: admin.add_member_email("Administrator", f"x@{DOMAIN}"),
            lambda: admin.remove_member_email("Administrator", f"x@{DOMAIN}"),
            lambda: admin.add_member_to_groups("Administrator", [f"sales@{DOMAIN}"]),
        ):
            self.assertRaisesRegex(frappe.PermissionError, "not a mail account", call)
        # Nobody changes their own password through the admin endpoint.
        self.assertRaisesRegex(
            frappe.PermissionError,
            "own password",
            admin.change_member_password,
            "Administrator",
            "new-password-9",
        )

    def test_lists_and_pickers_search_on_suite_cloud(self) -> None:
        for name in ("ops", "sales", "support"):
            self.fake.groups__create_group(f"{name}@{DOMAIN}", description=f"{name.title()} team")
        page = admin.get_groups(search="Sales team", start=0, page_length=20)
        self.assertEqual(([g["name"] for g in page["items"]], page["total"]), (["sales"], 3 - 2))
        self.assertEqual(
            self.fake.calls[-1],
            ("mail.groups.list_groups", {"search": "Sales team", "start": 0, "limit": 20}),
        )
        self.assertRaisesRegex(frappe.ValidationError, "Page length", admin.get_groups, page_length=7)

        picker = admin.get_accounts(search="Bob")
        self.assertEqual([a["email"] for a in picker], [f"bob@{DOMAIN}"])
        self.assertEqual(self.fake.calls[-1][1], {"search": "Bob", "limit": 20})
        self.assertEqual(len(admin.get_accounts(limit=1)), 1)

    def test_mailing_list_crud_and_recipients(self) -> None:
        mailing_list = admin.add_mailing_list(
            "news", DOMAIN, recipients=[f"alice@{DOMAIN}", "ext@example.org"], description="News"
        )
        self.assertEqual(mailing_list, f"news@{DOMAIN}")
        self.assertEqual(
            [(r["name"], r["recipient_count"]) for r in admin.get_mailing_lists()["items"]], [("news", 2)]
        )

        admin.add_mailing_list_recipients(mailing_list, [f"bob@{DOMAIN}", " ", f"alice@{DOMAIN}"])
        admin.remove_mailing_list_recipient(mailing_list, "ext@example.org")
        detail = admin.get_mailing_list(mailing_list)
        self.assertEqual(detail["recipients"], [f"alice@{DOMAIN}", f"bob@{DOMAIN}"])
        self.assertEqual(detail["recipient_total"], 2)

        admin.add_mailing_list_email(mailing_list, f"newsletter@{DOMAIN}")
        self.assertEqual(
            [a["email"] for a in admin.get_mailing_list(mailing_list)["email_addresses"]],
            [mailing_list, f"newsletter@{DOMAIN}"],
        )
        admin.update_mailing_list(mailing_list, description="Product news")
        self.assertEqual(self.fake.lists[mailing_list]["description"], "Product news")

        admin.delete_mailing_lists([mailing_list])
        self.assertEqual(admin.get_mailing_lists(), {"items": [], "total": 0})

    def test_the_mailing_list_index_is_read_in_two_calls(self) -> None:
        self.fake.mailing_lists__create_mailing_list(
            f"news@{DOMAIN}", recipients=[f"bob@{DOMAIN}", f"alice@{DOMAIN}"]
        )
        self.fake.mailing_lists__create_mailing_list(f"empty@{DOMAIN}")
        self.fake.lists[f"news@{DOMAIN}"]["recipients"]["gone@example.org"] = False
        directory.clear_mailing_list_index()
        self.fake.calls.clear()

        index = directory.get_mailing_list_index()

        self.assertEqual(
            index, {f"news@{DOMAIN}": [f"alice@{DOMAIN}", f"bob@{DOMAIN}"], f"empty@{DOMAIN}": []}
        )
        self.assertEqual(
            [c[0] for c in self.fake.calls],
            ["mail.mailing_lists.list_mailing_lists", "mail.mailing_lists.list_all_recipients"],
        )
        self.assertEqual(directory.get_mailing_list_index(), index)
        self.assertEqual(len(self.fake.calls), 2)  # served from the cache

    def test_a_refused_refresh_serves_the_previous_index(self) -> None:
        self.fake.mailing_lists__create_mailing_list(f"news@{DOMAIN}", recipients=[f"bob@{DOMAIN}"])
        directory.clear_mailing_list_index()
        index = directory.get_mailing_list_index()
        frappe.cache.delete_value(directory.INDEX_FRESH_KEY)  # the minute has passed

        def refuse(**_):
            frappe.throw("Rate limit exceeded.", frappe.TooManyRequestsError)

        self.fake.mailing_lists__list_all_recipients = refuse
        self.assertEqual(directory.get_mailing_list_index(), index)
        # The refusal is not retried on every lookup: the index is served for another minute.
        calls = len(self.fake.calls)
        self.assertEqual(directory.get_mailing_list_index(), index)
        self.assertEqual(len(self.fake.calls), calls)

        directory.clear_mailing_list_index()
        self.assertRaises(frappe.TooManyRequestsError, directory.get_mailing_list_index)

    def test_a_listing_that_never_ends_is_refused_and_keeps_the_previous_index(self) -> None:
        self.fake.mailing_lists__create_mailing_list(f"news@{DOMAIN}", recipients=[f"bob@{DOMAIN}"])
        directory.clear_mailing_list_index()
        index = directory.get_mailing_list_index()
        frappe.cache.delete_value(directory.INDEX_FRESH_KEY)
        self.fake.mailing_lists__add_recipients(f"news@{DOMAIN}", [f"alice@{DOMAIN}"])

        with patch.object(directory, "MAX_PAGES", 1):
            self.assertRaises(
                directory.ListingCutShortError,
                directory.all_pages,
                "mail.mailing_lists.list_all_recipients",
                limit=1,
            )
            with patch.object(directory, "RECIPIENT_PAGE", 1):
                self.assertEqual(directory.get_mailing_list_index(), index)  # not the cut one


class TestMembers(SuiteCloudTestCase):
    def setUp(self) -> None:
        super().setUp()
        # Frappe throttles User creation per hour across the site; a dev site that just took a bulk
        # load would otherwise block these tests for an hour.
        throttle = patch("frappe.core.doctype.user.user.throttle_user_creation")
        throttle.start()
        self.addCleanup(throttle.stop)
        self.email = f"carol@{DOMAIN}"
        frappe.delete_doc("User", self.email, force=True, ignore_permissions=True, ignore_missing=True)
        frappe.db.delete("Mail Account Request", {"account": self.email})
        self.fake.groups__create_group(f"sales@{DOMAIN}", description="Sales")
        self.fake.mailing_lists__create_mailing_list(f"news@{DOMAIN}", description="News")

    def test_failed_user_creation_removes_the_cluster_account(self) -> None:
        with patch(
            "suite.mail.doctype.mail_account_request.mail_account_request.create_user",
            side_effect=frappe.ValidationError("Throttled"),
        ):
            result = admin.add_member(
                "erin",
                DOMAIN,
                is_admin=False,
                send_invite=False,
                backup_email="erin@backup.test",
                first_name="Erin",
                password="a-strong-password-9",
            )
            self.assertEqual((result["success"], result["status"]), (False, "Setup failed"))
        # Suite Cloud had already created the account; it must not survive as an orphan.
        self.assertNotIn(f"erin@{DOMAIN}", self.fake.accounts)

    def test_a_timeout_after_the_cluster_created_the_account_is_recovered_on_retry(self) -> None:
        def create_then_time_out(email, password, operation=None, **kwargs):
            self.fake.accounts__create_account(
                email, password, description=f"Suite setup {operation}", **kwargs
            )
            raise SuiteCloudUnavailableError("Suite Cloud is unreachable; try again shortly.")

        member = dict(
            is_admin=False,
            send_invite=False,
            backup_email="erin@backup.test",
            first_name="Erin",
            password="a-strong-password-9",
        )
        with patch("suite.mail.directory.create_account", side_effect=create_then_time_out):
            result = admin.add_member("erin", DOMAIN, **member)
        self.assertEqual((result["success"], result["status"]), (False, "Setup failed"))
        # The answer never arrived but the account did. Its ownership is uncertain, so it is kept,
        # and the retry recognises it as this setup's own instead of meeting "already exists".
        self.assertIn(f"erin@{DOMAIN}", self.fake.accounts)
        retried = admin.add_member("erin", DOMAIN, **member)
        self.assertEqual((retried["success"], retried["status"]), (True, "Password change required"))

    def test_timeout_before_the_creation_leaves_an_existing_mailbox_alone(self) -> None:
        # A mailbox can outlive its user on this site; the cleanup must not take it for its own.
        self.fake.accounts__create_account(f"frank@{DOMAIN}", "secret-pw", display_name="Frank of old")
        with patch(
            "suite.mail.doctype.mail_account_request.mail_account_request.MailAccountRequest._surviving",
            side_effect=SuiteCloudUnavailableError("Suite Cloud is unreachable; try again shortly."),
        ):
            result = admin.add_member(
                "frank",
                DOMAIN,
                is_admin=False,
                send_invite=False,
                backup_email="frank@backup.test",
                first_name="Frank",
                password="a-strong-password-9",
                groups=[f"sales@{DOMAIN}"],
            )
            self.assertEqual((result["success"], result["status"]), (False, "Setup failed"))
        self.assertEqual(self.fake.accounts[f"frank@{DOMAIN}"]["display_name"], "Frank of old")

    def test_an_address_the_cluster_already_has_is_refused_before_the_creation(self) -> None:
        self.fake.accounts__create_account(f"grace@{DOMAIN}", "secret-pw", display_name="Grace of old")
        with patch("suite.mail.directory.create_account") as create_account:
            result = admin.add_member(
                "grace",
                DOMAIN,
                is_admin=False,
                send_invite=False,
                backup_email="grace@backup.test",
                first_name="Grace",
                password="a-strong-password-9",
            )
            self.assertEqual((result["success"], result["status"]), (False, "Setup failed"))
        create_account.assert_not_called()
        self.assertEqual(self.fake.accounts[f"grace@{DOMAIN}"]["display_name"], "Grace of old")

    def test_unset_quota_means_no_limit(self) -> None:
        admin.add_member(
            "dave",
            DOMAIN,
            is_admin=False,
            send_invite=False,
            backup_email="dave@backup.test",
            first_name="Dave",
            last_name="Doe",
            password="a-strong-password-9",
        )
        self.assertEqual(self.fake.accounts[f"dave@{DOMAIN}"]["disk_quota_gb"], 0)
        self.assertEqual(admin.get_member(f"dave@{DOMAIN}")["quota"]["total"], 0)

    def test_an_account_can_be_created_unable_to_receive(self) -> None:
        for username, disable_receiving in (("noreply", True), ("heidi", False)):
            admin.add_member(
                username,
                DOMAIN,
                is_admin=False,
                send_invite=False,
                backup_email=f"{username}@backup.test",
                first_name=username.title(),
                password="a-strong-password-9",
                disable_receiving=disable_receiving,
            )
        self.assertTrue(self.fake.accounts[f"noreply@{DOMAIN}"]["disable_receiving"])
        # Nobody loses their incoming mail unasked.
        self.assertFalse(self.fake.accounts[f"heidi@{DOMAIN}"]["disable_receiving"])

    def test_an_invited_account_is_still_unable_to_receive_once_the_invite_is_accepted(self) -> None:
        from suite.mail.api import account as account_api

        email = f"ivan@{DOMAIN}"
        with patch("frappe.sendmail"):
            admin.add_member(
                "ivan",
                DOMAIN,
                is_admin=False,
                send_invite=True,
                backup_email="ivan@backup.test",
                disable_receiving=True,
            )
        self.assertNotIn(email, self.fake.accounts)  # nothing exists until the invite is accepted

        request_key = frappe.db.get_value("Mail Account Request", {"account": email}, "request_key")
        account_api.create_account(request_key, "Ivan", "Doe", "a-strong-password-9")
        self.assertTrue(self.fake.accounts[email]["disable_receiving"])

    def test_a_suite_cloud_that_ignores_the_option_does_not_leave_a_receiving_mailbox(self) -> None:
        def create_as_before_the_option(email, password, disable_receiving=None, **kwargs):
            return self.fake.accounts__create_account(email, password, **kwargs)

        with patch(
            "suite.mail.directory.create_account",
            side_effect=create_as_before_the_option,
        ):
            result = admin.add_member(
                "judy",
                DOMAIN,
                is_admin=False,
                send_invite=False,
                backup_email="judy@backup.test",
                first_name="Judy",
                password="a-strong-password-9",
                disable_receiving=True,
            )
            self.assertEqual((result["success"], result["status"]), (False, "Setup failed"))
        # The admin asked for an address that takes no mail; an ordinary mailbox is not that.
        self.assertNotIn(f"judy@{DOMAIN}", self.fake.accounts)
        # The Suite user stays, blocked and marked for a retry of the creation.
        from suite.suite_core.account_state import read

        self.assertEqual(read(f"judy@{DOMAIN}").get("status"), "Setup failed")

    def _add_carol(self) -> None:
        admin.add_member(
            "carol",
            DOMAIN,
            is_admin=False,
            send_invite=False,
            backup_email="carol@backup.test",
            first_name="Carol",
            password="a-strong-password-9",
        )

    def test_an_admin_stops_and_restores_a_members_receiving(self) -> None:
        self._add_carol()
        self.assertFalse(admin.get_member(self.email)["disable_receiving"])

        admin.set_member_receiving_enabled(self.email, False)
        self.assertTrue(self.fake.accounts[self.email]["disable_receiving"])
        self.assertTrue(admin.get_member(self.email)["disable_receiving"])

        admin.set_member_receiving_enabled(self.email, True)
        self.assertFalse(self.fake.accounts[self.email]["disable_receiving"])
        self.assertFalse(admin.get_member(self.email)["disable_receiving"])

    def test_a_member_cannot_change_their_own_receiving(self) -> None:
        self._add_carol()
        frappe.set_user(self.email)
        self.addCleanup(frappe.set_user, "Administrator")

        self.assertRaises(frappe.PermissionError, admin.set_member_receiving_enabled, self.email, False)
        self.assertFalse(self.fake.accounts[self.email]["disable_receiving"])

    def test_a_suite_cloud_that_ignores_the_option_is_not_reported_as_changed(self) -> None:
        self._add_carol()
        update_account = self.fake.accounts__update_account

        def update_as_before_the_option(email, disable_receiving=None, **changes):
            return update_account(email, **changes)

        with patch.object(self.fake, "accounts__update_account", update_as_before_the_option):
            self.assertRaisesRegex(
                frappe.ValidationError,
                "Suite Cloud cannot change",
                admin.set_member_receiving_enabled,
                self.email,
                False,
            )

    def test_member_lifecycle_through_suite_cloud(self) -> None:
        admin.add_member(
            "carol",
            DOMAIN,
            is_admin=False,
            send_invite=False,
            backup_email="carol@backup.test",
            first_name="Carol",
            last_name="Doe",
            password="a-strong-password-9",
            aliases=[f"cd@{DOMAIN}"],
            groups=[f"sales@{DOMAIN}"],
            mailing_lists=[f"news@{DOMAIN}"],
        )
        account = self.fake.accounts[self.email]
        # Mail has no quota of its own (the combined cap covers it), and the Admin's chosen
        # password never becomes the Mail secret.
        self.assertEqual(
            (account["display_name"], account["disk_quota_gb"], account["groups"]),
            ("Carol Doe", 0, [f"sales@{DOMAIN}"]),
        )
        self.assertNotEqual(self.fake.passwords[self.email], "a-strong-password-9")
        self.assertEqual(frappe.db.get_value("User Settings", {"user": self.email}, "username"), self.email)
        self.assertEqual(
            frappe.get_doc("User Settings", {"user": self.email}).get_password("app_password"),
            f"apppassword-{self.email}",
        )

        member = admin.get_member(self.email)
        self.assertEqual([a["email"] for a in member["email_addresses"]], [self.email, f"cd@{DOMAIN}"])
        self.assertEqual([g["email"] for g in member["groups"]], [f"sales@{DOMAIN}"])
        self.assertEqual([ml["email"] for ml in member["mailing_lists"]], [f"news@{DOMAIN}"])
        self.assertEqual(member["quota"]["total"], 0)
        requests = admin.get_account_requests(search="carol")
        self.assertEqual((requests["total"], requests["items"][0]["account"]), (1, self.email))
        self.assertEqual(admin.get_account_requests(search="carol", start=20, page_length=20)["items"], [])
        self.fake.accounts[self.email]["used_disk_bytes"] = 4096
        page = admin.get_members(search="carol")
        self.assertEqual(page["total"], 1)
        listed = next(u for u in page["items"] if u["name"] == self.email)
        # Allotment and usage, fetched for the page in one call.
        self.assertEqual((listed["quota_gb"], listed["used_bytes"]), (0, 4096))
        self.assertEqual(admin.get_members(search="carol", start=20, page_length=20)["items"], [])
        self.assertNotIn("quota", listed)

        # A refused lookup leaves the page without quotas, logged, and without the refusal's message.
        refuse = lambda **_: frappe.throw("Suite Cloud refused the request.", frappe.ValidationError)  # noqa: E731
        messages_before = list(frappe.local.message_log)
        with (
            patch.object(self.fake, "accounts__get_quotas", side_effect=refuse),
            patch("suite.mail.api.admin.log_mail_error") as logged,
        ):
            listed = next(u for u in admin.get_members(search="carol")["items"] if u["name"] == self.email)
        self.assertEqual((listed["quota_gb"], listed["used_bytes"]), (None, None))
        self.assertEqual(frappe.local.message_log, messages_before)
        logged.assert_called_once()

        admin.update_member(self.email, description="Carol D", time_zone="Asia/Kolkata")
        self.assertEqual(
            (account["display_name"], account["disk_quota_gb"], account["time_zone"]),
            ("Carol D", 0, "Asia/Kolkata"),
        )
        self.assertRaisesRegex(
            frappe.ValidationError, "no storage quota", admin.update_member, self.email, quota_gb=3
        )

        admin.add_member_email(self.email, f"Carol.Doe@{DOMAIN}")
        admin.set_member_email_enabled(self.email, f"cd@{DOMAIN}", 0)
        self.assertEqual(
            [(a["email"], a["enabled"]) for a in account["aliases"]],
            [(f"cd@{DOMAIN}", False), (f"carol.doe@{DOMAIN}", True)],
        )
        admin.remove_member_email(self.email, f"cd@{DOMAIN}")
        self.assertEqual([a["email"] for a in account["aliases"]], [f"carol.doe@{DOMAIN}"])

        admin.remove_member_from_group(self.email, f"sales@{DOMAIN}")
        self.assertEqual(account["groups"], [])
        admin.add_member_to_groups(self.email, [f"sales@{DOMAIN}"])
        self.assertEqual(self.fake.groups[f"sales@{DOMAIN}"]["members"], [self.email])
        admin.remove_member_from_mailing_list(self.email, f"news@{DOMAIN}")
        self.assertEqual(self.fake.lists[f"news@{DOMAIN}"]["recipients"], {})
        admin.add_member_to_mailing_lists(self.email, [f"news@{DOMAIN}"])
        self.assertIn(self.email, self.fake.lists[f"news@{DOMAIN}"]["recipients"])

        # Admins issue one-time credentials instead of choosing a member's password.
        self.assertRaisesRegex(
            frappe.ValidationError,
            "temporary password",
            admin.change_member_password,
            self.email,
            "another-strong-pw-9",
        )

        # Access changes report one outcome per user and act on the Suite user.
        self.assertEqual(
            admin.disable_members([self.email]), [{"user": self.email, "success": True, "error": None}]
        )
        self.assertFalse(frappe.db.get_value("User", self.email, "enabled"))
        self.assertFalse(account["enabled"])
        self.assertEqual(
            admin.enable_members([self.email]), [{"user": self.email, "success": True, "error": None}]
        )
        self.assertTrue(frappe.db.get_value("User", self.email, "enabled"))

        overview = admin.get_overview()
        self.assertEqual(
            (overview["domains"], overview["groups"], overview["limits"]["max_domains"]), (1, 1, 10)
        )
        self.assertEqual(overview["site"]["cluster"], "mail.c1.example.test")
        self.assertEqual((overview["storage"]["used_bytes"], overview["storage"]["max_gb"]), (4096, 100))
        self.assertEqual(overview["domains_needing_attention"], [])
        self.assertEqual(overview["invites"], {"pending": 0, "expiring_soon": 0, "expired": 0})
        self.assertEqual(overview["recent_accounts"][0]["name"], self.email)
        admin.disable_members([self.email])
        # The dev site may hold disabled accounts of its own; ours must be among them, in address order.
        disabled = [a["name"] for a in admin.get_overview()["disabled_accounts"]]
        self.assertIn(self.email, disabled)
        self.assertEqual(disabled, sorted(disabled))

        # Deleting takes the disabled user's mailbox, confirmed by its address, and keeps the
        # Suite user and its Drive.
        admin.delete_members([self.email], confirmation=self.email)
        self.assertNotIn(self.email, self.fake.accounts)
        self.assertTrue(frappe.db.exists("User", self.email))

    def test_request_refuses_unknown_groups_and_alias_domains(self) -> None:
        self.assertRaisesRegex(
            frappe.ValidationError,
            "does not exist",
            admin.add_member,
            "dave",
            DOMAIN,
            False,
            False,
            "d@backup.test",
            first_name="Dave",
            password="a-strong-password-9",
            groups=[f"nope@{DOMAIN}"],
        )
        self.assertRaisesRegex(
            frappe.ValidationError,
            "does not exist on the server",
            admin.add_member,
            "dave",
            DOMAIN,
            False,
            False,
            "d@backup.test",
            first_name="Dave",
            password="a-strong-password-9",
            aliases=["dave@elsewhere.test"],
        )

    def test_an_invite_sent_by_a_suite_admin_carries_a_usable_request_key(self) -> None:
        """The request key is a permlevel 1 field, which the framework resets for anyone but the
        Administrator unless the write is exempted - leaving the invite link pointing at nothing."""

        account = f"frank@{DOMAIN}"
        # The invite stays pending, and the site-wide counts other tests assert on would see it.
        frappe.db.delete("Mail Account Request", {"account": account})
        self.addCleanup(frappe.db.delete, "Mail Account Request", {"account": account})
        frappe.set_user(self._suite_admin())
        self.addCleanup(frappe.set_user, "Administrator")

        admin.add_member(
            "frank",
            DOMAIN,
            is_admin=False,
            send_invite=True,
            backup_email="frank@backup.test",
        )

        request_key = frappe.db.get_value("Mail Account Request", {"account": account}, "request_key")
        self.assertTrue(request_key)
        invite = self.fake.emails[-1]  # Suite Cloud sends it from its template
        self.assertEqual((invite["email_type"], invite["recipient"]), ("account-invite", "frank@backup.test"))
        self.assertIn(f"/mail/signup/{request_key}", invite["params"]["link"])

    def _suite_admin(self) -> str:
        """An enabled Suite Admin of this site who is not the Administrator."""

        email = "suite-admin@backup.test"
        self.addCleanup(
            frappe.delete_doc, "User", email, force=True, ignore_permissions=True, ignore_missing=True
        )
        frappe.delete_doc("User", email, force=True, ignore_permissions=True, ignore_missing=True)
        user = frappe.get_doc(
            {
                "doctype": "User",
                "email": email,
                "first_name": "Suite",
                "send_welcome_email": 0,
                "roles": [{"role": "Suite Admin"}],
            }
        ).insert(ignore_permissions=True)
        return user.name
