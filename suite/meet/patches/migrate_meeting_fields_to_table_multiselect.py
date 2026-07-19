# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt

import json

import frappe
from frappe.model.document import Document


def execute():
	meetings = frappe.get_all("Meet Room", fields=["name", "members", "waiting_room"])

	for meeting in meetings:
		try:
			if meeting.members:
				try:
					members_data = json.loads(meeting.members)
					if members_data:
						for user in members_data:
							if user:
								child_doc = frappe.get_doc(
									{
										"doctype": "Meet Room User",
										"parent": meeting.name,
										"parenttype": "Meet Room",
										"parentfield": "members",
										"user": user,
									}
								)
								child_doc.insert(ignore_permissions=True)
				except (json.JSONDecodeError, TypeError):
					pass

			if meeting.waiting_room:
				try:
					waiting_data = json.loads(meeting.waiting_room)
					if waiting_data:
						for user in waiting_data:
							if user:
								child_doc = frappe.get_doc(
									{
										"doctype": "Meet Room User",
										"parent": meeting.name,
										"parenttype": "Meet Room",
										"parentfield": "waiting_room",
										"user": user,
									}
								)
								child_doc.insert(ignore_permissions=True)
				except (json.JSONDecodeError, TypeError):
					pass
		except Exception as e:
			frappe.log_error(f"Error migrating meeting {meeting.name}: {e}")
			continue

	frappe.db.commit()
