import { expect } from "@playwright/test";
import type { Credentials } from "../../shared/auth";
import { DEMO_URL, demoUser, openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import { perScene, type BaseScene } from "../scene";
import { benchPython, siteOf } from "./setup-helpers";
import { addPerson, signInAs } from "./welcome-helpers";

type Event =
	| { type: "RELOAD_SLOW" }
	| { type: "RELOAD_FAILS" }
	| { type: "REFRESH_FAILS" }
	| { type: "OPEN_NEW_MENU" }
	| { type: "CREATE_SLOW" }
	| { type: "OPEN_MEET_MENU" }
	| { type: "OPEN_SCHEDULE_MENU" }
	| { type: "OPEN_INVITE_TASK" }
	| { type: "OPEN_LOGO_TASK" }
	| { type: "PHONE_WIDTH" }
	| { type: "SIGN_IN_AS_MEMBER" }
	| { type: "SIGN_IN_AS_NEWCOMER" }
	| { type: "HIDE" }
	| { type: "HIDE_FAILS" }
	| { type: "ADD_PHOTO" };

/**
 * Home, in `HomePage.vue` and `GetStarted.vue`. Every panel picks its look from
 * its query alone: `status` plus whether rows are cached (skeleton, failed,
 * empty, rows, rows with a refresh banner). Get started stays out of the page
 * until each query it uses has loaded, and its `hidden` ref starts from the
 * session and flips before the save.
 */
const machine = setupFlow<Event>().createMachine({
	id: "home",
	initial: "adminHome",
	states: {
		adminHome: {
			meta: { description: "Maya, the Admin, on Home: Get started at 2 of 3 (Invite your team and Add your logo ticked, Bring your old mail open), the four New cards, her three most recent files, and her next three events with Meet and Schedule beside Upcoming." },
			on: {
				RELOAD_SLOW: "loading",
				RELOAD_FAILS: "loadFailed",
				REFRESH_FAILS: "refreshFailed",
				OPEN_NEW_MENU: "newMenu",
				CREATE_SLOW: "creatingFromCard",
				OPEN_MEET_MENU: "meetMenu",
				OPEN_SCHEDULE_MENU: "scheduleMenu",
				OPEN_INVITE_TASK: "inviteDialog",
				OPEN_LOGO_TASK: "logoDialog",
				PHONE_WIDTH: "phoneHome",
				SIGN_IN_AS_MEMBER: "memberHome",
				SIGN_IN_AS_NEWCOMER: "newcomerHome",
			},
		},
		loading: {
			meta: { description: "Home on a first load in this tab, with its requests out: four grey cards for Recent and three grey rows for Upcoming. Get started is left out entirely, not shown as grey, so it appears later above New and pushes the page down. On a reload Upcoming skips this and shows the events it kept in session storage." },
		},
		loadFailed: {
			meta: { description: "Recent and Upcoming both failed on a first load in this tab, with nothing kept: each panel shows the error's message in red (here “Something went wrong”) with Retry." },
		},
		refreshFailed: {
			meta: { description: "Coming back to Home from Drive more than 30 seconds after it loaded, with the requests now failing: the cached files and events stay, each with a red “could not be refreshed” bar and Retry under it." },
		},
		newMenu: {
			meta: { description: "New in the header, open: Document, Spreadsheet, Presentation and Drawing, the same four as the cards." },
		},
		creatingFromCard: {
			meta: { description: "The New document card pressed and the request still out: a spinner in that card and in the header's New button. The other cards stay clickable but do nothing." },
		},
		meetMenu: {
			meta: { description: "Meet beside Upcoming, open: Start meeting and Start private meeting." },
		},
		scheduleMenu: {
			meta: { description: "Schedule beside Upcoming, open: Event, which goes to Calendar, and Meeting, which opens a dialog here." },
		},
		inviteDialog: {
			meta: { description: "Invite your team opened from Get started, though it is ticked: the invite box, with Send invites off until there is an address." },
		},
		logoDialog: {
			meta: { description: "Add your logo opened from Get started: the workspace's current logo beside the Workspace name field (Northwind Labs), with Cancel and Save. Save is enabled before anything changes." },
		},
		phoneHome: {
			meta: { description: "Home at phone width: the compact header with New, Get started as one column, the cards two to a row, and the bottom bar." },
		},
		memberHome: {
			meta: { description: "Leo, who is not an Admin: Get started shows 1 of 2 done with his own tasks, Add a profile photo (ticked) and Bring your old mail, and no Admin ones. Recent and Upcoming show his files and events." },
		},
		newcomerHome: {
			meta: { description: "A person just added, with no files, events or mailbox: Get started has only Add a profile photo (0 of 1), Recent says “Nothing yet” with its own New menu, and Upcoming says nothing is scheduled." },
			on: { HIDE: "getStartedHidden", HIDE_FAILS: "hideFailed", ADD_PHOTO: "allSet" },
		},
		getStartedHidden: {
			meta: { description: "Hide pressed: the list is gone at once, and New moves to the top. Nothing on Home brings it back." },
		},
		hideFailed: {
			meta: { description: "Hiding failed: the list comes back and a toast says “Could not hide the list. Try again.”" },
		},
		allSet: {
			meta: { description: "Every task done: the heading turns to “You're all set”, 1 of 1, and the list stays until it is hidden." },
		},
	},
});

const RECENTS = "**/api/suite/drive/views/recents**";
const UPCOMING = /\/api\/suite\/calendar\/events\?/;
const PHONE = { width: 390, height: 844 };
const newcomer = perScene<Credentials>("home: newcomer");

function recentRows(scene: BaseScene) {
	return scene.page.getByTestId("recent-rows");
}

async function homeLoaded(scene: BaseScene): Promise<void> {
	await expect(recentRows(scene).or(scene.page.getByText("Nothing yet"))).toBeVisible();
	await expect(scene.page.getByTestId("upcoming-rows").or(scene.page.getByTestId("upcoming-empty"))).toBeVisible();
	await expect(scene.page.getByRole("heading", { name: /^(Get started|You're all set)$/ })).toBeVisible();
}

async function openMenu(scene: BaseScene, button: string, item: string): Promise<void> {
	await scene.page.getByRole("button", { name: button, exact: true }).first().click();
	await expect(scene.page.getByRole("menuitem", { name: item, exact: true })).toBeVisible();
}

async function openTask(scene: BaseScene, title: string): Promise<void> {
	await scene.page.getByRole("button", { name: new RegExp(`^${title}`) }).click();
	await expect(scene.dialog(title)).toBeVisible();
}

/**
 * Upcoming keeps its last events in session storage and shows them at once on
 * a reload, so a first load is a reload with that copy gone.
 */
async function reloadWithoutCache(scene: BaseScene): Promise<void> {
	// Cleared on every load of this page, before the app reads it.
	await scene.page.addInitScript(() => sessionStorage.removeItem("suite-calendar-upcoming-v1"));
	await scene.page.reload();
}

async function signInAsNewcomer(scene: BaseScene): Promise<void> {
	const person = addPerson(scene, { firstName: "Ines", lastName: "Moreau", welcome: false });
	newcomer.set(scene, person);
	await signInAs(scene, person);
	await scene.goto("/home");
	await homeLoaded(scene);
}

export const home = defineFlow<Event, BaseScene>({
	id: "home",
	title: "Home",
	source: "frontend/src/composition/home/HomePage.vue",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter(scene) {
		await scene.goto("/home");
		await homeLoaded(scene);
	},
	events: {
		async RELOAD_SLOW(scene) {
			await scene.hold(RECENTS);
			await scene.hold(UPCOMING);
			await scene.hold("**/api/suite/people**");
			await reloadWithoutCache(scene);
			await expect(scene.page.getByLabel("Loading recent documents")).toBeVisible();
			await expect(scene.page.getByRole("status", { name: "Loading upcoming events" })).toBeVisible();
		},
		async RELOAD_FAILS(scene) {
			await (await scene.hold(RECENTS)).abort(500);
			await (await scene.hold(UPCOMING)).abort(500);
			await reloadWithoutCache(scene);
			await expect(scene.page.getByTestId("recent-error")).toBeVisible({ timeout: 20_000 });
			await expect(scene.page.getByTestId("upcoming-error")).toBeVisible({ timeout: 20_000 });
		},
		async REFRESH_FAILS(scene) {
			// A read is fetched again on return only once it is 30 seconds old (`staleTime` in reads.ts).
			await scene.page.waitForTimeout(31_000);
			await (await scene.hold(RECENTS)).abort(500);
			await (await scene.hold(UPCOMING)).abort(500);
			await scene.page.getByRole("link", { name: "View all" }).first().click();
			await scene.page.waitForURL("**/drive/recent");
			await scene.page.goBack();
			await scene.page.waitForURL("**/home");
			await expect(scene.page.getByText("Recent files could not be refreshed.")).toBeVisible({ timeout: 20_000 });
			await expect(scene.page.getByText("Upcoming events could not be refreshed.")).toBeVisible({ timeout: 20_000 });
		},
		async OPEN_NEW_MENU(scene) {
			await openMenu(scene, "New", "Spreadsheet");
		},
		async CREATE_SLOW(scene) {
			await scene.hold("**/api/suite/drive/nodes");
			const card = scene.page.getByRole("region", { name: "New" }).getByRole("button").first();
			await card.click();
			await expect(card).toHaveAttribute("aria-busy", "true");
		},
		async OPEN_MEET_MENU(scene) {
			await openMenu(scene, "Meet", "Start private meeting");
		},
		async OPEN_SCHEDULE_MENU(scene) {
			await openMenu(scene, "Schedule", "Meeting");
		},
		async OPEN_INVITE_TASK(scene) {
			await openTask(scene, "Invite your team");
		},
		async OPEN_LOGO_TASK(scene) {
			await openTask(scene, "Add your logo");
		},
		async PHONE_WIDTH(scene) {
			await scene.page.setViewportSize(PHONE);
			await scene.page.reload();
			await homeLoaded(scene);
		},
		async SIGN_IN_AS_MEMBER(scene) {
			await signInAs(scene, demoUser("leo"));
			await scene.goto("/home");
			await homeLoaded(scene);
			await expect(scene.page.getByRole("button", { name: /^Add a profile photo/ })).toBeVisible();
		},
		async SIGN_IN_AS_NEWCOMER(scene) {
			await signInAsNewcomer(scene);
			await expect(scene.page.getByText("Nothing yet")).toBeVisible();
			await expect(scene.page.getByTestId("upcoming-empty")).toBeVisible();
		},
		async HIDE(scene) {
			await scene.page.getByRole("button", { name: "Hide" }).click();
			await expect(scene.page.getByRole("heading", { name: "Get started" })).toHaveCount(0);
		},
		async HIDE_FAILS(scene) {
			await (await scene.hold("**/api/suite/account")).abort(500);
			await scene.page.getByRole("button", { name: "Hide" }).click();
			await expect(scene.page.getByText("Could not hide the list. Try again.")).toBeVisible();
			await expect(scene.page.getByRole("heading", { name: "Get started" })).toBeVisible();
		},
		async ADD_PHOTO(scene) {
			benchPython(
				siteOf(DEMO_URL),
				"def run(data):\n    frappe.db.set_value('User', data['email'], 'user_image', data['image'])\n    return True",
				{ email: newcomer.get(scene).email, image: "/assets/frappe/images/smiley.png" },
			);
			await scene.page.reload();
			await expect(scene.page.getByRole("heading", { name: "You're all set" })).toBeVisible();
		},
	},
});
