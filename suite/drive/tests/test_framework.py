"""A share link opens a content document on the paths its editor uses.

`framework.doc_has_permission` answers Frappe's row checks for every governed
doctype, and it reads the request's `X-Drive-Links` header the way every Drive
route does (§4.6). So a Guest who holds only a share link reads and saves
exactly what the link's grant allows (§6.2, CONTEXT.md "Share Link"): a Read
link opens the document, an Edit link also saves it, and no link opens
nothing.

Each case goes through real HTTP as a Guest with no session, because the
framework's role check, the whitelist's guest rule and the Drive hook all have
to agree before a link holder gets in. The document is read through
`/api/v2/document/<doctype>/<name>`, the generic row read the hook guards, and
saved through the call its editor makes.
"""

import json
from urllib.parse import quote

import frappe
from frappe.tests import IntegrationTestCase
from frappe.tests.test_api import make_request
from frappe.utils import get_test_client

from suite import drive
from suite.drive._core import content
from suite.drive._core.access import grant
from suite.drive._core.nodes import purge, update
from suite.drive._core.roots import provision_personal_root
from suite.drive.framework import principals_for
from suite.tests.utils import ensure_user

OWNER = "framework-link-owner@example.com"

# Drive answers a caller below Read with 404 and Frappe's row check answers
# 403. Either one is a refusal.
REFUSED = (403, 404)


# Each editor saves through its log, so its link is checked on open only
OPENS = ("Writer Document", "Sheet", "Presentation")


class TestShareLinkOpensContentDocuments(IntegrationTestCase):
    # Requests run on their own connection, so the fixture commits before
    # each one and cleans up what it committed.
    CLIENT = get_test_client(use_cookies=False)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")
        root = provision_personal_root(OWNER)
        suffix = frappe.generate_hash(length=6)
        self.nodes = {
            doctype: drive.create_document(root, f"Linked {doctype} {suffix}", content_doctype=doctype)
            for doctype in OPENS
        }
        frappe.db.commit()
        self.addCleanup(self._purge)

    def _purge(self):
        frappe.db.rollback()
        principals = principals_for(OWNER)
        for node in self.nodes.values():
            update(principals, node, state="Trashed")
            purge(principals, node)
        frappe.db.commit()

    def _link(self, doctype: str, role: int) -> str:
        frappe.set_user(OWNER)
        principal = grant(self.nodes[doctype], "$LINK", role, principals_for(OWNER))["principal"]
        frappe.db.commit()
        return principal.removeprefix("$LINK:")

    def _docname(self, doctype: str) -> str:
        return frappe.db.get_value(doctype, {content.spec_for(doctype).node_field: self.nodes[doctype]})

    def _open(self, doctype: str, code: str | None):
        path = f"/api/v2/document/{quote(doctype)}/{self._docname(doctype)}"
        headers = {"X-Drive-Links": code} if code else {}
        response = make_request(
            target=self.CLIENT.open, args=(path,), kwargs={"method": "GET", "headers": headers}
        )
        frappe.db.rollback()
        return response

    def test_a_guest_without_a_link_cannot_open(self):
        for doctype in OPENS:
            with self.subTest(doctype):
                self._link(doctype, drive.EDIT)
                self.assertIn(self._open(doctype, None).status_code, REFUSED)

    def test_a_read_link_opens_the_document(self):
        for doctype in OPENS:
            with self.subTest(doctype):
                opened = self._open(doctype, self._link(doctype, drive.READ))
                self.assertEqual(opened.status_code, 200, opened.get_data(as_text=True))
                self.assertEqual(opened.get_json()["data"]["name"], self._docname(doctype))

    def test_an_edit_link_opens_the_document(self):
        for doctype in OPENS:
            with self.subTest(doctype):
                opened = self._open(doctype, self._link(doctype, drive.EDIT))
                self.assertEqual(opened.status_code, 200, opened.get_data(as_text=True))

    def test_a_link_to_one_document_opens_no_other(self):
        code = self._link("Writer Document", drive.EDIT)
        for doctype in ("Sheet", "Presentation"):
            with self.subTest(doctype):
                self.assertIn(self._open(doctype, code).status_code, REFUSED)
