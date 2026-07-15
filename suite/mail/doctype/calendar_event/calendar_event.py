# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


import json
from typing import Literal
from uuid import uuid7

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint

from suite.mail.doctype.calendar.calendar import validate_calendar_name_format
from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.jmap import get_calendar_event_service
from suite.utils import parse_filters
from suite.utils.dt import convert_to_utc, parse_iso_datetime, utcnow


class CalendarEvent(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		from suite.mail.doctype.event_alert.event_alert import EventAlert
		from suite.mail.doctype.event_calendar.event_calendar import EventCalendar
		from suite.mail.doctype.event_link.event_link import EventLink
		from suite.mail.doctype.event_location.event_location import EventLocation
		from suite.mail.doctype.event_participant.event_participant import EventParticipant

		account: DF.Link
		after: DF.Datetime | None
		alerts: DF.Table[EventAlert]
		before: DF.Datetime | None
		calendars: DF.Table[EventCalendar]
		created_utc: DF.Data | None
		description: DF.SmallText | None
		draft: DF.Check
		duration: DF.Data | None
		free_busy_status: DF.Literal["", "Busy", "Free"]
		hide_attendees: DF.Check
		id: DF.Data | None
		links: DF.Table[EventLink]
		locations: DF.Table[EventLocation]
		may_invite_others: DF.Check
		may_invite_self: DF.Check
		organizer: DF.Data | None
		origin: DF.Check
		participants: DF.Table[EventParticipant]
		privacy: DF.Literal["", "Public", "Private"]
		recurrence_id: DF.Data | None
		recurrence_id_time_zone: DF.Autocomplete | None
		recurrence_rule: DF.JSON | None
		send_scheduling_messages: DF.Check
		sequence: DF.Int
		show_without_time: DF.Check
		start: DF.Data | None
		status: DF.Literal["Tentative", "Confirmed", "Cancelled"]
		time_zone: DF.Autocomplete | None
		title: DF.Data | None
		uid: DF.Data | None
		updated_utc: DF.Data | None
		use_default_alerts: DF.Check
	# end: auto-generated types

	@property
	def calendar_ids(self) -> list[str]:
		"""Returns a list of calendar IDs associated with the event."""

		calendar_ids = []
		for calendar in self.calendars:
			calendar_id = calendar.get("calendar_id")
			if not calendar_id:
				frappe.throw(_("Row #{0}: Calendar ID is required.").format(calendar.idx))
			calendar_ids.append(calendar_id)

		return calendar_ids

	@property
	def formatted_recurrence_rule(self) -> dict | None:
		"""Returns the formatted recurrence rule for the event."""

		if self.recurrence_rule:
			return json.loads(self.recurrence_rule)

	@property
	def formatted_locations(self) -> list[dict] | None:
		"""Returns the formatted locations for the event."""

		if self.locations:
			return [{"uid": l.uid, "name": l._name} for l in self.locations]

	@property
	def formatted_links(self) -> list[dict] | None:
		"""Returns the formatted links for the event."""

		if self.links:
			return [{"uid": l.uid, "href": l.href, "content_type": l.content_type} for l in self.links]

	@property
	def formatted_alerts(self) -> list[dict] | None:
		"""Returns the formatted alerts for the event."""

		if self.alerts and not self.use_default_alerts:
			return [
				{
					"uid": a.uid,
					"action": a.action,
					"type": a.type,
					"relative_to": a.relative_to,
					"offset": a.offset,
					"when": a.when,
				}
				for a in self.alerts
			]

	@property
	def formatted_participants(self) -> list[dict] | None:
		"""Returns the formatted participants for the event."""

		if self.participants:
			return [
				{
					"uid": p.uid,
					"name": p._name,
					"email": p.email,
					"kind": p.kind,
					"roles": json.loads(p.roles),
					"schedule_id": p.schedule_id,
					"send_to": json.loads(p.send_to),
					"participation_status": p.participation_status,
					"expect_reply": bool(p.expect_reply),
					"description": p.description,
					"comment": p.comment,
				}
				for p in self.participants
			]

	def db_insert(self, *args, **kwargs) -> None:
		self.id = add_calendar_event(
			account=self.account,
			organizer=self.organizer,
			calendar_ids=self.calendar_ids,
			status=self.status,
			draft=bool(self.draft),
			title=self.title,
			start=self.start,
			duration=self.duration,
			time_zone=self.time_zone,
			recurrence_rule=self.formatted_recurrence_rule,
			show_without_time=bool(self.show_without_time),
			privacy=self.privacy,
			free_busy_status=self.free_busy_status,
			description=self.description,
			locations=self.formatted_locations,
			links=self.formatted_links,
			participants=self.formatted_participants,
			alerts=self.formatted_alerts,
			use_default_alerts=bool(self.use_default_alerts),
			send_scheduling_messages=bool(self.send_scheduling_messages),
		)
		self.name = f"{self.account}|{self.id}"
		self.reload()

	def load_from_db(self) -> "CalendarEvent":
		account, id = parse_calendar_event_name(self.name)
		if events := get_calendar_events(account, [id]):
			return super(Document, self).__init__(events[0])

		frappe.throw(
			_("Calendar Event with ID {0} not found in account {1}.").format(
				frappe.bold(id), frappe.bold(account)
			),
			title=_("Calendar Event Not Found"),
		)

	def db_update(self) -> None:
		account, id = parse_calendar_event_name(self.name)
		update_calendar_event(
			account=account,
			id=id,
			uid=self.uid,
			organizer=self.organizer,
			calendar_ids=self.calendar_ids,
			status=self.status,
			draft=bool(self.draft),
			title=self.title,
			start=self.start,
			duration=self.duration,
			time_zone=self.time_zone,
			recurrence_rule=self.formatted_recurrence_rule,
			show_without_time=bool(self.show_without_time),
			privacy=self.privacy,
			free_busy_status=self.free_busy_status,
			description=self.description,
			locations=self.formatted_locations,
			links=self.formatted_links,
			participants=self.formatted_participants,
			alerts=self.formatted_alerts,
			use_default_alerts=bool(self.use_default_alerts),
			send_scheduling_messages=bool(self.send_scheduling_messages),
		)
		self.reload()

	def delete(self) -> None:
		account, id = parse_calendar_event_name(self.name)
		if self.get("recurrence_id") and self.get("uid"):
			delete_calendar_event_instance(account, self.uid, self.recurrence_id)
		else:
			delete_calendar_events(account, [id])

	@staticmethod
	def get_list(filters=None, page_length=20, **kwargs) -> list:
		filters = parse_filters(filters)

		title = filters.get("title")
		calendar = filters.get("calendar")
		account = filters.get("account")

		if not account:
			frappe.msgprint(_("Please select an account to view calendar events."), alert=True)
			return []

		after = filters.get("after") and convert_to_utc(filters.get("after"), naive=True).strftime(
			"%Y-%m-%dT%H:%M:%SZ"
		)
		before = filters.get("before") and convert_to_utc(filters.get("before"), naive=True).strftime(
			"%Y-%m-%dT%H:%M:%SZ"
		)

		filter = {}
		if title:
			filter["title"] = title
		if calendar:
			validate_calendar_name_format(calendar)
			filter["inCalendar"] = calendar.split("|")[1]
		if after:
			filter["after"] = after
		if before:
			filter["before"] = before
		limit = cint(kwargs.get("start")) + page_length
		events, total = fetch_calendar_events(account, filter, limit=limit)
		frappe.cache.set_value(_get_total_cache_key(account), total, expires_in_sec=600)

		if not events:
			frappe.msgprint(_("No calendar events found."), alert=True)

		return events

	@staticmethod
	def get_count(filters=None, **kwargs) -> int:
		filters = parse_filters(filters)
		account = filters.get("account")

		if account:
			if get_user_for_jmap_account(account, raise_exception=False):
				return cint(frappe.cache.get_value(_get_total_cache_key(account)))

		return 0

	@staticmethod
	def get_stats(**kwargs) -> dict:
		return {}

	def validate(self) -> None:
		self.validate_draft()
		self.validate_calendars()
		self.validate_send_scheduling_messages()

	def validate_draft(self) -> None:
		"""Validates that an existing event cannot be marked as draft."""

		if not self.is_new() and self.draft:
			if self.has_value_changed("draft"):
				frappe.throw(_("Cannot mark an existing event as draft."))

		if not self.draft:
			if not self.start:
				frappe.throw(_("Start time is required for non-draft events."))
			if not self.duration:
				frappe.throw(_("Duration is required for non-draft events."))

	def validate_calendars(self) -> None:
		"""Validates that at least one calendar is associated with the event."""

		for c in self.calendars or []:
			validate_calendar_name_format(c.calendar)
			c.calendar_id = c.calendar.split("|")[1]

	def validate_send_scheduling_messages(self) -> None:
		"""Disables sending scheduling messages for draft events."""

		if self.draft:
			self.send_scheduling_messages = 0


def _get_total_cache_key(account: str) -> str:
	"""Returns a cache key for total calendar events count for the given account."""

	return f"{account}:calendar_events:total"


def parse_calendar_event_name(name: str) -> tuple[str, str]:
	"""Splits a Calendar Event name `account|id` into its bare `account` and `id`."""

	account, id = name.split("|")
	return account, id


@frappe.whitelist()
def bulk_delete(names: str | list[str]) -> None:
	"""Deletes calendar events for the given list of names."""

	if isinstance(names, str):
		names = json.loads(names)

	accounts_map = {}
	for name in names:
		account, id = parse_calendar_event_name(name)
		accounts_map.setdefault(account, []).append(id)

	for account, ids in accounts_map.items():
		delete_calendar_events(account, ids)

	frappe.msgprint(_("Calendar Events deleted successfully."), alert=True)


@frappe.whitelist()
def add_calendar_event(
	account: str,
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
	privacy: str | None = None,
	free_busy_status: str | None = None,
	description: str | None = None,
	locations: list[dict] | None = None,
	links: list[dict] | None = None,
	participants: list[dict] | None = None,
	alerts: list[dict] | None = None,
	use_default_alerts: bool = False,
	send_scheduling_messages: bool = False,
) -> str:
	"""Adds a calendar event for the given account and returns the event ID."""

	uid = uuid7().hex
	creation_id = str(uuid7())
	event = {
		"creation_id": creation_id,
		"uid": uid,
		"organizer": organizer,
		"calendar_ids": calendar_ids,
		"status": status.lower(),
		"draft": draft,
		"title": title,
		"start": start,
		"duration": duration,
		"time_zone": time_zone,
		"recurrence_rule": recurrence_rule,
		"show_without_time": show_without_time,
		"privacy": privacy.lower() if privacy else None,
		"free_busy_status": free_busy_status.lower() if free_busy_status else None,
		"description": description,
		"locations": locations,
		"links": links,
		"participants": participants,
		"alerts": alerts,
		"use_default_alerts": use_default_alerts,
	}

	service = get_calendar_event_service(account)
	response = service.create([event], send_scheduling_messages=send_scheduling_messages)

	title = _("Calendar Event Creation Error")
	if response.get("created"):
		return response["created"][creation_id]["id"]
	elif response.get("notCreated"):
		frappe.throw(_(response["notCreated"][creation_id]["description"]), title=title)
	else:
		frappe.throw(_(response["description"]), title=title)


@frappe.whitelist()
def fetch_calendar_events(
	account: str,
	filter: dict | None = None,
	position: int = 0,
	limit: int = 50,
	sort: list[dict] | None = None,
	time_zone: str | None = None,
	expand_recurrences: bool = False,
) -> list:
	"""Returns a list of calendar events for the given account based on the provided filters."""

	calendar_events = []
	service = get_calendar_event_service(account)
	data = service.query(filter, position, limit, sort, time_zone, expand_recurrences)

	ids = data.get("ids", [])
	total = data.get("total", 0)

	calendar_events.extend(get_calendar_events(account, ids))

	return calendar_events[:limit], total


@frappe.whitelist()
def get_calendar_events(account: str, ids: list[str]) -> list[dict]:
	"""Returns a list of calendar events for the specified account and IDs."""

	service = get_calendar_event_service(account)
	calendar_map = {c["id"]: c["name"] for c in service.calendars}

	events = {}
	for event in service.get(ids):
		event = format_calendar_event(account, calendar_map, event)
		events[event["id"]] = event

	return [events[id] for id in ids if id in events]


@frappe.whitelist()
def get_master_events_by_uids(account: str, uids: list[str]) -> dict:
	"""Returns a dictionary of master calendar events for the specified account and UIDs."""

	events = {}
	service = get_calendar_event_service(account)

	if master_ids := service.get_master_ids(uids):
		calendar_map = {c["id"]: c["name"] for c in service.calendars}

		for event in service.get(master_ids):
			event = format_calendar_event(account, calendar_map, event)
			events[event["uid"]] = event

	return events


@frappe.whitelist()
def update_calendar_event(
	account: str,
	id: str,
	uid: str | None = None,
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
	privacy: str | None = None,
	free_busy_status: str | None = None,
	description: str | None = None,
	locations: list[dict] | None = None,
	links: list[dict] | None = None,
	participants: list[dict] | None = None,
	alerts: list[dict] | None = None,
	use_default_alerts: bool = False,
	send_scheduling_messages: bool = False,
) -> None:
	"""Updates a calendar event for the given account and event ID."""

	event = {
		"id": id,
		"uid": uid,
		"organizer": organizer,
		"calendar_ids": calendar_ids,
		"status": status.lower(),
		"draft": draft,
		"title": title,
		"start": start,
		"duration": duration,
		"time_zone": time_zone,
		"recurrence_rule": recurrence_rule,
		"show_without_time": show_without_time,
		"privacy": privacy.lower() if privacy else None,
		"free_busy_status": free_busy_status.lower() if free_busy_status else None,
		"description": description,
		"locations": locations,
		"links": links,
		"participants": participants,
		"alerts": alerts,
		"use_default_alerts": use_default_alerts,
	}

	service = get_calendar_event_service(account)
	response = service.update([event], send_scheduling_messages=send_scheduling_messages)

	title = _("Calendar Event Update Error")
	if not response.get("updated"):
		if response.get("notUpdated"):
			frappe.throw(_(response["notUpdated"][id]["description"]), title=title)
		else:
			frappe.throw(_(response["description"]), title=title)


@frappe.whitelist()
def update_calendar_event_instance(
	account: str,
	master_id: str,
	recurrence_id: str,
	patch: dict,
	send_scheduling_messages: bool = False,
) -> None:
	"""Updates a specific instance of a recurring calendar event based on its master ID and recurrence ID."""

	service = get_calendar_event_service(account)
	response = service.update_instance(
		master_id, recurrence_id, patch, send_scheduling_messages=send_scheduling_messages
	)

	title = _("Calendar Event Instance Update Error")
	if not response.get("updated"):
		if response.get("notUpdated"):
			frappe.throw(_(response["notUpdated"][master_id]["description"]), title=title)
		else:
			frappe.throw(_(response["description"]), title=title)


@frappe.whitelist()
def delete_calendar_events(account: str, ids: list[str]) -> None:
	"""Deletes a calendar event for the given account by its ID."""

	service = get_calendar_event_service(account)
	response = service.delete(ids)

	if response.get("notDestroyed"):
		error_messages = []
		for id, error in response["notDestroyed"].items():
			error_messages.append(f"{id}: {error['description']}")
		frappe.throw(
			_("Calendar Event Deletion Error(s):<br>{0}").format("<br>".join(error_messages)),
			title=_("Calendar Event Deletion Error"),
		)


@frappe.whitelist()
def delete_calendar_event_instance(account: str, master_id: str, recurrence_id: str) -> None:
	"""Deletes a specific instance of a recurring calendar event based on its master ID and recurrence ID."""

	service = get_calendar_event_service(account)
	response = service.delete_instance(master_id, recurrence_id)

	title = _("Calendar Event Instance Deletion Error")
	if not response.get("updated"):
		if response.get("notUpdated"):
			frappe.throw(_(response["notUpdated"][master_id]["description"]), title=title)
		else:
			frappe.throw(_(response["description"]), title=title)


def format_calendar_event(account: str, calendar_map: dict, event: dict) -> dict:
	"""Formats calendar event data for display."""

	calendars = []
	for calendar_id in event["calendarIds"].keys():
		calendars.append(
			{
				"calendar": f"{account}|{calendar_id}",
				"calendar_id": calendar_id,
				"calendar_name": calendar_map.get(calendar_id),
			}
		)

	locations = [{"uid": uid, "_name": l.get("name")} for uid, l in event.get("locations", {}).items()]
	links = [
		{"uid": uid, "href": l.get("href"), "content_type": l.get("contentType")}
		for uid, l in event.get("links", {}).items()
	]
	alerts = [
		{
			"uid": uid,
			"action": a.get("action", "").title(),
			"type": a.get("trigger", {}).get("@type", ""),
			"relative_to": a.get("trigger", {}).get("relativeTo", "").title(),
			"offset": a.get("trigger", {}).get("offset", "").upper(),
			"when": a.get("trigger", {}).get("when", "").upper(),
		}
		for uid, a in event.get("alerts", {}).items()
	]

	participants = []
	for uid, p in event.get("participants", {}).items():
		p["roles"] = p.get("roles") or {}
		roles = {r.lower(): v for r, v in p.get("roles").items()}
		participants.append(
			{
				"uid": uid,
				"roles": roles,
				"kind": p["kind"].title() if p.get("kind") else "",
				"_name": p.get("name"),
				"email": p.get("calendarAddress", "").replace("mailto:", "") or p.get("email", ""),
				"schedule_id": p.get("scheduleId", ""),
				"send_to": p.get("sendTo", {}),
				"participation_status": p["participationStatus"].upper()
				if p.get("participationStatus")
				else "",
				"expect_reply": cint(p.get("expectReply", False)),
				"description": p.get("description", ""),
				"comment": p.get("comment", ""),
			}
		)

	organizer = (
		event.get("organizerCalendarAddress")
		and event["organizerCalendarAddress"].lower().replace("mailto:", "")
	) or ""

	created = event.get("created")
	updated = event.get("updated")
	created_utc = created or updated or utcnow()
	updated_utc = updated or created or utcnow()

	return {
		"name": f"{account}|{event['id']}",
		"account": account,
		"id": event["id"],
		"uid": event["uid"],
		"recurrence_id": event.get("recurrenceId"),
		"organizer": organizer,
		"calendars": calendars,
		"status": (event.get("status") and event["status"].title()) or "Confirmed",
		"draft": cint(event.get("isDraft") or False),
		"title": event.get("title") or "",
		"start": event.get("start") or "",
		"duration": event.get("duration") or "",
		"time_zone": event.get("timeZone") or "",
		"recurrence_id_time_zone": event.get("recurrenceIdTimeZone") or "",
		"recurrence_rule": json.dumps(event.get("recurrenceRule", {}), indent=2),
		"show_without_time": cint(event.get("showWithoutTime") or False),
		"privacy": (event.get("privacy") and event["privacy"].title()) or "",
		"free_busy_status": (event.get("freeBusyStatus") and event["freeBusyStatus"].title()) or "",
		"description": event.get("description") or "",
		"locations": locations,
		"links": links,
		"participants": participants,
		"alerts": alerts,
		"use_default_alerts": cint(event.get("useDefaultAlerts") or False),
		"created_utc": created_utc,
		"updated_utc": updated_utc,
		"origin": event.get("isOrigin") or False,
		"may_invite_self": cint(event.get("mayInviteSelf") or False),
		"may_invite_others": cint(event.get("mayInviteOthers") or False),
		"hide_attendees": cint(event.get("hideAttendees") or False),
		"creation": parse_iso_datetime(created_utc),
		"modified": parse_iso_datetime(updated_utc),
		"sequence": cint(event.get("sequence") or False),
	}


def has_permission(doc: "Document", ptype: str, user: str | None = None) -> bool:
	if doc.doctype != "Calendar Event":
		return False

	return bool(get_user_for_jmap_account(doc.account, raise_exception=False))
