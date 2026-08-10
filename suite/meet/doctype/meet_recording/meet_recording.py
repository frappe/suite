# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, get_datetime

ACTIVE_RECORDING_STATUSES = ("Recording", "Interrupted", "Stopping")
TERMINAL_STATUSES = ("Ready", "Partial", "Failed")
IMMUTABLE_FIELDS = ("meet_room", "room_owner", "initiated_by", "recorder_job_id", "request_id")
WRITE_ONCE_FIELDS = ("grant_jti", "grant_issued_at", "grant_expires_at", "stop_operation_id")
ALLOWED_TRANSITIONS = {
    "Pending": {"Recording"},
    "Recording": {"Interrupted", "Stopping", "Failed"},
    "Interrupted": {"Recording", "Stopping", "Failed"},
    "Stopping": {"Processing", "Failed"},
    "Processing": {"Ready", "Partial", "Failed"},
}


class MeetRecording(Document):
    def validate(self):
        self.validate_parties()
        self.validate_transition()
        self.validate_state()

    def validate_parties(self):
        if self.is_new():
            room = frappe.get_doc("Meet Room", self.meet_room)
            if self.room_owner != room.owner or self.room_owner == "Guest":
                frappe.throw(_("Room Owner must match the Meet Room owner"))
            if not room.is_host_or_cohost(self.initiated_by):
                frappe.throw(_("Recording Initiator must be a host or co-host"))
            return

        previous = self.get_doc_before_save()
        if not previous:
            return
        if any(self.get(fieldname) != previous.get(fieldname) for fieldname in IMMUTABLE_FIELDS):
            frappe.throw(_("Recording identity cannot change"))
        if any(
            previous.get(fieldname) and self.get(fieldname) != previous.get(fieldname)
            for fieldname in WRITE_ONCE_FIELDS
        ):
            frappe.throw(_("Recording operation identifiers cannot change"))

    def validate_transition(self):
        if self.is_new():
            if self.status != "Pending" or self.state_revision != 0:
                frappe.throw(_("A recording must begin in Pending at revision 0"))
            return

        previous = self.get_doc_before_save()
        if not previous:
            return
        if previous.status in TERMINAL_STATUSES:
            changed = [
                field.fieldname for field in self.meta.fields if self.has_value_changed(field.fieldname)
            ]
            if changed:
                frappe.throw(_("A terminal recording cannot be modified"))
        if previous.status in TERMINAL_STATUSES and self.has_value_changed("status"):
            frappe.throw(_("A terminal recording cannot change state"))
        if self.has_value_changed("status"):
            if self.status not in ALLOWED_TRANSITIONS.get(previous.status, set()):
                frappe.throw(_("Invalid recording state transition"))
            if self.state_revision != previous.state_revision + 1:
                frappe.throw(_("State revision must increase by one"))
            is_host_stop = self.status == "Stopping" and previous.status in ("Recording", "Interrupted")
            if not is_host_stop and self.recorder_event_sequence <= previous.recorder_event_sequence:
                frappe.throw(_("A recording state change requires a newer recorder event"))
        elif self.state_revision != previous.state_revision:
            frappe.throw(_("State revision changes only with recording state"))
        if self.recorder_event_sequence < previous.recorder_event_sequence:
            frappe.throw(_("Recorder event sequence cannot decrease"))

    def validate_state(self):
        artifact_fields = (self.artifact, self.artifact_size, self.artifact_duration, self.artifact_sha256)
        capture_gaps = frappe.parse_json(self.capture_gaps) or []
        if not isinstance(capture_gaps, list):
            frappe.throw(_("Capture gaps must be a list"))
        previous_end = None
        for gap in capture_gaps:
            if not isinstance(gap, dict) or set(gap) != {"started_at", "ended_at", "reason"}:
                frappe.throw(_("Capture gap metadata is invalid"))
            if gap["reason"] not in ("capture_interrupted", "ffmpeg_exited", "renderer_interrupted"):
                frappe.throw(_("Capture gap reason is invalid"))
            started_at = get_datetime(gap["started_at"])
            ended_at = get_datetime(gap["ended_at"])
            if ended_at < started_at or (previous_end and started_at < previous_end):
                frappe.throw(_("Capture gaps must be ordered and non-overlapping"))
            previous_end = ended_at
        if self.status in ("Ready", "Partial"):
            if not all(artifact_fields) or not self.ended_at:
                frappe.throw(_("A completed recording requires a validated artifact"))
            if (
                cint(self.artifact_size) <= 0
                or self.artifact_duration <= 0
                or len(self.artifact_sha256) != 64
                or any(character not in "0123456789abcdef" for character in self.artifact_sha256)
            ):
                frappe.throw(_("Completed recording artifact metadata is invalid"))
            if self.failure_code:
                frappe.throw(_("A completed recording cannot have a failure code"))
        elif any(artifact_fields):
            frappe.throw(_("Only a completed recording may reference an artifact"))

        if self.status == "Partial" and not capture_gaps:
            frappe.throw(_("A partial recording requires capture gaps"))
        if self.status == "Ready" and capture_gaps:
            frappe.throw(_("A complete recording cannot have capture gaps"))
        if self.status == "Failed":
            if not self.failure_code:
                frappe.throw(_("A failed recording requires a failure code"))
        elif self.failure_code:
            frappe.throw(_("Only a failed recording may have a failure code"))

        if self.status in ("Recording", "Interrupted", "Stopping", "Processing", "Ready", "Partial"):
            if not self.started_at or not self.max_ends_at:
                frappe.throw(_("An accepted recording requires start and maximum end times"))
        if self.status in ("Processing", "Ready", "Partial") and (not self.ended_at or not self.end_reason):
            frappe.throw(_("A stopped recording requires an end time and reason"))
        if self.status in ("Pending", "Recording", "Interrupted", "Stopping") and self.ended_at:
            frappe.throw(_("An active recording cannot have an end time"))

        upload_fields = (self.upload_id, self.upload_size, self.upload_sha256, self.upload_duration_ms)
        if any(upload_fields):
            if (
                not all(upload_fields)
                or len(self.upload_id) != 40
                or not self.upload_id.isalnum()
                or cint(self.upload_size) <= 0
                or cint(self.upload_size) > cint(self.budget_bytes)
                or cint(self.upload_offset) < 0
                or cint(self.upload_offset) > cint(self.upload_size)
                or len(self.upload_sha256) != 64
                or any(character not in "0123456789abcdef" for character in self.upload_sha256)
                or cint(self.upload_duration_ms) <= 0
            ):
                frappe.throw(_("Recording upload metadata is invalid"))


def get_permission_query_conditions(user: str | None = None) -> str:
    user = user or frappe.session.user
    if user == "Administrator" or "System Manager" in frappe.get_roles(user):
        return ""
    if user == "Guest":
        return "1 = 0"
    return f"`tabMeet Recording`.`room_owner` = {frappe.db.escape(user)}"


def has_permission(doc: MeetRecording, ptype: str = "read", user: str | None = None) -> bool:
    user = user or frappe.session.user
    if user == "Administrator" or "System Manager" in frappe.get_roles(user):
        return True
    return user != "Guest" and ptype == "read" and doc.room_owner == user
