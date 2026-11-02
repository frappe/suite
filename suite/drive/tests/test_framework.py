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
SHEET_BODY = json.dumps({"sheets": [{"name": "Sheet1", "cells": {"A1": {"v": "4242"}}}]})

# Drive answers a caller below Read with 404 and Frappe's row check answers
# 403. Either one is a refusal.
REFUSED = (403, 404)


def _writer_save(document: dict) -> tuple[str, dict]:
    path = f"/api/v2/document/{quote('Writer Document')}/{document['name']}/method/save_html"
    return path, {"html": "<p>Written through the link</p>"}


def _sheet_save(document: dict) -> tuple[str, dict]:
    return "/api/method/suite.sheets.api.save_sheet", {"name": document["name"], "sheets_data": SHEET_BODY}


def _slides_save(document: dict) -> tuple[str, dict]:
    return "/api/method/suite.slides.api.slides.save_slides", {
        "name": document["name"],
        "slides": [],
        "base_modified": str(document["modified"]),
    }


# The save each editor sends, given the row it read.
SAVES = {
    "Writer Document": _writer_save,
    "Sheet": _sheet_save,
    "Presentation": _slides_save,
}


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
            for doctype in SAVES
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

    def _send(self, method: str, path: str, code: str | None, body: dict | None = None):
        headers = {"X-Drive-Links": code} if code else {}
        kwargs = {"method": method, "headers": headers}
        if body is not None:
            kwargs["json"] = body
        response = make_request(target=self.CLIENT.open, args=(path,), kwargs=kwargs)
        frappe.db.rollback()
        return response

    def _open(self, doctype: str, code: str | None):
        path = f"/api/v2/document/{quote(doctype)}/{self._docname(doctype)}"
        return self._send("GET", path, code)

    def _save(self, doctype: str, code: str | None, document: dict):
        path, body = SAVES[doctype](document)
        return self._send("POST", path, code, body)

    def _owner_row(self, doctype: str) -> dict:
        frappe.set_user(OWNER)
        return frappe.get_doc(doctype, self._docname(doctype)).as_dict()

    def test_a_guest_without_a_link_can_neither_open_nor_save(self):
        for doctype in SAVES:
            with self.subTest(doctype):
                self._link(doctype, drive.EDIT)
                self.assertIn(self._open(doctype, None).status_code, REFUSED)
                self.assertIn(self._save(doctype, None, self._owner_row(doctype)).status_code, REFUSED)

    def test_a_read_link_opens_the_document_but_does_not_save_it(self):
        for doctype in SAVES:
            with self.subTest(doctype):
                code = self._link(doctype, drive.READ)
                opened = self._open(doctype, code)
                self.assertEqual(opened.status_code, 200, opened.get_data(as_text=True))
                self.assertEqual(opened.get_json()["data"]["name"], self._docname(doctype))
                self.assertIn(self._save(doctype, code, opened.get_json()["data"]).status_code, REFUSED)

    def test_an_edit_link_opens_the_document_and_saves_it(self):
        for doctype in SAVES:
            with self.subTest(doctype):
                code = self._link(doctype, drive.EDIT)
                opened = self._open(doctype, code)
                self.assertEqual(opened.status_code, 200, opened.get_data(as_text=True))
                saved = self._save(doctype, code, opened.get_json()["data"])
                self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))

        written = self._owner_row("Writer Document")["html"]
        self.assertEqual(written, "<p>Written through the link</p>")

    def test_a_link_to_one_document_opens_no_other(self):
        code = self._link("Writer Document", drive.EDIT)
        for doctype in ("Sheet", "Presentation"):
            with self.subTest(doctype):
                self.assertIn(self._open(doctype, code).status_code, REFUSED)
