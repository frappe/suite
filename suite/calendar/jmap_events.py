# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Calendar-domain JMAP helpers built on jmaplib.

Ports the payload building and recurrence/instance logic that used to live in
``CalendarEventService``. Every function takes an already-scoped client (see
``suite.mail.jmap.get_account_client``); mutators return the typed ``SetResponse`` (or a
merged ``SetResult`` for chunked calls) so callers read failures via
``suite.mail.jmap.get_set_error_message``.
"""

from uuid import uuid7

from jmap.models.responses import SetResponse

from suite.mail.jmap import (
    SetResult,
    SuiteJMAPClient,
    chunk_list,
    chunked_get,
    chunked_set,
    get_default_calendar_id,
    get_default_participant_identity,
    omit_none,
)
from suite.mail.utils.dt import normalize_utc_z
from suite.utils.dt import utcnow


def create_events(
    client: SuiteJMAPClient,
    account: str,
    events: list[dict],
    send_scheduling_messages: bool = False,
) -> SetResult:
    """Creates calendar events from snake_case event rows (same shape the old service took)."""

    payload = {}
    for event in events:
        timestamp = utcnow()

        calendar_ids = event.get("calendar_ids")
        if not calendar_ids:
            calendar_ids = [get_default_calendar_id(account, raise_exception=True)]

        organizer = event.get("organizer")
        if not organizer:
            organizer = get_default_participant_identity(account, raise_exception=True)

        payload[event["creation_id"]] = {
            "@type": "Event",
            "uid": event["uid"],
            "organizerCalendarAddress": _mailto(organizer),
            "calendarIds": {id: True for id in calendar_ids},
            "status": event.get("status"),
            "isDraft": bool(event.get("is_draft") or False),
            "title": event.get("title"),
            "start": event.get("start"),
            "duration": event.get("duration"),
            "timeZone": event.get("time_zone"),
            "recurrenceRule": event.get("recurrence_rule") or None,
            "showWithoutTime": bool(event.get("show_without_time") or False),
            "privacy": event.get("privacy"),
            "freeBusyStatus": event.get("free_busy_status"),
            "description": event.get("description"),
            "locations": locations_map(event.get("locations")),
            "links": links_map(event.get("links")),
            "participants": participants_map(event.get("participants")),
            "alerts": alerts_map(event.get("alerts")),
            "useDefaultAlerts": bool(event.get("use_default_alerts") or False),
            "created": timestamp,
            "updated": timestamp,
        }

    return chunked_set(
        client,
        lambda b, chunk: b.calendars.calendar_event.set(
            create=chunk, sendSchedulingMessages=send_scheduling_messages
        ),
        payload,
    )


def update_events(
    client: SuiteJMAPClient,
    account: str,
    events: list[dict],
    send_scheduling_messages: bool = False,
) -> SetResult:
    """Updates calendar events from snake_case event rows (same shape the old service took)."""

    payload = {}
    for event in events:
        calendar_ids = event.get("calendar_ids")
        if not calendar_ids:
            calendar_ids = [get_default_calendar_id(account, raise_exception=True)]

        organizer = event.get("organizer")

        payload[event["id"]] = {
            "@type": "Event",
            "calendarIds": {id: True for id in calendar_ids},
            "privacy": event.get("privacy"),
            "freeBusyStatus": event.get("free_busy_status"),
            "alerts": alerts_map(event.get("alerts")),
            "uid": event["uid"],
            "organizerCalendarAddress": _mailto(organizer) if organizer else None,
            "status": event.get("status"),
            "isDraft": bool(event.get("is_draft") or False),
            "title": event.get("title"),
            "start": event.get("start"),
            "duration": event.get("duration"),
            "timeZone": event.get("time_zone"),
            "recurrenceRule": event.get("recurrence_rule") or None,
            "showWithoutTime": bool(event.get("show_without_time") or False),
            "description": event.get("description"),
            "locations": locations_map(event.get("locations")),
            "links": links_map(event.get("links")),
            "participants": participants_map(event.get("participants")),
            "useDefaultAlerts": bool(event.get("use_default_alerts") or False),
            "updated": utcnow(),
        }

        # The caller may force a SEQUENCE bump (iTIP) so attendee clients apply the update
        # instead of ignoring it as a duplicate. Only set it when provided; otherwise leave
        # the server-managed value alone.
        if (sequence := event.get("sequence")) is not None:
            payload[event["id"]]["sequence"] = int(sequence)

    return chunked_set(
        client,
        lambda b, chunk: b.calendars.calendar_event.set(
            update=chunk, sendSchedulingMessages=send_scheduling_messages
        ),
        payload,
    )


def get_events(client: SuiteJMAPClient, ids: list[str] | None = None) -> list[dict]:
    """Returns raw calendar event objects, chunking large id lists (concatenated like the old
    client — a concurrent calendar change must not abort the read)."""

    if ids:
        events = chunked_get(client, lambda b, chunk: b.calendars.calendar_event.get(ids=chunk), ids)
    else:
        with client.batch() as b:
            h = b.calendars.calendar_event.get()
        events = h.result.items

    return [e.to_wire() for e in events]


def get_calendars(client: SuiteJMAPClient) -> list[dict]:
    """Returns raw calendar objects for the client's account."""

    with client.batch() as b:
        h = b.calendars.calendar.get()

    return [c.to_wire() for c in h.result.items]


def set_calendar_ids(client: SuiteJMAPClient, mapping: dict[str, dict[str, bool]]) -> SetResult:
    """Replaces the calendarIds of each given event with the provided map.

    `updated` is server-managed for CalendarEvent (it is stripped on create; see the exchange's
    SERVER_MANAGED_KEYS), so patch calendarIds only and let the server set the timestamp itself.
    """

    return chunked_set(
        client,
        lambda b, chunk: b.calendars.calendar_event.set(update=chunk),
        {id: {"calendarIds": calendar_ids} for id, calendar_ids in mapping.items()},
    )


def delete_events(
    client: SuiteJMAPClient, ids: list[str], send_scheduling_messages: bool = False
) -> SetResult:
    """Deletes calendar events; the server sends cancellations unless suppressed."""

    return chunked_set(
        client,
        lambda b, chunk: b.calendars.calendar_event.set(
            destroy=chunk, sendSchedulingMessages=send_scheduling_messages
        ),
        ids,
    )


def query_events(
    client: SuiteJMAPClient,
    filter: dict | None = None,
    position: int = 0,
    limit: int = 50,
    sort: list[dict] | None = None,
    time_zone: str | None = None,
    expand_recurrences: bool = False,
) -> dict:
    """Queries calendar events with the old service's pagination loop; returns {"ids", "total"}."""

    ids = []
    total = None
    batch_size = min(limit, client.capabilities.limits.max_objects_in_get)
    sort = sort or [{"property": "start", "isAscending": True}]

    while len(ids) < limit:
        current_batch_size = min(batch_size, limit - len(ids))

        with client.batch() as b:
            h = b.calendars.calendar_event.query(
                position=position,
                limit=current_batch_size,
                sort=sort,
                calculate_total=total is None,
                **omit_none(filter=filter, timeZone=time_zone, expandRecurrences=expand_recurrences),
            )
        response = h.result

        ids.extend(response.ids)

        if total is None:
            total = response.total

        if len(response.ids) < current_batch_size or (total is not None and len(ids) >= total):
            break

        position += len(response.ids)

    return {"ids": ids[:limit], "total": total}


def parse_event_blobs(client: SuiteJMAPClient, blob_ids: list[str]) -> dict:
    """Parses calendar blobs into JSCalendar events via `CalendarEvent/parse` (typed ParsedEvents
    result — `parsed` maps a blob id to an *array* of events; no automatic chunking)."""

    result = {"parsed": {}, "notFound": {}, "notParsable": {}}
    for batch in chunk_list(blob_ids, client.capabilities.limits.max_objects_in_get):
        with client.batch() as b:
            h = b.add("CalendarEvent/parse", {"blobIds": batch})
        response = h.result

        result["parsed"].update(
            {blob_id: [e.to_wire() for e in events] for blob_id, events in (response.parsed or {}).items()}
        )
        # The server reports notFound/notParsable as blob-id arrays; keep the
        # dict shape callers read (.keys()) by keying the ids.
        if response.not_found:
            result["notFound"].update(dict.fromkeys(response.not_found))
        if response.not_parsable:
            result["notParsable"].update(dict.fromkeys(response.not_parsable))

    return result


def get_base_event_ids(client: SuiteJMAPClient, ids: list[str]) -> dict[str, str]:
    """Maps event ids (including synthetic ids from recurrence-expanded queries) to the id of
    the real event they belong to.

    Resolved via a lightweight get requesting only baseEventId, which the server derives
    directly from the id itself — unlike a uid query, it does not depend on the search index
    (updated asynchronously), so it works immediately after an event is created."""

    events = chunked_get(
        client,
        lambda b, chunk: b.calendars.calendar_event.get(ids=chunk, properties=["id", "baseEventId"]),
        ids,
    )

    base_ids = {}
    for event in events:
        event = event.to_wire()
        base_ids[event["id"]] = event.get("baseEventId") or event["id"]

    return base_ids


def get_master_ids(client: SuiteJMAPClient, uids: list[str]) -> list[str]:
    """Returns master event IDs for a list of UIDs (search-index backed; may lag creation)."""

    return query_events(
        client,
        {"operator": "OR", "conditions": [{"uid": uid} for uid in uids]},
        position=0,
        limit=len(uids),
        expand_recurrences=False,
    ).get("ids", [])


def update_instance(
    client: SuiteJMAPClient,
    id: str,
    recurrence_id: str,
    patch: dict,
    send_scheduling_messages: bool = False,
    sequence: int | None = None,
) -> SetResponse:
    """Updates one instance of a recurring event by patching the master's recurrence overrides."""

    if not id or not recurrence_id:
        raise ValueError("Both 'id' and 'recurrence_id' are required.")
    if not patch:
        raise ValueError("Patch data is required to update an instance.")

    with client.batch() as b:
        h = b.calendars.calendar_event.get(ids=[id], properties=["id", "recurrenceOverrides"])
    events = h.result.items
    if not events:
        raise ValueError(f"Event with id '{id}' not found.")

    recurrence_overrides = events[0].to_wire().get("recurrenceOverrides") or {}

    field_map = {
        "calendar_ids": ("calendarIds", lambda v: {i: True for i in v}),
        "privacy": ("privacy", None),
        "free_busy_status": ("freeBusyStatus", None),
        "alerts": ("alerts", alerts_map),
        "organizer": ("organizerCalendarAddress", _mailto),
        "uid": ("uid", None),
        "status": ("status", None),
        "title": ("title", None),
        "start": ("start", None),
        "duration": ("duration", None),
        "time_zone": ("timeZone", None),
        "recurrence_rule": ("recurrenceRule", None),
        "show_without_time": ("showWithoutTime", lambda v: bool(v)),
        "description": ("description", None),
        "locations": ("locations", locations_map),
        "links": ("links", links_map),
        "participants": ("participants", participants_map),
        "use_default_alerts": ("useDefaultAlerts", lambda v: bool(v)),
    }

    out = {}
    for key, (target, transform) in field_map.items():
        if key in patch:
            value = patch[key]
            out[target] = transform(value) if transform else value

    payload = {id: {}}

    if recurrence_id in recurrence_overrides:
        payload[id].update({f"recurrenceOverrides/{recurrence_id}/{k}": v for k, v in out.items()})
    else:
        recurrence_overrides[recurrence_id] = out
        payload = {id: {"recurrenceOverrides": recurrence_overrides}}

    payload[id]["updated"] = utcnow()

    # Bump the master SEQUENCE (iTIP) so attendees' clients accept the re-sent series.
    if sequence is not None:
        payload[id]["sequence"] = int(sequence)

    with client.batch() as b:
        h = b.calendars.calendar_event.set(update=payload, sendSchedulingMessages=send_scheduling_messages)

    return h.result


def set_participation_status(
    client: SuiteJMAPClient,
    id: str,
    participant_uid: str,
    participation_status: str,
    send_scheduling_messages: bool = False,
) -> SetResponse:
    """Patches a single participant's participationStatus without rewriting the event.

    Used by the RSVP link endpoint, where a guest updates only their own response on the
    organizer's copy of the event.
    """

    if not id or not participant_uid:
        raise ValueError("Both 'id' and 'participant_uid' are required.")

    with client.batch() as b:
        h = b.calendars.calendar_event.set(
            update={
                id: {
                    f"participants/{participant_uid}/participationStatus": participation_status.lower(),
                    "updated": utcnow(),
                }
            },
            sendSchedulingMessages=send_scheduling_messages,
        )

    return h.result


def delete_instance(
    client: SuiteJMAPClient,
    id: str,
    recurrence_id: str,
    send_scheduling_messages: bool = False,
) -> SetResponse:
    """Deletes one instance of a recurring event by marking it excluded in the master's overrides.
    If send_scheduling_messages is True, the JMAP server sends a cancellation for the excluded
    instance; pass False to suppress it (e.g. when the client sends its own)."""

    if not id or not recurrence_id:
        raise ValueError("Both 'id' and 'recurrence_id' are required.")

    with client.batch() as b:
        h = b.calendars.calendar_event.get(ids=[id], properties=["id", "recurrenceOverrides"])
    events = h.result.items
    if not events:
        raise ValueError(f"Event with id '{id}' not found.")

    recurrence_overrides = events[0].to_wire().get("recurrenceOverrides") or {}
    recurrence_overrides.setdefault(recurrence_id, {}).update({"excluded": True})

    with client.batch() as b:
        h = b.calendars.calendar_event.set(
            update={id: {"recurrenceOverrides": recurrence_overrides, "updated": utcnow()}},
            sendSchedulingMessages=send_scheduling_messages,
        )

    return h.result


def locations_map(locations: list[dict] | None = None) -> dict[str, dict] | None:
    if locations:
        result = {}
        for location in locations:
            uid = location.get("uid") or str(uuid7())
            result[uid] = {
                "@type": "Location",
                "name": location.get("name"),
            }

        return result


def links_map(links: list[dict] | None = None) -> dict[str, dict] | None:
    if links:
        result = {}
        for link in links:
            uid = link.get("uid") or str(uuid7())
            result[uid] = {
                "@type": "Link",
                "href": link.get("href"),
                "contentType": link.get("content_type"),
            }

        return result


def alerts_map(alerts: list[dict] | None = None) -> dict[str, dict] | None:
    if alerts:
        result = {}
        for alert in alerts:
            if alert["type"] == "OffsetTrigger":
                trigger = {
                    "@type": "OffsetTrigger",
                    "relativeTo": alert["relative_to"].lower(),
                    "offset": alert["offset"].upper(),
                }
            elif alert["type"] == "AbsoluteTrigger":
                # The API listens UTC: a naive value is read as UTC and sent as ``...Z``.
                trigger = {
                    "@type": "AbsoluteTrigger",
                    "when": normalize_utc_z(alert["when"]),
                }
            else:
                continue

            uid = alert.get("uid") or str(uuid7())
            result[uid] = {
                "@type": "Alert",
                "action": alert["action"].lower(),
                "trigger": trigger,
            }

        return result


def participants_map(participants: list[dict] | None = None) -> dict[str, dict] | None:
    """Builds the 'participants' property map from snake_case participant rows."""

    if participants:
        result = {}
        for participant in participants:
            email = participant["email"].lower()
            uid = participant.get("uid") or str(uuid7())
            expect_reply = participant.get("expect_reply", False)
            calendar_address = f"mailto:{email}" if email else None

            if expect_reply:
                send_to = (
                    participant.get("send_to") or {"imip": calendar_address} if calendar_address else None
                )
                schedule_id = participant.get("schedule_id") or calendar_address
            else:
                send_to = None
                schedule_id = None

            result[uid] = {
                "@type": "Participant",
                "name": participant.get("name") or email,
                "sendTo": send_to,
                "scheduleId": schedule_id,
                "calendarAddress": calendar_address,
                "kind": participant.get("kind", "").lower() or None,
                "description": participant.get("description") or None,
                "roles": participant.get("roles") or None,
                "participationStatus": participant.get("participation_status", "").lower() or None,
                "expectReply": expect_reply,
                "comment": participant.get("comment") or None,
            }

        return result


def _mailto(value: str) -> str:
    value = value.lower()
    return value if value.startswith("mailto:") else f"mailto:{value}"
