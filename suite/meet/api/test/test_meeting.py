# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import frappe
import jwt
from frappe.tests import IntegrationTestCase

from suite.meet.api.meeting import get_sfu_connection_details


class IntegrationTestMeetingApi(IntegrationTestCase):
	def setUp(self):
		frappe.conf.sfu_secret = "test-sfu-secret"

		self.host_email = "host-meet@example.com"
		self.member_email = "member-meet@example.com"
		self.outsider_email = "outsider-meet@example.com"

		for email, first_name in (
			(self.host_email, "Host"),
			(self.member_email, "Member"),
			(self.outsider_email, "Outsider"),
		):
			self._ensure_user(email, first_name)

		self.meeting = self._create_meeting(self.host_email, meeting_type="restricted")

	def test_member_can_get_sfu_connection_details(self):
		self.meeting.add_user_to_table("members", self.member_email, save=True, ignore_permissions=True)

		frappe.set_user(self.member_email)

		result = get_sfu_connection_details(self.meeting.name)

		self.assertEqual(result["user_id"], self.member_email)
		self.assertEqual(result["meeting_id"], self.meeting.name)
		self.assertTrue(result["auth_token"])
		self.assertFalse(result["e2ee_required"])
		self.assertNotIn("e2ee_host_public_key", result)
		self.assertIn("is_host", result)
		self.assertFalse(result["is_host"])
		self.assertIn("is_cohost", result)
		self.assertFalse(result["is_cohost"])

	def test_host_gets_is_host_from_sfu_connection_details(self):
		self.meeting.add_user_to_table("members", self.host_email, save=True, ignore_permissions=True)

		frappe.set_user(self.host_email)

		result = get_sfu_connection_details(self.meeting.name)

		self.assertTrue(result["is_host"])
		self.assertFalse(result["is_cohost"])

		decoded = jwt.decode(
			result["auth_token"],
			frappe.conf.sfu_secret,
			algorithms=["HS256"],
		)

		self.assertEqual(decoded["site"], frappe.local.site)
		self.assertEqual(decoded["meeting_id"], self.meeting.name)

	def test_sfu_token_site_claim_keeps_cross_site_meetings_isolated(self):
		"""Two sites with meetings of the same name must mint tokens that
		carry different `site` claims so the SFU can route them to distinct
		rooms."""
		from suite.meet.api.meeting import _generate_sfu_token

		token_a = _generate_sfu_token(
			user_id="user-a",
			meeting_id="all-hands",
			site="site-a.example.com",
		)
		token_b = _generate_sfu_token(
			user_id="user-b",
			meeting_id="all-hands",
			site="site-b.example.com",
		)

		decoded_a = jwt.decode(token_a, frappe.conf.sfu_secret, algorithms=["HS256"])
		decoded_b = jwt.decode(token_b, frappe.conf.sfu_secret, algorithms=["HS256"])

		self.assertEqual(decoded_a["meeting_id"], decoded_b["meeting_id"])
		self.assertNotEqual(decoded_a["site"], decoded_b["site"])

	def test_restricted_meeting_non_member_cannot_get_sfu_connection_details(self):
		frappe.set_user(self.outsider_email)

		with self.assertRaises(frappe.PermissionError):
			get_sfu_connection_details(self.meeting.name)

	def _ensure_user(self, email: str, first_name: str):
		if frappe.db.exists("User", email):
			return frappe.get_doc("User", email)

		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": first_name,
				"enabled": 1,
				"new_password": "password",
			}
		)
		user.insert(ignore_permissions=True)
		return user

	def _create_meeting(self, owner: str, meeting_type: str = "open"):
		frappe.set_user(owner)
		meeting = frappe.get_doc(
			{
				"doctype": "Sae Meeting",
				"meeting_type": meeting_type,
				"allow_guest": 1,
			}
		)
		meeting.insert(ignore_permissions=True)
		return meeting
