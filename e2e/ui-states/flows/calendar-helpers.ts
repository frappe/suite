import type { APIRequestContext } from "@playwright/test";
import { callMethod } from "../scene";

/**
 * Seeds calendars and events on the demo site through the whitelisted methods
 * the Calendar app calls, for the `calendar` flow, and removes them again.
 */

/** The zone the browser and the seeded events share: the runner's own. */
export const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The runner's calendar date `days` from today, as `YYYY-MM-DD`. */
export function localDate(days = 0): string {
	const date = new Date();
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
 * today. Rows of a series are occurrences; the series is deleted through its
 * `master_id`, since the server refuses an occurrence's synthetic id.
 */
export async function removeEventsTitled(api: APIRequestContext, account: string, title: string): Promise<void> {
	const rows = await callMethod<EventRow[]>(api, "suite.calendar.api.get_calendar_events_with_shared", {
		account,
		from_date: `${localDate(-40)}T00:00:00Z`,
		to_date: `${localDate(40)}T00:00:00Z`,
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
