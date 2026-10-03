# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt
"""The sheet body endpoints on a linked sheet answer through Drive.

`/d/<node>` opens a sheet with the access the Drive session has, and that
includes a Guest who holds a share link. So `get_sheet`, `save_sheet` and
`yjs_relay` must read the request's `X-Drive-Links` header the way Drive does,
and a trashed sheet must open read-only rather than not at all.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from unittest import mock

import frappe
from frappe.tests import IntegrationTestCase
from frappe.tests.test_api import make_request
from frappe.utils import get_test_client
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite import drive
from suite.sheets import api
from suite.tests.utils import ensure_user

OWNER = "sheets-link-owner@example.com"
STRANGER = "sheets-link-stranger@example.com"
DRIVE = "/api/suite/drive"
BODY = json.dumps({"sheets": [{"name": "Sheet1", "cells": {"A1": {"v": "4242"}}}]})
REFUSED = (frappe.PermissionError, drive.DriveError)


@contextmanager
def link_header(*codes: str):
    """Carry the given link codes in `X-Drive-Links`, as the Drive client does."""
    environ = EnvironBuilder(
        path="/api/method/suite.sheets.api.get_sheet", headers={"X-Drive-Links": ",".join(codes)}
    )
    previous = getattr(frappe.local, "request", None)
    frappe.local.request = Request(environ.get_environ())
    try:
        yield
    finally:
        frappe.local.request = previous


class TestSheetBodyThroughDrive(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for user in (OWNER, STRANGER):
            ensure_user(user)
        frappe.db.commit()

    # Drive's package root has no workflow to share, trash or purge a node.
    # The fixtures use Drive's public HTTP API instead, as the owner. Its
    # requests run on their own connection, so each side commits before the
    # other reads.
    CLIENT = get_test_client(use_cookies=False)

    def setUp(self):
        super().setUp()
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.name = api.create_sheet(title=f"Linked {frappe.generate_hash(6)}")
        self.node = frappe.db.get_value("Sheet", self.name, "node")
        frappe.db.commit()
        self.owner_sid = self._session_for(OWNER)
        self.addCleanup(self._drop)
        publish = mock.patch("suite.sheets.api.frappe.publish_realtime")
        self.published = publish.start()
        self.addCleanup(publish.stop)

    @staticmethod
    def _session_for(user: str) -> str:
        from frappe.auth import CookieManager, LoginManager
        from frappe.utils import set_request

        kept = {
            name: getattr(frappe.local, name, None)
            for name in ("request", "session", "login_manager", "cookie_manager")
        }
        set_request(path="/")
        try:
            frappe.local.cookie_manager = CookieManager()
            frappe.local.login_manager = LoginManager()
            frappe.local.login_manager.login_as(user)
            sid = frappe.session.sid
        finally:
            for name, value in kept.items():
                if value is None:
                    try:
                        delattr(frappe.local, name)
                    except AttributeError:
                        pass
                else:
                    setattr(frappe.local, name, value)
        frappe.db.commit()
        return sid

    def _drive(self, method: str, path: str, body: dict | None = None) -> dict:
        """Send one Drive request as the owner, then read what it committed."""
        frappe.db.commit()
        kwargs = {"method": method, "headers": {"Cookie": f"sid={self.owner_sid}"}}
        if body is not None:
            kwargs["json"] = body
        response = make_request(target=self.CLIENT.open, args=(f"{DRIVE}/{path}",), kwargs=kwargs)
        frappe.db.rollback()
        self.assertLess(response.status_code, 300, response.get_data(as_text=True))
        return response.get_json() or {}

    def _drop(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        if not frappe.db.exists("Drive Node", self.node):
            return
        if frappe.db.get_value("Drive Node", self.node, "state") != "Trashed":
            self._trash()
        self._drive("DELETE", f"nodes/{self.node}")

    def _link(self, role: int) -> str:
        answer = self._drive("PUT", f"nodes/{self.node}/grants/$LINK", {"role": role})
        return answer["data"]["principal"].removeprefix("$LINK:")

    def _trash(self):
        self._drive("PATCH", f"nodes/{self.node}", {"state": "Trashed"})

    def test_a_guest_with_a_read_link_opens_it_read_only(self):
        code = self._link(drive.READ)
        frappe.set_user("Guest")
        with link_header(code):
            sheet = api.get_sheet(self.name)
        self.assertEqual(sheet["name"], self.name)
        self.assertFalse(sheet["can_write"])

    def test_a_guest_without_a_link_is_refused(self):
        self._link(drive.READ)
        frappe.set_user("Guest")
        with self.assertRaises(REFUSED):
            api.get_sheet(self.name)

    def test_a_guest_with_an_edit_link_saves(self):
        code = self._link(drive.EDIT)
        frappe.set_user("Guest")
        with link_header(code):
            self.assertTrue(api.get_sheet(self.name)["can_write"])
            api.save_sheet("Ignored", BODY, name=self.name)
        frappe.set_user(OWNER)
        self.assertIn("4242", json.dumps(api.get_sheet(self.name)["sheets_data"]))

    def test_a_guest_with_a_read_link_cannot_save(self):
        code = self._link(drive.READ)
        frappe.set_user("Guest")
        with link_header(code), self.assertRaises(REFUSED):
            api.save_sheet("Ignored", BODY, name=self.name)

    def test_a_guest_with_a_read_link_relays_presence_but_not_edits(self):
        code = self._link(drive.READ)
        frappe.set_user("Guest")
        with link_header(code):
            api.yjs_relay(self.name, "yjs_awareness", "{}")
            with self.assertRaises(REFUSED):
                api.yjs_relay(self.name, "yjs_update", "{}")
        relayed = [call.args[0] for call in self.published.call_args_list if call.args[0].startswith("yjs_")]
        self.assertEqual(relayed, ["yjs_awareness"])

    def test_a_trashed_sheet_opens_read_only_and_refuses_a_save(self):
        self._trash()
        frappe.set_user(OWNER)
        sheet = api.get_sheet(self.name)
        self.assertFalse(sheet["can_write"])
        with self.assertRaises(REFUSED):
            api.save_sheet("Ignored", BODY, name=self.name)

    def test_a_relayed_update_goes_to_the_sheet_room_only(self):
        api.yjs_relay(self.name, "yjs_update", "{}")
        call = next(call for call in self.published.call_args_list if call.args[0] == "yjs_update")
        self.assertEqual((call.kwargs.get("doctype"), call.kwargs.get("docname")), ("Sheet", self.name))
        self.assertIsNone(call.kwargs.get("room"))

    def test_only_a_caller_with_drive_access_joins_the_sheet_room(self):
        """The socket server asks `frappe.realtime.has_permission` before a
        `doc_subscribe` joins `doc:Sheet/<name>`, so a stranger never
        receives the updates published there."""
        from frappe.realtime import has_permission as may_join

        self.assertTrue(may_join("Sheet", self.name))
        frappe.set_user(STRANGER)
        with self.assertRaises(REFUSED):
            may_join("Sheet", self.name)
