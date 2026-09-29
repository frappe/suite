import json
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import frappe
from dateutil.rrule import rrulestr
from frappe import _
from frappe.utils import cint
from icalendar.prop import vRecur
from pydantic import BaseModel

from suite.calendar.api.rsvp import record_rsvp
from suite.calendar.doctype.calendar.calendar import (
    add_calendar,
    delete_calendars,
    ensure_default_alerts,
    fetch_calendars,
    forget_default_alerts_seeded,
)
from suite.calendar.doctype.calendar_event.calendar_event import (
    add_calendar_event,
    delete_calendar_events,
    fetch_calendar_events,
    update_calendar_event,
)
from suite.calendar.doctype.calendar_event.calendar_event import (
    get_calendar_events as get_calendar_events_by_ids,
)
from suite.calendar.doctype.calendar_event.fields import KNOWN_TRIGGERS, EventFields, Lower
from suite.calendar.doctype.calendar_exchange.calendar_exchange import _build_recurrence_rule
from suite.mail.jmap import get_calendar_event_service, get_calendar_service, get_participant_identities
from suite.mail.utils.dt import normalize_utc_z
from suite.utils.rate_limiter import dynamic_rate_limit
from suite.utils.validation import parse, without_blanks

# `fetch_calendars` pages ten at a time for the desk list view; the app wants all of them.
MAX_CALENDARS = 1000


@frappe.whitelist()
def get_calendars(account: str) -> list[dict[str, str]]:
    """Returns a list of the specified account's calendars.

    The colour comes with them: it is the calendar's own, set wherever its owner
    set it, and the views draw their events and their dots in it rather than in
    a colour assigned by position. So do the rights the account holds on it, for
    the app to offer only what the server will allow.
    """

    ensure_default_alerts(account)
    return _calendar_rows(account)


def _calendar_rows(account: str) -> list[dict]:
    """The account's calendars, in the shape the app reads, without seeding their reminders."""

    calendars = fetch_calendars(account, limit=MAX_CALENDARS)

    return [
        {
            key: cal[key]
            for key in [
                "name",
                "account",
                "id",
                "_name",
                "color",
                "default",
                "visible",
                "may_write_all",
                "may_delete",
            ]
        }
        for cal in calendars
    ]


def _shared_calendars() -> list[str]:
    """The calendars shared with the user read-only, as `account|id`, from any of their accounts.

    A calendar shared with the user lives in its owner's account, not the user's, so the
    calendar would only show it after switching to an account nobody thinks of as theirs.
    JMAP marks nothing as "shared with me", so it is read off the rights: a calendar the user
    can't write to. One they can write to is in an account they work in, like a team's, and is
    reached through the account switcher (see get_account_apps).

    Every account's calendars are listed in one request, and the answer is kept for a few minutes.
    """

    cache_key = f"calendar|shared_calendars|{frappe.session.user}"
    if (cached := frappe.cache.get_value(cache_key)) is not None:
        return cached

    shared = []
    accounts = frappe.get_all("User Account", {"user": frappe.session.user}, pluck="account")
    if accounts:
        try:
            calendars = get_calendar_service(accounts[0]).get_across_accounts(accounts, ["id", "myRights"])
        except NotImplementedError:
            calendars = {}
        for account, rows in calendars.items():
            shared.extend(
                f"{account}|{row['id']}"
                for row in rows or []
                if not (row.get("myRights") or {}).get("mayWriteAll")
            )

    frappe.cache.set_value(cache_key, shared, expires_in_sec=300)
    return shared


def _with_shared(account: str, fetch) -> list:
    """`fetch(account, None)` for the account, then `fetch(other, calendar_ids)` for each other
    account with calendars shared with the user — asked for those calendars alone, so an account
    that also holds calendars the user can write to isn't read in full to throw most of it away."""

    shared: dict[str, list[str]] = {}
    for name in _shared_calendars():
        other, calendar_id = name.split("|")
        if other != account:
            shared.setdefault(other, []).append(calendar_id)

    rows = list(fetch(account, None))
    for other, calendar_ids in shared.items():
        rows.extend(fetch(other, calendar_ids))
    return rows


@frappe.whitelist()
def get_calendars_with_shared(account: str) -> list[dict]:
    """The account's calendars, and the calendars shared with the user read-only from elsewhere."""

    # Reminders are seeded on the account's own calendars only: a shared one isn't the user's to
    # change, and its account's seeded mark is shared by everyone who can see it.
    ensure_default_alerts(account)
    return _with_shared(
        account,
        lambda each, calendar_ids: [
            row for row in _calendar_rows(each) if calendar_ids is None or row["id"] in calendar_ids
        ],
    )


@frappe.whitelist()
@dynamic_rate_limit()
def create_calendar(account: str, name: str, color: str | None = None) -> str:
    """Creates a calendar and returns its `account|id` name."""

    name = _calendar_name(name)
    calendar_id = add_calendar(account, name, color=color)
    # Seeded on the next listing, which the app asks for straight after creating.
    forget_default_alerts_seeded(account)
    return f"{account}|{calendar_id}"


@frappe.whitelist()
@dynamic_rate_limit()
def edit_calendar(
    account: str,
    id: str,
    name: str | None = None,
    color: str | None = None,
    default: bool = False,
    visible: bool | None = None,
) -> None:
    """Renames, recolours, shows or hides, or makes default one calendar, touching nothing
    else on it.

    The doctype's `update_calendar` writes every property, so renaming through it
    clears the description and time zone another client may have set. This patches
    only what it is given."""

    patch = {}
    if name is not None:
        patch["name"] = _calendar_name(name)
    if color is not None:
        patch["color"] = color or None
    # JMAP's own flag for whether a calendar's events are shown, so the choice follows the
    # user to every client rather than living in one browser.
    if visible is not None:
        patch["isVisible"] = visible

    kwargs = {"onSuccessSetIsDefault": id} if default else {}
    service = get_calendar_service(account)
    response = service._update({id: patch}, **kwargs)

    method_responses = response.get("methodResponses") or []
    result = method_responses[0][1] if method_responses else {}
    if id not in (result.get("updated") or {}):
        error = (result.get("notUpdated") or {}).get(id) or result
        frappe.throw(
            error.get("description") or _("Could not update the calendar."),
            title=_("Calendar Update Error"),
        )


@frappe.whitelist()
@dynamic_rate_limit()
def delete_calendar(account: str, id: str) -> None:
    """Deletes a calendar and the events on it. The default calendar stays: it is
    where new events go, invitations included."""

    service = get_calendar_service(account)
    calendar = next((c for c in service.get([id])), None)
    if not calendar:
        frappe.throw(_("Calendar not found."), frappe.DoesNotExistError)
    if calendar.get("isDefault"):
        frappe.throw(_("The default calendar can't be deleted. Make another calendar the default first."))

    delete_calendars(account, [id], remove_events=True)


def _calendar_name(name: str) -> str:
    name = (name or "").strip()
    if not name:
        frappe.throw(_("A calendar needs a name."))
    return name


# Stalwart answers a range query one page at a time, and a window wide enough for the
# Agenda — plus the months either side of it — can outrun a single page once a calendar
# carries a few daily recurrences. Asking for one page of 999 and returning it took the
# first 999 and said nothing about the rest: the grid simply stopped, with nothing on
# screen to say why.
EVENT_PAGE_SIZE = 999

# Where walking the pages stops. Past this the answer is not something anyone is reading
# day by day, and an unbounded loop against a shared server is its own kind of bug — so
# it stops, and says so in the error log rather than silently.
MAX_EVENTS_IN_WINDOW = 5000

# What a search answers with when the caller names no count of its own.
EVENT_SEARCH_LIMIT = 20

# And the most it will answer with however large a count is asked for. The service walks the
# server batch by batch until it has the number it was given, so an unbounded count is an
# unbounded walk of the account's whole event store — from a whitelisted endpoint, for a
# palette that shows ten. Bounded here for the same reason `MAX_EVENTS_IN_WINDOW` bounds the
# grid's paging.
MAX_EVENT_SEARCH_LIMIT = 200


def _events_in_window(
    account: str, from_date: str, to_date: str, time_zone: str, calendar_ids: list[str] | None = None
) -> list[dict]:
    """Every event in the window, page by page rather than the first page alone; only those on
    `calendar_ids` when given."""

    # The API listens UTC: a naive range value is read as UTC, not system time.
    query = {"after": normalize_utc_z(from_date), "before": normalize_utc_z(to_date)}
    if calendar_ids:
        query = {
            "operator": "AND",
            "conditions": [
                query,
                {"operator": "OR", "conditions": [{"inCalendar": id} for id in calendar_ids]},
            ],
        }
    events: list[dict] = []
    position = 0
    total = 0

    while len(events) < MAX_EVENTS_IN_WINDOW:
        # The last page asks for what is left under the ceiling, not a whole one:
        # a full page on top of 4,995 is a thousand events past the bound.
        page, total = fetch_calendar_events(
            account,
            query,
            position=position,
            limit=min(EVENT_PAGE_SIZE, MAX_EVENTS_IN_WINDOW - len(events)),
            time_zone=time_zone,
            expand_recurrences=True,
        )
        events.extend(page)
        position += len(page)
        # An empty page ends it whatever the total claims: a total that never comes
        # down is how a loop against a paging server runs forever.
        if not page or position >= total:
            break

    if position < total:
        frappe.log_error(
            title="Calendar range query truncated",
            message=(
                f"Account {account} has {total} events between {from_date} and {to_date}; "
                f"{len(events)} were returned (ceiling {MAX_EVENTS_IN_WINDOW})."
            ),
        )

    return events


@frappe.whitelist()
def get_calendar_events(account: str, from_date: str, to_date: str, time_zone: str) -> list[dict]:
    """Fetches calendar events between from_date and to_date for the specified account."""

    return _calendar_events(account, from_date, to_date, time_zone)


def _calendar_events(
    account: str, from_date: str, to_date: str, time_zone: str, calendar_ids: list[str] | None = None
) -> list[dict]:
    events = _events_in_window(account, from_date, to_date, time_zone, calendar_ids)

    enrich_events_with_master_data(account, events)
    events = merge_own_copies(account, events)
    enrich_participants_with_avatars(events)

    return events


@frappe.whitelist()
def get_calendar_events_with_shared(account: str, from_date: str, to_date: str, time_zone: str) -> list[dict]:
    """`get_calendar_events` for the account and the calendars shared with the user."""

    return _with_shared(
        account,
        lambda each, calendar_ids: _calendar_events(each, from_date, to_date, time_zone, calendar_ids),
    )


@frappe.whitelist()
def search_calendar_events_with_shared(
    account: str,
    text: str | None = None,
    limit: int = EVENT_SEARCH_LIMIT,
    time_zone: str | None = None,
    filters: dict | None = None,
) -> list[dict]:
    """Events matching `text` and `filters`, from the account and the calendars shared with it.

    The grid reads through `_with_shared`, so it draws calendars that live in their owner's
    account rather than the viewer's — a holidays calendar shared read-only, say. A search
    that asked the viewer's account alone would answer "no results" for an event the reader
    can see on the grid in front of them.

    `limit` is what the caller would like and `MAX_EVENT_SEARCH_LIMIT` what it may have.
    """

    limit = _search_limit(limit)
    filters = parse(EventSearchFilters, without_blanks(frappe.parse_json(filters) or {}), _("Filters"))

    # With nothing asked there is nothing to answer. Guarded here rather than per account,
    # because the `inCalendar` scoping a shared account is read with is a condition too — and
    # on its own it would hand back every event in every calendar shared with the reader.
    if not (_search_conditions(text, filters) or filters.calendar):
        return []

    # A named calendar answers for itself: it says which account to ask and which calendar in
    # it, so the fan-out has nothing left to widen. Named as `account|id`, the way every other
    # calendar-shaped argument in this app is.
    if filters.calendar:
        calendar_account, _sep, calendar_id = filters.calendar.partition("|")
        events = _search_calendar_events(calendar_account, text, limit, time_zone, [calendar_id], filters)
    else:
        events = _with_shared(
            account,
            lambda each, calendar_ids: _search_calendar_events(
                each, text, limit, time_zone, calendar_ids, filters
            ),
        )

    # Without a range the server answered with masters, and a master's date is the least useful
    # date a series has: the standup shows once, dated the week it was first entered. Each is
    # replaced by its next few occurrences — before the cut, since that date is no better to
    # rank on than it is to show, and cutting on it keeps the series that *began* earliest.
    if not (filters.after and filters.before):
        events = _expanded_upcoming(events, limit, time_zone)

    # Each account answers in its own order, so the concatenation is in none: the merged list
    # has to be put back in order before it is cut down to the asked-for count, or which
    # results survive depends on which account happened to be read first. Nearest today first:
    # a reader searching a calendar is looking for something they are about to go to or have
    # just been to, and a match ten years off is the one they meant least often, whichever
    # side of today it falls.
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S")
    events.sort(key=lambda event: _distance(event, now))

    return _first_events(events, limit)


def _utc_start(event: dict) -> str:
    """The event's start as UTC, for measuring against a UTC `now`.

    A start is stored as the wall-clock time in the event's own zone; measured as it stands, an
    event in Auckland and one in Los Angeles at the same instant would rank a day apart. An
    all-day event has no zone and no instant — its date is the same everywhere — and a zone
    the platform does not know is read as it stands.
    """

    start = event.get("start") or ""
    if not start or len(start) < 16:
        return start
    try:
        zone = ZoneInfo(event.get("time_zone") or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return start
    local = datetime.fromisoformat(start[:19]).replace(tzinfo=zone)
    return local.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S")


def _distance(event: dict, now: str) -> timedelta:
    """How far the event's start falls from `now`, on either side, measured in UTC."""

    start = _utc_start(event)
    if not start:
        return timedelta.max
    return abs(datetime.fromisoformat(start[:19]) - datetime.fromisoformat(now[:19]))


def _rank_distance(event: dict, now: str) -> timedelta:
    """How far a candidate ranks from today while it is still a master, before anything is
    expanded.

    A series' own start is the week it was first entered, which says nothing about when it next
    runs; a series still going next runs today-ish, whenever it began. So a recurring candidate
    that has begun ranks as today.

    An estimate, and only ever used as one: a yearly series ranks as though it ran today, and a
    series that ended years ago ranks as though it still runs. It decides which candidates are
    worth the cost of expanding, never the order of the answer — that is settled afterwards, on
    the rows expansion actually returned.
    """

    if _recurs(event) and _utc_start(event) <= now:
        return timedelta(0)
    return _distance(event, now)


def _expanded_upcoming(events: list[dict], limit: int, time_zone: str | None) -> list[dict]:
    """`events`, with each recurring master among the ranking candidates replaced by its next
    few occurrences.

    Only the `limit` nearest-ranked candidates are expanded, because expansion is a query per series
    (see `occurrences_from`) rather than one for the batch. The fan-out asks every account
    holding a calendar shared into this one, so expanding everything they returned would put a
    query per series per account behind a single palette keystroke — and the answer is only
    `limit` events long, so the rest could not have appeared in it anyway.
    """

    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S")
    candidates = sorted(events, key=lambda event: _rank_distance(event, now))[:limit]

    by_account: dict[str, list[dict]] = defaultdict(list)
    for event in candidates:
        by_account[event["account"]].append(event)

    return [
        row
        for account_events in by_account.values()
        for row in _with_nearest_occurrences(account_events, time_zone)
    ]


def _first_events(rows: list[dict], limit: int) -> list[dict]:
    """The rows belonging to the first `limit` events in `rows`, which is more rows than that
    wherever a recurring event contributed several.

    `limit` counts events rather than rows because a recurring event is one answer to the
    search however many times it is about to run — ten events is the promise, and three rows
    each is how a recurring one keeps it. Rows arrive nearest today first, so the events are
    taken in the order their nearest row falls, and the further rows of one already taken come
    along with it rather than counting again."""

    taken: set[tuple[str, str]] = set()
    kept = []
    for row in rows:
        event = (row.get("account") or "", row.get("master_id") or row.get("id") or "")
        if event not in taken:
            if len(taken) == limit:
                continue
            taken.add(event)
        kept.append(row)

    return kept


# How many of a recurring event's coming occurrences a search shows in the master's place, and
# how far ahead it looks for them — three years, so a yearly one has three to show.
RECURRENCE_INSTANCES = 3
RECURRENCE_HORIZON_YEARS = 3


def _rule(event: dict) -> dict:
    """The event's recurrence rule. The formatter serialises it as JSON and writes `{}` for
    none, so the string being non-empty proves nothing; anything unreadable is no rule."""

    try:
        rule = json.loads(event.get("recurrence_rule") or "{}")
    except (TypeError, ValueError):
        return {}
    return rule if isinstance(rule, dict) else {}


def _recurs(event: dict) -> bool:
    return bool(_rule(event))


def _with_nearest_occurrences(events: list[dict], time_zone: str | None) -> list[dict]:
    """`events`, all from one account, with each recurring master replaced by the few
    occurrences nearest today, on either side of it: a standup answers as last week's, today's
    and next week's, since the answer is read nearest first and the next three would have put
    the one that just ran out of it. A series with nothing from its last period on — one that
    has ended — stays as its master: a row dated when it last ran is still the answer to the
    search that found it.

    One query per series, from one period before today: that is where the previous occurrences
    fall, and asking for as many as a period holds over the count from there — the previous
    period's, then today's and the next few — leaves the nearest few to be chosen here. Asking
    each side of today separately would have doubled the queries, and this is already the
    search's one cost that grows with the answer; and every occurrence asked for is fetched
    whole before the choice is made, so the ask stays as small as the choice allows.

    Each occurrence is handed the master's id and rule, which the expansion does not carry. The
    id is what a link to it is written with (see the calendar's `handleEventClick`), and the rule
    is what tells the row to draw the repeat mark."""

    recurring = [event for event in events if _recurs(event)]
    if not recurring:
        return events

    account = events[0]["account"]
    now = datetime.now(UTC)
    by_uid = get_calendar_event_service(account).occurrences_from(
        {event["uid"]: normalize_utc_z(now - _period(event)) for event in recurring},
        before=normalize_utc_z(now + timedelta(days=365 * RECURRENCE_HORIZON_YEARS)),
        # A period back reaches every occurrence of the last period and, over the extra day,
        # possibly one more; the count on top of those is what is left for today and after.
        per_series=max(_per_period(event) for event in recurring) + 1 + RECURRENCE_INSTANCES,
        time_zone=time_zone,
    )

    ids = [id for event in recurring for id in by_uid.get(event["uid"], [])]
    occurrences: dict[str, list[dict]] = defaultdict(list)
    for occurrence in get_calendar_events_by_ids(account, ids):
        occurrences[occurrence["uid"]].append(occurrence)
    today = now.strftime("%Y-%m-%dT%H:%M:%S")
    for found in occurrences.values():
        found.sort(key=lambda occurrence: _distance(occurrence, today))
        del found[RECURRENCE_INSTANCES:]

    rows: list[dict] = []
    for event in events:
        nearest = occurrences.get(event["uid"]) if _recurs(event) else None
        if not nearest:
            rows.append(event)
            continue
        for occurrence in nearest:
            occurrence["master_id"] = event["id"]
            occurrence["recurrence_rule"] = event["recurrence_rule"]
            rows.append(occurrence)

    return rows


# How long one step of a rule's frequency is, at the longest a step of it can be.
_FREQUENCY_DAYS = {"daily": 1, "weekly": 7, "monthly": 31, "yearly": 366}


def _period(event: dict) -> timedelta:
    """How far back a series' previous occurrences can be: one step of its rule, and a day
    over, since "a week ago" measured from now falls after last week's occurrence whenever that
    ran earlier in its day than now is in this one. A rule the frequency cannot be read from is
    taken as weekly."""

    rule = _rule(event)
    days = _FREQUENCY_DAYS.get(str(rule.get("frequency", "")).lower(), 7)
    return timedelta(days=days * max(cint(rule.get("interval")) or 1, 1) + 1)


def _per_period(event: dict) -> int:
    """How many times a series can run in one step of its rule: once, unless the rule names
    several days of the week, days of the month or months of the year, in which case each. A
    weekly standup on Monday, Wednesday and Friday runs three times a week, and a window a week
    back holds all three before it reaches today."""

    rule = _rule(event)
    return max(
        1,
        *(
            len(rule[key]) if isinstance(rule.get(key), list) else 1
            for key in ("byDay", "byMonthDay", "byMonth", "byYearDay", "byWeekNo")
        ),
    )


# The filters that are a JMAP condition each, under the name the server knows them by. Left out
# deliberately: `participants`, `status`, `privacy`, `isDraft` and `showWithoutTime` are not
# indexed by Stalwart, and an unindexed condition is *ignored* rather than refused — a filter
# built on one would quietly widen the search instead of narrowing it.
EVENT_SEARCH_CONDITIONS = {
    "attendee": "attendee",
    "organizer": "owner",
}


def _search_limit(limit: int | str | None) -> int:
    """How many results a search will actually answer with, whatever it was asked for."""

    return max(1, min(cint(limit) or EVENT_SEARCH_LIMIT, MAX_EVENT_SEARCH_LIMIT))


class EventSearchFilters(BaseModel):
    """What a search may narrow on, as the palette's panel sends it.

    Parsed rather than read off the request as it arrives. This is a whitelisted endpoint, so
    `filters` is whatever JSON a caller cared to send: a list, a number, or an `attendee` that
    is itself a list. Read straight, those reach `.strip()` and `partition()` as a server error
    saying nothing; parsed, each says which field is wrong and why.

    `scope` is what a word typed on the query line is matched against. `text` is the server's
    own union of everything an event is written in — its title, its description, where it is,
    and the addresses of whoever called it and whoever is coming — so a name finds the meeting
    somebody called as well as the one named after them. `title` narrows to the title alone.
    """

    scope: Annotated[Literal["text", "title"], Lower] = "text"
    # `account|id`, the way every other calendar-shaped argument in this app is named.
    calendar: str = ""
    attendee: str = ""
    organizer: str = ""
    after: str = ""
    before: str = ""


def _search_conditions(text: str | None, filters: EventSearchFilters) -> list[dict]:
    """The filters as JMAP conditions, dropping the ones left blank."""

    conditions = [{filters.scope: text}] if text else []

    conditions.extend(
        {condition: value}
        for key, condition in EVENT_SEARCH_CONDITIONS.items()
        if (value := getattr(filters, key).strip())
    )

    # Sent as instants, not dates: which instants a reader's "3 July" begins and ends at is a
    # question about their time zone, and the client is the one holding that. It widens each
    # to the whole day there before asking (see the calendar's `utcDayStart`/`utcDayEnd`), the
    # way the grid's own range query does.
    if filters.after:
        conditions.append({"after": normalize_utc_z(filters.after)})
    if filters.before:
        conditions.append({"before": normalize_utc_z(filters.before)})

    return conditions


def _search_calendar_events(
    account: str,
    text: str | None,
    limit: int,
    time_zone: str | None,
    calendar_ids: list[str] | None = None,
    filters: EventSearchFilters | None = None,
) -> list[dict]:
    """The account's matching events, on `calendar_ids` alone when given. A series answers
    as its master unless a date range was asked (see below)."""

    filters = filters or EventSearchFilters()
    conditions = _search_conditions(text, filters)
    if calendar_ids:
        conditions.append({"operator": "OR", "conditions": [{"inCalendar": id} for id in calendar_ids]})

    # A date range is the one thing that lets a series answer as the occurrence the reader is
    # looking for. Without a window the server matches a series on any occurrence in it and
    # still hands back the master, so a search of one July came back full of birthdays dated
    # the January they were first entered. Expansion needs a start and an end, which is
    # precisely what a range is, so it is on exactly when the reader has given one. A half-open
    # range would put us back to mis-dated masters, which is why the panel keeps both ends of
    # its range filled: JMAP will not expand without both, so there is no half-open case to
    # answer better than this.
    expand = bool(filters.after and filters.before)

    # The answer is ordered by distance from today, and the server can only order by date. So
    # it is asked for both halves — what is still to come, soonest first, and what has passed,
    # most recent first — each cut at `limit` on its own, which is the most of either the
    # answer could hold (see `query_around`).
    ids = get_calendar_event_service(account).query_around(
        conditions,
        normalize_utc_z(datetime.now(UTC)),
        limit,
        time_zone=time_zone,
        expand_recurrences=expand,
    )
    events = get_calendar_events_by_ids(account, ids)

    # An expanded occurrence's id is synthetic — derived from its position in the expansion —
    # and the server renumbers it the moment that occurrence gains an override. The grid pays
    # for this enrichment for the same reason (`_calendar_events`): without the master's id
    # beside it, a link to a hit is a link to an id that stops resolving as soon as anyone
    # edits or answers that occurrence. Unexpanded results are masters already, and pay nothing.
    if expand:
        enrich_events_with_master_data(account, events)

    return events


@frappe.whitelist()
def get_calendar_event_density(account: str, from_date: str, to_date: str, time_zone: str) -> list[dict]:
    """The bare minimum needed to mark a day as busy, for the sidebar's mini month.

    That card is a navigation aid: it has to draw a tick under any day with something on
    it, in whatever month it is paged to, which is not the window the main view fetched.
    Asking `get_calendar_events` for a month to draw at most three dots a day would pull
    every description, location, link and participant avatar in it, so this returns only
    what a tick is made of — when the event runs, and whose calendar it is on.

    Deliberately NOT bucketed into days here. Which day an event lands on is the viewer's
    zone, all-day-ness and inclusive-end arithmetic that the client already does for the
    grid (`isAllDayEvent`, `eventLastDay`); a second implementation of it in Python is a
    second implementation to disagree with the first. The client places these rows with
    the same code it places real events with.
    """

    return _event_density(account, from_date, to_date, time_zone, _own_emails(account))


def _own_emails(account: str) -> set[str]:
    """The account's own addresses — what tells a decline of the viewer's from anyone else's."""

    return {(identity.get("email") or "").lower() for identity in get_participant_identities(account)}


def _event_density(
    account: str,
    from_date: str,
    to_date: str,
    time_zone: str,
    own_emails: set[str],
    calendar_ids: list[str] | None = None,
) -> list[dict]:
    # A decline gives the time back, so a declined event is not density.
    events = _events_in_window(account, from_date, to_date, time_zone, calendar_ids)

    return [
        {
            "start": event.get("start"),
            "duration": event.get("duration"),
            "time_zone": event.get("time_zone"),
            "show_without_time": event.get("show_without_time"),
            "calendars": [
                cal.get("calendar") for cal in (event.get("calendars") or []) if cal.get("calendar")
            ],
            "is_declined": _declined_by_viewer(event, own_emails),
        }
        for event in events
    ]


@frappe.whitelist()
def get_calendar_event_density_with_shared(
    account: str, from_date: str, to_date: str, time_zone: str
) -> list[dict]:
    """`get_calendar_event_density` for the account and the calendars shared with the user."""

    # Declines are the viewer's, so their own addresses are read once, from their account.
    own_emails = _own_emails(account)
    return _with_shared(
        account,
        lambda each, calendar_ids: _event_density(
            each, from_date, to_date, time_zone, own_emails, calendar_ids
        ),
    )


def _declined_by_viewer(event: dict, own_emails: set[str]) -> bool:
    """True when one of the account's own addresses said no to this event."""

    for participant in event.get("participants") or []:
        if participant.get("participation_status") != "DECLINED":
            continue
        email = (participant.get("email") or "").lower().replace("mailto:", "")
        if email in own_emails:
            return True
    return False


# What an occurrence inherits from its series, as (our name, the JMAP name the override uses).
#
# An occurrence that carries a recurrence override comes back from Stalwart 0.16.20 with the
# structural half merged — uid, zone, calendars, organizer, participants — and this half
# dropped, plus a duration invented to run to the end of the day. RFC 8984 reads an override as
# a patch over the series, so the series is what these should say unless the override says
# otherwise. Applying that here is the whole of the workaround; delete it, and the test that
# pins it, once the server merges them itself.
INHERITED_FROM_SERIES = (
    ("title", "title"),
    ("description", "description"),
    ("duration", "duration"),
    ("privacy", "privacy"),
    ("free_busy_status", "freeBusyStatus"),
    ("status", "status"),
    ("show_without_time", "showWithoutTime"),
    ("locations", "locations"),
    ("links", "links"),
    # Who is on it and who called it. A start-only override — what dragging one occurrence
    # writes — drops both, so an occurrence moved on its own came back with an empty guest list
    # and no organizer, and the panel said nobody was going.
    ("participants", "participants"),
    ("organizer", "organizerCalendarAddress"),
    ("alerts", "alerts"),
    ("use_default_alerts", "useDefaultAlerts"),
)


def enrich_events_with_master_data(account: str, events: list[dict]) -> None:
    """Attaches recurrence/master info to each event in-place, and what its series says about it.

    Masters are resolved through baseEventId rather than a uid query: the uid filter runs on
    the server's search index, which is updated asynchronously, so a query-based lookup misses
    events created moments ago — leaving them without a master_id (so the frontend falls back
    to the synthetic id, which the server renumbers as overrides land) and with an unparsed
    recurrence_rule string until the index catches up."""

    if not events:
        return

    service = get_calendar_event_service(account)
    base_ids = service.get_base_event_ids([event["id"] for event in events])
    if not base_ids:
        return

    master_ids = sorted(set(base_ids.values()))
    # The raw copies carry recurrenceOverrides, which the formatter drops — and the override is
    # the only thing that says which properties an occurrence owns rather than inherits.
    overrides = {master["id"]: master.get("recurrenceOverrides") or {} for master in service.get(master_ids)}
    masters = {master["id"]: master for master in get_calendar_events_by_ids(account, master_ids)}

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

        if not event.get("recurrence_id"):
            continue

        # Only where the series actually carries an override for this date. An occurrence the
        # server keeps as its own object — or one whose series has lost its rule — is not a
        # patch over anything, and reading the series onto it would replace what it does say
        # with what the series does not.
        override = overrides.get(master["id"], {}).get(event["recurrence_id"])
        if not override:
            continue

        # A patch names its property first, whether it replaces the whole thing ("title") or
        # reaches inside it ("participants/<uid>/participationStatus").
        # An override says what is different about one occurrence, not who called the meeting.
        # Answering one writes the responder in as its organizer and owner, which would show the
        # guest who declined as the host of that week, so the series keeps the say on both.
        owned = {key.split("/")[0] for key in override} - {"organizerCalendarAddress"}
        for name, jmap_name in INHERITED_FROM_SERIES:
            if jmap_name not in owned:
                event[name] = master[name]

        # An override that touches one participant carries only that one — answering for a single
        # occurrence would otherwise empty its guest list down to the responder. The series says
        # who is on it; the override says what they answered, so the two are laid over each other
        # by address rather than one replacing the other.
        if "participants" in owned:
            answered = {
                p.get("email"): p.get("participation_status")
                for p in event.get("participants") or []
                if p.get("participation_status")
            }
            # Only the answer is taken from the override. The name, the roles and who else is on
            # it are the series' — an override carries just enough of a participant to say what
            # they replied, and reading the rest of it back would rewrite them.
            event["participants"] = [
                {**p, "participation_status": answered.get(p.get("email"), p.get("participation_status"))}
                for p in master.get("participants") or []
            ]


def merge_own_copies(account: str, events: list[dict]) -> list[dict]:
    """Draws an invitation once, with the answer the account gave it.

    An invitation is delivered as an occurrence of its own — organized by whoever sent it, and
    carrying a recurrence id — while the account keeps its own copy of that uid alongside. The
    delivered occurrence is the one worth drawing: it has the title, the time and the
    organizer's guest list. The copy holds nothing but what the account itself put there, which
    is its answer, and the RSVP endpoint writes there because that is the copy the account owns.

    Drawn as it comes back, that is two events on the same day — the invitation, and an
    untitled one beside it that appears the moment the invitation is answered. So the copy's
    answer is carried onto the occurrence and the copy itself is not drawn.

    A row is the copy when it resolves to the same event as an occurrence does and carries no
    recurrence id of its own. An event with no occurrences beside it is left alone, which is
    every ordinary event.
    """

    siblings: dict[str, list[dict]] = {}
    for event in events:
        if event.get("master_id"):
            siblings.setdefault(event["master_id"], []).append(event)

    # An override on a series organized elsewhere does not replace the occurrence it names; the
    # sender's copy of that date comes back beside it, so the same occurrence is drawn twice —
    # once as it was sent and once as this account answered it. The account's own copy is the
    # one to keep: it carries the answer, and the series has already filled in everything the
    # override does not name. Where nothing was overridden there is only ever one.
    duplicates = set()
    for rows in siblings.values():
        by_date: dict[str, list[dict]] = {}
        for row in rows:
            if row.get("recurrence_id"):
                by_date.setdefault(row["recurrence_id"], []).append(row)
        for drawn in by_date.values():
            if len(drawn) < 2:
                continue
            # The one built from the override is the one the server never stored, so it is the
            # one with no creation time. It is the one to keep: it carries the answer, and the
            # series fills in everything the override does not name.
            answered = next((row for row in drawn if not row.get("created")), None)
            if answered:
                duplicates.update(row["id"] for row in drawn if row is not answered)

    events = [event for event in events if event["id"] not in duplicates]
    siblings = {
        master_id: [row for row in rows if row["id"] not in duplicates]
        for master_id, rows in siblings.items()
    }

    identities = {identity["email"] for identity in get_participant_identities(account)}
    copies = set()

    for rows in siblings.values():
        occurrences = [row for row in rows if row.get("recurrence_id")]
        own = [row for row in rows if not row.get("recurrence_id")]
        if not occurrences or not own:
            continue

        answer = next(
            (
                participant.get("participation_status")
                for row in own
                for participant in row.get("participants") or []
                if participant.get("email") in identities and participant.get("participation_status")
            ),
            None,
        )
        # Onto the occurrences that have no answer of their own. One answered on its own date
        # comes back as this account's own copy of that date, carrying what was said there —
        # and the copy of the whole event, which is the series-wide answer, must not be read
        # over the top of it.
        if answer:
            for row in (row for row in occurrences if row.get("created")):
                for participant in row.get("participants") or []:
                    if participant.get("email") in identities:
                        participant["participation_status"] = answer

        copies.update(row["id"] for row in own)

    return [event for event in events if event["id"] not in copies]


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


def _with_name(items: list[dict] | None) -> list[dict] | None:
    """Map the formatter's ``_name`` onto the ``name`` key CalendarEventService reads.

    format_calendar_event emits locations and participants with ``_name`` (the desk field name) and
    the frontend echoes that shape straight back. The service reads ``name``, so without this every
    edit rewrote location names as null and replaced each participant's display name with their
    email address - including on partial patches that never mentioned those fields.
    """

    if not items:
        return items

    return [
        {**item, "name": item["_name"]} if "name" not in item and "_name" in item else item for item in items
    ]


@frappe.whitelist()
@dynamic_rate_limit()
def rsvp_calendar_event(account: str, id: str, response: str, recurrence_id: str | None = None) -> None:
    """Records the logged-in user's RSVP (accepted / declined / tentative) on the event.

    Patches only the caller's own participationStatus — unlike edit_calendar_event, which
    rewrites the whole event — and routes the organizer's notification through the custom
    event_response template when custom event invites are enabled (see record_rsvp)."""

    record_rsvp(account, id, response, recurrence_id=recurrence_id)


@frappe.whitelist()
@dynamic_rate_limit()
def edit_calendar_event(account: str, id: str, send_scheduling_messages: bool = False, **kwargs) -> None:
    """Sets the given `EventFields` on an event and keeps every other field as stored.

    The JMAP update replaces the whole event, so what the caller leaves out is read back first.
    Frappe does not check `**kwargs`, hence the explicit parse.
    """

    patch = parse(EventFields, kwargs).model_dump(exclude_unset=True)

    events = get_calendar_events_by_ids(account, [id])
    if not events:
        frappe.throw(_("Calendar Event {0} not found.").format(frappe.bold(id)), frappe.DoesNotExistError)

    event = events[0]
    stored = {
        **event,
        "calendar_ids": [calendar["calendar_id"] for calendar in event["calendars"]],
        "recurrence_rule": json.loads(event["recurrence_rule"]),
        # An alert with a trigger this app cannot express would fail the update; the service has
        # always dropped such alerts on write, so they are left out here instead.
        "alerts": [alert for alert in event["alerts"] if alert["type"] in KNOWN_TRIGGERS],
    }

    def resolve(key):
        return patch[key] if key in patch else stored[key]

    update_calendar_event(
        account,
        id,
        event["uid"],
        event["organizer"],
        resolve("calendar_ids"),
        resolve("status"),
        resolve("draft"),
        resolve("title"),
        resolve("start"),
        resolve("duration"),
        resolve("time_zone"),
        resolve("recurrence_rule"),
        resolve("show_without_time"),
        resolve("privacy"),
        resolve("free_busy_status"),
        resolve("description"),
        _with_name(resolve("locations")),
        resolve("links"),
        _with_name(resolve("participants")),
        resolve("alerts"),
        resolve("use_default_alerts"),
        send_scheduling_messages,
    )


@frappe.whitelist()
@dynamic_rate_limit()
def split_calendar_event_series(
    account: str,
    master_id: str,
    recurrence_id: str,
    send_scheduling_messages: bool = False,
    **kwargs,
) -> str:
    """Applies an edit to one occurrence of a series and to every occurrence after it.

    JSCalendar has no way to say "from here on": a recurrence rule runs from the event's start,
    and an override speaks for a single date. So the series is cut in two — the original stops
    just before this occurrence, and the edit becomes a new series starting at it. Every calendar
    that offers "this and following" does it this way, and it is why the occurrences before the
    split keep the old title, the old time and their own overrides.

    Occurrences after the split that had been edited on their own keep those edits only when the
    new series still falls on their dates; move the series and they are drawn by the new rule
    like every other occurrence, since there is no date left to hang them on.

    Returns the id of the series that now owns this occurrence.
    """

    events = get_calendar_events_by_ids(account, [master_id])
    if not events:
        frappe.throw(
            _("Calendar Event {0} not found.").format(frappe.bold(master_id)), frappe.DoesNotExistError
        )

    master = events[0]
    rule = json.loads(master["recurrence_rule"] or "{}")
    if not rule:
        frappe.throw(_("This event does not repeat, so there is nothing following it."))

    fields = parse(EventFields, kwargs).model_dump(exclude_unset=True)
    # A series edited from one of its occurrences keeps the calendars the series is in; the form
    # never names them, and without this the new half would land in the default calendar.
    if not fields.get("calendar_ids"):
        fields["calendar_ids"] = [calendar["calendar_id"] for calendar in master.get("calendars") or []]
    fields.setdefault("organizer", master.get("organizer"))

    before = _occurrences_before(rule, master["start"], recurrence_id)
    # A counted series can only be split by sharing the count out, so a rule that cannot be
    # expanded cannot be split — better said than silently turned into two full-length series.
    if rule.get("count") is not None and before is None:
        frappe.throw(_("This event's repeat rule could not be read, so it cannot be split here."))

    # Splitting at the first occurrence cuts nothing off: there is no earlier part to keep, so
    # this is the whole series changing rather than a series becoming two.
    if before == 0 or recurrence_id == master["start"]:
        # Through edit_calendar_event, never update_calendar_event: the latter writes every
        # property it is given and NULLs every one it is not, so a caller that sent a title and
        # no start would erase the start, the duration, the rule and the organizer with it.
        edit_calendar_event(account, master_id, send_scheduling_messages=send_scheduling_messages, **fields)
        return master_id

    tail_overrides = _end_series_before(
        account, master_id, rule, before, recurrence_id, send_scheduling_messages
    )
    service = get_calendar_event_service(account)

    # Overrides the rule no longer generates are not dropped with it — RFC 8984 reads an override
    # on an ungenerated date as an occurrence in its own right, so leaving them would keep every
    # edited occurrence after the split visible on the old series, beside the new one.
    # The new half takes what is left of a count; an `until` needs no adjusting, since it names
    # a date the new half runs to just as the old one did.
    tail_rule = dict(fields.get("recurrence_rule") or rule)
    if rule.get("count") is not None:
        tail_rule["count"] = max(cint(rule["count"]) - before, 1)
    fields["recurrence_rule"] = tail_rule

    new_id = add_calendar_event(account, send_scheduling_messages=send_scheduling_messages, **fields)

    # Only when the new series falls on the same dates — an occurrence's override is addressed by
    # its date, and a series that moved has none of them left.
    # The occurrence the split begins at is not carried over: the edit being applied is its new
    # description, and its old override would sit on top of the change the reader just made.
    carried = {rid: override for rid, override in tail_overrides.items() if rid != recurrence_id}
    # And only where the new half still falls on their dates. An override is addressed by the date
    # it belongs to, and a rule the reader changed in the same save generates other dates — where
    # RFC 8984 reads an override as an occurrence in its own right, which is the extra event this
    # is trying to avoid everywhere else.
    rule_kept = spoken_rule(fields.get("recurrence_rule")) == spoken_rule(rule)
    if carried and rule_kept and fields.get("start") == recurrence_id:
        service.set_overrides(new_id, carried)

    return new_id


@frappe.whitelist()
@dynamic_rate_limit()
def delete_calendar_event_series_from(
    account: str,
    master_id: str,
    recurrence_id: str,
    send_scheduling_messages: bool = False,
) -> None:
    """Deletes this occurrence of a series and every occurrence after it.

    Which is an edit rather than a delete: the series stops at the occurrence before this one.
    The overrides that belonged to the occurrences being deleted go with them — an override on a
    date the shortened rule no longer generates is not dropped along with it, and RFC 8984 reads
    it as an occurrence in its own right, so an edited occurrence would survive its own deletion
    as an event of its own.
    """

    events = get_calendar_events_by_ids(account, [master_id])
    if not events:
        frappe.throw(
            _("Calendar Event {0} not found.").format(frappe.bold(master_id)), frappe.DoesNotExistError
        )

    master = events[0]
    rule = json.loads(master["recurrence_rule"] or "{}")
    if not rule:
        frappe.throw(_("This event does not repeat, so there is nothing following it."))

    before = _occurrences_before(rule, master["start"], recurrence_id)
    if rule.get("count") is not None and before is None:
        frappe.throw(_("This event's repeat rule could not be read, so it cannot be ended here."))

    # Nothing precedes the first occurrence, so ending the series there deletes all of it.
    if before == 0 or recurrence_id == master["start"]:
        delete_calendar_events(account, [master_id], send_scheduling_messages)
        return

    _end_series_before(account, master_id, rule, before, recurrence_id, send_scheduling_messages)


def _end_series_before(
    account: str,
    master_id: str,
    rule: dict,
    before: int | None,
    recurrence_id: str,
    send_scheduling_messages: bool,
) -> dict:
    """Stops a series at the occurrence before `recurrence_id`, and lifts off what came after.

    Returns the overrides that belonged to the occurrences no longer generated, already removed
    from the series — the caller decides whether they move somewhere else or simply go.
    """

    head_rule = dict(rule)
    if rule.get("count") is not None:
        # A counted series stays counted: the occurrences that already happened are its whole run.
        head_rule["count"] = before
    else:
        # `until` includes the moment it names, so the series stops just short of this one.
        head_rule["until"] = _moment_before(recurrence_id)

    edit_calendar_event(
        account, master_id, send_scheduling_messages=send_scheduling_messages, recurrence_rule=head_rule
    )

    service = get_calendar_event_service(account)
    stored = service.get([master_id])
    overrides = (stored[0] if stored else {}).get("recurrenceOverrides") or {}
    tail_overrides = {
        rid: override for rid, override in overrides.items() if not _is_before(rid, recurrence_id)
    }
    if tail_overrides:
        service.remove_overrides(master_id, list(tail_overrides))

    return tail_overrides


def spoken_rule(value: dict | None) -> str:
    """A recurrence rule reduced to what it actually says, for comparing two of them.

    The server normalises what it is sent — dropping "@type" and anything left at its default —
    so a stored rule and the one that produced it are rarely equal as written.
    """

    return json.dumps({k: v for k, v in (value or {}).items() if k != "@type" and v}, sort_keys=True)


def _occurrences_before(rule: dict, start: str, recurrence_id: str) -> int | None:
    """How many of a series' occurrences fall before the given one, or None if it can't be told.

    Expanded locally rather than asked of the server: the answer is needed while the series is
    still whole, and only to split a `count` between the two halves.
    """

    try:
        recur = _build_recurrence_rule(rule)
        if not recur:
            return None

        first = _local(start)
        split = _local(recurrence_id)
        occurrences = rrulestr(f"RRULE:{vRecur(recur).to_ical().decode()}", dtstart=first)
        # A bounded window, so an endless rule still answers.
        return len(occurrences.between(first - timedelta(seconds=1), split, inc=False))
    except Exception:
        return None


def _moment_before(recurrence_id: str) -> str:
    """The LocalDateTime a second before an occurrence — where a truncated rule stops."""

    return (_local(recurrence_id) - timedelta(seconds=1)).strftime("%Y-%m-%dT%H:%M:%S")


def _is_before(recurrence_id: str, split: str) -> bool:
    """Whether one occurrence's date falls before another's."""

    try:
        return _local(recurrence_id) < _local(split)
    except ValueError:
        return recurrence_id < split


def _local(value: str) -> datetime:
    """A JSCalendar LocalDateTime as a naive datetime — the zone is the event's, and the same
    for every date being compared here."""

    return datetime.fromisoformat(value.replace("Z", ""))
