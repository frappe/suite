import { expect, type Page } from "@playwright/test";
import type { Credentials } from "../../shared/auth";
import { DEMO_DOMAIN, openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import { perScene, type BaseScene } from "../scene";
import { animationsDone } from "./setup-helpers";
import { addPerson, signInAs } from "./welcome-helpers";

type Event =
	| { type: "WRONG_TEMPORARY" }
	| { type: "REUSE_TEMPORARY" }
	| { type: "SAVE_SLOW" }
	| { type: "SAVE_PASSWORD" }
	| { type: "SIGN_OUT" }
	| { type: "SIGN_IN_WRONG" }
	| { type: "SIGN_IN" }
	| { type: "PRESS_SHORTCUT" }
	| { type: "FINISH" }
	| { type: "FINISH_FAILS" }
	| { type: "OPEN_SUITE" }
	| { type: "SIGN_IN_AS_ANOTHER_NEWCOMER" }
	| { type: "FINISH_WELCOME" }
	| { type: "OPEN_HOME" }
	| { type: "OPEN_DEAD_LINK" }
	| { type: "OPEN_INVITATION" }
	| { type: "OPEN_EXPIRED_INVITATION" }
	| { type: "ACCEPT" }
	| { type: "CREATE_SLOW" }
	| { type: "CREATE_FAILS" };

/**
 * The welcome a person added after setup walks once, in `JoinView.vue`. Its
 * `step` ref is explicit; `arrival` picks the order of steps. Inside a step the
 * screen comes from the children: `AccountSetupStep`'s `setupState` plus a
 * per-row map advanced by a timer, `PasswordStep`'s mutation flags, and the
 * welcome's completion promise beside `opening`.
 *
 * This site is self-hosted, so an Admin's invitation is a Frappe email and
 * never a `/join/<key>` link. The invitation pages are captured with the
 * invitation lookup answered by the test, as a Suite Cloud site would answer it.
 */
const machine = setupFlow<Event>().createMachine({
	id: "welcome",
	initial: "passwordStep",
	states: {
		passwordStep: {
			meta: { description: "A person an Admin gave a temporary password, signed in and sent here from any page: “Choose your own password”, asking for the temporary one first because it is no longer in memory. Sign out is the only other way off the page." },
			on: {
				WRONG_TEMPORARY: "passwordWrongTemporary",
				REUSE_TEMPORARY: "passwordReused",
				SAVE_SLOW: "passwordSaving",
				SAVE_PASSWORD: "shortcut",
				SIGN_OUT: "joinSignIn",
				SIGN_IN_AS_ANOTHER_NEWCOMER: "welcomeShortcut",
			},
		},
		passwordWrongTemporary: {
			meta: { description: "The temporary password typed is wrong: “Incorrect password” shows under the form, and nothing is saved." },
		},
		passwordReused: {
			meta: { description: "The new password is the temporary one again. On a site without Suite Cloud the refusal is Frappe's own (“New password cannot be the same as your current password”), not Suite's message, which only the Cloud path checks." },
		},
		passwordSaving: {
			meta: { description: "Save password pressed and the change still out: the button spins and Sign out is off." },
		},
		shortcut: {
			meta: { description: "The password is saved and the welcome goes on: Get anywhere with Ctrl K, with the workspace's logo at the top and the track on its second step." },
			on: { PRESS_SHORTCUT: "palette", FINISH: "ready", FINISH_FAILS: "readyOpenFailed" },
		},
		palette: {
			meta: { description: "The practice command menu for a person who is not an Admin: Create and Go to, with no Admin group." },
		},
		ready: {
			meta: { description: "Welcome to Northwind Labs, with the person's first name: their email, their role and the teammates' faces. Reaching this step ends the welcome and puts the welcome document in their Drive." },
			on: { OPEN_SUITE: "passwordAskedAgain" },
		},
		readyOpenFailed: {
			meta: { description: "Ending the welcome failed and Open Suite was pressed: the button spun and stopped, and the page looks the same as before. Nothing says what went wrong." },
		},
		passwordAskedAgain: {
			meta: { description: "Open Suite after the password was saved: Home sends the person straight back to “Choose your own password”. On a site without Suite Cloud, saving the password never clears the must-change flag, so every page load returns here until an Admin steps in." },
		},
		welcomeShortcut: {
			meta: { description: "A person added after setup without a temporary password, opening Suite for the first time: the welcome starts at the shortcut step, with no password step before it. The progress track at the top right shows one short grey mark and no current step: the track always skips the first step of the order, which here is the shortcut step itself." },
			on: { FINISH_WELCOME: "welcomeReady" },
		},
		welcomeReady: {
			meta: { description: "Their last welcome step: their email, role and teammates. Reaching it ends the welcome and puts the welcome document in their Drive." },
			on: { OPEN_HOME: "homeAfterWelcome" },
		},
		homeAfterWelcome: {
			meta: { description: "Open Suite loads Home: Get started with Add a profile photo, and the welcome document in Recent." },
		},
		joinSignIn: {
			meta: { description: "Sign out leads to /join, where a person with a temporary password signs in: the workspace's mark and name, Email, Password, and a note to ask the Admin for a new one." },
			on: {
				SIGN_IN_WRONG: "joinSignInFailed",
				SIGN_IN: "joinPassword",
				OPEN_DEAD_LINK: "linkInvalid",
				OPEN_INVITATION: "invitation",
				OPEN_EXPIRED_INVITATION: "invitationExpired",
			},
		},
		joinSignInFailed: {
			meta: { description: "The email or password is wrong: the error shows above Sign in and the email stays." },
		},
		joinPassword: {
			meta: { description: "Signed in with the temporary password: the password step no longer asks for it, because the sign-in kept it in memory." },
		},
		linkInvalid: {
			meta: { description: "An invitation link with a key the site does not know: “This invitation link does not work”, with the workspace mark greyed and a way to sign in." },
		},
		invitation: {
			meta: { description: "An invitation from Maya (answered by the test: this self-hosted site sends none): the workspace's logo with her avatar, the work email and role, Accept invitation, and where it was sent and when it expires." },
			on: { ACCEPT: "accountForm" },
		},
		invitationExpired: {
			meta: { description: "An invitation past its date (answered by the test): “This invitation has expired”, Email Maya, and I already joined." },
		},
		accountForm: {
			meta: { description: "Create your account: the work email Maya chose, a name and a password, and where a reset link would go." },
			on: { CREATE_SLOW: "accountWorking", CREATE_FAILS: "accountFailed" },
		},
		accountWorking: {
			meta: { description: "Setting up your account: Drive, Mailbox and Account rows advance on a timer while one request runs; the button spins and Back is gone." },
		},
		accountFailed: {
			meta: { description: "The mailbox could not be made: Drive is ticked, Mailbox reads “Couldn't create it”, the heading says setup didn't finish, and the button is Try again." },
		},
		accountReady: {
			meta: {
				description: "The account is made and the person is signed in: “Your account is ready”, then the welcome steps. Unreachable here: making the account needs a real invitation, which this self-hosted site never creates.",
				transient: true,
			},
		},
		firstAdminInvitation: {
			meta: {
				description: "On Suite Cloud the first Admin's invitation opens the setup wizard with an account step instead. Unreachable here: this site is already set up.",
				transient: true,
			},
		},
	},
});

const person = perScene<Credentials>("welcome: person");
const NEW_PASSWORD = "Northwind-Coast-77";
const INVITATION_KEY = "f3b9c2d7e41a";

function onStep(page: Page, title: string | RegExp) {
	return expect(page.getByRole("heading", { name: title })).toBeVisible();
}

async function fillNewPassword(page: Page, temporary: string, password: string): Promise<void> {
	await page.getByLabel("Temporary password").fill(temporary);
	await page.getByLabel("New password").fill(password);
	await page.getByRole("button", { name: "Save password" }).click();
}

/** Answers the invitation lookup as a Suite Cloud site would, since this site makes no invitations. */
async function answerInvitation(page: Page, expired: boolean): Promise<void> {
	const day = 86_400_000;
	await page.route(/\/api\/suite\/mail\/invitations\/[^/?]+(\?.*)?$/, (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				data: {
					backup_email: "nora.lindqvist@gmail.com",
					account: `nora@${DEMO_DOMAIN}`,
					is_verified: 0,
					is_expired: expired ? 1 : 0,
					workspace_name: "Northwind Labs",
					workspace_logo: "/files/2vnaui2ajd/northwind-labs-logo.png",
					invited_by_name: "Maya Chen",
					invited_by_image: "/files/2vro7qdgqa/maya-avatar.png",
					invited_by_email: `maya@${DEMO_DOMAIN}`,
					is_admin: 0,
					sets_up_site: 0,
					expires_at: new Date(Date.now() + (expired ? -2 : 5) * day).toISOString(),
				},
			}),
		}),
	);
	await page.route(/\/api\/suite\/mail\/invitations\/[^/]+\/options/, (route) =>
		route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { locales: [], time_zones: [] } }) }),
	);
}

async function openInvitation(scene: BaseScene, expired: boolean): Promise<void> {
	await answerInvitation(scene.page, expired);
	await scene.goto(`/join/${INVITATION_KEY}`);
}

async function fillAccount(page: Page): Promise<void> {
	await page.getByLabel("Your name").fill("Nora Lindqvist");
	await page.getByLabel("Password").fill(NEW_PASSWORD);
	await page.getByRole("button", { name: "Join Northwind Labs" }).click();
}

export const welcome = defineFlow<Event, BaseScene>({
	id: "welcome",
	title: "Welcome",
	source: "frontend/src/composition/onboarding/JoinView.vue",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter(scene) {
		const nora = addPerson(scene, { firstName: "Nora", lastName: "Lindqvist", temporary: true, welcome: true });
		person.set(scene, nora);
		await signInAs(scene, nora);
		// Any page sends a person with a temporary password to the welcome.
		await scene.goto("/home");
		await scene.page.waitForURL("**/suite/welcome");
		await onStep(scene.page, "Choose your own password");
	},
	events: {
		async WRONG_TEMPORARY(scene) {
			const refused = scene.page.waitForResponse((response) => response.url().includes("update_password"));
			await fillNewPassword(scene.page, "not-the-one-1", NEW_PASSWORD);
			expect((await refused).ok()).toBe(false);
			await expect(scene.page.getByText(/incorrect|wrong|invalid/i)).toBeVisible();
		},
		async REUSE_TEMPORARY(scene) {
			const { password } = person.get(scene);
			await fillNewPassword(scene.page, password, password);
			await expect(scene.page.getByText(/New password cannot be the same|Choose a password different/)).toBeVisible();
		},
		async SAVE_SLOW(scene) {
			await scene.hold("**/frappe.core.doctype.user.user.update_password");
			await fillNewPassword(scene.page, person.get(scene).password, NEW_PASSWORD);
			await expect(scene.page.getByRole("button", { name: "Sign out" })).toBeDisabled();
		},
		async SAVE_PASSWORD(scene) {
			await fillNewPassword(scene.page, person.get(scene).password, NEW_PASSWORD);
			await onStep(scene.page, /^Get anywhere with/);
		},
		async SIGN_OUT(scene) {
			await scene.page.getByRole("button", { name: "Sign out" }).click();
			await scene.page.waitForURL("**/join");
			await onStep(scene.page, "Sign in to Northwind Labs");
		},
		async SIGN_IN_WRONG(scene) {
			const refused = scene.page.waitForResponse((response) => response.url().includes("/api/method/login"));
			await scene.page.getByLabel("Email").fill(person.get(scene).email);
			await scene.page.getByLabel("Password").fill("not-the-one-1");
			await scene.page.getByRole("button", { name: "Sign in" }).click();
			expect((await refused).ok()).toBe(false);
			await expect(scene.page.getByText(/incorrect|invalid|wrong/i)).toBeVisible();
		},
		async SIGN_IN(scene) {
			const { email, password } = person.get(scene);
			await scene.page.getByLabel("Email").fill(email);
			await scene.page.getByLabel("Password").fill(password);
			await scene.page.getByRole("button", { name: "Sign in" }).click();
			await onStep(scene.page, "Choose your own password");
			await expect(scene.page.getByLabel("New password")).toBeVisible();
			await expect(scene.page.getByLabel("Temporary password")).toHaveCount(0);
		},
		async PRESS_SHORTCUT(scene) {
			await scene.page.mouse.move(10, 10);
			await scene.page.keyboard.press("Control+k");
			await expect(scene.page.getByRole("option", { name: "New document" })).toBeVisible();
		},
		async FINISH(scene) {
			const welcomed = scene.page.waitForResponse(
				(response) => response.url().endsWith("/api/suite/account") && response.request().method() === "PATCH",
			);
			await scene.page.getByRole("button", { name: "Skip" }).click();
			expect((await welcomed).ok()).toBe(true);
			await onStep(scene.page, "Welcome to Northwind Labs, Nora");
			await expect(scene.page.getByText("Normal User")).toBeVisible();
		},
		async FINISH_FAILS(scene) {
			const hold = await scene.hold("**/api/suite/account");
			await scene.page.getByRole("button", { name: "Skip" }).click();
			await onStep(scene.page, "Welcome to Northwind Labs, Nora");
			await hold.abort(500);
			const open = scene.page.getByRole("button", { name: "Open Suite" });
			await open.click();
			await expect(open).toBeEnabled();
			await expect(scene.page).toHaveURL(/\/suite\/welcome$/);
		},
		async OPEN_SUITE(scene) {
			await scene.page.getByRole("button", { name: "Open Suite" }).click();
			await scene.page.waitForURL("**/home");
			await scene.page.waitForURL("**/suite/welcome");
			await onStep(scene.page, "Choose your own password");
		},
		async SIGN_IN_AS_ANOTHER_NEWCOMER(scene) {
			const ines = addPerson(scene, { firstName: "Ines", lastName: "Moreau", welcome: true });
			await signInAs(scene, ines);
			await scene.goto("/home");
			await scene.page.waitForURL("**/suite/welcome");
			await onStep(scene.page, /^Get anywhere with/);
		},
		async FINISH_WELCOME(scene) {
			const welcomed = scene.page.waitForResponse(
				(response) => response.url().endsWith("/api/suite/account") && response.request().method() === "PATCH",
			);
			await scene.page.getByRole("button", { name: "Skip" }).click();
			expect((await welcomed).ok()).toBe(true);
			await onStep(scene.page, "Welcome to Northwind Labs, Ines");
		},
		async OPEN_HOME(scene) {
			await scene.page.getByRole("button", { name: "Open Suite" }).click();
			await scene.page.waitForURL("**/home");
			await expect(scene.page.getByRole("link", { name: /^Welcome to Frappe Suite/ })).toBeVisible();
		},
		async OPEN_DEAD_LINK(scene) {
			await scene.goto("/join/0000deadbeef");
			await onStep(scene.page, "This invitation link does not work");
		},
		async OPEN_INVITATION(scene) {
			await openInvitation(scene, false);
			await onStep(scene.page, "Join Northwind Labs on Frappe Suite");
			await expect(scene.page.getByRole("button", { name: "Accept invitation" })).toBeVisible();
		},
		async OPEN_EXPIRED_INVITATION(scene) {
			await openInvitation(scene, true);
			await onStep(scene.page, "This invitation has expired");
		},
		async ACCEPT(scene) {
			await scene.page.getByRole("button", { name: "Accept invitation" }).click();
			await onStep(scene.page, "Create your account");
			await expect(scene.page.getByText(`nora@${DEMO_DOMAIN}`)).toBeVisible();
		},
		async CREATE_SLOW(scene) {
			await scene.hold(/\/api\/suite\/mail\/invitations\/[^/]+\/account/);
			await fillAccount(scene.page);
			await onStep(scene.page, "Setting up your account");
		},
		async CREATE_FAILS(scene) {
			await scene.page.route(/\/api\/suite\/mail\/invitations\/[^/]+\/account/, (route) =>
				route.fulfill({
					status: 500,
					contentType: "application/json",
					body: JSON.stringify({ errors: [{ type: "MailboxSetupFailed", message: "The mailbox could not be created" }] }),
				}),
			);
			await fillAccount(scene.page);
			await onStep(scene.page, "Setup didn't finish");
			await expect(scene.page.getByText("Couldn't create it")).toBeVisible();
		},
	},
	settle: Object.fromEntries(
		Object.keys(machine.config.states ?? {}).map((state) => [state, (scene: BaseScene) => animationsDone(scene.page)]),
	),
});
