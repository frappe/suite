# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt

import secrets
import string
from typing import ClassVar

import frappe
from frappe import _
from frappe.model.document import Document

from suite.meet import guest_access
from suite.meet.utils.user import (
    get_user_info,
    unique_users,
)
from suite.utils.rate_limiter import dynamic_rate_limit


class MeetRoom(Document):
    CONTROLLED_FIELDS: ClassVar[set[str]] = {
        "owner",
        "title",
        "calendar_event",
        "allow_guest",
        "meeting_type",
        "host_only_chat",
        "members",
        "co_hosts",
        "waiting_room",
        "banned_users",
    }

    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        from suite.meet.doctype.meet_room_user.meet_room_user import MeetRoomUser

        allow_guest: DF.Check
        banned_users: DF.Table[MeetRoomUser]
        calendar_event: DF.Data | None
        co_hosts: DF.Table[MeetRoomUser]
        e2ee_enabled: DF.Check
        meeting_type: DF.Literal["open", "restricted"]
        members: DF.Table[MeetRoomUser]
        waiting_room: DF.Table[MeetRoomUser]
    # end: auto-generated types

    def autoname(self):
        """Set the name of the meeting"""
        if not self.name:
            self.name = generate()

    def validate(self):
        self.validate_recording_policy()
        self.validate_controlled_updates()
        self.backfill_display_names()

    def validate_controlled_updates(self):
        if self.is_new():
            return

        allowed = set(getattr(self.flags, "meet_controlled_updates", None) or ())
        previous = self.get_doc_before_save()
        changed = {
            fieldname
            for fieldname in self.CONTROLLED_FIELDS
            if self.controlled_field_changed(previous, fieldname) and fieldname not in allowed
        }
        self.flags.meet_controlled_updates = set()
        if changed:
            frappe.throw(_("Use the dedicated meeting methods to update room access and participants"))

    def controlled_field_changed(self, previous, fieldname: str) -> bool:
        if fieldname not in ("members", "co_hosts", "waiting_room", "banned_users"):
            return self.get(fieldname) != previous.get(fieldname)
        current_rows = [(row.user, row.user_name) for row in self.get(fieldname) or []]
        previous_rows = [(row.user, row.user_name) for row in previous.get(fieldname) or []]
        return current_rows != previous_rows

    def allow_controlled_update(self, *fieldnames: str):
        allowed = set(getattr(self.flags, "meet_controlled_updates", None) or ())
        self.flags.meet_controlled_updates = allowed | set(fieldnames)

    def validate_recording_policy(self):
        policy_fields_changed = not self.is_new() and self.has_value_changed("e2ee_enabled")
        if policy_fields_changed and not getattr(self.flags, "recording_policy_update", False):
            frappe.throw(_("Use the dedicated meeting policy method to change E2EE"))
        if self.has_value_changed("e2ee_enabled") and self.e2ee_enabled and self.has_active_recording():
            frappe.throw(_("Stop the active recording before enabling end-to-end encryption"))

    def has_active_recording(self) -> bool:
        from suite.meet.doctype.meet_recording.meet_recording import ACTIVE_RECORDING_STATUSES

        return bool(
            frappe.db.exists(
                "Meet Recording", {"meet_room": self.name, "status": ["in", ACTIVE_RECORDING_STATUSES]}
            )
        )

    def recording_policy_lock(self):
        lock = frappe.cache.lock(f"meet-recording-policy:{frappe.local.site}:{self.name}", timeout=300)
        if not lock.acquire(blocking=True, blocking_timeout=10):
            frappe.throw(_("Meeting policy is being updated; try again"))
        frappe.db.after_commit.add(lock.release)
        frappe.db.after_rollback.add(lock.release)

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
                    self.allow_controlled_update(fieldname)
                    self.save(ignore_permissions=ignore_permissions)
            return False

        self.append(fieldname, self.build_user_row(user))
        self.allow_controlled_update(fieldname)
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

    def publish_waiting_room_updated(self):
        waiting_count = len(self.get_waiting_room()) + len(guest_access.list_pending(self.name))
        frappe.publish_realtime(
            "meeting_waiting_room_updated",
            doctype=self.doctype,
            docname=self.name,
            message={"meeting": self.name, "waiting_count": waiting_count},
            after_commit=True,
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
                self.save(ignore_permissions=True)
                return {"status": "waiting_for_approval", "message": "Waiting for host approval"}

        joined = self.add_user_to_table("members", user)

        # Add user if not already in room
        if joined:
            self.remove_from_waiting_room(user)

            self.save(ignore_permissions=True)

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

    def get_waiting_room(self):
        """Get list of users waiting for approval"""
        return self.get_table_users("waiting_room")

    def add_to_waiting_room(self, user):
        """Add user to waiting room"""
        self.add_waiting_room_user(user)

    def remove_from_waiting_room(self, user):
        """Remove user from waiting room"""
        for row in self.get("waiting_room") or []:
            if row.user == user:
                self.remove(row)
                self.allow_controlled_update("waiting_room")
                return

    def approve_user(self, user, save=True):
        """Approve a user from waiting room to join the meeting"""
        if not self.is_host_or_cohost(frappe.session.user):
            frappe.throw(_("Only hosts and co-hosts can approve join requests"))

        waiting_users = self.get_waiting_room()
        if user not in waiting_users:
            frappe.throw("User is not in waiting room")

        self.add_user_to_table("members", user)
        self.allow_controlled_update("members", "waiting_room")

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

        self.allow_controlled_update("waiting_room", "banned_users")

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

        if target_user.startswith("guest_") or not frappe.db.exists("User", target_user):
            frappe.throw(_("Only authenticated users can be promoted to co-host"))

        if self.is_host_or_cohost(target_user):
            frappe.throw(_("User is already a host or co-host"))

        if target_user not in self.get_members():
            frappe.throw(_("User is not currently in the meeting"))

    @frappe.whitelist(methods=["POST"])
    def promote_to_cohost(self, user_id: str) -> dict:
        """Promote a user to co-host during an active meeting (host only)"""
        self.lock_for_update()
        self.validate_can_promote_to_cohost(frappe.session.user, user_id)

        self.add_user_to_table("co_hosts", user_id)
        self.save()
        frappe.publish_realtime(
            "meeting:cohost_promoted",
            message={"meeting": self.name, "user": user_id},
            user=user_id,
            after_commit=True,
        )

        return {
            "meeting_id": self.name,
            "user_id": user_id,
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

    @frappe.whitelist(methods=["POST"])
    @dynamic_rate_limit()
    def approve_join_request(self, user_id: str) -> dict:
        """Approve a user's join request from the waiting room."""
        self.lock_for_update()
        if not self.is_host_or_cohost(frappe.session.user):
            frappe.throw(_("Only hosts and co-hosts can approve join requests"))
        if user_id.startswith("guest_"):
            self._approve_guest_join_request(user_id)
            self.publish_waiting_room_updated()
        else:
            self.approve_user(user_id)

        return {"meeting_id": self.name, "user_id": user_id, "message": "User approved successfully"}

    @frappe.whitelist(methods=["POST"])
    @dynamic_rate_limit()
    def approve_all_join_requests(self) -> dict:
        """Approve all users' join requests from the waiting room."""
        self.lock_for_update()
        self.approve_all_users()
        pending_guests = guest_access.list_pending(self.name)
        for lease in pending_guests:
            self._approve_guest_join_request(lease.guest_id)
        if pending_guests:
            self.publish_waiting_room_updated()

        return {"meeting_id": self.name, "message": "All users approved successfully"}

    def _approve_guest_join_request(self, guest_id: str) -> None:
        lease = guest_access.admit(self.name, guest_id)
        frappe.publish_realtime(
            "meet:guest_join_approved",
            {
                "meeting_id": self.name,
                "guest_id": guest_id,
                "guest_name": lease.guest_name,
                "message": "Your join request has been approved",
            },
            room=f"guest:{guest_id}",
            after_commit=True,
        )

    @frappe.whitelist(methods=["POST"])
    @dynamic_rate_limit()
    def reject_join_request(self, user_id: str) -> dict:
        """Reject a user's join request from the waiting room."""
        self.lock_for_update()
        if user_id.startswith("guest_"):
            if not self.is_host_or_cohost(frappe.session.user):
                frappe.throw(_("Only hosts and co-hosts can reject join requests"))
            guest_access.reject(self.name, user_id)
            frappe.publish_realtime(
                "meet:guest_join_rejected",
                {"meeting_id": self.name, "guest_id": user_id},
                room=f"guest:{user_id}",
                after_commit=True,
            )
            self.publish_waiting_room_updated()
        else:
            self.reject_user(user_id)

        return {"meeting_id": self.name, "user_id": user_id, "message": "User rejected successfully"}

    @frappe.whitelist(methods=["POST"])
    def get_waiting_room_details(self) -> dict:
        """Return display details for users waiting for approval."""
        if not self.is_host_or_cohost(frappe.session.user):
            frappe.throw(_("Access denied"))

        user_details = []
        for row in self.waiting_room or []:
            user = row.user
            user_info = get_user_info(user) or {}
            user_name = row.user_name or user_info.get("full_name") or user
            user_details.append(
                {
                    "user_id": user,
                    "full_name": user_name,
                    "user_name": user_name,
                    "user_image": user_info.get("user_image"),
                    "is_guest": user_info.get("is_guest", user.startswith("guest_")),
                }
            )

        user_details.extend(
            {
                "user_id": lease.guest_id,
                "full_name": lease.guest_name,
                "user_name": lease.guest_name,
                "user_image": None,
                "is_guest": True,
            }
            for lease in guest_access.list_pending(self.name)
        )

        return {"meeting_id": self.name, "waiting_users": user_details}

    @frappe.whitelist(methods=["POST"])
    def ban_guest(self, guest_id: str) -> dict:
        """Permanently revoke a guest's access to this Meet Room."""
        if not self.is_host_or_cohost(frappe.session.user):
            frappe.throw(_("Only hosts and co-hosts can ban guests"), frappe.PermissionError)
        guest_access.ban(self.name, guest_id)
        return {"meeting_id": self.name, "guest_id": guest_id, "status": "banned"}

    @frappe.whitelist(methods=["POST"])
    def enable_e2ee(self) -> bool:
        """Enable epoch-based E2EE for this meeting."""
        if not self.is_host_or_cohost(frappe.session.user):
            frappe.throw(_("Only hosts and co-hosts can convert meetings to E2EE"), frappe.PermissionError)

        self.recording_policy_lock()
        self.reload()
        if not self.is_host_or_cohost(frappe.session.user):
            frappe.throw(_("Only hosts and co-hosts can convert meetings to E2EE"), frappe.PermissionError)
        if self.has_active_recording():
            frappe.throw(_("Stop the active recording before enabling end-to-end encryption"))
        self.e2ee_enabled = True
        self.flags.recording_policy_update = True
        self.save()

        users_notified = set()
        payload = {"meeting_id": self.name, "e2ee_enabled": True}
        for member in self.members:
            user = member.user
            if not user or user in users_notified:
                continue
            users_notified.add(user)
            frappe.publish_realtime(
                "meeting:e2ee_enabled",
                payload,
                user=user,
                after_commit=True,
            )

        for lease in guest_access.list_admitted(self.name):
            frappe.publish_realtime(
                "meeting:e2ee_enabled",
                payload,
                room=f"guest:{lease.guest_id}",
                after_commit=True,
            )

        return True

    @frappe.whitelist(methods=["POST"])
    def update_settings(
        self,
        allow_guest: int | None = None,
        meeting_type: str | None = None,
        host_only_chat: int | None = None,
    ) -> dict:
        """
        Update meeting settings (host or co-host only)
        """

        if not self.is_host_or_cohost(frappe.session.user):
            frappe.throw(_("Only the meeting host or co-host can update settings"))

        updated_fields = {}
        if allow_guest is not None:
            global_settings = frappe.get_cached_doc("Meet Settings")
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
            self.allow_controlled_update(*updated_fields)
            self.save()

        return updated_fields

    def lock_for_update(self) -> None:
        """Lock and refresh this instance so the endpoint returns the mutated document."""
        frappe.db.get_value("Meet Room", self.name, "name", for_update=True)
        self.reload()


def generate(segment_length=4, num_segments=3, separator="-"):
    return separator.join(
        "".join(secrets.choice(string.ascii_lowercase) for _ in range(segment_length))
        for _ in range(num_segments)
    )


def get_permission_query_conditions(user: str | None = None) -> str:
    user = user or frappe.session.user
    if user == "Administrator" or "System Manager" in frappe.get_roles(user):
        return ""

    escaped_user = frappe.db.escape(user)
    return f"""
		`tabMeet Room`.`owner` = {escaped_user}
		OR EXISTS (
			SELECT 1
			FROM `tabMeet Room User` AS cohost
			WHERE cohost.parent = `tabMeet Room`.`name`
				AND cohost.parenttype = 'Meet Room'
				AND cohost.parentfield = 'co_hosts'
				AND cohost.user = {escaped_user}
		)
	"""


def has_permission(doc: MeetRoom, ptype: str = "read", user: str | None = None) -> bool:
    user = user or frappe.session.user
    if user == "Administrator" or "System Manager" in frappe.get_roles(user):
        return True

    if ptype == "create":
        return True

    if ptype == "delete":
        return doc.owner == user

    return doc.owner == user or user in doc.get_co_hosts()
