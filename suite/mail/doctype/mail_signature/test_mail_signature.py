# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

EMAIL = "signature-sync@example.test"
OLD = "<p><strong>Maya Chen</strong></p><p>Director - Growth</p>"
NEW = "<p><strong>Maya Chen</strong></p><p>Director - Marketing</p>"


class TestEditedSignatureReachesIdentities(IntegrationTestCase):
    def setUp(self) -> None:
        frappe.set_user("Administrator")
        if not frappe.db.exists("User", EMAIL):
            frappe.get_doc({"doctype": "User", "email": EMAIL, "first_name": "Maya"}).insert(
                ignore_permissions=True
            )
        self.signature = frappe.get_doc(
            {"doctype": "Mail Signature", "user": EMAIL, "signature_name": "Work", "html_body": OLD}
        ).insert(ignore_permissions=True)
        frappe.set_user(EMAIL)
        identities = [
            {"id": "a", "name": "Maya Chen", "replyTo": None, "bcc": None, "htmlSignature": OLD},
            {
                "id": "b",
                "name": "Maya at Sales",
                "replyTo": None,
                "bcc": None,
                "htmlSignature": "<p>Sales</p>",
            },
            {"id": "c", "name": "Maya", "replyTo": None, "bcc": None, "htmlSignature": None},
        ]
        self.enterContext(
            patch("suite.mail.doctype.user_account.user_account.get_user_jmap_accounts", return_value=["acc"])
        )
        self.enterContext(patch("suite.mail.jmap.get_cached_identities", return_value=identities))
        self.enterContext(patch("suite.mail.jmap.invalidate_jmap_identities_cache"))
        self.update_identity = self.enterContext(
            patch("suite.mail.doctype.identity.identity.update_identity")
        )

    def tearDown(self) -> None:
        frappe.set_user("Administrator")

    def test_an_edit_reaches_only_the_identities_carrying_the_old_signature(self) -> None:
        self.signature.html_body = NEW
        self.signature.save(ignore_permissions=True)

        self.update_identity.assert_called_once()
        *kept, text, html = self.update_identity.call_args.args
        self.assertEqual(kept, ["acc", "a", "Maya Chen", None, None])
        self.assertEqual(html, NEW)
        self.assertIn("Director - Marketing", text)

    def test_renaming_a_signature_touches_no_identity(self) -> None:
        self.signature.signature_name = "Office"
        self.signature.save(ignore_permissions=True)

        self.update_identity.assert_not_called()

    def test_an_edit_by_someone_else_touches_no_identity(self) -> None:
        frappe.set_user("Administrator")
        self.signature.html_body = NEW
        self.signature.save(ignore_permissions=True)

        self.update_identity.assert_not_called()

    def test_a_failed_identity_update_keeps_the_edit(self) -> None:
        self.update_identity.side_effect = frappe.ValidationError("refused")

        self.signature.html_body = NEW
        self.signature.save(ignore_permissions=True)

        self.assertEqual(frappe.db.get_value("Mail Signature", self.signature.name, "html_body"), NEW)
