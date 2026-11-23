# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt
"""A deck's preview reaches Drive through Drive's own preview route.

The editor captures the first slide and sends it to
`POST /api/suite/drive/nodes/<node>/preview` (§9.2, [012 §8]). These cases send
whole requests, so the route table, the argument binding and the refusal
envelope are the ones a browser meets. A request runs on its own connection,
so each side commits before the other reads.
"""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.tests.test_api import make_request
from frappe.utils import get_test_client

from suite import drive
from suite.slides.tests.utils import WEBP_1PX, make_presentation, node_of, share
from suite.tests.utils import ensure_user, session_for

OWNER = "slides-preview-owner@example.com"
READER = "slides-preview-reader@example.com"
DRIVE = "/api/suite/drive"
CAPTURE = {"image": WEBP_1PX, "mime": "image/webp"}


class TestDeckPreviewRoute(IntegrationTestCase):
    CLIENT = get_test_client(use_cookies=False)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for user in (OWNER, READER):
            ensure_user(user)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.deck = make_presentation(f"Previewed {frappe.generate_hash(6)}").name
        self.node = node_of(self.deck)
        share(self.deck, READER, drive.READ)
        frappe.db.commit()
        self.addCleanup(self._purge)

    def _send(self, user: str, method: str, path: str, body: dict | None = None):
        sid = session_for(user)
        kwargs = {"method": method, "headers": {"Cookie": f"sid={sid}"}}
        if body is not None:
            kwargs["json"] = body
        response = make_request(target=self.CLIENT.open, args=(f"{DRIVE}/{path}",), kwargs=kwargs)
        frappe.db.rollback()
        return response

    def _purge(self):
        self._send(OWNER, "PATCH", f"nodes/{self.node}", {"state": "Trashed"})
        self._send(OWNER, "DELETE", f"nodes/{self.node}")

    def _preview_row(self):
        return frappe.db.get_value(
            "Drive Node Preview", {"node": self.node}, ["source_blob", "blob"], as_dict=True
        )

    def test_an_editor_stores_the_capture_as_the_decks_preview(self):
        stamped = frappe.db.get_value("Drive Node", self.node, ["modified", "content_modified"], as_dict=True)

        response = self._send(OWNER, "POST", f"nodes/{self.node}/preview", CAPTURE)

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertTrue(response.json["data"]["preview"]["url"])
        row = self._preview_row()
        self.assertTrue(row.blob)
        self.assertIsNone(row.source_blob, "a pushed preview names no source, so no sweep renders over it")
        self.assertEqual(
            frappe.db.get_value("Drive Node", self.node, ["modified", "content_modified"], as_dict=True),
            stamped,
            "a preview is not an edit",
        )

    def test_a_reader_is_refused_and_nothing_is_stored(self):
        response = self._send(READER, "POST", f"nodes/{self.node}/preview", CAPTURE)

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.json["errors"][0]["type"], "DriveForbidden")
        self.assertIsNone(self._preview_row())
