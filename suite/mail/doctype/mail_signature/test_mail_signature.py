# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.mail.doctype.mail_signature.mail_signature import link_identity

EMAIL = "signature-sync@example.test"
OTHER = "signature-other@example.test"
OLD = "<p><strong>Maya Chen</strong></p><p>Director - Growth</p>"
NEW = "<p><strong>Maya Chen</strong></p><p>Director - Marketing</p>"


def ensure_user(email: str) -> None:
    if not frappe.db.exists("User", email):
        frappe.get_doc({"doctype": "User", "email": email, "first_name": "Maya"}).insert(
            ignore_permissions=True
        )


def saved_signature(user: str, html: str, identities: list[str] | None = None):
    return frappe.get_doc(
        {
            "doctype": "Mail Signature",
            "user": user,
            "signature_name": "Work",
            "html_body": html,
            "identities": [{"identity": identity} for identity in identities or []],
        }
    ).insert(ignore_permissions=True)


def links_of(signature) -> list[str]:
    return [row.identity for row in frappe.get_doc("Mail Signature", signature.name).identities]


class TestEditedSignatureReachesLinkedIdentities(IntegrationTestCase):
    def setUp(self) -> None:
        frappe.set_user("Administrator")
        ensure_user(EMAIL)
        self.signature = saved_signature(EMAIL, OLD, ["acc|a"])
        frappe.set_user(EMAIL)
        # b holds the same words as a but was never given this signature
        self.identities = [
            {"id": "a", "name": "Maya Chen", "replyTo": None, "bcc": None, "htmlSignature": OLD},
            {"id": "b", "name": "Maya at Sales", "replyTo": None, "bcc": None, "htmlSignature": OLD},
            {"id": "c", "name": "Maya", "replyTo": None, "bcc": None, "htmlSignature": None},
        ]
        self.enterContext(patch("suite.mail.jmap.get_cached_identities", return_value=self.identities))
        self.enterContext(patch("suite.mail.jmap.invalidate_jmap_identities_cache"))
        self.update_identity = self.enterContext(
            patch("suite.mail.doctype.identity.identity.update_identity")
        )

    def tearDown(self) -> None:
        frappe.set_user("Administrator")

    def edit(self, html: str = NEW) -> None:
        self.signature.html_body = html
        self.signature.save(ignore_permissions=True)

    def test_an_edit_reaches_only_the_identities_given_the_signature(self) -> None:
        self.edit()

        self.update_identity.assert_called_once()
        *kept, text, html = self.update_identity.call_args.args
        self.assertEqual(kept, ["acc", "a", "Maya Chen", None, None])
        self.assertEqual(html, NEW)
        self.assertIn("Director - Marketing", text)
        self.assertEqual(links_of(self.signature), ["acc|a"])

    def test_an_identity_changed_elsewhere_keeps_its_words_and_loses_the_link(self) -> None:
        self.identities[0]["htmlSignature"] = "<p>Written in another client</p>"

        self.edit()

        self.update_identity.assert_not_called()
        self.assertEqual(links_of(self.signature), [])

    def test_a_deleted_identity_loses_the_link(self) -> None:
        del self.identities[0]

        self.edit()

        self.update_identity.assert_not_called()
        self.assertEqual(links_of(self.signature), [])

    def test_renaming_a_signature_touches_no_identity(self) -> None:
        self.signature.signature_name = "Office"
        self.signature.save(ignore_permissions=True)

        self.update_identity.assert_not_called()

    def test_an_edit_by_someone_else_touches_no_identity(self) -> None:
        frappe.set_user("Administrator")
        self.edit()

        self.update_identity.assert_not_called()

    def test_a_failed_identity_update_keeps_the_edit(self) -> None:
        self.update_identity.side_effect = frappe.ValidationError("refused")

        self.edit()

        self.assertEqual(frappe.db.get_value("Mail Signature", self.signature.name, "html_body"), NEW)


class TestGivingAnIdentityASavedSignature(IntegrationTestCase):
    def setUp(self) -> None:
        frappe.set_user("Administrator")
        ensure_user(EMAIL)
        ensure_user(OTHER)
        self.first = saved_signature(EMAIL, OLD)
        self.twin = saved_signature(EMAIL, OLD)
        self.theirs = saved_signature(OTHER, OLD)
        frappe.set_user(EMAIL)

    def tearDown(self) -> None:
        frappe.set_user("Administrator")

    def test_the_picked_one_of_two_identical_signatures_is_linked(self) -> None:
        link_identity("acc|a", self.first.name, OLD)
        link_identity("acc|a", self.twin.name, OLD)

        self.assertEqual(links_of(self.first), [])
        self.assertEqual(links_of(self.twin), ["acc|a"])

    def test_words_written_by_hand_unlink_the_identity(self) -> None:
        link_identity("acc|a", self.first.name, OLD)
        link_identity("acc|a", None, "<p>Typed for this address</p>")

        self.assertEqual(links_of(self.first), [])

    def test_a_signature_whose_words_were_not_saved_is_not_linked(self) -> None:
        link_identity("acc|a", self.first.name, "<p>Something else</p>")

        self.assertEqual(links_of(self.first), [])

    def test_someone_elses_signature_is_not_linked(self) -> None:
        link_identity("acc|a", self.theirs.name, OLD)

        self.assertEqual(links_of(self.theirs), [])

    def test_a_deleted_signature_is_no_error(self) -> None:
        link_identity("acc|a", "no-such-signature", OLD)
