import { expect, type Locator, type Page } from "@playwright/test";
import { chooseNew } from "../../drive-backed-apps/helpers/drive";
import { demoUser, openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import { perScene, type BaseScene } from "../scene";

type Event =
	| { type: "HOVER_MAIL" }
	| { type: "UPLOAD_ELSEWHERE" }
	| { type: "UPLOAD_FAILS_ELSEWHERE" }
	| { type: "OPEN_BELL" }
	| { type: "OPEN_BELL_SLOWLY" }
	| { type: "OPEN_BELL_FAILS" }
	| { type: "OPEN_BELL_EMPTY" }
	| { type: "OPEN_ACCOUNT" }
	| { type: "OPEN_ACCOUNT_AS_SYSTEM_MANAGER" }
	| { type: "OPEN_WORKSPACE" }
	| { type: "OPEN_WORKSPACE_AS_MEMBER" }
	| { type: "OPEN_SHORTCUTS" }
	| { type: "OPEN_PALETTE" }
	| { type: "TYPE_TWO_LETTERS" }
	| { type: "TYPE_WORD" }
	| { type: "TYPE_WORD_SLOWLY" }
	| { type: "SEARCH_FAILS" }
	| { type: "TYPE_MISS" }
	| { type: "TYPE_ANGLE" }
	| { type: "TYPE_APP_MISS" }
	| { type: "GO_NOWHERE" }
	| { type: "GO_OUTSIDE_THE_APP" }
	| { type: "PAGE_CODE_FAILS" }
	| { type: "OPEN_MAIL_WITHOUT_ACCOUNT" }
	| { type: "NARROW" }
	| { type: "OPEN_ACCOUNT_SHEET" }
	| { type: "OPEN_CALENDAR_ON_PHONE" };

/**
 * The frame around every app. `ShellLayout.vue` picks the frame from
 * `showGuestSurface`, `unavailable`, `resolvedFrame` and `isMobile`, read in
 * that order; the rail draws badges from `deriveAreaBadges` and progress from
 * `useAreaWork`; the command palette's message comes from `emptyMessage`, a
 * chain over `navigationMode`, the query length, `contextSearchLabel` and
 * `isSearching`; the router sends a failed page load to `app-load-error`.
 */
const machine = setupFlow<Event>().createMachine({
	id: "shell",
	initial: "home",
	states: {
		home: {
			meta: { description: "Maya on Home: the rail with the workspace mark, Search, the six areas, then Shortcuts, the bell with its unread count, Settings and her avatar. Mail and Calendar carry a red dot for unread mail and events coming up." },
			on: {
				HOVER_MAIL: "railTooltip",
				UPLOAD_ELSEWHERE: "railUploading",
				UPLOAD_FAILS_ELSEWHERE: "railUploadFailed",
				OPEN_BELL: "notifications",
				OPEN_BELL_SLOWLY: "notificationsLoading",
				OPEN_BELL_FAILS: "notificationsFailed",
				OPEN_BELL_EMPTY: "notificationsEmpty",
				OPEN_ACCOUNT: "accountMenu",
				OPEN_ACCOUNT_AS_SYSTEM_MANAGER: "accountMenuDesk",
				OPEN_WORKSPACE: "workspaceMenuAdmin",
				OPEN_WORKSPACE_AS_MEMBER: "workspaceMenuMember",
				OPEN_SHORTCUTS: "shortcuts",
				OPEN_PALETTE: "paletteEmpty",
				GO_NOWHERE: "notFound",
				GO_OUTSIDE_THE_APP: "siteNotFound",
				PAGE_CODE_FAILS: "appLoadError",
				OPEN_MAIL_WITHOUT_ACCOUNT: "unavailable",
				NARROW: "phoneHome",
			},
		},
		railTooltip: {
			meta: { description: "Hovering Mail: the tooltip names the area and spells out the count the dot hides, here \"8 unread\"." },
		},
		railUploading: {
			meta: { description: "A file started uploading in Drive and Maya went Home: an orange dot on the Drive rail item is the only sign of the work. The upload is held at its first request, so nothing is stored." },
		},
		railUploadFailed: {
			meta: { description: "The server refused the upload after Maya left Drive: the Drive dot turns red until she opens the upload tracker. A failure she watches happen in Drive leaves no red dot." },
		},
		notificationsLoading: {
			meta: { description: "The bell's panel while its list is on the way: five skeleton rows under the header, Mark all read already on." },
		},
		notificationsFailed: {
			meta: { description: "The list request failed: the server's message in red and Retry, in the middle of the panel. The bell keeps its count, from a separate request." },
		},
		notificationsEmpty: {
			meta: { description: "No notifications (list answer rewritten to none): \"No notifications\", while the bell and Mark all read still count the unread ones the count request reports." },
		},
		notifications: {
			meta: { description: "The panel opens beside the rail: comments and shares, unread ones bold with an amber dot, each with its excerpt and when." },
		},
		accountMenu: {
			meta: { description: "The avatar opens the account menu: Maya's name and email, then Log out. Maya is a Suite Admin but no system manager, so there is no Open Desk." },
		},
		accountMenuDesk: {
			meta: { description: "Administrator, a system manager, gets Open Desk between the name and Log out. Administrator has no mail account, so Mail and Calendar are missing from the rail." },
		},
		workspaceMenuAdmin: {
			meta: { description: "The workspace mark opens the workspace menu: \"Northwind Labs\", then Admin, Invite people and Workspace settings for a Suite Admin." },
		},
		workspaceMenuMember: {
			meta: { description: "Leo, a member: the same menu holds only Settings, which opens his own Settings dialog." },
		},
		shortcuts: {
			meta: { description: "Shortcuts on the rail opens the list of keyboard shortcuts for the page in view." },
		},
		paletteEmpty: {
			meta: { description: "Search opens the palette with nothing typed: \"Search in Drive\" and the Suggested commands with their shortcuts. Home has no search of its own, so the palette searches Drive." },
			on: {
				TYPE_TWO_LETTERS: "paletteTypeMore",
				TYPE_WORD: "paletteResults",
				TYPE_WORD_SLOWLY: "paletteSearching",
				SEARCH_FAILS: "paletteSearchFailed",
				TYPE_MISS: "paletteNoResults",
				TYPE_ANGLE: "paletteApps",
			},
		},
		paletteTypeMore: {
			meta: { description: "Two characters typed that match no command: below the three-character minimum, the palette says \"Type more to search Drive\". Two letters that match a command show only that command, with no word about the minimum." },
		},
		paletteSearching: {
			meta: { description: "A word typed and the search still out: \"Searching…\", so an empty list does not read as no results yet." },
		},
		paletteResults: {
			meta: { description: "Drive's matches, the typed word highlighted in each title, with the folder each sits in. With no matching command there is no heading over them." },
		},
		paletteSearchFailed: {
			meta: { description: "The search request failed: the palette says \"No results for\" the word, the same as a real miss, with no error and no retry." },
		},
		paletteNoResults: {
			meta: { description: "A word nothing matches: \"No results for\" the word." },
		},
		paletteApps: {
			meta: { description: "A `>` turns the palette into the app switcher: \"Switch apps\", every area of the rail under Navigate, and the footer drops its \"> to switch apps\" hint." },
			on: { TYPE_APP_MISS: "paletteNoApp" },
		},
		paletteNoApp: {
			meta: { description: "A `>` followed by a name no area has: \"No app matches\" the name." },
		},
		notFound: {
			meta: { description: "An address under an app's path that no route knows (/drive/quarterly-plans): \"Page not found\" and a Back to launcher link, with no rail, icon or other frame around it." },
		},
		siteNotFound: {
			meta: { description: "An address outside the app's paths (/quarterly-plans): the server answers with the site's own \"Page not found\" page and Back to Home, which looks different from the app's Not found page." },
		},
		appLoadError: {
			meta: { description: "The code for People failed to load, after the one automatic reload was used: \"This page did not load\" with Reload and Go to Home, with no frame around it. The banner \"A newer version is available\" shows at the same time, because the failed chunk also fired the update check."  },
		},
		unavailable: {
			meta: { description: "Administrator opens /mail without a mail account: the shell keeps the rail and says \"Mail is unavailable\", \"You don't have a Mail account.\" and \"Ask your admin to add one.\"" },
		},
		phoneHome: {
			meta: { description: "Home at phone width: no rail. A bottom bar holds one item per area and the avatar; the workspace menu, bell, Search and Shortcuts have no place here." },
			on: { OPEN_ACCOUNT_SHEET: "accountSheet", OPEN_CALENDAR_ON_PHONE: "phoneInstallOffer" },
		},
		accountSheet: {
			meta: { description: "The avatar opens the account sheet from the bottom: Maya's name and email, Settings, Theme as Light, Dark and Auto, and Log out." },
		},
		phoneInstallOffer: {
			meta: { description: "Calendar on a phone whose browser offers to install it (the offer event is sent by the flow): a strip above the bottom bar says \"Install Calendar as an app.\" with Install and a close button." },
		},
		phoneNotifyAsk: {
			meta: {
				description: "Inside an installed Calendar app, the first time it opens: \"Be notified by Calendar on this device?\" with Turn on. Not reached: it needs the page to run as an installed app.",
				transient: true,
			},
		},
	},
});

const PHONE = { width: 390, height: 844 };
const NOTIFICATIONS = /\/api\/suite\/drive\/notifications\?/;
const SEARCH = /\/api\/suite\/drive\/views\/search\?/;
const UPLOAD_CREATE = /\/api\/suite\/drive\/uploads(\?|$)/;
const LOAD_RETRY_KEY = "suite:load-failure-reload";

const other = perScene<Page>("shell: second page");

function rail(page: Page): Locator {
	return page.locator(".suite-rail");
}

function bell(page: Page): Locator {
	return page.getByRole("button", { name: "Notifications" });
}

function panel(page: Page): Locator {
	return page.getByTestId("notifications-popover");
}

function palette(page: Page): Locator {
	return page.getByRole("dialog", { name: "Search Suite" });
}

async function openHome(page: Page): Promise<void> {
	await page.goto("/home");
	await expect(page.getByText("Recent", { exact: true })).toBeVisible();
	await expect(bell(page)).toBeVisible();
}

/** A page for someone other than Maya, on Home, closed with the scene. */
async function openAs(scene: BaseScene, email: string, password: string): Promise<Page> {
	const page = await scene.pageAs({ email, password });
	other.set(scene, page);
	await openHome(page);
	return page;
}

async function openPalette(scene: BaseScene): Promise<Locator> {
	await rail(scene.page).getByRole("button", { name: "Search" }).click();
	const dialog = palette(scene.page);
	await expect(dialog.getByText("Suggested")).toBeVisible();
	return dialog;
}

async function typeInPalette(scene: BaseScene, text: string): Promise<Locator> {
	const dialog = palette(scene.page);
	await dialog.getByRole("combobox").or(dialog.getByRole("textbox")).first().fill(text);
	return dialog;
}

/** Starts an upload in Drive whose first request is held or failed, then goes Home. */
async function uploadThenLeave(scene: BaseScene, fail: boolean): Promise<void> {
	const hold = await scene.hold(UPLOAD_CREATE);
	await scene.page.goto("/drive");
	await expect(scene.page.getByRole("button", { name: "New", exact: true })).toBeVisible();
	const [chooser] = await Promise.all([scene.page.waitForEvent("filechooser"), chooseNew(scene.page, "Upload files")]);
	await Promise.all([
		scene.page.waitForRequest(UPLOAD_CREATE),
		chooser.setFiles({ name: "Board minutes.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(64 * 1024) }),
	]);
	await rail(scene.page).getByRole("link", { name: /^Home/ }).click();
	await expect(scene.page.getByText("Recent", { exact: true })).toBeVisible();
	// A failure while Drive's tracker is mounted counts as seen (queue.ts `fail`), and a
	// server error is retried, so the upload is refused only once the tracker is gone.
	await expect(scene.page.locator('[data-slot="upload-tracker"]')).toHaveCount(0);
	if (fail) await hold.abort(417);
}

export const shell = defineFlow<Event, BaseScene>({
	id: "shell",
	title: "Shell",
	source: "frontend/src/shell/ShellLayout.vue",
	open: (browser) => openDemoScene(browser, "maya"),
	machine,
	async enter(scene) {
		await openHome(scene.page);
	},
	settle: {
		// Home's first paint is skeletons; its seeded file and meeting mark the loaded page.
		async home(scene) {
			await expect(scene.page.getByText("Welcome to Northwind", { exact: true })).toBeVisible();
			await expect(scene.page.getByText("Beacon standup", { exact: true })).toBeVisible();
		},
	},
	events: {
		async HOVER_MAIL(scene) {
			await rail(scene.page).getByRole("link", { name: /^Mail/ }).hover();
			await expect(scene.page.locator('[data-slot="content"][data-state$="open"]').getByText(/\d+ unread/).first()).toBeVisible();
		},
		async UPLOAD_ELSEWHERE(scene) {
			await uploadThenLeave(scene, false);
			await expect(rail(scene.page).locator('[data-slot="area-progress-dot"]')).toBeVisible();
		},
		async UPLOAD_FAILS_ELSEWHERE(scene) {
			await uploadThenLeave(scene, true);
			await expect(rail(scene.page).locator('[data-slot="area-progress-dot"][data-attention="true"]')).toBeVisible();
		},
		async OPEN_BELL(scene) {
			await bell(scene.page).click();
			await expect(panel(scene.page).getByText(/commented on|shared/).first()).toBeVisible();
		},
		async OPEN_BELL_SLOWLY(scene) {
			await scene.hold(NOTIFICATIONS);
			await bell(scene.page).click();
			await expect(panel(scene.page).getByLabel("Loading notifications")).toBeVisible();
		},
		async OPEN_BELL_FAILS(scene) {
			const hold = await scene.hold(NOTIFICATIONS);
			await hold.abort(500);
			await bell(scene.page).click();
			await expect(panel(scene.page).getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 30_000 });
		},
		async OPEN_BELL_EMPTY(scene) {
			await scene.page.route(NOTIFICATIONS, async (route) => {
				const response = await route.fetch().catch(() => null);
				if (!response) return;
				// SAFETY: the notifications list answers an object with `rows` under `data`.
				const body = (await response.json()) as { data: Record<string, unknown> };
				await route.fulfill({ response, json: { data: { ...body.data, rows: [] } } }).catch(() => undefined);
			});
			await bell(scene.page).click();
			await expect(panel(scene.page).getByText("No notifications")).toBeVisible();
		},
		async OPEN_ACCOUNT(scene) {
			await rail(scene.page).getByRole("button", { name: "Account", exact: true }).click();
			await expect(scene.page.getByRole("menuitem", { name: "Log out" })).toBeVisible();
		},
		async OPEN_ACCOUNT_AS_SYSTEM_MANAGER(scene) {
			const page = await openAs(scene, "Administrator", "admin");
			await rail(page).getByRole("button", { name: "Account", exact: true }).click();
			await expect(page.getByRole("menuitem", { name: "Open Desk" })).toBeVisible();
		},
		async OPEN_WORKSPACE(scene) {
			await scene.page.getByRole("button", { name: "Workspace menu" }).click();
			await expect(scene.page.getByRole("menuitem", { name: "Invite people" })).toBeVisible();
		},
		async OPEN_WORKSPACE_AS_MEMBER(scene) {
			const leo = demoUser("leo");
			const page = await openAs(scene, leo.email, leo.password);
			await page.getByRole("button", { name: "Workspace menu" }).click();
			await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
		},
		async OPEN_SHORTCUTS(scene) {
			await rail(scene.page).getByRole("button", { name: "Shortcuts" }).click();
			await expect(scene.page.getByRole("dialog")).toBeVisible();
		},
		async OPEN_PALETTE(scene) {
			await openPalette(scene);
		},
		async TYPE_TWO_LETTERS(scene) {
			const dialog = await typeInPalette(scene, "q3");
			await expect(dialog.getByText("Type more to search Drive")).toBeVisible();
		},
		async TYPE_WORD(scene) {
			const dialog = await typeInPalette(scene, "priorities");
			await expect(dialog.getByRole("option").filter({ hasText: "priorities" }).first()).toBeVisible();
		},
		async TYPE_WORD_SLOWLY(scene) {
			await scene.hold(SEARCH);
			const dialog = await typeInPalette(scene, "priorities");
			await expect(dialog.getByText("Searching…")).toBeVisible();
		},
		async SEARCH_FAILS(scene) {
			const hold = await scene.hold(SEARCH);
			await hold.abort(500);
			const dialog = await typeInPalette(scene, "priorities");
			await expect(dialog.getByText('No results for "priorities"')).toBeVisible({ timeout: 30_000 });
		},
		async TYPE_MISS(scene) {
			const dialog = await typeInPalette(scene, "zebracorn");
			await expect(dialog.getByText('No results for "zebracorn"')).toBeVisible();
		},
		async TYPE_ANGLE(scene) {
			const dialog = await typeInPalette(scene, ">");
			await expect(dialog.getByText("Navigate", { exact: true })).toBeVisible();
		},
		async TYPE_APP_MISS(scene) {
			const dialog = await typeInPalette(scene, ">payroll");
			await expect(dialog.getByText('No app matches "payroll"')).toBeVisible();
		},
		async GO_NOWHERE(scene) {
			await scene.page.goto("/drive/quarterly-plans");
			await expect(scene.page.getByRole("link", { name: "Back to launcher" })).toBeVisible();
		},
		async GO_OUTSIDE_THE_APP(scene) {
			await scene.page.goto("/quarterly-plans");
			await expect(scene.page.getByRole("link", { name: "Back to Home" })).toBeVisible();
		},
		async PAGE_CODE_FAILS(scene) {
			// The automatic reload is spent, so the next failure opens the error page.
			await scene.page.evaluate((key) => sessionStorage.setItem(key, "1"), LOAD_RETRY_KEY);
			const hold = await scene.hold(/\/assets\/.*\.js(\?|$)/);
			await hold.abort(503);
			await rail(scene.page).getByRole("link", { name: /^People/ }).click();
			await expect(scene.page.getByRole("heading", { name: "This page did not load" })).toBeVisible();
			await scene.lastHold.release();
		},
		async OPEN_MAIL_WITHOUT_ACCOUNT(scene) {
			const page = await scene.pageAs({ email: "Administrator", password: "admin" });
			other.set(scene, page);
			await page.goto("/mail");
			await expect(page.getByRole("heading", { name: "Mail is unavailable" })).toBeVisible();
		},
		async NARROW(scene) {
			await scene.page.setViewportSize(PHONE);
			await expect(rail(scene.page)).toBeHidden();
			await expect(scene.page.getByRole("button", { name: "Account", exact: true }).or(scene.page.getByRole("link", { name: "Account", exact: true })).first()).toBeVisible();
		},
		async OPEN_ACCOUNT_SHEET(scene) {
			await scene.page.getByRole("button", { name: "Account", exact: true }).or(scene.page.getByRole("link", { name: "Account", exact: true })).first().click();
			await expect(scene.page.getByRole("dialog", { name: "Account" }).getByText("Log out")).toBeVisible();
		},
		async OPEN_CALENDAR_ON_PHONE(scene) {
			await scene.page.goto("/calendar");
			await scene.page.waitForLoadState("networkidle").catch(() => undefined);
			await scene.page.evaluate(() => {
				const offer = new Event("beforeinstallprompt", { cancelable: true });
				Object.assign(offer, { prompt: () => Promise.resolve(), userChoice: Promise.resolve({ outcome: "dismissed" }) });
				window.dispatchEvent(offer);
			});
			await expect(scene.page.getByRole("region", { name: "Install Calendar" })).toBeVisible();
		},
	},
	frame(scene, state) {
		if (state === "accountMenuDesk" || state === "workspaceMenuMember" || state === "unavailable") {
			return other.get(scene).locator("body");
		}
		return null;
	},
});
