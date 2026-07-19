# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import frappe
import jwt
from frappe.tests import IntegrationTestCase

from suite.meet.api.meeting import get_sfu_presence_preview_token, join_meeting


class IntegrationTestPresencePreview(IntegrationTestCase):
	def setUp(self):
		frappe.conf.sfu_secret = "test-sfu-secret"
		self.host = "preview-host@example.com"
		self.cohost = "preview-cohost@example.com"
		self.member = "preview-member@example.com"
		self.outsider = "preview-outsider@example.com"

		for email, first_name in (
			(self.host, "Preview Host"),
			(self.cohost, "Preview Cohost"),
			(self.member, "Preview Member"),
			(self.outsider, "Preview Outsider"),
		):
			self._ensure_user(email, first_name)

		frappe.set_user(self.host)
		self.meeting = frappe.get_doc(
			{
				"doctype": "Sae Meeting",
				"meeting_type": "restricted",
				"allow_guest": 1,
			}
		).insert(ignore_permissions=True)

	def test_restricted_outsider_cannot_get_presence_preview_token(self):
		frappe.set_user(self.outsider)

		with self.assertRaises(frappe.PermissionError):
			get_sfu_presence_preview_token(self.meeting.name)

	def test_waiting_user_can_get_presence_preview_token(self):
		frappe.set_user(self.outsider)
		join_meeting(self.meeting.name)

		self._assert_preview_token(get_sfu_presence_preview_token(self.meeting.name))

	def test_existing_member_can_get_presence_preview_token(self):
		self.meeting.add_user_to_table("members", self.member, save=True, ignore_permissions=True)
		frappe.set_user(self.member)

		self._assert_preview_token(get_sfu_presence_preview_token(self.meeting.name))

	def test_cohost_can_get_presence_preview_token(self):
		self.meeting.add_user_to_table("co_hosts", self.cohost, save=True, ignore_permissions=True)
		frappe.set_user(self.cohost)

		self._assert_preview_token(get_sfu_presence_preview_token(self.meeting.name))

	def _assert_preview_token(self, result: dict):
		decoded = jwt.decode(
			result["auth_token"],
			frappe.conf.sfu_secret,
			algorithms=["HS256"],
		)
		self.assertEqual(decoded["scope"], "presence-preview")

	def _ensure_user(self, email: str, first_name: str):
		if frappe.db.exists("User", email):
			return

		frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": first_name,
				"enabled": 1,
				"new_password": "password",
			}
		).insert(ignore_permissions=True)
