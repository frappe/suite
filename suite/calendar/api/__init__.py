import json

import frappe
from frappe import _

from suite.calendar.doctype.calendar.calendar import fetch_calendars
from suite.calendar.doctype.calendar_event.calendar_event import (
	fetch_calendar_events,
	update_calendar_event,
)
from suite.calendar.doctype.calendar_event.calendar_event import (
	get_calendar_events as get_calendar_events_by_ids,
)
from suite.mail.jmap import get_calendar_event_service


@frappe.whitelist()
def get_calendars(account: str) -> list[dict[str, str]]:
	"""Returns a list of the specified account's calendars."""

	calendars = fetch_calendars(account)

	return [{key: cal[key] for key in ["name", "_name"]} for cal in calendars]


@frappe.whitelist()
def get_calendar_events(account: str, from_date: str, to_date: str, time_zone: str) -> list[dict]:
	"""Fetches calendar events between from_date and to_date for the specified account."""

	events = fetch_calendar_events(
		account,
		{"after": from_date, "before": to_date},
		limit=999,
		time_zone=time_zone,
		expand_recurrences=True,
	)[0]

	enrich_events_with_master_data(account, events)
	enrich_participants_with_avatars(events)

	return events


def enrich_events_with_master_data(account: str, events: list[dict]) -> None:
	"""Attaches recurrence/master info to each event in-place.

	Masters are resolved through baseEventId rather than a uid query: the uid filter runs on
	the server's search index, which is updated asynchronously, so a query-based lookup misses
	events created moments ago — leaving them without a master_id (so the frontend falls back
	to the synthetic id, which cannot be updated or deleted) and with an unparsed
	recurrence_rule string until the index catches up."""

	if not events:
		return

	base_ids = get_calendar_event_service(account).get_base_event_ids(
		[event["id"] for event in events]
	)
	if not base_ids:
		return

	masters = {
		master["id"]: master
		for master in get_calendar_events_by_ids(account, sorted(set(base_ids.values())))
	}

	for event in events:
		master = masters.get(base_ids.get(event["id"]))
		if not master:
			continue

		event.update(
			{
				"recurrence_rule": json.loads(master["recurrence_rule"]),
				"master_id": master["id"],
				"master_start": master["start"],
				"master_duration": master["duration"],
			}
		)


def enrich_participants_with_avatars(events: list[dict]) -> None:
	"""Attaches user_image to each participant in-place."""
	unique_emails = list(
		dict.fromkeys(
			participant["email"]
			for event in events
			for participant in event["participants"]
			if participant.get("email")
		)
	)
	if not unique_emails:
		return

	user_data = frappe.db.get_all(
		"User", filters={"name": ["in", list(unique_emails)]}, fields=["name", "user_image"]
	)
	# Only actual profile pictures — no Gravatar fallback, so participants
	# without one render as initials in the frontend.
	user_images = {u.name: u.user_image for u in user_data if u.user_image}

	for event in events:
		for participant in event["participants"]:
			email = participant.get("email")
			if user_images.get(email):
				participant["user_image"] = user_images[email]


@frappe.whitelist()
def edit_calendar_event(account: str, id: str, **kwargs) -> None:
	event = get_calendar_events_by_ids(account, [id])[0]

	def resolve(key):
		return kwargs[key] if key in kwargs else event[key]

	calendar_ids = (
		kwargs["calendar_ids"]
		if "calendar_ids" in kwargs
		else [calendar["calendar_id"] for calendar in event["calendars"]]
	)

	update_calendar_event(
		account,
		id,
		event["uid"],
		event["organizer"],
		calendar_ids,
		resolve("status"),
		resolve("draft"),
		resolve("title"),
		resolve("start"),
		resolve("duration"),
		resolve("time_zone"),
		json.loads(resolve("recurrence_rule")),
		resolve("show_without_time"),
		resolve("privacy"),
		resolve("free_busy_status"),
		resolve("description"),
		resolve("locations"),
		resolve("links"),
		resolve("participants"),
		resolve("alerts"),
		resolve("use_default_alerts"),
		kwargs.get("send_scheduling_messages", False),
	)
