import { expect, type APIRequestContext, type Locator } from "@playwright/test";
import { demoUser, identityOf, openDemoScene, personalAccount, type DemoPerson } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import { perScene, type BaseScene } from "../scene";
import {
	createCalendar,
	createEvent,
	defaultCalendar,
	localDate,
	removeCalendarsNamed,
	removeEventsTitled,
	setCalendarVisible,
	type NewEvent,
	type Participant,
} from "./calendar-helpers";

type Event =
	| { type: "WEEK" }
	| { type: "DAY" }
	| { type: "AGENDA" }
	| { type: "MONTH_SLOW" }
	| { type: "AGENDA_SLOW" }
	| { type: "LOAD_FAILS" }
	| { type: "EMPTY_MONTH" }
	| { type: "EMPTY_AGENDA" }
	| { type: "MINI_NEXT" }
	| { type: "HIDE_CALENDAR" }
	| { type: "NEW_CALENDAR" }
	| { type: "NAME_CALENDAR" }
	| { type: "SAVE_CALENDAR" }
	| { type: "DEFAULT_CALENDAR_MENU" }
	| { type: "OTHER_CALENDAR_MENU" }
	| { type: "EDIT_CALENDAR" }
	| { type: "RENAME_CALENDAR" }
	| { type: "SAVE_CALENDAR_EDIT" }
	| { type: "DELETE_CALENDAR" }
	| { type: "CONFIRM_DELETE_CALENDAR" }
	| { type: "OPEN_EVENT" }
	| { type: "EVENT_MENU" }
	| { type: "EDIT_EVENT" }
	| { type: "ALL_PARTICIPANTS" }
	| { type: "CLICK_SLOT" }
	| { type: "NEW_EVENT" }
	| { type: "TYPE_TITLE" }
	| { type: "SEARCH_PARTICIPANT" }
	| { type: "PICK_PARTICIPANT" }
	| { type: "INVALID_PARTICIPANT" }
	| { type: "SAVE_EVENT" }
	| { type: "SKIP_NOTIFY" }
	| { type: "SAVE_SLOW" }
	| { type: "REPEAT" }
	| { type: "APPLY_REPEAT" }
	| { type: "CANCEL_EVENT" }
	| { type: "CLOSE_EVENT" }
	| { type: "OPEN_OWN_EVENT" }
	| { type: "DELETE_OWN_EVENT" }
	| { type: "SKIP_CANCELLATION" }
	| { type: "OPEN_SERIES" }
	| { type: "DELETE_SERIES" }
	| { type: "EDIT_SERIES" }
	| { type: "RENAME_SERIES" }
	| { type: "SAVE_SERIES" }
	| { type: "CONFIRM_SCOPE" }
	| { type: "OPEN_INVITE" }
	| { type: "ANSWER_YES" }
	| { type: "OPEN_RECURRING_INVITE" }
	| { type: "ANSWER_RECURRING" }
	| { type: "OPEN_PENDING_INVITE" }
	| { type: "SEARCH" }
	| { type: "SEARCH_HIT" }
	| { type: "SEARCH_MISS" }
	| { type: "SEARCH_FILTERS" }
	| { type: "SHORTCUTS" }
	| { type: "PHONE" }
	| { type: "SWITCH_VIEW" }
	| { type: "PICK_MONTH" }
	| { type: "TAP_EVENT" }
	| { type: "TAP_NEW_EVENT" }
	| { type: "SEARCH_TAB" }
	| { type: "PHONE_SEARCH_HIT" }
	| { type: "PHONE_SEARCH_MISS" }
	| { type: "PROFILE_TAB" };

/**
 * Calendar: one mail account's calendars and events. In the code the view is
 * the route (`calendar-month`, `-week`, `-day`, `-agenda`); the open event is
 * read from the `?event=` query, `railOpen` and `cardAnchor` together; and
 * every dialog is its own boolean on `CalendarView` or `EventModal`
 * (`showEditEvent`, `showRecurringEventModal`, `showNotifyModal`,
 * `showDiscardModal`, `showRepeatSettings`, ...).
 */
const machine = setupFlow<Event>().createMachine({
	id: "calendar",
	initial: "month",
	states: {
		month: {
			meta: { description: "Maya's month: the sidebar with the mini month, My calendars and Upcoming events; the grid with up to a few event pills per day. Month is the desktop default." },
			on: {
				WEEK: "week",
				DAY: "day",
				AGENDA: "agenda",
				MONTH_SLOW: "monthLoading",
				LOAD_FAILS: "loadFailed",
				EMPTY_MONTH: "monthEmpty",
				MINI_NEXT: "miniMonthPaged",
				HIDE_CALENDAR: "calendarHidden",
				NEW_CALENDAR: "calendarNew",
				DEFAULT_CALENDAR_MENU: "defaultCalendarMenu",
				OTHER_CALENDAR_MENU: "otherCalendarMenu",
				NEW_EVENT: "newEvent",
				SEARCH: "searchPalette",
				SHORTCUTS: "shortcutsDialog",
				PHONE: "phoneAgenda",
			},
		},
		monthLoading: {
			meta: { description: "The events request still out: the month grid and Upcoming events are drawn empty with nothing saying they are loading, so it looks like an empty month." },
		},
		loadFailed: {
			meta: { description: "The events request failed: a “Something went wrong” toast, and the grid and Upcoming events stay empty with no retry on the page." },
		},
		monthEmpty: {
			meta: { description: "A month with no events (January 2031): the plain grid, with no message. Maya's seeded series never end, so the events reply is stubbed as empty here; the mini month still has its dots because it reads them from another request." },
		},
		miniMonthPaged: {
			meta: { description: "The mini month paged forward to December. The main view stays on November; only a day click moves it." },
		},
		calendarHidden: {
			meta: { description: "Maya's only calendar switched off by clicking its row: its dot fades, its name greys, and every event leaves the grid. The change is saved on the server." },
		},
		calendarNew: {
			meta: { description: "New Calendar: an empty Name with the placeholder “Personal”, a Color select, and Save off until a name is typed." },
			on: { NAME_CALENDAR: "calendarNewNamed" },
		},
		calendarNewNamed: {
			meta: { description: "A name typed and Amber picked as the colour: Save turns on." },
			on: { SAVE_CALENDAR: "calendarCreated" },
		},
		calendarCreated: {
			meta: { description: "“Calendar created.”: the new calendar joins My calendars under Maya's own." },
		},
		defaultCalendarMenu: {
			meta: { description: "The options menu of Maya's default calendar: only Edit. Set as Default and Delete are left out for the default calendar." },
		},
		otherCalendarMenu: {
			meta: { description: "The options menu of a second calendar: Edit, Set as Default and Delete." },
			on: { EDIT_CALENDAR: "calendarEdit", DELETE_CALENDAR: "calendarDeleteConfirm" },
		},
		calendarEdit: {
			meta: { description: "Edit Calendar: the same form, filled. Save is off until something changes." },
			on: { RENAME_CALENDAR: "calendarEditDirty" },
		},
		calendarEditDirty: {
			meta: { description: "The calendar renamed in the form: Save turns on." },
			on: { SAVE_CALENDAR_EDIT: "calendarUpdated" },
		},
		calendarUpdated: {
			meta: { description: "“Calendar updated.”: the sidebar shows the new name." },
		},
		calendarDeleteConfirm: {
			meta: { description: "“Delete <name>?”: every event on the calendar is deleted with it, and it cannot be undone. A red Delete button." },
			on: { CONFIRM_DELETE_CALENDAR: "calendarDeleted" },
		},
		calendarDeleted: {
			meta: { description: "“Calendar deleted.”: the row leaves My calendars." },
		},
		week: {
			meta: { description: "This week, scrolled to 9 am. On Wednesday the 10:00 standup overlaps the 9–11 focus block and is drawn as a smaller pill inside it. Nothing marks the two as a conflict." },
			on: {
				OPEN_EVENT: "eventPopover",
				CLICK_SLOT: "quickCreate",
				OPEN_OWN_EVENT: "ownEventPopover",
				OPEN_SERIES: "seriesPopover",
				OPEN_INVITE: "invitePopover",
				OPEN_RECURRING_INVITE: "recurringInvitePopover",
				OPEN_PENDING_INVITE: "pendingInvitePopover",
			},
		},
		day: {
			meta: { description: "Today alone, in one wide column, with the same overlap of the focus block and the standup." },
		},
		agenda: {
			meta: { description: "The agenda: three months as a list, grouped by week and day, each row with time, recurrence, place and the number of people." },
			on: { AGENDA_SLOW: "agendaLoading", EMPTY_AGENDA: "agendaEmpty" },
		},
		agendaLoading: {
			meta: { description: "The agenda before its events arrive: one spinner in the list. Only the agenda view shows a loading state." },
		},
		agendaEmpty: {
			meta: { description: "An agenda span with no events (from January 2031): “Nothing on between January and March.” The events reply is stubbed as empty, as for the empty month." },
		},
		eventPopover: {
			meta: { description: "Launch check-in, which Maya organizes: time and date, organizer, “5 people (4 yes, 1 no)” with the first four, the description, and Going? with Yes picked." },
			on: { EVENT_MENU: "eventMenu", ALL_PARTICIPANTS: "allParticipants" },
		},
		eventMenu: {
			meta: { description: "The event's ⋯ menu: Edit, Copy Invite, and Delete in red." },
			on: { EDIT_EVENT: "eventEdit" },
		},
		eventEdit: {
			meta: { description: "Edit Event for Launch check-in: the form filled in, with all five participants and their answers. Availability shows “Select option” because the seeded event has none. Not saved here; this is seeded data." },
		},
		allParticipants: {
			meta: { description: "“See all participants” expands the list in place: Sofia Martinez, who answered no (a red cross), now shows below the first four, and the link is gone." },
		},
		quickCreate: {
			meta: { description: "A click on an empty 7 pm slot opens New Event with that day and 7–8 pm already filled in." },
		},
		newEvent: {
			meta: { description: "New Event from the toolbar: title empty, the next hour as the time, one alert, Busy and Public, and Maya alone as organizer." },
			on: { TYPE_TITLE: "newEventTitled", REPEAT: "repeatSettings", CANCEL_EVENT: "discardConfirm", CLOSE_EVENT: "draftSaved" },
		},
		newEventTitled: {
			meta: { description: "A title typed." },
			on: { SEARCH_PARTICIPANT: "participantSuggestions", INVALID_PARTICIPANT: "invalidParticipant", SAVE_SLOW: "eventSaving" },
		},
		participantSuggestions: {
			meta: { description: "“le” typed into Participants: a list of matching people, Leo Park with his avatar and address." },
			on: { PICK_PARTICIPANT: "participantAdded" },
		},
		participantAdded: {
			meta: { description: "Leo added: Participants counts 2. Leo is listed under Maya as “Leo” with a letter avatar and a remove button, not with the full name and photo the suggestion showed." },
			on: { SAVE_EVENT: "notifyParticipants" },
		},
		invalidParticipant: {
			meta: { description: "Something that is not an address entered as a participant: an “Invalid email address” toast. The typed text is cleared, the open list says “No results”, and nobody is added." },
		},
		notifyParticipants: {
			meta: { description: "Save with someone invited asks first: Notify Participants, “Send an email to let attendees know they've been invited?”, with Skip and Send Email." },
			on: { SKIP_NOTIFY: "eventCreated" },
		},
		eventCreated: {
			meta: { description: "“Event created.”: the dialog closes, and the event appears on today in the month grid and first in Upcoming events." },
		},
		eventSaving: {
			meta: { description: "Save pressed and the request still out: a “Creating event...” toast." },
		},
		repeatSettings: {
			meta: { description: "The Repeat dialog: every N days, weeks, months or years, an end condition, the rule in words, Remove Repeat and Apply." },
			on: { APPLY_REPEAT: "newEventRepeating" },
		},
		newEventRepeating: {
			meta: { description: "Back in New Event with the rule applied: the Repeat row now reads the rule in words." },
		},
		discardConfirm: {
			meta: { description: "Cancel on a form with changes asks: “Discard changes?”, “This event has not been saved and will be lost.”, with Save as draft and a red Discard. The X is the only way back to the form." },
		},
		draftSaved: {
			meta: { description: "Closing the same form with Escape does not ask: it saves a draft, drawn with a dashed outline on today, and says “Draft saved.” with a Discard action. Cancel asks first; Escape and X do not." },
		},
		ownEventPopover: {
			meta: { description: "A one-off event Maya organizes with Leo invited: Busy, Public, the organizer, and “2 people (1 yes)” with Leo not yet answered." },
			on: { DELETE_OWN_EVENT: "deleteNotify" },
		},
		deleteNotify: {
			meta: { description: "Delete on an event with others on it asks: Notify Participants, “Send a cancellation email…”, Skip or Send Email." },
			on: { SKIP_CANCELLATION: "eventDeleted" },
		},
		eventDeleted: {
			meta: { description: "“Event deleted.”: the card closes and the event leaves the grid." },
		},
		seriesPopover: {
			meta: { description: "One occurrence of a weekly series Maya organizes alone; the card says how it repeats." },
			on: { DELETE_SERIES: "deleteScope", EDIT_SERIES: "seriesEdit" },
		},
		deleteScope: {
			meta: { description: "Delete repeating event: This event only (picked), This and following events, All events in the series, and a red Delete." },
		},
		seriesEdit: {
			meta: { description: "Edit Event for the series occurrence, filled in, with “Repeats every week” ticked. Save is off until something changes." },
			on: { RENAME_SERIES: "seriesEditDirty" },
		},
		seriesEditDirty: {
			meta: { description: "The occurrence's title changed in the form." },
			on: { SAVE_SERIES: "recurringScope" },
		},
		recurringScope: {
			meta: { description: "Update repeating event: This event only (picked), This and following events, All events in the series, and Update." },
			on: { CONFIRM_SCOPE: "recurringUpdated" },
		},
		recurringUpdated: {
			meta: { description: "“Event updated.”: today's occurrence shows the new title “Evening review, moved …” in the week grid." },
		},
		invitePopover: {
			meta: { description: "An invitation from Leo that Maya has not answered: Going? with none of Yes, No or Maybe picked." },
			on: { ANSWER_YES: "answered" },
		},
		answered: {
			meta: { description: "Yes picked: “Response sent.”, Yes is highlighted, and the count reads “2 people (2 yes)” with a tick by Maya." },
		},
		recurringInvitePopover: {
			meta: { description: "An unanswered weekly invitation from Leo." },
			on: { ANSWER_RECURRING: "rsvpScope" },
		},
		rsvpScope: {
			meta: { description: "Respond to repeating event: This event only is greyed out, since it is not Maya's event, so All events in the series is picked." },
		},
		pendingInvitePopover: {
			meta: { description: "The seeded invitation Collections retest, from Leo next Tuesday, still waiting for Maya's answer. Not answered here: it is seeded data." },
		},
		searchPalette: {
			meta: { description: "Search on desktop is Suite's palette: a Search box with a Filters button, Suggested commands (New event, Keyboard shortcuts, Settings, Switch to light theme), and key hints at the foot." },
			on: { SEARCH_HIT: "searchResults", SEARCH_MISS: "searchNoResults", SEARCH_FILTERS: "searchFilters" },
		},
		searchResults: {
			meta: { description: "“launch” typed: matching events, each with its date, the match highlighted, how far away it is, and its time." },
		},
		searchNoResults: {
			meta: { description: "A query with no match: “No results for …”." },
		},
		searchFilters: {
			meta: { description: "Filters opened under the search box: Look In (All calendars), Organiser, Attendee, and a From Date / To Date range with a note on how a range matches a series." },
		},
		shortcutsDialog: {
			meta: { description: "Keyboard Shortcuts (Shift + /): the calendar's E, T, arrows, D, W, M and A, then Suite's own." },
		},
		phoneAgenda: {
			meta: { description: "Phone width with no remembered view: the agenda. A Switch view button, the range, Previous / Today / Next, a New event button, and a tab bar of the view, Search and Profile." },
			on: { SWITCH_VIEW: "phoneViewSheet", TAP_EVENT: "phoneEventSheet", TAP_NEW_EVENT: "phoneNewEvent", SEARCH_TAB: "phoneSearch", PROFILE_TAB: "phoneProfile" },
		},
		phoneViewSheet: {
			meta: { description: "The view sheet: Day, Week, Month and Agenda tiles, then My calendars with New Calendar." },
			on: { PICK_MONTH: "phoneMonth" },
		},
		phoneMonth: {
			meta: { description: "The month at phone width: seven narrow columns where each event title is cut to its first few letters." },
		},
		phoneEventSheet: {
			meta: { description: "An event tapped: a bottom sheet with the same details as the desktop card, the participants as one row of avatars." },
		},
		phoneNewEvent: {
			meta: { description: "New event on a phone is a full screen form with X and Save at the top, and each setting on its own row." },
		},
		phoneSearch: {
			meta: { description: "The Search tab: a search box and Filters over “Search events by name, organizer, or attendees.”" },
			on: { PHONE_SEARCH_HIT: "phoneSearchResults", PHONE_SEARCH_MISS: "phoneSearchEmpty" },
		},
		phoneSearchResults: {
			meta: { description: "“launch” typed: three matching events, each with a date tile, the match highlighted, the time, and how far away it is." },
		},
		phoneSearchEmpty: {
			meta: { description: "“No results for …”." },
		},
		phoneProfile: {
			meta: { description: "The Profile tab: Maya's name and address, then Preferences, Calendars, Participant Identity, Import, Export, Advanced and Log Out." },
		},
	},
});

interface CalendarContext {
	account: string;
}

const context = perScene<CalendarContext>("calendar");

const viewPath = (scene: BaseScene, view: string, date?: string) =>
	`/calendar/account/${context.get(scene).account}/${view}${date ? `/${date.replaceAll("-", "/")}` : ""}`;

const EVENTS = "**/api/method/suite.calendar.api.get_calendar_events_with_shared";

/** The event card, the dialog whose heading is the event's title. */
function card(scene: BaseScene, title: string): Locator {
	return scene.page.getByRole("dialog").filter({ has: scene.page.getByRole("heading", { name: title, exact: true }) });
}

/** The event form. frappe-ui's dialog gives it no accessible name; its description is unique. */
function eventForm(scene: BaseScene): Locator {
	return scene.page.getByRole("dialog").filter({ hasText: /Create a calendar event\.|Edit this calendar event\./ });
}

/**
 * A dialog raised over another one (the event form or the card). reka marks
 * everything outside the newest modal `aria-hidden`, and these stacked
 * dialogs end up hidden from the accessibility tree too, so they are found
 * by their text, and their controls with `includeHidden`.
 */
function stacked(scene: BaseScene, title: string): Locator {
	return scene.page.locator('[role="dialog"]').filter({ has: scene.page.getByText(title, { exact: true }) });
}

/** Opens the card of the pill titled `title` in the current grid. */
async function openCard(scene: BaseScene, title: string): Promise<void> {
	await scene.page.getByText(title, { exact: true }).first().click();
	await expect(card(scene, title)).toBeVisible();
}

async function cardMenu(scene: BaseScene, title: string): Promise<void> {
	await card(scene, title).getByRole("button").first().click();
	await expect(scene.page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
}

/** Removes events titled `titles` from Maya's and Leo's accounts when the path ends. */
function deferEvents(scene: BaseScene, ...titles: string[]): void {
	const { account } = context.get(scene);
	scene.defer(async () => {
		const leo = await scene.as(demoUser("leo"));
		const leoAccount = await personalAccount(leo);
		for (const title of titles) {
			await removeEventsTitled(leo, leoAccount, title);
			await removeEventsTitled(scene.api, account, title);
		}
	});
}

/** A demo person as an event's participant names them. */
function participant(person: DemoPerson, participation_status: Participant["participation_status"], expect_reply?: number): Participant {
	const { email, name } = identityOf(person);
	return { email, _name: name, participation_status, expect_reply };
}

/** Seeds an event Maya organizes, then reloads the week to show it. */
async function seedOwn(scene: BaseScene, event: NewEvent): Promise<void> {
	deferEvents(scene, event.title);
	await createEvent(scene.api, context.get(scene).account, identityOf("maya").email, event);
	await scene.page.reload();
	await expect(scene.page.getByText(event.title, { exact: true }).first()).toBeVisible();
}

/** Seeds an invitation from Leo to Maya and waits until Maya's copy shows in the week. */
async function seedInvite(scene: BaseScene, event: Omit<NewEvent, "participants" | "invite">): Promise<void> {
	deferEvents(scene, event.title);
	const leo: APIRequestContext = await scene.as(demoUser("leo"));
	await createEvent(leo, await personalAccount(leo), identityOf("leo").email, {
		...event,
		invite: true,
		participants: [participant("leo", "ACCEPTED"), participant("maya", "NEEDS-ACTION", 1)],
	});
	await expect(async () => {
		await scene.page.reload();
		await expect(scene.page.getByText(event.title, { exact: true }).first()).toBeVisible({ timeout: 3000 });
	}).toPass({ timeout: 30_000 });
}

/** Seeds a second calendar for Maya, so its menu offers Delete. */
async function seedCalendar(scene: BaseScene): Promise<string> {
	const { account } = context.get(scene);
	const name = scene.name("Side projects");
	scene.defer(() => removeCalendarsNamed(scene.api, account, name));
	await createCalendar(scene.api, account, name, "#6846e3"); // Violet in the app palette
	await scene.page.reload();
	await expect(myCalendars(scene).getByRole("button", { name, exact: true })).toBeVisible();
	return name;
}

function myCalendars(scene: BaseScene): Locator {
	return scene.page.getByRole("group", { name: "My calendars" });
}

/** The options button on the sidebar row of the calendar called `name`. */
function calendarOptions(scene: BaseScene, name: string): Locator {
	const row = myCalendars(scene)
		.locator("*")
		.filter({ has: scene.page.getByRole("button", { name, exact: true }) })
		.filter({ has: scene.page.getByRole("button", { name: "Calendar options" }) })
		.last();
	return row.getByRole("button", { name: "Calendar options" });
}

async function pickView(scene: BaseScene, view: "Day" | "Week" | "Month" | "Agenda", path: string): Promise<void> {
	await scene.page.getByRole("radio", { name: view }).click();
	await expect(scene.page).toHaveURL(new RegExp(`/${path}`));
	await expect(scene.page.getByText("Beacon standup").first()).toBeVisible();
}

/** Today at `hour`, as the API's local wall time. */
const todayAt = (hour: number, days = 0) => `${localDate(days)}T${String(hour).padStart(2, "0")}:00:00`;

/**
 * Maya's seeded series have no end date, so every range on the demo site has events.
 * An empty range is shown by answering the events request with an empty list.
 */
async function answerNoEvents(scene: BaseScene): Promise<void> {
	await scene.page.route(EVENTS, (route) => route.fulfill({ json: { message: [] } }));
}

const phoneTabs = (scene: BaseScene) => scene.page.getByRole("navigation").filter({ has: scene.page.getByRole("button", { name: "Profile" }) });

export const calendar = defineFlow<Event, BaseScene>({
	id: "calendar",
	title: "Calendar",
	source: "frontend/src/apps/calendar/pages/CalendarView.vue",
	open: (browser) => openDemoScene(browser, "maya"),
	machine,
	async enter(scene) {
		context.set(scene, { account: await personalAccount(scene.api) });
		await scene.goto(viewPath(scene, "month", localDate()));
		await expect(scene.page.getByRole("radio", { name: "Month" })).toBeChecked();
		await expect(scene.page.getByText("Launch check-in").first()).toBeVisible();
	},
	events: {
		async WEEK(scene) {
			await pickView(scene, "Week", "week");
		},
		async DAY(scene) {
			await pickView(scene, "Day", "day");
		},
		async AGENDA(scene) {
			await pickView(scene, "Agenda", "agenda");
			await expect(scene.page.getByText("Collections retest: share position").first()).toBeVisible();
		},
		async MONTH_SLOW(scene) {
			await scene.hold(EVENTS);
			await scene.page.reload();
			await expect(scene.page.getByRole("radio", { name: "Month" })).toBeChecked();
			await scene.settle();
			await expect(scene.page.getByText("Launch check-in")).toHaveCount(0);
		},
		async AGENDA_SLOW(scene) {
			await scene.hold(EVENTS);
			await scene.page.reload();
			// The boot splash also counts as loading; wait for the sidebar so the spinner is the agenda's.
			await expect(scene.page.getByText("My calendars")).toBeVisible();
			await expect(scene.page.getByRole("status", { name: "Loading" })).toBeVisible();
		},
		async LOAD_FAILS(scene) {
			await (await scene.hold(EVENTS)).abort(500);
			await scene.page.reload();
			await expect(scene.toast(/went wrong/i)).toBeVisible();
		},
		async EMPTY_MONTH(scene) {
			await answerNoEvents(scene);
			await scene.goto(viewPath(scene, "month", "2031-01-01"));
			await expect(scene.page.getByText("Jan 1", { exact: true })).toBeVisible();
			await scene.page.waitForLoadState("networkidle");
		},
		async EMPTY_AGENDA(scene) {
			await answerNoEvents(scene);
			await scene.goto(viewPath(scene, "agenda", "2031-01-01"));
			await expect(scene.page.getByText(/Nothing on between/)).toBeVisible();
		},
		async MINI_NEXT(scene) {
			const sidebar = scene.page.getByRole("complementary", { name: "Calendar" });
			const month = new Date();
			month.setDate(1);
			month.setMonth(month.getMonth() + 1);
			const label = month.toLocaleString("en-US", { month: "long" });
			await sidebar.getByRole("button").nth(2).click();
			await expect(sidebar.getByText(label, { exact: true })).toBeVisible();
		},
		async HIDE_CALENDAR(scene) {
			const { account } = context.get(scene);
			const own = await defaultCalendar(scene.api, account);
			scene.defer(() => setCalendarVisible(scene.api, account, own.id, true));
			await myCalendars(scene).getByRole("button", { name: own._name, exact: true }).click();
			await expect(scene.page.getByText("Launch check-in")).toHaveCount(0);
		},
		async NEW_CALENDAR(scene) {
			await scene.page.getByRole("button", { name: "New Calendar" }).click();
			await expect(scene.dialog("New Calendar").getByRole("button", { name: "Save" })).toBeDisabled();
		},
		async NAME_CALENDAR(scene) {
			const dialog = scene.dialog("New Calendar");
			const name = scene.name("Travel");
			const { account } = context.get(scene);
			scene.defer(() => removeCalendarsNamed(scene.api, account, name));
			await dialog.getByRole("textbox", { name: "Name" }).fill(name);
			await dialog.getByRole("combobox", { name: "Color" }).click();
			await scene.page.getByRole("option", { name: "Amber" }).click();
			await expect(dialog.getByRole("combobox", { name: "Color" })).toHaveText(/Amber/);
			await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
		},
		async SAVE_CALENDAR(scene) {
			await scene.dialog("New Calendar").getByRole("button", { name: "Save" }).click();
			await expect(scene.toast("Calendar created.")).toBeVisible();
			await expect(myCalendars(scene).getByRole("button", { name: scene.name("Travel"), exact: true })).toBeVisible();
		},
		async DEFAULT_CALENDAR_MENU(scene) {
			await calendarOptions(scene, "Maya Chen").click();
			await expect(scene.page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
		},
		async OTHER_CALENDAR_MENU(scene) {
			const name = await seedCalendar(scene);
			await calendarOptions(scene, name).click();
			await expect(scene.page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
		},
		async EDIT_CALENDAR(scene) {
			await scene.page.getByRole("menuitem", { name: "Edit" }).click();
			const dialog = scene.dialog("Edit Calendar");
			await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue(scene.name("Side projects"));
			await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
		},
		async RENAME_CALENDAR(scene) {
			const dialog = scene.dialog("Edit Calendar");
			const name = scene.name("Weekend projects");
			const { account } = context.get(scene);
			scene.defer(() => removeCalendarsNamed(scene.api, account, name));
			await dialog.getByRole("textbox", { name: "Name" }).fill(name);
			await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
		},
		async SAVE_CALENDAR_EDIT(scene) {
			await scene.dialog("Edit Calendar").getByRole("button", { name: "Save" }).click();
			await expect(scene.toast("Calendar updated.")).toBeVisible();
			await expect(myCalendars(scene).getByRole("button", { name: scene.name("Weekend projects"), exact: true })).toBeVisible();
		},
		async DELETE_CALENDAR(scene) {
			await scene.page.getByRole("menuitem", { name: "Delete" }).click();
			await expect(scene.dialog(`Delete ${scene.name("Side projects")}?`)).toBeVisible();
		},
		async CONFIRM_DELETE_CALENDAR(scene) {
			await scene.dialog(`Delete ${scene.name("Side projects")}?`).getByRole("button", { name: "Delete" }).click();
			await expect(scene.toast("Calendar deleted.")).toBeVisible();
			await expect(myCalendars(scene).getByRole("button", { name: scene.name("Side projects"), exact: true })).toHaveCount(0);
		},
		async OPEN_EVENT(scene) {
			await openCard(scene, "Launch check-in");
			await expect(card(scene, "Launch check-in").getByText("5 people (4 yes, 1 no)")).toBeVisible();
		},
		async EVENT_MENU(scene) {
			await cardMenu(scene, "Launch check-in");
		},
		async EDIT_EVENT(scene) {
			await scene.page.getByRole("menuitem", { name: "Edit" }).click();
			await expect(eventForm(scene).getByRole("textbox", { name: "Add title" })).toHaveValue("Launch check-in");
		},
		async ALL_PARTICIPANTS(scene) {
			const button = card(scene, "Launch check-in").getByRole("button", { name: "See all participants" });
			await button.click();
			await expect(button).toBeHidden();
		},
		async CLICK_SLOT(scene) {
			const today = new Date().toDateString();
			await scene.page.locator(`[data-time-grid][data-date-attr^="${today}"] .cell[data-time-attr]`).nth(19).click();
			await expect(eventForm(scene).getByRole("combobox", { name: "Select time" }).first()).toHaveValue("7:00 PM");
		},
		async NEW_EVENT(scene) {
			await scene.page.getByRole("button", { name: "Event", exact: true }).click();
			await expect(eventForm(scene).getByRole("textbox", { name: "Add title" })).toBeVisible();
		},
		async TYPE_TITLE(scene) {
			const title = scene.name("Venue walkthrough");
			deferEvents(scene, title);
			await eventForm(scene).getByRole("textbox", { name: "Add title" }).fill(title);
			await expect(eventForm(scene).getByRole("textbox", { name: "Add title" })).toHaveValue(title);
		},
		async SEARCH_PARTICIPANT(scene) {
			await eventForm(scene).getByRole("combobox", { name: "Enter participants" }).click();
			await scene.page.keyboard.type("le");
			await expect(scene.page.getByRole("option", { name: /Leo Park/ })).toBeVisible();
		},
		async PICK_PARTICIPANT(scene) {
			await scene.page.getByRole("option", { name: /Leo Park/ }).click();
			await expect(eventForm(scene).getByText("leo@northwind.test")).toBeVisible();
		},
		async INVALID_PARTICIPANT(scene) {
			await eventForm(scene).getByRole("combobox", { name: "Enter participants" }).click();
			await scene.page.keyboard.type("leo at northwind");
			await scene.page.keyboard.press("Enter");
			await expect(scene.toast("Invalid email address")).toBeVisible();
		},
		async SAVE_EVENT(scene) {
			await eventForm(scene).getByRole("button", { name: "Save", exact: true }).click();
			await expect(stacked(scene, "Notify Participants")).toBeVisible();
		},
		async SKIP_NOTIFY(scene) {
			await stacked(scene, "Notify Participants").getByRole("button", { name: "Skip", includeHidden: true }).click();
			await expect(scene.toast("Event created.")).toBeVisible();
			await expect(scene.page.getByText(scene.name("Venue walkthrough")).first()).toBeVisible();
		},
		async SAVE_SLOW(scene) {
			await scene.hold("**/api/method/suite.calendar.doctype.calendar_event.calendar_event.add_calendar_event");
			await eventForm(scene).getByRole("button", { name: "Save", exact: true }).click();
			await expect(scene.toast("Creating event...")).toBeVisible();
		},
		async REPEAT(scene) {
			await eventForm(scene).getByText("Repeat", { exact: true }).click();
			await expect(scene.dialog("Repeat").getByRole("button", { name: "Apply" })).toBeVisible();
		},
		async APPLY_REPEAT(scene) {
			await scene.dialog("Repeat").getByRole("radio", { name: "Week" }).click();
			await scene.dialog("Repeat").getByRole("button", { name: "Apply" }).click();
			await expect(scene.dialog("Repeat")).toBeHidden();
			await expect(eventForm(scene).getByText(/^Repeats /)).toBeVisible();
		},
		async CANCEL_EVENT(scene) {
			await eventForm(scene).getByRole("textbox", { name: "Add title" }).fill(scene.name("Unsaved idea"));
			await eventForm(scene).getByRole("button", { name: "Cancel" }).click();
			await expect(scene.page.getByText("Discard changes?")).toBeVisible();
		},
		async CLOSE_EVENT(scene) {
			const title = scene.name("Unsaved idea");
			deferEvents(scene, title);
			await eventForm(scene).getByRole("textbox", { name: "Add title" }).fill(title);
			await scene.page.keyboard.press("Escape");
			await expect(scene.toast("Draft saved.")).toBeVisible();
		},
		async OPEN_OWN_EVENT(scene) {
			const title = scene.name("Supplier call");
			await seedOwn(scene, {
				title,
				start: todayAt(19),
				participants: [participant("maya", "ACCEPTED"), participant("leo", "NEEDS-ACTION", 1)],
			});
			await openCard(scene, title);
		},
		async DELETE_OWN_EVENT(scene) {
			await cardMenu(scene, scene.name("Supplier call"));
			await scene.page.getByRole("menuitem", { name: "Delete" }).click();
			await expect(stacked(scene, "Notify Participants")).toBeVisible();
		},
		async SKIP_CANCELLATION(scene) {
			await stacked(scene, "Notify Participants").getByRole("button", { name: "Skip", includeHidden: true }).click();
			await expect(scene.toast("Event deleted.")).toBeVisible();
			await expect(scene.page.getByText(scene.name("Supplier call"))).toHaveCount(0);
		},
		async OPEN_SERIES(scene) {
			const title = scene.name("Evening review");
			deferEvents(scene, scene.name("Evening review, moved"));
			await seedOwn(scene, { title, start: todayAt(21, -7), weekly: true });
			await openCard(scene, title);
		},
		async DELETE_SERIES(scene) {
			await cardMenu(scene, scene.name("Evening review"));
			await scene.page.getByRole("menuitem", { name: "Delete" }).click();
			await expect(stacked(scene, "Delete repeating event").getByRole("radio", { name: "This and following events", includeHidden: true })).toBeVisible();
		},
		async EDIT_SERIES(scene) {
			await cardMenu(scene, scene.name("Evening review"));
			await scene.page.getByRole("menuitem", { name: "Edit" }).click();
			await expect(eventForm(scene).getByRole("textbox", { name: "Add title" })).toHaveValue(scene.name("Evening review"));
		},
		async RENAME_SERIES(scene) {
			const field = eventForm(scene).getByRole("textbox", { name: "Add title" });
			await field.fill(scene.name("Evening review, moved"));
			await expect(field).toHaveValue(scene.name("Evening review, moved"));
		},
		async SAVE_SERIES(scene) {
			await eventForm(scene).getByRole("button", { name: "Save", exact: true }).click();
			await expect(stacked(scene, "Update repeating event").getByRole("radio", { name: "This event only", includeHidden: true })).toBeChecked();
		},
		async CONFIRM_SCOPE(scene) {
			await stacked(scene, "Update repeating event").getByRole("button", { name: "Update", includeHidden: true }).click();
			await expect(scene.toast("Event updated.")).toBeVisible();
			await expect(scene.page.getByText(scene.name("Evening review, moved")).first()).toBeVisible();
		},
		async OPEN_INVITE(scene) {
			const title = scene.name("Press briefing");
			await seedInvite(scene, { title, start: todayAt(20) });
			await openCard(scene, title);
			await expect(card(scene, title).getByRole("radio", { name: "Yes" })).not.toBeChecked();
		},
		async ANSWER_YES(scene) {
			const popover = card(scene, scene.name("Press briefing"));
			await popover.getByRole("radio", { name: "Yes" }).click();
			await expect(scene.toast("Response sent.")).toBeVisible();
		},
		async OPEN_RECURRING_INVITE(scene) {
			const title = scene.name("Launch retro");
			await seedInvite(scene, { title, start: todayAt(18, -7), weekly: true });
			await openCard(scene, title);
		},
		async ANSWER_RECURRING(scene) {
			await card(scene, scene.name("Launch retro")).getByRole("radio", { name: "Maybe" }).click();
			await expect(stacked(scene, "Respond to repeating event").getByRole("radio", { name: "All events in the series", includeHidden: true })).toBeChecked();
		},
		async OPEN_PENDING_INVITE(scene) {
			await scene.goto(viewPath(scene, "week", localDate(7)));
			await openCard(scene, "Collections retest: share position");
		},
		async SEARCH(scene) {
			await scene.page.getByRole("navigation", { name: "Areas" }).getByRole("button", { name: "Search" }).click();
			await expect(scene.dialog("Search Suite").getByRole("button", { name: "Filters" })).toBeVisible();
		},
		async SEARCH_HIT(scene) {
			await scene.page.keyboard.type("launch");
			await expect(scene.dialog("Search Suite").getByRole("option", { name: /Launch check-in/ })).toBeVisible();
		},
		async SEARCH_MISS(scene) {
			await scene.page.keyboard.type("zzqx");
			await expect(scene.dialog("Search Suite").getByText('No results for "zzqx"')).toBeVisible();
		},
		async SEARCH_FILTERS(scene) {
			await scene.dialog("Search Suite").getByRole("button", { name: "Filters" }).click();
			await expect(scene.dialog("Search Suite").getByRole("button", { name: "Filters" })).toHaveAttribute("aria-expanded", "true");
		},
		async SHORTCUTS(scene) {
			await scene.page.keyboard.press("Shift+?");
			await expect(scene.dialog("Keyboard Shortcuts").getByText("Agenda View")).toBeVisible();
		},
		async PHONE(scene) {
			await scene.page.setViewportSize({ width: 390, height: 844 });
			await scene.page.evaluate(() => localStorage.removeItem("calendar-view"));
			await scene.goto("/calendar");
			await expect(phoneTabs(scene).getByRole("button", { name: "Agenda" })).toBeVisible();
			await expect(scene.page.getByRole("button", { name: /^Launch check-in/ })).toBeVisible();
		},
		async SWITCH_VIEW(scene) {
			await phoneTabs(scene).getByRole("button", { name: "Agenda" }).click();
			await expect(scene.page.getByRole("dialog").getByRole("button", { name: "Month" })).toBeVisible();
		},
		async PICK_MONTH(scene) {
			await scene.page.getByRole("dialog").getByRole("button", { name: "Month" }).click();
			await expect(phoneTabs(scene).getByRole("button", { name: "Month" })).toBeVisible();
			await expect(scene.page.getByRole("dialog")).toHaveCount(0);
		},
		async TAP_EVENT(scene) {
			await scene.page.getByRole("button", { name: /^Launch check-in/ }).click();
			await expect(card(scene, "Launch check-in").getByText("5 people (4 yes, 1 no)")).toBeVisible();
		},
		async TAP_NEW_EVENT(scene) {
			await scene.page.getByRole("button", { name: "New event" }).click();
			await expect(scene.page.getByPlaceholder("Add title")).toBeVisible();
		},
		async SEARCH_TAB(scene) {
			await phoneTabs(scene).getByRole("button", { name: "Search" }).click();
			await expect(scene.page.getByText("Search events by name, organizer, or attendees.")).toBeVisible();
		},
		async PHONE_SEARCH_HIT(scene) {
			await scene.page.getByRole("searchbox", { name: "Search events" }).fill("launch");
			await expect(scene.page.getByText("Launch check-in").first()).toBeVisible();
		},
		async PHONE_SEARCH_MISS(scene) {
			await scene.page.getByRole("searchbox", { name: "Search events" }).fill("zzqx");
			await expect(scene.page.getByText('No results for "zzqx"')).toBeVisible();
		},
		async PROFILE_TAB(scene) {
			await phoneTabs(scene).getByRole("button", { name: "Profile" }).click();
			await expect(scene.page.getByRole("button", { name: "Participant Identity" })).toBeVisible();
		},
	},
});
