import { expect, type Locator, type Page, type Route } from "@playwright/test";
import { acrossRestarts } from "../bench";
import { demoUser, openDemoScene } from "../demo";
import { defineFlow, setupFlow, type StateMeta } from "../flow";
import { perScene, type BaseScene } from "../scene";

/** One tab of an app's group: its name in the sidebar, which of the same names it is, and text only its loaded body shows. */
interface AppTab {
	nav: string;
	/** Mail and Calendar both have Import, Export and Advanced: Mail's come first. */
	last?: boolean;
	marker: string;
	description: string;
}

const MAIL_TABS = {
	mailCredentials: { nav: "Credentials", marker: "App Password", description: "Mail > Credentials: the server URL set by the administrator, the username, an App Password field left blank to keep it, and a Backup Email for recovery." },
	mailAccount: { nav: "Account", marker: "Default Outgoing Email", description: "Mail > Account: outgoing and incoming switches, When Blocking a Sender, and the mailbox storage line. Save stays off until something changes." },
	mailIdentity: { nav: "Identity", marker: "Display Name", description: "Mail > Identity: the identity picker, display name, Reply To and Bcc lists with their empty rows, and the default signature editor." },
	mailLayout: { nav: "Layout", marker: "Split View", description: "Mail > Layout (titled \"Mail layout\"): Split View, Group by date, and the Inbox categories with a switch each." },
	mailFolders: { nav: "Folders", marker: "Trash", description: "Mail > Folders: the six system folders, each with a menu, and New." },
	mailSignatures: { nav: "Signatures", marker: "Signatures let you", description: "Mail > Signatures with none saved: \"No signatures found.\" and what a signature is for." },
	mailCompose: { nav: "Compose", marker: "Undo Send", description: "Mail > Compose: one row, how long Undo Send holds a sent message." },
	mailVacation: { nav: "Vacation Response", marker: "From Date", description: "Mail > Vacation Response, off: the switch, dates, subject and an empty message editor are all shown and editable while it is off." },
	mailAutomation: { nav: "Automation", marker: "Rebuild Automation", description: "Mail > Automation with no scripts: \"No sieve scripts found.\", Rebuild Automation and New." },
	mailPush: { nav: "Push Subscriptions", marker: "Push subscriptions let", description: "Mail > Push Subscriptions with none: an empty message, a refresh button and New." },
	mailScreener: { nav: "Screener", marker: "Screened Senders", description: "Mail > Screener: the Screen New Senders switch, then the screened senders with search, sort and a checkbox per row." },
	mailImport: { nav: "Import", marker: "Upload File", description: "Mail > Import: Mail and Contacts tabs, format, folder and Mark as Read, Upload File, and a Create Import that stays off until a file is uploaded." },
	mailExport: { nav: "Export", marker: "Create Export", description: "Mail > Export: Mail and Contacts tabs, format, archive type, Custom Selection off, and Create Export." },
	mailAdvanced: { nav: "Advanced", marker: "API Access", description: "Mail > Advanced: no API key yet, so only Generate Keys under API Access." },
} as const satisfies Record<string, AppTab>;

const CALENDAR_TABS = {
	calendarCalendars: { nav: "Calendars", last: true, marker: "Default", description: "Calendar > Calendars: Maya's own calendar marked Default, with a menu, and New." },
	calendarIdentity: { nav: "Participant Identity", last: true, marker: "Email Address", description: "Calendar > Participant Identity: the identity picker, name, email, the default checkbox and Delete." },
	calendarImport: { nav: "Import", last: true, marker: "Upload File", description: "Calendar > Import: .ics into a chosen calendar, with Create Import off until a file is uploaded." },
	calendarExport: { nav: "Export", last: true, marker: "Create Export", description: "Calendar > Export: format, archive type, Custom Selection and Create Export." },
	calendarAdvanced: { nav: "Advanced", last: true, marker: "Calendar Client Configuration", description: "Calendar > Advanced: the CalDAV server URL, calendar URL and username, each with Copy." },
} as const satisfies Record<string, AppTab>;

const APP_TABS = new Map<string, AppTab>(Object.entries({ ...MAIL_TABS, ...CALENDAR_TABS }));
type AppTabState = keyof typeof MAIL_TABS | keyof typeof CALENDAR_TABS;
type AppTabEvent = { type: `OPEN_${AppTabState}` };

type Event =
	| AppTabEvent
	| { type: "OPEN" }
	| { type: "OPEN_SLOWLY" }
	| { type: "OPEN_GROUPS_FAIL" }
	| { type: "OPEN_PROFILE_SLOWLY" }
	| { type: "OPEN_PROFILE_FAILS" }
	| { type: "OPEN_AS_MEMBER" }
	| { type: "OPEN_WITHOUT_MAIL_ACCOUNT" }
	| { type: "OPEN_CALENDAR_TAB" }
	| { type: "NARROW" }
	| { type: "OPEN_PREFERENCES_PAGE" }
	| { type: "RENAME" }
	| { type: "RENAME_FAILS" }
	| { type: "CLEAR_FIRST_NAME" }
	| { type: "AVATAR_MENU" }
	| { type: "CHANGE_PASSWORD" }
	| { type: "MISTYPE_CONFIRMATION" }
	| { type: "WRONG_CURRENT_PASSWORD" }
	| { type: "PREFERENCES" }
	| { type: "PREFERENCES_CODE_SLOW" }
	| { type: "PREFERENCES_CODE_FAILS" }
	| { type: "CHANGE_TIME_ZONE" }
	| { type: "CHANGE_TIME_ZONE_FAILS" }
	| { type: "STORAGE" }
	| { type: "EXTERNAL_ACCESS" }
	| { type: "MAIL_ACCOUNT_SLOWLY" }
	| { type: "MAIL_ACCOUNT_FAILS" }
	| { type: "TOGGLE" }
	| { type: "SAVE" }
	| { type: "SAVE_SLOWLY" }
	| { type: "SAVE_FAILS" }
	| { type: "CHANGE_UNDO_SEND" };

/** A settings tab as a machine state. */
type AppTabNode = { meta: StateMeta; on?: Record<string, string> };

/** Tabs whose saves lead further. */
const APP_TAB_EDGES = new Map<string, Record<string, string>>([
	["mailAccount", { TOGGLE: "mailAccountDirty" }],
	["mailCompose", { CHANGE_UNDO_SEND: "composeSaved" }],
]);

function appTabStates() {
	return Object.fromEntries(
		[...APP_TABS].map(([state, tab]) => {
			const node: AppTabNode = { meta: { description: tab.description } };
			const on = APP_TAB_EDGES.get(state);
			if (on) node.on = on;
			return [state, node];
		}),
	);
}

function appTabTransitions() {
	return Object.fromEntries([...APP_TABS.keys()].map((state) => [`OPEN_${state}`, state]));
}

/**
 * Settings, as a dialog on desktop and a drill-in on a phone. The list is
 * `useSettingsGroups()`: `resolved` (null while the group modules load) plus
 * `failed`; each tab body is an async component with its own loading and error
 * component (`SettingsTabBody.vue`); Mail and Calendar bodies wait on the mail
 * account in `MailSettingsScope.vue` and `CalendarSettingsScope.vue`. Saves that
 * would change Maya's seeded settings are answered in the browser, so the
 * toast shows and nothing on the site changes.
 */
const machine = setupFlow<Event>().createMachine({
	id: "suiteSettings",
	initial: "home",
	states: {
		home: {
			meta: { description: "Maya on Home, before Settings opens." },
			on: {
				OPEN: "profile",
				OPEN_SLOWLY: "listLoading",
				OPEN_GROUPS_FAIL: "groupsStuck",
				OPEN_PROFILE_SLOWLY: "profileLoading",
				OPEN_PROFILE_FAILS: "profileFailed",
				OPEN_AS_MEMBER: "memberProfile",
				OPEN_WITHOUT_MAIL_ACCOUNT: "mailTabWaiting",
				NARROW: "phoneList",
			},
		},
		listLoading: {
			meta: { description: "Settings while its groups load (Drive's WebDAV answer held): a spinner in an empty dialog, with no sidebar, title or tab." },
		},
		groupsStuck: {
			meta: { description: "The Mail and Calendar group modules failed to load: the dialog keeps its spinner for good, and the banner \"A newer version is available\" shows instead of an error, because the app's preload-error handler swallows the failure." },
		},
		groupsFailed: {
			meta: {
				transient: true,
				description: "\"Some settings could not load.\" with Retry under the sidebar's last group. Unreachable: a failed group module fires vite:preloadError, which platform/build/index.ts cancels and turns into the update banner, so the import never rejects and the list stays on its spinner (see groupsStuck).",
			},
		},
		groupsRetried: {
			meta: {
				transient: true,
				description: "Retry after the network came back: the list loads every group again. Unreachable, because groupsFailed is unreachable.",
			},
		},
		profile: {
			meta: { description: "Settings opens on Account > Profile for Maya, a Suite Admin: her photo, name and email, first and last name fields that save on blur, and Update password. The sidebar lists Account, Drive with External access, Mail and Calendar." },
			on: {
				...appTabTransitions(),
				RENAME: "nameSaved",
				RENAME_FAILS: "nameSaveFailed",
				CLEAR_FIRST_NAME: "firstNameRequired",
				AVATAR_MENU: "avatarMenu",
				CHANGE_PASSWORD: "passwordDialog",
				PREFERENCES: "preferences",
				PREFERENCES_CODE_SLOW: "tabLoading",
				PREFERENCES_CODE_FAILS: "tabStuck",
				STORAGE: "storage",
				EXTERNAL_ACCESS: "externalAccess",
				MAIL_ACCOUNT_SLOWLY: "mailAccountLoading",
				MAIL_ACCOUNT_FAILS: "mailAccountFailed",
			},
		},
		profileLoading: {
			meta: { description: "Profile before Maya's preferences arrive (request held from page load): the Profile title over an empty body, with no spinner." },
		},
		profileFailed: {
			meta: { description: "Maya's preferences failed to load: the same empty body as loading, with no message and no retry." },
		},
		memberProfile: {
			meta: { description: "Leo, a member, opens Settings: the same list without Drive's External access, which only an admin sees while WebDAV is off." },
		},
		nameSaved: {
			meta: { description: "A last name typed and the field left: \"Name saved\" in a toast, and the field keeps the new name (the save is answered in the browser, so Maya's name stays as seeded on the site)." },
		},
		nameSaveFailed: {
			meta: { description: "The name save failed: \"Could not save name\" in a toast, and the field keeps the typed name with no mark that it is unsaved." },
		},
		firstNameRequired: {
			meta: { description: "First name emptied and left: \"First name is required\" in a toast, and the field fills back with the saved name." },
		},
		avatarMenu: {
			meta: { description: "Maya has a photo, so clicking it opens a menu: Change image and Remove image." },
		},
		passwordDialog: {
			meta: { description: "Update password opens Change password: current, new and confirm fields, and Confirm off until the first two are filled and the last matches." },
			on: { MISTYPE_CONFIRMATION: "passwordMismatch", WRONG_CURRENT_PASSWORD: "passwordRefused" },
		},
		passwordMismatch: {
			meta: { description: "The confirmation differs from the new password: \"Passwords do not match\" under the fields and Confirm off." },
		},
		passwordRefused: {
			meta: { description: "Confirm with a wrong current password: the server's refusal shows under the fields and the dialog stays open." },
		},
		tabLoading: {
			meta: { description: "Preferences while its code loads (held): a spinner where the tab's body goes, with the Preferences row already selected." },
		},
		tabStuck: {
			meta: { description: "Preferences' code failed to load: a spinner stays where the body goes, and the banner \"A newer version is available\" shows instead of an error." },
		},
		tabFailed: {
			meta: {
				transient: true,
				description: "\"This tab could not load. Reload the page and try again.\" Unreachable: the failed import fires vite:preloadError, which platform/build/index.ts cancels, so the async component never errors and its error component never shows (see tabStuck).",
			},
		},
		preferences: {
			meta: { description: "Account > Preferences: Appearance, Cursor, Language (unset, so \"Select language\") and Time zone." },
			on: { CHANGE_TIME_ZONE: "timeZoneSaved", CHANGE_TIME_ZONE_FAILS: "preferencesSaveFailed" },
		},
		timeZoneSaved: {
			meta: { description: "A new time zone picked: \"Time zone saved, reloading…\" in a toast, and the page reloads 1.2 s later (the save is answered in the browser)." },
		},
		preferencesSaveFailed: {
			meta: { description: "The time zone save failed: \"Could not save preferences\" in a toast, and the picker shows the old zone again." },
		},
		storage: {
			meta: { description: "Drive > Storage, the same body Drive's own settings flow covers: bytes used, totals by type and the largest files." },
		},
		externalAccess: {
			meta: { description: "Drive > External access for an admin while WebDAV is off on this site: one switch to enable it." },
		},
		...appTabStates(),
		mailAccountLoading: {
			meta: { description: "Mail > Account before its settings arrive (held): the title, no Save, and an empty body." },
		},
		mailAccountFailed: {
			meta: { description: "Mail > Account when its settings fail: the same empty body as loading. The error message is inside the part that never renders." },
		},
		mailAccountDirty: {
			meta: { description: "A switch turned on: Save turns on. Nothing else marks the change." },
			on: { SAVE: "mailAccountSaved", SAVE_SLOWLY: "mailAccountSaving", SAVE_FAILS: "mailAccountSaveFailed" },
		},
		mailAccountSaving: {
			meta: { description: "Save pressed and the request still out: the button spins." },
		},
		mailAccountSaved: {
			meta: { description: "Saved: \"Account updated.\" in a toast (answered in the browser, so the seeded setting stays)." },
		},
		mailAccountSaveFailed: {
			meta: { description: "The save failed: an error toast, and the switch stays on with Save still on to try again." },
		},
		composeSaved: {
			meta: { description: "Undo Send changed to 10 seconds and saved: \"Compose settings updated.\" in a toast (answered in the browser)." },
		},
		mailTabWaiting: {
			meta: { description: "The mail account request failed at page load: Mail > Credentials shows a spinner, and it stays, with no error and no retry. The Mail group is still listed, as it reads the session, not the account." },
			on: { OPEN_CALENDAR_TAB: "calendarTabWaiting" },
		},
		calendarTabWaiting: {
			meta: { description: "Calendar > Calendars waits on the same mail account request, so it spins for good too." },
		},
		phoneList: {
			meta: { description: "Settings on a phone, opened from the account sheet: a full-screen list under a back arrow, grouped by app." },
			on: { OPEN_PREFERENCES_PAGE: "phonePreferences" },
		},
		phonePreferences: {
			meta: { description: "A row opens its tab as a page over the list: the bar shows the tab's name, and the body drops the dialog's header." },
		},
	},
});

const PHONE = { width: 390, height: 844 };
const PREFERENCES_URL = /\/api\/suite\/preferences(\?|$)/;
const MAIL_USER = /suite\.mail\.api\.account\.get_user_info/;
const MAIL_ACCOUNT_SETTINGS = /\/api\/suite\/mail\/settings\/account(\?|$)/;
const GROUP_MODULES = /\/assets\/settings-[^/]+\.js(\?|$)/;
const PREFERENCES_BODY = /\/assets\/PreferencesSettings-[^/]+\.js(\?|$)/;

const member = perScene<Page>("suiteSettings: Leo's page");

function dialog(page: Page): Locator {
	return page.getByRole("dialog", { name: "Settings" });
}

async function openHome(page: Page): Promise<void> {
	await page.goto("/home");
	await expect(page.getByText("Recent", { exact: true })).toBeVisible();
}

async function clickSettings(page: Page): Promise<void> {
	await page.locator(".suite-rail").getByRole("button", { name: "Settings" }).click();
}

async function openSettings(page: Page): Promise<Locator> {
	await clickSettings(page);
	const settings = dialog(page);
	await expect(settings.getByRole("tab", { name: "Preferences" })).toBeVisible();
	return settings;
}

function tab(page: Page, nav: string, last = false): Locator {
	const tabs = dialog(page).getByRole("tab", { name: nav, exact: true });
	return last ? tabs.last() : tabs.first();
}

async function openAppTab(page: Page, state: string): Promise<void> {
	const spec = APP_TABS.get(state);
	if (!spec) throw new Error(`suiteSettings: no tab ${state}`);
	await tab(page, spec.nav, spec.last).click();
	await expect(dialog(page).getByText(spec.marker, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
}

/**
 * Answers Maya's preference saves in the browser, and the reads after them, with
 * what the server would return, so the screen shows the save and the site keeps
 * her seeded preferences.
 */
async function answerPreferenceSave(scene: BaseScene): Promise<void> {
	// SAFETY: the preferences GET answers an object under `data`.
	let data = ((await (await scene.api.get("/api/suite/preferences")).json()) as { data: Record<string, unknown> }).data;
	await scene.page.route(PREFERENCES_URL, async (route: Route) => {
		if (route.request().method() === "PATCH") {
			// SAFETY: the PATCH body is the changed fields.
			data = { ...data, ...(route.request().postDataJSON() as Record<string, unknown>) };
		}
		await route.fulfill({ json: { data } });
	});
}

async function failPreferenceSave(scene: BaseScene): Promise<void> {
	await scene.page.route(PREFERENCES_URL, (route) =>
		route.request().method() === "PATCH"
			? route.fulfill({ status: 417, json: { exc_type: "ValidationError", message: "Something went wrong" } })
			: route.continue(),
	);
}

/**
 * Answers a Mail settings save (no output) in the browser, and lays the saved
 * fields over the server's answer to the reads after it (`reads`, which is the
 * save's own URL unless the app refetches elsewhere), so the screen shows the
 * save and the site keeps Maya's seeded settings.
 */
async function answerMailSave(scene: BaseScene, url: RegExp, reads: RegExp = url): Promise<void> {
	let saved: Record<string, unknown> | null = null;
	const overlay = async (route: Route) => {
		if (!saved) return route.continue();
		const response = await acrossRestarts(scene.baseURL, () => route.fetch());
		// SAFETY: Mail reads answer an object under `data` (REST) or `message` (method).
		const body = (await response.json()) as { data?: Record<string, unknown>; message?: Record<string, unknown> };
		const key = body.data ? "data" : "message";
		await route.fulfill({ response, json: { ...body, [key]: { ...body[key], ...saved } } });
	};
	await scene.page.route(url, async (route) => {
		if (route.request().method() === "PATCH") {
			// SAFETY: the PATCH body is the changed fields, under `changes` for Mail > Account.
			const body = route.request().postDataJSON() as { changes?: Record<string, unknown> } & Record<string, unknown>;
			saved = { ...saved, ...(body.changes ?? body) };
			return route.fulfill({ json: { data: null } });
		}
		return overlay(route);
	});
	if (reads !== url) await scene.page.route(reads, overlay);
}

async function typeName(scene: BaseScene, label: string, value: string): Promise<void> {
	const field = dialog(scene.page).getByLabel(label, { exact: true });
	await field.fill(value);
	await field.blur();
}

function accountSwitch(page: Page): Locator {
	return dialog(page).getByRole("switch").first();
}

async function openPasswordDialog(page: Page): Promise<Locator> {
	await dialog(page).getByRole("button", { name: "Update password" }).click();
	const change = page.getByRole("dialog", { name: "Change password" });
	await expect(change.getByLabel("Current password")).toBeVisible();
	return change;
}

async function pickTimeZone(page: Page): Promise<void> {
	await dialog(page).getByRole("button", { name: /Asia\/Kolkata/ }).click();
	await page.keyboard.type("London");
	await page.getByRole("option", { name: /Europe\/London/ }).first().click();
}

export const suiteSettings = defineFlow<Event, BaseScene>({
	id: "suiteSettings",
	title: "Settings",
	source: "frontend/src/shell/settings/SuiteSettingsDialog.vue",
	open: (browser) => openDemoScene(browser, "maya"),
	machine,
	async enter(scene) {
		await openHome(scene.page);
	},
	events: {
		// SAFETY: APP_TABS holds exactly the states AppTabEvent names, so these keys are its event types.
		...(Object.fromEntries(
			[...APP_TABS.keys()].map((state) => [`OPEN_${state}`, (scene: BaseScene) => openAppTab(scene.page, state)]),
		) as Record<AppTabEvent["type"], (scene: BaseScene) => Promise<void>>),
		async OPEN(scene) {
			await openSettings(scene.page);
			await expect(dialog(scene.page).getByLabel("First name")).toHaveValue("Maya");
		},
		async OPEN_SLOWLY(scene) {
			await scene.hold(/\/api\/suite\/drive\/webdav/);
			await clickSettings(scene.page);
			await expect(dialog(scene.page).getByRole("status", { name: "Loading" }).first()).toBeVisible();
		},
		async OPEN_GROUPS_FAIL(scene) {
			const hold = await scene.hold(GROUP_MODULES);
			await hold.abort(503);
			await clickSettings(scene.page);
			await expect(scene.page.getByText("A newer version is available").first()).toBeVisible();
			await expect(dialog(scene.page).getByRole("status", { name: "Loading" }).first()).toBeVisible();
		},
		async OPEN_PROFILE_SLOWLY(scene) {
			await scene.hold(PREFERENCES_URL);
			await scene.page.reload();
			await expect(scene.page.getByText("Recent", { exact: true })).toBeVisible();
			await clickSettings(scene.page);
			await expect(dialog(scene.page).getByRole("tab", { name: "Preferences" })).toBeVisible();
			await expect(dialog(scene.page).getByLabel("First name")).toBeHidden();
		},
		async OPEN_PROFILE_FAILS(scene) {
			const hold = await scene.hold(PREFERENCES_URL);
			await hold.abort(500);
			await scene.page.reload();
			await expect(scene.page.getByText("Recent", { exact: true })).toBeVisible();
			await clickSettings(scene.page);
			await expect(dialog(scene.page).getByRole("tab", { name: "Preferences" })).toBeVisible();
			await scene.page.waitForTimeout(3000);
			await expect(dialog(scene.page).getByLabel("First name")).toBeHidden();
		},
		async OPEN_AS_MEMBER(scene) {
			const page = await scene.pageAs(demoUser("leo"));
			member.set(scene, page);
			await openHome(page);
			await openSettings(page);
			await expect(dialog(page).getByLabel("First name")).toHaveValue("Leo");
			await expect(dialog(page).getByRole("tab", { name: "External access" })).toHaveCount(0);
		},
		async OPEN_WITHOUT_MAIL_ACCOUNT(scene) {
			const hold = await scene.hold(MAIL_USER);
			await hold.abort(500);
			await scene.page.reload();
			await expect(scene.page.getByText("Recent", { exact: true })).toBeVisible();
			await openSettings(scene.page);
			await tab(scene.page, "Credentials").click();
			await expect(dialog(scene.page).getByRole("status", { name: "Loading" }).first()).toBeVisible();
			await scene.page.waitForTimeout(5000);
			await expect(dialog(scene.page).getByRole("status", { name: "Loading" }).first()).toBeVisible();
		},
		async OPEN_CALENDAR_TAB(scene) {
			await tab(scene.page, "Calendars", true).click();
			await expect(dialog(scene.page).getByRole("status", { name: "Loading" }).first()).toBeVisible();
			await expect(dialog(scene.page).getByText("Default", { exact: true })).toHaveCount(0);
		},
		async NARROW(scene) {
			await scene.page.setViewportSize(PHONE);
			await scene.page.getByRole("button", { name: "Account", exact: true }).click();
			const sheet = scene.page.getByRole("dialog", { name: "Account" });
			await sheet.getByText("Settings", { exact: true }).click();
			const list = scene.page.getByRole("dialog", { name: "Settings" });
			await expect(list.getByText("Preferences", { exact: true })).toBeVisible();
		},
		async OPEN_PREFERENCES_PAGE(scene) {
			await scene.page.getByRole("dialog", { name: "Settings" }).getByText("Preferences", { exact: true }).click();
			await expect(scene.page.getByRole("region", { name: "Preferences" }).getByRole("button", { name: /Asia\/Kolkata/ })).toBeVisible();
		},
		async RENAME(scene) {
			await answerPreferenceSave(scene);
			await typeName(scene, "Last name", "Chen-Ruiz");
			await expect(scene.toast("Name saved")).toBeVisible();
			await expect(dialog(scene.page).getByLabel("Last name", { exact: true })).toHaveValue("Chen-Ruiz");
		},
		async RENAME_FAILS(scene) {
			await failPreferenceSave(scene);
			await typeName(scene, "Last name", "Chen-Ruiz");
			await expect(scene.toast("Could not save name")).toBeVisible();
		},
		async CLEAR_FIRST_NAME(scene) {
			await typeName(scene, "First name", "");
			await expect(scene.toast("First name is required")).toBeVisible();
		},
		async AVATAR_MENU(scene) {
			await dialog(scene.page).getByRole("button", { name: "Profile picture options" }).click();
			await expect(scene.page.getByRole("menuitem", { name: "Remove image" })).toBeVisible();
		},
		async CHANGE_PASSWORD(scene) {
			await openPasswordDialog(scene.page);
		},
		async MISTYPE_CONFIRMATION(scene) {
			const change = scene.page.getByRole("dialog", { name: "Change password" });
			await change.getByLabel("Current password").fill("harbour-light-41");
			await change.getByLabel("New password", { exact: true }).fill("harbour-light-42");
			await change.getByLabel("Confirm new password").fill("harbour-light-43");
			await expect(change.getByText("Passwords do not match")).toBeVisible();
		},
		async WRONG_CURRENT_PASSWORD(scene) {
			const change = scene.page.getByRole("dialog", { name: "Change password" });
			await change.getByLabel("Current password").fill("not-my-password");
			await change.getByLabel("New password", { exact: true }).fill("harbour-light-42");
			await change.getByLabel("Confirm new password").fill("harbour-light-42");
			const answered = scene.page.waitForResponse((response) => response.request().method() !== "GET" && /password/i.test(response.url()));
			await change.getByRole("button", { name: "Confirm" }).click();
			const response = await answered;
			expect(response.ok()).toBe(false);
			await expect(change.getByRole("button", { name: "Confirm" })).toBeEnabled();
		},
		async PREFERENCES(scene) {
			await tab(scene.page, "Preferences").click();
			await expect(dialog(scene.page).getByText("Time zone", { exact: true })).toBeVisible();
			await expect(dialog(scene.page).getByRole("button", { name: /Asia\/Kolkata/ })).toBeVisible();
		},
		async PREFERENCES_CODE_SLOW(scene) {
			await scene.hold(PREFERENCES_BODY);
			await tab(scene.page, "Preferences").click();
			await expect(dialog(scene.page).getByRole("status", { name: "Loading" }).first()).toBeVisible();
		},
		async PREFERENCES_CODE_FAILS(scene) {
			const hold = await scene.hold(PREFERENCES_BODY);
			await hold.abort(503);
			await tab(scene.page, "Preferences").click();
			await expect(scene.page.getByText("A newer version is available").first()).toBeVisible();
			await expect(dialog(scene.page).getByRole("status", { name: "Loading" }).first()).toBeVisible();
		},
		async CHANGE_TIME_ZONE(scene) {
			await answerPreferenceSave(scene);
			await pickTimeZone(scene.page);
			await expect(scene.toast("Time zone saved, reloading…")).toBeVisible();
		},
		async CHANGE_TIME_ZONE_FAILS(scene) {
			await failPreferenceSave(scene);
			await pickTimeZone(scene.page);
			await expect(scene.toast("Could not save preferences")).toBeVisible();
		},
		async STORAGE(scene) {
			await tab(scene.page, "Storage").click();
			await expect(dialog(scene.page).getByText("Largest files")).toBeVisible();
		},
		async EXTERNAL_ACCESS(scene) {
			await tab(scene.page, "External access").click();
			await expect(dialog(scene.page).getByRole("switch", { name: "Enable WebDAV" })).toBeVisible();
		},
		async MAIL_ACCOUNT_SLOWLY(scene) {
			await scene.hold(MAIL_ACCOUNT_SETTINGS);
			await tab(scene.page, "Account").click();
			await expect(dialog(scene.page).getByText("Storage", { exact: true }).last()).toBeVisible();
			await expect(dialog(scene.page).getByText("Default Outgoing Email")).toHaveCount(0);
		},
		async MAIL_ACCOUNT_FAILS(scene) {
			const hold = await scene.hold(MAIL_ACCOUNT_SETTINGS);
			await hold.abort(500);
			await tab(scene.page, "Account").click();
			await scene.page.waitForTimeout(5000);
			await expect(dialog(scene.page).getByText("Default Outgoing Email")).toHaveCount(0);
		},
		async TOGGLE(scene) {
			await accountSwitch(scene.page).click();
			await expect(dialog(scene.page).getByRole("button", { name: "Save" })).toBeEnabled();
		},
		async SAVE(scene) {
			await answerMailSave(scene, MAIL_ACCOUNT_SETTINGS);
			await dialog(scene.page).getByRole("button", { name: "Save" }).click();
			await expect(scene.toast("Account updated.")).toBeVisible();
			await expect(accountSwitch(scene.page)).toBeChecked();
		},
		async SAVE_SLOWLY(scene) {
			await scene.hold(MAIL_ACCOUNT_SETTINGS);
			await dialog(scene.page).getByRole("button", { name: "Save" }).click();
			await expect(dialog(scene.page).getByRole("button", { name: "Save" })).toBeDisabled();
		},
		async SAVE_FAILS(scene) {
			await scene.page.route(MAIL_ACCOUNT_SETTINGS, (route) =>
				route.request().method() === "PATCH"
					? route.fulfill({ status: 417, json: { exc_type: "ValidationError", message: "The mail server refused the change." } })
					: route.continue(),
			);
			await dialog(scene.page).getByRole("button", { name: "Save" }).click();
			await expect(scene.page.getByText("The mail server refused the change.").first()).toBeVisible();
		},
		async CHANGE_UNDO_SEND(scene) {
			await answerMailSave(scene, /\/api\/suite\/mail\/settings\/preferences(\?|$)/, MAIL_USER);
			await dialog(scene.page).getByRole("combobox").first().click();
			await scene.page.getByRole("option", { name: "10 seconds" }).click();
			await dialog(scene.page).getByRole("button", { name: "Save" }).click();
			await expect(scene.toast("Compose settings updated.")).toBeVisible();
			await expect(dialog(scene.page).getByRole("button", { name: "Save" })).toBeDisabled();
		},
	},
	frame(scene, state) {
		return state === "memberProfile" ? member.get(scene).locator("body") : null;
	},
});
