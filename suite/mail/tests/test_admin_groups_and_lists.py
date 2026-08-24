# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.mail.api.admin import (
    add_group,
    add_group_email,
    add_group_members,
    add_mailing_list,
    add_mailing_list_email,
    add_mailing_list_recipients,
    add_member_to_groups,
    add_member_to_mailing_lists,
    delete_groups,
    delete_mailing_lists,
    get_group,
    get_groups,
    get_mailing_list,
    get_mailing_lists,
    get_member,
    remove_group_email,
    remove_group_member,
    remove_mailing_list_email,
    remove_mailing_list_recipient,
    remove_member_from_group,
    remove_member_from_mailing_list,
    set_group_email_enabled,
    set_mailing_list_email_enabled,
    update_group,
    update_mailing_list,
)
from suite.mail.doctype.user_account.user_account import get_user_personal_jmap_account
from suite.mail.stalwart import get_mailing_list_address_index
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestAdminGroupsAndLists(StalwartIntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.member1 = cls.create_member()
        cls.member2 = cls.create_member()

    def test_group_crud_and_membership(self):
        group_id = self.create_group()
        detail = get_group(group_id)
        group_name = detail["name"]

        rows = get_groups(search=group_name)
        self.assertEqual([g["id"] for g in rows], [group_id])
        self.assertEqual(detail["email"], f"{group_name}@{self.domain}")
        self.assertEqual(detail["members"], [])

        update_group(group_id, description="Renamed Group")
        self.assertEqual(get_group(group_id)["description"], "Renamed Group")

        # Alias addresses on the group.
        alias = f"{unique_name('galias')}@{self.domain}"
        add_group_email(group_id, alias)
        aliases = {e["email"]: e for e in get_group(group_id)["email_addresses"]}
        self.assertIn(alias, aliases)
        self.assertFalse(aliases[alias]["is_primary"])

        set_group_email_enabled(group_id, alias, 0)
        aliases = {e["email"]: e for e in get_group(group_id)["email_addresses"]}
        self.assertFalse(aliases[alias]["enabled"])

        remove_group_email(group_id, alias)
        self.assertNotIn(alias, [e["email"] for e in get_group(group_id)["email_addresses"]])

        # Membership, from both the group side and the member side.
        account1 = get_user_personal_jmap_account(self.member1.email)
        add_group_members(group_id, [account1])
        self.assertIn(account1, [m["id"] for m in get_group(group_id)["members"]])
        self.assertIn(group_id, [g["id"] for g in get_member(self.member1.email)["groups"]])

        remove_group_member(group_id, account1)
        self.assertEqual(get_group(group_id)["members"], [])

        add_member_to_groups(self.member1.email, [group_id])
        self.assertIn(account1, [m["id"] for m in get_group(group_id)["members"]])
        remove_member_from_group(self.member1.email, group_id)
        self.assertEqual(get_group(group_id)["members"], [])

        throwaway = self.create_group()
        delete_groups([throwaway])
        self.assertEqual([g for g in get_groups() if g["id"] == throwaway], [])

    def test_mailing_list_crud_and_recipients(self):
        list_id = self.create_mailing_list()
        detail = get_mailing_list(list_id)
        list_name = detail["name"]

        rows = get_mailing_lists(search=list_name)
        self.assertEqual([ml["id"] for ml in rows], [list_id])
        self.assertEqual(rows[0]["recipient_count"], 0)
        self.assertEqual(detail["email"], f"{list_name}@{self.domain}")

        update_mailing_list(list_id, description="Renamed List")
        self.assertEqual(get_mailing_list(list_id)["description"], "Renamed List")

        # Alias addresses on the list.
        alias = f"{unique_name('lalias')}@{self.domain}"
        add_mailing_list_email(list_id, alias)
        self.assertIn(alias, [e["email"] for e in get_mailing_list(list_id)["email_addresses"]])
        set_mailing_list_email_enabled(list_id, alias, 0)
        aliases = {e["email"]: e for e in get_mailing_list(list_id)["email_addresses"]}
        self.assertFalse(aliases[alias]["enabled"])
        remove_mailing_list_email(list_id, alias)
        self.assertNotIn(alias, [e["email"] for e in get_mailing_list(list_id)["email_addresses"]])

        # Recipients: an internal member plus an external address.
        external = "external@elsewhere.example.org"
        add_mailing_list_recipients(list_id, [self.member1.email, external])
        recipients = get_mailing_list(list_id)["recipients"]
        self.assertIn(self.member1.email, recipients)
        self.assertIn(external, recipients)

        remove_mailing_list_recipient(list_id, external)
        self.assertNotIn(external, get_mailing_list(list_id)["recipients"])

        # Member-side endpoints, matched by any of the member's addresses.
        add_member_to_mailing_lists(self.member2.email, [list_id])
        self.assertIn(self.member2.email, get_mailing_list(list_id)["recipients"])
        self.assertIn(list_id, [ml["id"] for ml in get_member(self.member2.email)["mailing_lists"]])

        remove_member_from_mailing_list(self.member2.email, list_id)
        self.assertNotIn(self.member2.email, get_mailing_list(list_id)["recipients"])

        throwaway = self.create_mailing_list()
        delete_mailing_lists([throwaway])
        self.assertEqual([ml for ml in get_mailing_lists() if ml["id"] == throwaway], [])

    def test_mailing_list_address_index_resolves_every_live_address(self):
        """The index calendar invites use to turn a list address into its members."""

        list_id = self.create_mailing_list()
        add_mailing_list_recipients(list_id, [self.member1.email])
        primary = get_mailing_list(list_id)["email"]

        enabled = f"{unique_name('lalias')}@{self.domain}"
        disabled = f"{unique_name('lalias')}@{self.domain}"
        add_mailing_list_email(list_id, enabled)
        add_mailing_list_email(list_id, disabled)
        set_mailing_list_email_enabled(list_id, disabled, 0)

        index = get_mailing_list_address_index()

        self.assertEqual(index.get(primary), [self.member1.email.lower()])
        self.assertEqual(index.get(enabled), [self.member1.email.lower()])
        # Mail to a disabled alias is not delivered, so an invite to it must not expand either.
        self.assertNotIn(disabled, index)

    def test_mail_to_list_reaches_recipient_inbox(self):
        self.disable_screening(self.member2)
        list_id = self.create_mailing_list()
        add_mailing_list_recipients(list_id, [self.member2.email])
        list_email = get_mailing_list(list_id)["email"]

        subject = f"List delivery {unique_name('subject')}"
        result = self.send_mail(self.member1, list_email, subject=subject)
        self.assertEqual(result["status"], "Submitted", result.get("error"))

        self.wait_until(
            lambda: any(subject in str(thread) for thread in self.get_inbox_threads(self.member2)),
            timeout=60,
            message=f"Mail to {list_email} did not reach {self.member2.email}'s inbox.",
        )

    def test_non_admin_cannot_manage_groups_and_lists(self):
        with self.set_user(self.member1.email):
            self.assertRaises(frappe.PermissionError, get_groups)
            self.assertRaises(frappe.PermissionError, add_group, unique_name("group"), self.domain)
            self.assertRaises(frappe.PermissionError, get_mailing_lists)
            self.assertRaises(frappe.PermissionError, add_mailing_list, unique_name("list"), self.domain)
            self.assertRaises(frappe.PermissionError, delete_groups, ["any-id"])
            self.assertRaises(frappe.PermissionError, delete_mailing_lists, ["any-id"])
