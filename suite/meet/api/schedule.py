from __future__ import annotations

from typing import Literal

import frappe
from frappe.utils import get_url

from suite.mail.doctype.calendar_event.calendar_event import add_calendar_event
from suite.mail.doctype.user_account.user_account import is_jmap_account_belongs_to_user
from suite.meet.api.meeting import create as create_meeting


@frappe.whitelist()
def create_scheduled_meeting(
	account: str,
	user: str | None = None,
	organizer: str | None = None,
	calendar_ids: list[str] | None = None,
	status: Literal["Tentative", "Confirmed", "Cancelled"] = "Confirmed",
	draft: bool = False,
	title: str | None = None,
	start: str | None = None,
	duration: str | None = None,
	time_zone: str | None = None,
	recurrence_rule: dict | None = None,
	show_without_time: bool = False,
	participants: list[dict] | None = None,
	description: str | None = None,
	locations: list[dict] | None = None,
	alerts: list[dict] | None = None,
	free_busy_status: str | None = "Busy",
	privacy: str | None = None,
	use_default_alerts: bool = False,
	send_scheduling_messages: bool = False,
	meeting_type: str = "open",
) -> dict[str, str]:
	"""Create a Meet room and attach it to a calendar event."""
	del user

	is_jmap_account_belongs_to_user(account, raise_exception=True)
	organizer = frappe.db.get_value("JMAP Account", account, "default_outgoing_email") or frappe.session.user

	meeting_id = create_meeting(meeting_type=meeting_type, title=title)
	meet_url = get_url(f"/meet/{meeting_id}")
	meet_description = f"Join Frappe Meet: {meet_url}"
	if description:
		description = f"{description}\n\n{meet_description}"
	else:
		description = meet_description

	event_id = add_calendar_event(
		account=account,
		organizer=organizer,
		calendar_ids=calendar_ids,
		status=status,
		draft=draft,
		title=title,
		start=start,
		duration=duration,
		time_zone=time_zone,
		recurrence_rule=recurrence_rule,
		show_without_time=show_without_time,
		free_busy_status=free_busy_status,
		privacy=privacy,
		description=description,
		locations=locations,
		links=[{"href": meet_url, "content_type": "text/html"}],
		participants=participants,
		alerts=alerts,
		use_default_alerts=use_default_alerts,
		send_scheduling_messages=send_scheduling_messages,
	)

	return {"meeting_id": meeting_id, "meeting_url": meet_url, "event_id": event_id}
