import { resolve } from "node:path";
import { expect } from "@playwright/test";
import { openSetupScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";
import { animationsDone, failCompletion, snapshotSetupSite } from "./setup-helpers";

type Event =
	| { type: "GET_STARTED" }
	| { type: "TYPE_NAME" }
	| { type: "ADD_LOGO" }
	| { type: "SAVE_SLOW" }
	| { type: "SAVE_FAILS" }
	| { type: "CONTINUE" }
	| { type: "SEND_INVALID" }
	| { type: "SEND_SLOW" }
	| { type: "SEND" }
	| { type: "SKIP_INVITES" }
	| { type: "PRESS_SHORTCUT" }
	| { type: "SEARCH_MISS" }
	| { type: "PICK_COMMAND" }
	| { type: "FINISH" }
	| { type: "FINISH_FAILS" }
	| { type: "OPEN_SUITE" };

/**
 * The first Admin's wizard on a self-hosted site: welcome, workspace, team,
 * the command menu and the summary. In the code the step is `SetupView.vue`'s
 * `step` ref over a computed `order`, an explicit list; inside each step the
 * screen comes from the child's own flags (`saveWorkspace.isPending`,
 * `invite.isPending`, `clientError`, `learnedPalette`, `markOnboarded.error`).
 */
const machine = setupFlow<Event>().createMachine({
	id: "setup",
	initial: "welcome",
	states: {
		welcome: {
			meta: { description: "The first page an Admin sees on a new site: the Suite mark, “Welcome to Frappe Suite”, the included apps as icons, and Get started." },
			on: { GET_STARTED: "workspace" },
		},
		workspace: {
			meta: { description: "Set up your workspace: an empty logo tile, an empty name, and the time zone the browser reports. Continue stays off until there is a name." },
			on: { TYPE_NAME: "workspaceNamed" },
		},
		workspaceNamed: {
			meta: { description: "A name typed: Continue turns on. The logo is optional." },
			on: { ADD_LOGO: "workspaceWithLogo", SAVE_SLOW: "workspaceSaving", SAVE_FAILS: "workspaceSaveFailed", CONTINUE: "invite" },
		},
		workspaceWithLogo: {
			meta: { description: "A logo uploaded: the tile shows it, and hovering it offers Replace and Remove." },
		},
		workspaceSaving: {
			meta: { description: "Continue pressed and the save still out: the button spins. The fields stay editable." },
		},
		workspaceSaveFailed: {
			meta: { description: "The save failed: the server's message shows under the name, and the wizard stays on this step." },
		},
		invite: {
			meta: { description: "Let's invite your team: one box for comma-separated addresses, with Skip beside Send invites. Send invites is off until an address looks valid." },
			on: { SEND_INVALID: "inviteInvalid", SEND_SLOW: "inviteSending", SEND: "inviteNoOutgoingEmail", SKIP_INVITES: "shortcut" },
		},
		inviteInvalid: {
			meta: { description: "One of the addresses is not an email: the box keeps them all and names the bad one under it. Nothing was sent." },
		},
		inviteSending: {
			meta: { description: "Send invites pressed and the request still out: the button spins, and the box, Back and Skip are off." },
		},
		inviteNoOutgoingEmail: {
			meta: { description: "This site has no outgoing email account, so the invitation is refused with “Outgoing email account not set up.” Skip is the only way on; the wizard offers no link to set email up." },
		},
		invitesSent: {
			meta: {
				description: "Invites sent: the wizard moves to the next step and the summary's Team row says how many. Unreachable here: the setup site has no outgoing email account.",
				transient: true,
			},
		},
		cloudSteps: {
			meta: {
				description: "On Suite Cloud the wizard adds Set up business Mail (a mailbox before anyone is invited) and Use your own domain, and an invited first Admin creates their account first. Unreachable here: the setup site is self-hosted.",
				transient: true,
			},
		},
		shortcut: {
			meta: { description: "Get anywhere with Ctrl K: two large keycaps and “Try it now”. The only button is Skip until the shortcut is used." },
			on: { PRESS_SHORTCUT: "palette", FINISH: "ready", FINISH_FAILS: "readyFailed" },
		},
		palette: {
			meta: { description: "Ctrl K opens a practice copy of the command menu: Create, Go to and Admin commands. Picking one only reports the pick. Pressing the shortcut already counts as learned, so behind the menu Skip has become Continue." },
			on: { SEARCH_MISS: "paletteNoResults", PICK_COMMAND: "shortcutLearned" },
		},
		paletteNoResults: {
			meta: { description: "A search that matches no command: “No results”." },
		},
		shortcutLearned: {
			meta: { description: "A command picked: a green tick says it is one keystroke away, and Skip has become Continue." },
		},
		ready: {
			meta: { description: "You're all set!: the summary lists the workspace and the team, the track shows a tick, and the site is marked set up as this step opens." },
			on: { OPEN_SUITE: "suiteOpened" },
		},
		readyFailed: {
			meta: { description: "Marking the site set up failed: the same summary, with the server's message under Open Suite, which tries again." },
		},
		suiteOpened: {
			meta: { description: "Open Suite loads Home afresh: Get started at 0 of 2 (Invite your team, Add your logo), the starter document, spreadsheet, presentation and board in Recent, and “Nothing scheduled” under Upcoming, because Administrator has no mailbox." },
		},
	},
});

const logoPath = resolve(__dirname, "../fixtures/Logo.png");
const WORKSPACE = "Harbor Studio";

async function onStep(scene: BaseScene, title: string): Promise<void> {
	await expect(scene.page.getByRole("heading", { name: title, exact: true })).toBeVisible();
}

function workspaceName(scene: BaseScene) {
	return scene.page.getByRole("textbox", { name: "Workspace name" });
}

function inviteBox(scene: BaseScene) {
	return scene.page.getByPlaceholder("name@company.com, another@company.com");
}

async function sendInvites(scene: BaseScene, emails: string): Promise<void> {
	await inviteBox(scene).fill(emails);
	await scene.page.getByRole("button", { name: "Send invites" }).click();
}

export const setup = defineFlow<Event, BaseScene>({
	id: "setup",
	title: "Site setup",
	source: "frontend/src/composition/onboarding/SetupView.vue",
	async open(browser) {
		const scene = await openSetupScene(browser);
		// Finishing the wizard marks the site set up for every later path, so each path puts it back.
		const restore = snapshotSetupSite();
		scene.defer(async () => restore());
		return scene;
	},
	machine,
	async enter(scene) {
		await scene.goto("/suite/setup");
		await expect(scene.page.getByRole("button", { name: "Get started" })).toBeVisible();
	},
	events: {
		async GET_STARTED(scene) {
			await scene.page.getByRole("button", { name: "Get started" }).click();
			await onStep(scene, "Set up your workspace");
			await expect(workspaceName(scene)).toBeFocused();
		},
		async TYPE_NAME(scene) {
			await workspaceName(scene).fill(WORKSPACE);
			await expect(scene.page.getByRole("button", { name: "Continue" })).toBeEnabled();
		},
		async ADD_LOGO(scene) {
			await scene.page.locator('input[type="file"]').setInputFiles(logoPath);
			await expect(scene.page.getByRole("img", { name: "Workspace logo" })).toBeVisible();
			await scene.page.getByRole("button", { name: "Replace logo" }).hover();
		},
		async SAVE_SLOW(scene) {
			await scene.hold("**/api/suite/site");
			await scene.page.getByRole("button", { name: "Continue" }).click();
			// frappe-ui turns a loading button off while it spins.
			await expect(scene.page.getByRole("button", { name: "Continue" })).toBeDisabled();
		},
		async SAVE_FAILS(scene) {
			const hold = await scene.hold("**/api/suite/site");
			await scene.page.getByRole("button", { name: "Continue" }).click();
			await hold.abort(500);
			await expect(scene.page.getByText("Something went wrong")).toBeVisible();
		},
		async CONTINUE(scene) {
			await scene.page.getByRole("button", { name: "Continue" }).click();
			await onStep(scene, "Let's invite your team");
		},
		async SEND_INVALID(scene) {
			await sendInvites(scene, "sam@harbor.example, jordan@");
			await expect(scene.page.getByText("\"jordan@\" doesn't look like a valid email address.")).toBeVisible();
		},
		async SEND_SLOW(scene) {
			await scene.hold("**/api/suite/invitations");
			await sendInvites(scene, "sam@harbor.example, jordan@harbor.example");
			await expect(inviteBox(scene)).toBeDisabled();
		},
		async SEND(scene) {
			await sendInvites(scene, "sam@harbor.example, jordan@harbor.example");
			await expect(scene.page.getByText("Outgoing email account not set up.")).toBeVisible();
		},
		async SKIP_INVITES(scene) {
			await scene.page.getByRole("button", { name: "Skip" }).click();
			await expect(scene.page.getByText("Try it now")).toBeVisible();
		},
		async PRESS_SHORTCUT(scene) {
			// Away from the menu's rows, so the pointer does not highlight one.
			await scene.page.mouse.move(10, 10);
			await scene.page.keyboard.press("Control+k");
			await expect(scene.page.getByRole("option", { name: "New document" })).toBeVisible();
		},
		async SEARCH_MISS(scene) {
			await scene.page.getByRole("combobox", { name: "Search Suite" }).fill("payroll");
			await expect(scene.page.getByText("No results")).toBeVisible();
		},
		async PICK_COMMAND(scene) {
			await scene.page.keyboard.press("Enter");
			await expect(scene.page.getByText("is one keystroke away from anywhere")).toBeVisible();
			await expect(scene.page.getByRole("button", { name: "Continue" })).toBeVisible();
		},
		async FINISH(scene) {
			const completed = scene.page.waitForResponse(
				(response) => response.url().endsWith("/api/suite/site") && response.request().method() === "PATCH",
			);
			await scene.page.getByRole("button", { name: "Skip" }).click();
			expect((await completed).ok()).toBe(true);
			await onStep(scene, "You're all set!");
		},
		async FINISH_FAILS(scene) {
			await failCompletion(scene.page);
			await scene.page.getByRole("button", { name: "Skip" }).click();
			await onStep(scene, "You're all set!");
			await expect(scene.page.getByText("Something went wrong")).toBeVisible();
		},
		async OPEN_SUITE(scene) {
			await scene.page.getByRole("button", { name: "Open Suite" }).click();
			await scene.page.waitForURL("**/home");
			await expect(scene.page.getByRole("heading", { name: "Recent" })).toBeVisible();
			await expect(scene.page.getByTestId("recent-rows")).toBeVisible();
		},
	},
	settle: Object.fromEntries(
		Object.keys(machine.config.states ?? {}).map((state) => [state, (scene: BaseScene) => animationsDone(scene.page)]),
	),
});
