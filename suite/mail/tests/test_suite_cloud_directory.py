# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import csv
import io
import json
from contextlib import ExitStack
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

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
        self._settings = ExitStack()
        self._settings.enter_context(
            self.change_settings("Mail Settings", server_url="https://mail.c1.example.test")
        )
        self._settings.enter_context(
            self.change_settings(
                "Suite Settings",
                suite_cloud_url="https://cloud.example.test",
                site_api_key="key",
                site_api_secret="secret",
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
            "Suite Settings", suite_cloud_url="https://cloud.test", site_api_key="k", site_api_secret=""
        ):
            frappe.local.request_cache.clear()
            self.assertFalse(is_suite_cloud_configured())
        with self.change_settings(
            "Suite Settings", suite_cloud_url="https://cloud.test", site_api_key="k", site_api_secret="s"
        ):
            frappe.local.request_cache.clear()
            self.assertTrue(is_suite_cloud_configured())
        frappe.local.request_cache.clear()

    def test_refusals_become_frappe_exceptions(self) -> None:
        client = SuiteCloudClient("https://cloud.test", "k", "s")

        def response(status: int, body: dict):
            r = frappe._dict(status_code=status, ok=status < 400, content=b"x", text=json.dumps(body))
            r.json = lambda: body
            return r

        server_message = json.dumps(
            [json.dumps({"message": "Site acme has reached its limit of 10 domains."})]
        )
        with patch.object(
            client.session, "post", return_value=response(422, {"_server_messages": server_message})
        ):
            self.assertRaisesRegex(
                frappe.ValidationError,
                "limit of 10 domains",
                client.call,
                "domains.create_domain",
                domain="x.test",
            )
        with patch.object(
            client.session,
            "post",
            return_value=response(
                404, {"exception": "frappe.exceptions.DoesNotExistError: Mail Domain x.test not found."}
            ),
        ):
            self.assertRaises(frappe.DoesNotExistError, client.call, "domains.get_domain", domain="x.test")
        with patch.object(client.session, "post", return_value=response(403, {})):
            self.assertRaises(frappe.PermissionError, client.call, "ping")
        with patch.object(client.session, "post", return_value=response(200, {"message": {"site": "acme"}})):
            self.assertEqual(client.call("site.ping"), {"site": "acme"})
            body = json.loads(client.session.post.call_args.kwargs["data"])
            self.assertEqual(body, {})
        self.assertEqual(client.session.headers["Frappe-Authorization-Source"], "Suite Site")
        self.assertEqual(client.session.headers["Authorization"], "token k:s")


class TestSuiteSettings(SuiteCloudTestCase):
    def test_validate_credentials_pings_and_flags_jmap_url_mismatch(self) -> None:
        settings = frappe.get_doc("Suite Settings")
        site = settings.validate_suite_cloud_credentials()
        self.assertEqual(site["site"], "acme.frappe.test")
        self.assertEqual(self.fake.calls[-1][0], "site.ping")
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
        self.assertEqual([c for c in self.fake.calls[calls:] if c[0] == "site.update_site_profile"], [])

    def test_validate_credentials_needs_configuration(self) -> None:
        with self.change_settings("Suite Settings", site_api_secret=""):
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
            ("_imaps._tcp", "mail.c1.example.test.", 0, 1, 993),
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
        group = admin.add_group("sales", DOMAIN, description="Sales", members=[f"alice@{DOMAIN}"], quota_gb=2)
        self.assertEqual(group, f"sales@{DOMAIN}")
        self.assertEqual([g["name"] for g in admin.get_groups(search="sal")["items"]], ["sales"])

        detail = admin.get_group(group)
        self.assertEqual([m["email"] for m in detail["members"]], [f"alice@{DOMAIN}"])
        self.assertEqual(detail["quota"]["total"], 2 * 1024**3)
        self.fake.groups[group]["used_disk_bytes"] = 1024
        listed = admin.get_groups()["items"][0]
        self.assertEqual((listed["quota_gb"], listed["used_bytes"]), (2, 1024))
        with self.change_settings("Mail Settings", default_disk_quota_gb=7):
            frappe.local.request_cache.clear()
            admin.add_group("ops", DOMAIN)
        frappe.local.request_cache.clear()
        self.assertEqual(self.fake.groups[f"ops@{DOMAIN}"]["disk_quota_gb"], 7)
        admin.delete_groups([f"ops@{DOMAIN}"])

        admin.add_group_members(group, [f"bob@{DOMAIN}"])
        admin.remove_group_member(group, f"alice@{DOMAIN}")
        self.assertEqual([m["email"] for m in admin.get_group(group)["members"]], [f"bob@{DOMAIN}"])

        admin.add_group_email(group, f"Team@{DOMAIN}", description="old name")
        admin.set_group_email_enabled(group, f"team@{DOMAIN}", 0)
        # One alias per call, never the whole set: concurrent edits cannot drop each other's rows.
        self.assertEqual(
            [c[0] for c in self.fake.calls[-2:]],
            ["mail.groups.add_group_alias", "mail.groups.set_group_alias_enabled"],
        )
        addresses = admin.get_group(group)["email_addresses"]
        self.assertEqual(
            [(a["email"], a["is_primary"], a["enabled"], a["description"]) for a in addresses],
            [(group, True, True, "Sales"), (f"team@{DOMAIN}", False, False, "old name")],
        )
        self.assertRaisesRegex(frappe.ValidationError, "primary address", admin.add_group_email, group, group)
        admin.remove_group_email(group, f"team@{DOMAIN}")
        self.assertEqual(len(admin.get_group(group)["email_addresses"]), 1)

        admin.update_group(group, description="Sales team", quota_gb=3)
        self.assertEqual(
            (self.fake.groups[group]["description"], self.fake.groups[group]["disk_quota_gb"]),
            ("Sales team", 3),
        )

        admin.delete_groups([group])
        self.assertEqual(admin.get_groups(), {"items": [], "total": 0})

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
            self.assertRaisesRegex(
                frappe.ValidationError,
                "Failed to create user",
                admin.add_member,
                "erin",
                DOMAIN,
                is_admin=False,
                send_invite=False,
                backup_email="erin@backup.test",
                first_name="Erin",
                password="a-strong-password-9",
            )
        # Suite Cloud had already created the account; it must not survive as an orphan.
        self.assertNotIn(f"erin@{DOMAIN}", self.fake.accounts)

    def test_timeout_after_the_cluster_created_the_account_removes_it(self) -> None:
        def create_then_time_out(email, password, **kwargs):
            self.fake.accounts__create_account(email, password, **kwargs)
            raise SuiteCloudUnavailableError("Suite Cloud is unreachable; try again shortly.")

        with patch(
            "suite.mail.doctype.mail_account_request.mail_account_request.create_account",
            side_effect=create_then_time_out,
        ):
            self.assertRaisesRegex(
                frappe.ValidationError,
                "Failed to create the mail account",
                admin.add_member,
                "erin",
                DOMAIN,
                is_admin=False,
                send_invite=False,
                backup_email="erin@backup.test",
                first_name="Erin",
                password="a-strong-password-9",
            )
        # The answer never arrived, but the account did; a retry must not meet "already exists".
        self.assertNotIn(f"erin@{DOMAIN}", self.fake.accounts)

    def test_timeout_before_the_creation_leaves_an_existing_mailbox_alone(self) -> None:
        # A mailbox can outlive its user on this site; the cleanup must not take it for its own.
        self.fake.accounts__create_account(f"frank@{DOMAIN}", "secret-pw", display_name="Frank of old")
        with patch(
            "suite.mail.doctype.mail_account_request.mail_account_request.MailAccountRequest._surviving",
            side_effect=SuiteCloudUnavailableError("Suite Cloud is unreachable; try again shortly."),
        ):
            self.assertRaises(
                frappe.ValidationError,
                admin.add_member,
                "frank",
                DOMAIN,
                is_admin=False,
                send_invite=False,
                backup_email="frank@backup.test",
                first_name="Frank",
                password="a-strong-password-9",
                groups=[f"sales@{DOMAIN}"],
            )
        self.assertEqual(self.fake.accounts[f"frank@{DOMAIN}"]["display_name"], "Frank of old")

    def test_an_address_the_cluster_already_has_is_refused_before_the_creation(self) -> None:
        self.fake.accounts__create_account(f"grace@{DOMAIN}", "secret-pw", display_name="Grace of old")
        with patch(
            "suite.mail.doctype.mail_account_request.mail_account_request.create_account"
        ) as create_account:
            self.assertRaisesRegex(
                frappe.ValidationError,
                "Failed to create the mail account",
                admin.add_member,
                "grace",
                DOMAIN,
                is_admin=False,
                send_invite=False,
                backup_email="grace@backup.test",
                first_name="Grace",
                password="a-strong-password-9",
            )
        create_account.assert_not_called()
        self.assertEqual(self.fake.accounts[f"grace@{DOMAIN}"]["display_name"], "Grace of old")

    def test_unset_quota_takes_the_mail_settings_default(self) -> None:
        with self.change_settings("Mail Settings", default_disk_quota_gb=7):
            frappe.local.request_cache.clear()
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
        frappe.local.request_cache.clear()
        self.assertEqual(self.fake.accounts[f"dave@{DOMAIN}"]["disk_quota_gb"], 7)

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
            quota_gb=2,
        )
        account = self.fake.accounts[self.email]
        self.assertEqual(
            (account["display_name"], account["disk_quota_gb"], account["groups"]),
            ("Carol Doe", 2, [f"sales@{DOMAIN}"]),
        )
        self.assertEqual(self.fake.passwords[self.email], "a-strong-password-9")
        self.assertEqual(frappe.db.get_value("User Settings", {"user": self.email}, "username"), self.email)
        self.assertEqual(
            frappe.get_doc("User Settings", {"user": self.email}).get_password("app_password"),
            f"apppassword-{self.email}",
        )

        member = admin.get_member(self.email)
        self.assertEqual([a["email"] for a in member["email_addresses"]], [self.email, f"cd@{DOMAIN}"])
        self.assertEqual([g["email"] for g in member["groups"]], [f"sales@{DOMAIN}"])
        self.assertEqual([ml["email"] for ml in member["mailing_lists"]], [f"news@{DOMAIN}"])
        self.assertEqual(member["quota"]["total"], 2 * 1024**3)
        requests = admin.get_account_requests(search="carol")
        self.assertEqual((requests["total"], requests["items"][0]["account"]), (1, self.email))
        self.assertEqual(admin.get_account_requests(search="carol", start=20, page_length=20)["items"], [])
        self.fake.accounts[self.email]["used_disk_bytes"] = 4096
        page = admin.get_members(search="carol")
        self.assertEqual(page["total"], 1)
        listed = next(u for u in page["items"] if u["name"] == self.email)
        # Allotment and usage, fetched for the page in one call.
        self.assertEqual((listed["quota_gb"], listed["used_bytes"]), (2, 4096))
        self.assertEqual(admin.get_members(search="carol", start=20, page_length=20)["items"], [])
        self.assertNotIn("quota", listed)

        admin.update_member(self.email, description="Carol D", quota_gb=3, time_zone="Asia/Kolkata")
        self.assertEqual(
            (account["display_name"], account["disk_quota_gb"], account["time_zone"]),
            ("Carol D", 3, "Asia/Kolkata"),
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

        admin.change_member_password(self.email, "another-strong-pw-9")
        self.assertEqual(self.fake.passwords[self.email], "another-strong-pw-9")

        admin.disable_members([self.email])
        self.assertFalse(account["enabled"])
        admin.enable_members([self.email])
        self.assertTrue(account["enabled"])

        overview = admin.get_overview()
        self.assertEqual(
            (overview["domains"], overview["groups"], overview["limits"]["max_domains"]), (1, 1, 10)
        )
        self.assertEqual(overview["site"]["cluster"], "mail.c1.example.test")
        self.assertEqual(overview["storage"]["max_gb"], 100)
        self.assertEqual(overview["domains_needing_attention"], [])
        self.assertEqual(overview["invites"], {"pending": 0, "expiring_soon": 0, "expired": 0})
        self.assertEqual(overview["recent_accounts"][0]["name"], self.email)
        admin.disable_members([self.email])
        # The dev site may hold disabled accounts of its own; ours must be among them, in address order.
        disabled = [a["name"] for a in admin.get_overview()["disabled_accounts"]]
        self.assertIn(self.email, disabled)
        self.assertEqual(disabled, sorted(disabled))
        admin.enable_members([self.email])

        admin.delete_members([self.email])
        self.assertNotIn(self.email, self.fake.accounts)
        self.assertFalse(frappe.db.exists("User", self.email))

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

        with patch("frappe.sendmail") as sendmail:
            admin.add_member(
                "frank",
                DOMAIN,
                is_admin=False,
                send_invite=True,
                backup_email="frank@backup.test",
            )

        request_key = frappe.db.get_value("Mail Account Request", {"account": account}, "request_key")
        self.assertTrue(request_key)
        self.assertIn(f"/mail/signup/{request_key}", sendmail.call_args.kwargs["args"]["link"])

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
