"""Completed recording artifacts belonging to the signed-in room owner."""

import frappe
from frappe import _

from suite import drive


@frappe.whitelist()
def get_recordings() -> list[dict]:
    if frappe.session.user == "Guest":
        frappe.throw(_("Authentication required"), frappe.AuthenticationError)
    recordings = frappe.get_all(
        "Meet Recording",
        filters={
            "room_owner": frappe.session.user,
            "status": ["in", ["Ready", "Partial"]],
            "artifact": ["is", "set"],
        },
        fields=["name", "meet_room", "started_at", "artifact", "artifact_duration", "status"],
        order_by="started_at desc",
        limit=100,
    )
    visible = []
    for recording in recordings:
        try:
            drive.check(recording.artifact, 1)
        except drive.DriveError:
            # Drive refuses with its own types, not Frappe's permission errors,
            # so an artifact that is gone or unreadable skips one recording
            # instead of failing the list.
            continue
        visible.append(recording)
    if not visible:
        return []
    room_titles = {
        room.name: room.title
        for room in frappe.get_all(
            "Meet Room",
            filters={"name": ["in", list({recording.meet_room for recording in visible})]},
            fields=["name", "title"],
        )
    }
    for recording in visible:
        recording["room_title"] = room_titles.get(recording.meet_room)
    return visible
