import type { APIRequestContext } from "@playwright/test";
import { callMethod } from "../scene";

/**
 * Seeds calendars and events on the demo site through the whitelisted methods
 * the Calendar app calls, for the `calendar` flow, and removes them again.
 */

/** The zone the browser and the seeded events share: the runner's own. */
export const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Maya's one-off event on the Wednesday of the seed's week (`maya-focus` in `suite/composition/demo/agenda.py`). */
const SEED_WEDNESDAY_EVENT = "Focus: launch checklist";
/** Before Maya's first event that day, so all of them are still to come. */
const PINNED_TIME = "08:30:00";

/**
 * The calendar's "today", which the flow pins the browser's clock to: 8:30
 * on the Wednesday of the week the demo seed ran. The seed dates its events
 * by weeks from that one, so on this day the focus block overlaps the
 * standup, Launch check-in is tomorrow and the Collections retest is next
 * week, however long ago the site was seeded, and the screens stay the same
 * from one capture to the next.
 */
export async function seedWednesday(api: APIRequestContext, account: string): Promise<Date> {
	const [focus] = await callMethod<{ start: string }[]>(api, "suite.calendar.api.search_calendar_events_with_shared", {
		account,
		text: SEED_WEDNESDAY_EVENT,
		time_zone: TIME_ZONE,
	});
	if (!focus) throw new Error(`calendar: the demo seed's “${SEED_WEDNESDAY_EVENT}” is missing`);
	return new Date(`${focus.start.slice(0, 10)}T${PINNED_TIME}`);
}

/** The runner's calendar date `days` after `today`, as `YYYY-MM-DD`. */
export function localDate(today: Date, days = 0): string {
	const date = new Date(today);
	date.setDate(date.getDate() + days);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface CalendarRow {
	id: string;
	name: string;
	_name: string;
	account: string;
	default: number;
	visible: number;
}

export function calendars(api: APIRequestContext, account: string): Promise<CalendarRow[]> {
	return callMethod(api, "suite.calendar.api.get_calendars_with_shared", { account });
}

export async function defaultCalendar(api: APIRequestContext, account: string): Promise<CalendarRow> {
	const found = (await calendars(api, account)).find((row) => row.account === account && row.default);
	if (!found) throw new Error("calendar: the account has no default calendar");
	return found;
}

/** Creates a calendar and returns its bare id (the server answers `account|id`). */
export async function createCalendar(api: APIRequestContext, account: string, name: string, color: string): Promise<string> {
	const name_ = await callMethod<string>(api, "suite.calendar.api.create_calendar", { account, name, color });
	return name_.split("|").pop() ?? name_;
}

export function setCalendarVisible(api: APIRequestContext, account: string, id: string, visible: boolean): Promise<unknown> {
	return callMethod(api, "suite.calendar.api.edit_calendar", { account, id, visible });
}

/** Deletes the account's calendars named `name`, if any are left. */
export async function removeCalendarsNamed(api: APIRequestContext, account: string, name: string): Promise<void> {
	for (const row of await calendars(api, account)) {
		if (row.account === account && row._name === name) {
			await callMethod(api, "suite.calendar.api.delete_calendar", { account, id: row.id });
		}
	}
}

export interface Participant {
	email: string;
	_name: string;
	participation_status: "ACCEPTED" | "NEEDS-ACTION";
	expect_reply?: number;
}

export interface NewEvent {
	title: string;
	/** Local wall time, `YYYY-MM-DDTHH:mm:ss`. */
	start: string;
	duration?: string;
	weekly?: boolean;
	participants?: Participant[];
	/** Whether the server delivers copies to the other participants. */
	invite?: boolean;
}

/** Adds an event to the account's default calendar and returns its id. */
export async function createEvent(api: APIRequestContext, account: string, organizer: string, event: NewEvent): Promise<string> {
	const calendar = await defaultCalendar(api, account);
	return callMethod(api, "suite.calendar.doctype.calendar_event.calendar_event.add_calendar_event", {
		account,
		organizer,
		calendar_ids: [calendar.id],
		title: event.title,
		start: event.start,
		duration: event.duration ?? "PT1H",
		time_zone: TIME_ZONE,
		free_busy_status: "Busy",
		privacy: "Public",
		recurrence_rule: event.weekly ? { frequency: "weekly" } : undefined,
		participants: event.participants,
		send_scheduling_messages: event.invite ?? false,
	});
}

interface EventRow {
	id: string;
	master_id?: string | null;
	title: string | null;
	account: string;
}

/**
 * Deletes every event titled `title` in the account, a month either side of
 * `today`. Rows of a series are occurrences; the series is deleted through its
 * `master_id`, since the server refuses an occurrence's synthetic id.
 */
export async function removeEventsTitled(api: APIRequestContext, account: string, title: string, today: Date): Promise<void> {
	const rows = await callMethod<EventRow[]>(api, "suite.calendar.api.get_calendar_events_with_shared", {
		account,
		from_date: `${localDate(today, -40)}T00:00:00Z`,
		to_date: `${localDate(today, 40)}T00:00:00Z`,
		time_zone: TIME_ZONE,
	});
	const ids = [...new Set(rows.filter((row) => row.account === account && row.title === title).map((row) => row.master_id || row.id))];
	if (ids.length) {
		await callMethod(api, "suite.calendar.doctype.calendar_event.calendar_event.delete_calendar_events", {
			account,
			ids,
			send_scheduling_messages: false,
		});
	}
}
