# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt

import secrets
import string

import frappe
from frappe import _
from frappe.model.document import Document

from suite.meet.utils.user import (
	get_guest_session,
	get_user_info,
	unique_users,
)


class SaeMeeting(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		from suite.meet.doctype.sae_meeting_user.sae_meeting_user import SaeMeetingUser

		allow_guest: DF.Check
		banned_users: DF.Table[SaeMeetingUser]
		co_hosts: DF.Table[SaeMeetingUser]
		meeting_type: DF.Literal["open", "restricted"]
		members: DF.Table[SaeMeetingUser]
		waiting_room: DF.Table[SaeMeetingUser]
	# end: auto-generated types

	def autoname(self):
		"""Set the name of the meeting"""
		if not self.name:
			self.name = generate()

	def validate(self):
		self.backfill_display_names()

	def backfill_display_names(self):
		"""Backfill display names for existing child rows."""
		for fieldname in ("members", "co_hosts", "waiting_room", "banned_users"):
			for row in self.get(fieldname) or []:
				if row.user and not row.user_name:
					row.user_name = self.get_user_display_name(row.user)

	def get_user_display_name(self, user: str) -> str:
		"""Resolve a display name for a member, guest, or fallback user ID."""
		user_info = get_user_info(user)
		if user_info and user_info.get("full_name"):
			return user_info.get("full_name")

		if user.startswith("guest_"):
			guest_session = get_guest_session(user)
			if guest_session and guest_session.get("guest_name"):
				return guest_session.get("guest_name")

		return user

	def build_user_row(self, user: str) -> dict:
		"""Build a child table row with both the id and display name."""
		return {"user": user, "user_name": self.get_user_display_name(user)}

	def get_table_users(self, fieldname: str) -> list[str]:
		"""Return all user IDs from a child table."""
		return [row.user for row in self.get(fieldname) or []]

	def add_user_to_table(
		self, fieldname: str, user: str, save: bool = False, ignore_permissions: bool = False
	):
		"""Append a user to a child table if they are not already present."""
		for row in self.get(fieldname) or []:
			if row.user != user:
				continue
			if not row.user_name:
				row.user_name = self.get_user_display_name(user)
				if save:
					self.save(ignore_permissions=ignore_permissions)
			return False

		self.append(fieldname, self.build_user_row(user))
		if save:
			self.save(ignore_permissions=ignore_permissions)
		return True

	def add_waiting_room_user(self, user: str, save: bool = False, ignore_permissions: bool = False):
		"""Add a user to the waiting room and notify authorized users."""
		if self.is_user_approved(user):
			return

		waiting_users = self.get_waiting_room()
		if self.add_user_to_table("waiting_room", user, save=save, ignore_permissions=ignore_permissions):
			self.publish_waiting_room_request(user, len(waiting_users) + 1)

	def get_waiting_room_payload(self, user: str) -> tuple[str, str | None]:
		"""Return display payload for waiting-room notifications."""
		user_info = get_user_info(user) or {}
		return user_info.get("full_name", user), user_info.get("user_image")

	def publish_waiting_room_request(self, user: str, waiting_count: int):
		"""Notify host and co-hosts about a waiting-room request."""
		user_name, user_image = self.get_waiting_room_payload(user)

		for authorized_user in [self.owner, *self.get_co_hosts()]:
			frappe.publish_realtime(
				"meeting_join_request",
				user=authorized_user,
				message={
					"meeting": self.name,
					"user": user,
					"user_name": user_name,
					"user_image": user_image,
					"waiting_count": waiting_count,
				},
			)

	def after_insert(self):
		self.join(frappe.session.user)

	def join(self, user=None):
		"""
		Join the meeting room

		Args:
			user: User to join (defaults to current session user)
		"""
		if not user:
			user = frappe.session.user

		if self.meeting_type == "restricted" and user != self.owner:
			if not self.is_user_approved(user):
				self.add_to_waiting_room(user)
				self.save()
				return {"status": "waiting_for_approval", "message": "Waiting for host approval"}

		joined = self.add_user_to_table("members", user)

		# Add user if not already in room
		if joined:
			self.remove_from_waiting_room(user)

			self.save()

		return {"status": "joined", "message": "Successfully joined the meeting"}

	def get_members(self):
		"""Get list of current members"""
		return self.get_table_users("members")

	def get_co_hosts(self):
		"""Get list of current co-hosts"""
		return self.get_table_users("co_hosts")

	def can_join(self, user=None):
		"""
		Check if a user can join this meeting

		Args:
			user: User to check (defaults to current session user)

		Returns:
			bool: True if user can join, False otherwise
		"""
		if not user:
			user = frappe.session.user

		return not self.is_user_banned(user)

	def update_members(self, members_list):
		"""Update members list and save"""
		self.set("members", [])
		for row in unique_users(members_list):
			user = row.get("user") if isinstance(row, dict) else row
			if user:
				self.append("members", self.build_user_row(user))

	def add_guest_to_members(self, guest_id: str):
		self.validate_guest_id(guest_id)
		self.add_user_to_table("members", guest_id, save=True, ignore_permissions=True)

	def get_waiting_room(self):
		"""Get list of users waiting for approval"""
		return self.get_table_users("waiting_room")

	def add_to_waiting_room(self, user):
		"""Add user to waiting room"""
		self.add_waiting_room_user(user)

	def add_guest_to_waiting_room(self, guest_id: str):
		self.validate_guest_id(guest_id)
		self.add_waiting_room_user(guest_id, save=True, ignore_permissions=True)

	def remove_from_waiting_room(self, user):
		"""Remove user from waiting room"""
		for row in self.get("waiting_room") or []:
			if row.user == user:
				self.remove(row)
				return

	def approve_user(self, user, save=True):
		"""Approve a user from waiting room to join the meeting"""
		if not self.is_host_or_cohost(frappe.session.user):
			frappe.throw(_("Only hosts and co-hosts can approve join requests"))

		waiting_users = self.get_waiting_room()
		if user not in waiting_users:
			frappe.throw("User is not in waiting room")

		self.add_user_to_table("members", user)

		self.remove_from_waiting_room(user)
		if save:
			self.save()

		# for signed-in users
		frappe.publish_realtime(
			"meeting_join_approved",
			user=user,
			message={"meeting": self.name, "user": user, "approved_by": frappe.session.user},
			after_commit=True,
		)

		# for guests
		if user.startswith("guest_"):
			session_data = get_guest_session(user)
			if session_data:
				guest_name = session_data.get("guest_name")
				frappe.publish_realtime(
					"meet:guest_join_approved",
					{
						"meeting_id": self.name,
						"guest_id": user,
						"guest_name": guest_name,
						"message": "Your join request has been approved",
					},
					room=f"guest:{user}",
					after_commit=True,
				)

		updated_waiting_users = self.get_waiting_room()

		authorized_users = [self.owner, *self.get_co_hosts()]
		for authorized_user in authorized_users:
			frappe.publish_realtime(
				"meeting_user_approved",
				user=authorized_user,
				message={"meeting": self.name, "user": user, "approved_by": frappe.session.user},
				after_commit=True,
			)

		frappe.publish_realtime(
			"meeting_waiting_room_updated",
			doctype=self.doctype,
			docname=self.name,
			message={"meeting": self.name, "waiting_count": len(updated_waiting_users)},
			after_commit=True,
		)

		return {"status": "joined", "message": "Successfully joined the meeting"}

	def approve_all_users(self):
		if not self.is_host_or_cohost(frappe.session.user):
			frappe.throw(_("Only hosts and co-hosts can approve join requests"))

		users = self.get_waiting_room()
		for user in users:
			self.approve_user(user, save=False)

		self.save()

	def reject_user(self, user, rejected_by=None):
		"""Reject a user from waiting room"""
		if not rejected_by:
			rejected_by = frappe.session.user

		if not self.is_host_or_cohost(rejected_by):
			frappe.throw(_("Only hosts and co-hosts can reject join requests"))

		waiting_users = self.get_waiting_room()
		if user not in waiting_users:
			frappe.throw("User is not in waiting room")

		self.remove_from_waiting_room(user)

		if not self.get("banned_users"):
			self.banned_users = []

		already_banned = any(row.user == user for row in self.banned_users)
		if not already_banned:
			self.append("banned_users", self.build_user_row(user))

		self.save()

		frappe.publish_realtime(
			"meeting_join_rejected",
			user=user,
			message={"meeting": self.name, "user": user, "rejected_by": rejected_by},
		)

		authorized_users = [self.owner, *self.get_co_hosts()]
		for authorized_user in authorized_users:
			frappe.publish_realtime(
				"meeting_user_rejected",
				user=authorized_user,
				message={"meeting": self.name, "user": user, "rejected_by": rejected_by},
			)

		updated_waiting_users = self.get_waiting_room()
		frappe.publish_realtime(
			"meeting_waiting_room_updated",
			doctype=self.doctype,
			docname=self.name,
			message={"meeting": self.name, "waiting_count": len(updated_waiting_users)},
		)

	def is_user_approved(self, user):
		"""Check if user is already approved"""

		if user == self.owner:
			return True

		members = self.get_members()
		return user in members

	def is_host_or_cohost(self, user: str) -> bool:
		"""Check if user is the host or a co-host"""
		if user == self.owner:
			return True

		co_hosts = self.get_co_hosts()
		return user in co_hosts

	def validate_can_promote_to_cohost(self, user: str, target_user: str) -> None:
		"""Validate that a user can promote another user to co-host"""
		if user != self.owner:
			frappe.throw(_("Only the meeting host can promote users to co-host"))

		if target_user.startswith("guest_"):
			frappe.throw(_("Guests cannot be promoted to co-host"))

		if self.is_host_or_cohost(target_user):
			frappe.throw(_("User is already a host or co-host"))

		if target_user not in self.get_members():
			frappe.throw(_("User is not currently in the meeting"))

	def promote_to_cohost(self, user: str, target_user: str) -> dict:
		"""Promote a user to co-host during an active meeting (host only)"""
		self.validate_can_promote_to_cohost(user, target_user)

		self.add_user_to_table("co_hosts", target_user)
		self.save()

		return {
			"meeting_id": self.name,
			"user_id": target_user,
			"message": _("User promoted to co-host successfully"),
		}

	def is_user_banned(self, user):
		"""Check if user is banned from this meeting"""
		if not self.get("banned_users"):
			return False

		banned_user_emails = [row.user for row in self.banned_users]
		return user in banned_user_emails

	def validate_guest_id(self, guest_id: str):
		if not guest_id or not isinstance(guest_id, str):
			frappe.throw(_("Invalid guest ID"))

		if not guest_id.startswith("guest_"):
			frappe.throw(_("Invalid guest ID format"))

		if len(guest_id) < 7:
			frappe.throw(_("Invalid guest ID format"))

		if self.is_user_banned(guest_id):
			frappe.throw(_("Guest is banned from this meeting"))

	@frappe.whitelist()
	def update_settings(
		self,
		allow_guest: int | None = None,
		meeting_type: str | None = None,
		host_only_chat: int | None = None,
	) -> None:
		"""
		Update meeting settings (host or co-host only)
		"""

		if not self.is_host_or_cohost(frappe.session.user):
			frappe.throw(_("Only the meeting host or co-host can update settings"))

		updated_fields = {}
		if allow_guest is not None:
			global_settings = frappe.get_cached_doc("Sae Settings")
			if not global_settings.allow_guest and allow_guest:
				frappe.throw(_("Guest access is disabled globally"))
			self.allow_guest = bool(allow_guest)
			updated_fields["allow_guest"] = self.allow_guest

		if meeting_type is not None:
			if meeting_type not in ["open", "restricted"]:
				frappe.throw(_("Invalid meeting type"))
			self.meeting_type = meeting_type
			updated_fields["meeting_type"] = self.meeting_type

		if host_only_chat is not None:
			self.host_only_chat = bool(host_only_chat)
			updated_fields["host_only_chat"] = self.host_only_chat

		if updated_fields:
			self.save()


def generate(segment_length=4, num_segments=3, separator="-"):
	return separator.join(
		"".join(secrets.choice(string.ascii_lowercase) for _ in range(segment_length))
		for _ in range(num_segments)
	)
