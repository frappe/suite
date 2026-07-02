# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import base64
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.meet.api.meeting import (
	_is_valid_e2ee_device_id,
	get_sfu_connection_details,
	register_e2ee_device,
)


def _b64(raw: bytes) -> str:
	return base64.b64encode(raw).decode("ascii")


class IntegrationTestE2EEEpoch(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.host_email = "host-e2ee@example.com"
		cls._ensure_user(cls.host_email, "HostE2EE")

	def setUp(self):
		frappe.conf.sfu_secret = "test-sfu-secret"

	@classmethod
	def _ensure_user(cls, email: str, first_name: str):
		if frappe.db.exists("User", email):
			user = frappe.get_doc("User", email)
		else:
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
		if not any(r.role == "Meet User" for r in user.roles):
			user.append("roles", {"role": "Meet User"})
			user.save(ignore_permissions=True)

	def _create_meeting_as_host(self):
		frappe.set_user(self.host_email)
		meeting = frappe.get_doc(
			{
				"doctype": "Sae Meeting",
				"meeting_type": "open",
				"allow_guest": 1,
			}
		).insert(ignore_permissions=True)
		return meeting

	def test_device_id_validator(self):
		self.assertTrue(_is_valid_e2ee_device_id("default"))
		self.assertTrue(_is_valid_e2ee_device_id("laptop-2026-01"))
		self.assertFalse(_is_valid_e2ee_device_id(""))
		self.assertFalse(_is_valid_e2ee_device_id("a" * 65))
		self.assertFalse(_is_valid_e2ee_device_id("has space"))

	def test_register_e2ee_device_upserts_public_key(self):
		frappe.set_user(self.host_email)
		first_key = _b64(b"\x11" * 32)
		second_key = _b64(b"\x22" * 32)

		register_e2ee_device("device-1", first_key)
		register_e2ee_device("device-1", second_key)

		stored = frappe.db.get_value(
			"E2EE Device Key",
			{"user": self.host_email, "device_id": "device-1"},
			"ed25519_public_key",
		)
		self.assertEqual(stored, second_key)

	def test_register_e2ee_device_recovers_from_concurrent_insert_race(self):
		frappe.set_user(self.host_email)
		public_key = _b64(b"\x33" * 32)
		fake_doc = MagicMock()
		fake_doc.insert.side_effect = frappe.DuplicateEntryError

		with (
			patch(
				"suite.meet.api.meeting.frappe.db.get_value",
				side_effect=[None, "existing-row"],
			),
			patch("suite.meet.api.meeting.frappe.new_doc", return_value=fake_doc),
			patch("suite.meet.api.meeting.frappe.db.set_value") as set_value,
		):
			result = register_e2ee_device("race-device", public_key)

		self.assertEqual(result, {"device_id": "race-device", "ed25519_public_key": public_key})
		set_value.assert_called_once_with(
			"E2EE Device Key",
			"existing-row",
			"ed25519_public_key",
			public_key,
			update_modified=False,
		)

	def test_enable_e2ee_enables_epoch_room(self):
		meeting = self._create_meeting_as_host()

		result = meeting.enable_e2ee()

		self.assertTrue(result)
		meeting.reload()
		self.assertTrue(meeting.e2ee_enabled)

	def test_sfu_connection_details_only_expose_e2ee_required(self):
		meeting = self._create_meeting_as_host()
		meeting.enable_e2ee()

		details = get_sfu_connection_details(meeting.name)

		self.assertTrue(details["e2ee_required"])
		self.assertNotIn("e2ee_host_public_key", details)
		self.assertNotIn("e2ee_host_signing_public_key", details)
		self.assertNotIn("e2ee_key_version", details)
