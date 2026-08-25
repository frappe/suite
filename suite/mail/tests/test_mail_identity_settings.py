# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.mail.api.account import (
    get_calendar_client_config,
    get_identities,
    get_mail_client_config,
    get_participant_identities,
    get_quota,
    get_user_info,
    set_signature,
)
from suite.mail.doctype.identity.identity import add_identity, delete_identities, update_identity
from suite.mail.doctype.participant_identity.participant_identity import (
    add_participant_identity,
    update_participant_identity,
)
from suite.mail.doctype.sieve_script.sieve_script import AUTOMATION_SCRIPT_NAME
from suite.mail.doctype.vacation_response.vacation_response import (
    get_vacation_response,
    update_vacation_response,
)
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestMailIdentitySettings(StalwartIntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.member = cls.create_member()
        cls.account = cls.personal_account(cls.member)

    def test_identities(self):
        with self.set_user(self.member.email):
            identities = get_identities(self.account)
            self.assertIn(self.member.email, [i["email"] for i in identities])

            identity_id = add_identity(self.account, self.member.email, name="Alternate Persona")
            rows = {i["id"]: i for i in get_identities(self.account)}
            self.assertEqual(rows[identity_id]["_name"], "Alternate Persona")

            update_identity(self.account, identity_id, name="Renamed Persona")
            rows = {i["id"]: i for i in get_identities(self.account)}
            self.assertEqual(rows[identity_id]["_name"], "Renamed Persona")

            set_signature(
                rows[identity_id]["name"],
                "<div>Kind regards</div><div>Alex</div>"
                '<div><a href="https://example.com/team">our team page</a></div>',
            )
            rows = {i["id"]: i for i in get_identities(self.account)}
            self.assertIn("Kind regards", rows[identity_id]["html_signature"] or "")
            # The text form is the same signature, not a one-line trace of it: JMAP carries
            # both and a client renders whichever part it shows.
            self.assertEqual(
                rows[identity_id]["text_signature"],
                "Kind regards\nAlex\nour team page <https://example.com/team>",
            )

            delete_identities(self.account, [identity_id])
            self.assertNotIn(identity_id, [i["id"] for i in get_identities(self.account)])

    def test_participant_identities(self):
        with self.set_user(self.member.email):
            # A default participant identity for the primary address exists after account setup.
            rows = get_participant_identities(self.account)
            default = next(i for i in rows if i["email"] == self.member.email)

            update_participant_identity(self.account, default["id"], "Renamed Cal Persona", self.member.email)
            rows = {i["id"]: i for i in get_participant_identities(self.account)}
            self.assertEqual(rows[default["id"]]["_name"], "Renamed Cal Persona")

            # A calendar address can carry only one participant identity.
            self.assertRaisesRegex(
                frappe.ValidationError,
                "already in use",
                add_participant_identity,
                self.account,
                "Duplicate",
                self.member.email,
            )

    def test_delete_participant_identity(self):
        from suite.mail.api.admin import add_member_email
        from suite.mail.doctype.participant_identity.participant_identity import (
            delete_participant_identities,
        )

        # Adding an alias makes the server create a participant identity for it automatically.
        alias = f"{unique_name('alias')}@{self.domain}"
        add_member_email(self.member.email, alias)

        with self.set_user(self.member.email):
            row = self.wait_until(
                lambda: next(
                    (i for i in get_participant_identities(self.account) if i["email"] == alias), None
                ),
                message="No participant identity appeared for the new alias.",
            )

            delete_participant_identities(self.account, [row["id"]])
            self.assertNotIn(row["id"], {i["id"] for i in get_participant_identities(self.account)})

    def test_vacation_response(self):
        with self.set_user(self.member.email):
            update_vacation_response(
                self.account,
                enabled=1,
                subject="Out of office",
                html_body="<div>Back next week.</div><div>Ask ops@example.com if urgent.</div>",
                text_body="ignored, the HTML body is authoritative",
            )
            vacation = get_vacation_response(self.account)
            self.assertTrue(vacation["enabled"])
            self.assertEqual(vacation["subject"], "Out of office")
            # Derived from the HTML rather than taken from the caller, and keeping its shape:
            # an auto-reply is read as plain text by whoever gets it.
            self.assertEqual(vacation["text_body"], "Back next week.\nAsk ops@example.com if urgent.")

            # Turning vacation off reactivates the previously active (automation) script.
            update_vacation_response(self.account, enabled=0)
            self.assertFalse(get_vacation_response(self.account)["enabled"])

            from suite.mail.api.sieve import get_sieve_scripts

            scripts = {s["_name"]: s for s in get_sieve_scripts(self.account)}
            self.assertTrue(scripts[AUTOMATION_SCRIPT_NAME]["active"])

        # From/to validation.
        with self.set_user(self.member.email):
            self.assertRaisesRegex(
                frappe.ValidationError,
                "must be after",
                update_vacation_response,
                self.account,
                1,
                "2026-01-02T00:00:00Z",
                "2026-01-01T00:00:00Z",
                "s",
            )

    def test_quota_and_user_info(self):
        with self.set_user(self.member.email):
            quota = get_quota(self.account)
            for key in ("disk_quota", "used_quota", "used_percentage"):
                self.assertIn(key, quota)

            info = get_user_info()
            self.assertEqual(info["email"], self.member.email)
            self.assertTrue(info["accounts"])
            self.assertIn(self.account, [a["account"] for a in info["accounts"]])

    def test_client_configs(self):
        with self.set_user(self.member.email):
            self.assertIsInstance(get_mail_client_config(), list)

            calendar = get_calendar_client_config()
            self.assertIsInstance(calendar, dict)
            if calendar.get("calendar_url"):
                self.assertIn(self.member.email, calendar["calendar_url"])
                self.assertEqual(calendar.get("username"), self.member.email)

    def test_user_settings_actions(self):
        settings = frappe.get_doc("User Settings", {"user": self.member.email})

        with self.set_user(self.member.email):
            settings.clear_jmap_session()
            self.assertRaises(frappe.PermissionError, settings.show_app_password)

        # Only the Administrator may reveal the app password.
        self.assertTrue(settings.show_app_password())
