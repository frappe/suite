import { expect, type Page } from "@playwright/test";
import { demoUser, identityOf, openDemoScene, personalAccount } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import type { BaseScene } from "../scene";

type Event =
	| { type: "SUBMIT_SLOW" }
	| { type: "LOGIN_GOES_THROUGH" }
	| { type: "SUBMIT_WRONG" }
	| { type: "FORGOT_PASSWORD" }
	| { type: "SEND_RESET_SLOW" }
	| { type: "RESET_REFUSED" }
	| { type: "SEND_RESET" }
	| { type: "OPEN_BAD_RESET_LINK" }
	| { type: "OPEN_RESET_LINK" }
	| { type: "OPEN_SIGNUP_CLOSED" }
	| { type: "SIGNUP_OPENS" }
	| { type: "CREATE_ACCOUNT" }
	| { type: "NEXT_NAME" }
	| { type: "NEXT_TAKEN_USERNAME" }
	| { type: "NEXT_USERNAME" }
	| { type: "NEXT_BACKUP_EMAIL" }
	| { type: "SIGN_UP" }
	| { type: "OPEN_BAD_INVITE" }
	| { type: "OPEN_INVITE" }
	| { type: "OPEN_EXPIRED_INVITE" }
	| { type: "OPEN_PROFILE" }
	| { type: "LOG_OUT" }
	| { type: "CONFIRM_LOG_OUT" }
	| { type: "PHONE_WIDTH" }
	| { type: "OPEN_EXCHANGES" }
	| { type: "OPEN_EXCHANGES_SLOW" }
	| { type: "EXCHANGES_FAIL" }
	| { type: "OPEN_EXCHANGES_FILLED" }
	| { type: "SHOW_EXPORTS" }
	| { type: "OPEN_RUNNING" }
	| { type: "OPEN_DONE" }
	| { type: "OPEN_FAILED" }
	| { type: "OPEN_EXCHANGE_SLOW" }
	| { type: "OPEN_MISSING_EXCHANGE" }
	| { type: "BACK_BY_BREADCRUMB" }
	| { type: "OPEN_CALENDAR_EXCHANGES" }
	| { type: "OPEN_CONTACTS_EXCHANGES" }
	| { type: "OPEN_CONTACTS_DONE" };

/**
 * Mail's signed-out pages under `LoginLayout`, the profile page, and the
 * import and export history. The signed-out pages each keep their phase in
 * the request they wait on (`isLoggingIn`, `sendResetLink.isPending`, a
 * `?step=` query on signup); the exchange pages are three near copies.
 */
const machine = setupFlow<Event>().createMachine({
	id: "mailAccount",
	initial: "login",
	states: {
		login: {
			meta: { description: "Signed out at /mail/login: \"Sign in to your account\" with Email, Password, Forgot password? and Log In. Sign-up is closed on this site, so there is no link to create an account." },
			on: {
				SUBMIT_SLOW: "loggingIn",
				SUBMIT_WRONG: "loginFailed",
				FORGOT_PASSWORD: "forgotPassword",
				OPEN_BAD_RESET_LINK: "resetLinkInvalid",
				OPEN_RESET_LINK: "resetPasswordForm",
				OPEN_SIGNUP_CLOSED: "signupClosed",
				SIGNUP_OPENS: "loginWithSignup",
				OPEN_BAD_INVITE: "inviteLinkInvalid",
				OPEN_INVITE: "invite",
				OPEN_EXPIRED_INVITE: "inviteExpired",
			},
		},
		loggingIn: {
			meta: { description: "Log In pressed while the server answers: the button shows a spinner." },
			on: { LOGIN_GOES_THROUGH: "signedIn" },
		},
		signedIn: {
			meta: { description: "Signed in: Maya lands in her Inbox." },
			on: {
				OPEN_PROFILE: "profile",
				OPEN_EXCHANGES: "exchangesEmpty",
				OPEN_EXCHANGES_SLOW: "exchangesLoading",
				OPEN_EXCHANGES_FILLED: "exchangesImports",
				OPEN_RUNNING: "exchangeCrashed",
				OPEN_DONE: "exchangeDone",
				OPEN_FAILED: "exchangeFailed",
				OPEN_EXCHANGE_SLOW: "exchangeLoading",
				OPEN_MISSING_EXCHANGE: "exchangeMissing",
				OPEN_CALENDAR_EXCHANGES: "calendarExchanges",
				OPEN_CONTACTS_EXCHANGES: "contactsExchanges",
				OPEN_CONTACTS_DONE: "contactsExchangeCrashed",
			},
		},
		loginFailed: {
			meta: { description: "A wrong email or password: the form stays filled and \"Invalid login credentials\" shows in red above Log In." },
		},
		forgotPassword: {
			meta: { description: "\"Reset Password\": an Email field, Send Reset Link, and \"Remember your password? Log in.\"" },
			on: { SEND_RESET_SLOW: "resetSending", SEND_RESET: "resetLinkSent" },
		},
		resetSending: {
			meta: { description: "Send Reset Link pressed: the button shows a spinner while the server answers." },
			on: { RESET_REFUSED: "resetUnknownAddress" },
		},
		resetUnknownAddress: {
			meta: { description: "An address with no account: \"User jordan@northwind.test does not exist.\" in red. Anyone signed out can learn this way which addresses have accounts." },
		},
		resetLinkSent: {
			meta: { description: "The link was sent: the form is replaced by one sentence naming the address it went to. There is no way back to Log In from here. Sending a real link would change Maya's account, so the answer is shaped." },
		},
		resetLinkInvalid: {
			meta: { description: "A reset link that does not work (used, expired or mistyped) sends the user to the Reset Password form without a word about the link." },
		},
		resetPasswordForm: {
			meta: { description: "A working reset link: the email it is for, read-only, then New Password and a Confirm button. There is no second field to repeat the password. A real link would change Maya's account, so the key check is shaped." },
		},
		signupClosed: {
			meta: { description: "/mail/signup while sign-up is closed: the page goes to Log In and says nothing about why." },
		},
		loginWithSignup: {
			meta: { description: "Log In when the site allows sign-up: \"New member? Create an account.\" under the form. This site has sign-up closed, so its setting is shaped." },
			on: { CREATE_ACCOUNT: "signupName" },
		},
		signupName: {
			meta: { description: "\"Create a new account\", step one: First Name and Last Name, Next, and a link back to Log In." },
			on: { NEXT_NAME: "signupUsername" },
		},
		signupUsername: {
			meta: { description: "Step two: a username, an @ sign and the domain, which is read-only when the site offers one domain. Back returns to the names." },
			on: { NEXT_TAKEN_USERNAME: "signupUsernameTaken", NEXT_USERNAME: "signupBackupEmail" },
		},
		signupUsernameTaken: {
			meta: { description: "A username already in use: \"Username already taken.\" in red above Next, and the step stays." },
		},
		signupBackupEmail: {
			meta: { description: "Step three: Backup Email, where the verification code goes." },
			on: { NEXT_BACKUP_EMAIL: "signupPassword" },
		},
		signupPassword: {
			meta: { description: "Step four: Password, and the button now says Sign Up." },
			on: { SIGN_UP: "signupCode" },
		},
		signupCode: {
			meta: { description: "Step five: Verification Code, the address it was sent to, Resend code, and Verify. Sign Up would create an account request and send mail, so its answer is shaped." },
		},
		inviteLinkInvalid: {
			meta: { description: "An invite setup link (/mail/signup/<key>) goes to the Join page. With a key that does not exist: \"This invitation link does not work\" and \"I already joined. Sign in\"." },
		},
		invite: {
			meta: { description: "A working invite: \"Join Northwind on Frappe Suite\", who sent it, the email and role, Accept invitation, and when the invite expires. The invitation is shaped." },
		},
		inviteExpired: {
			meta: { description: "An expired invite: \"This invitation has expired\", that invitations last 7 days and to ask Maya Chen for a new one, an Email Maya button, and \"I already joined. Sign in\". The invitation is shaped." },
		},
		profile: {
			meta: { description: "The profile page at desktop width is the phone's page inside the desktop layout: a header \"Profile\", Maya's card, then Account and Mail settings rows stretched across the whole pane. Log Out is below the fold." },
			on: { LOG_OUT: "logOutConfirm", PHONE_WIDTH: "profilePhone" },
		},
		profilePhone: {
			meta: { description: "The profile page at phone width, the width it was made for, with the bottom bar of Inbox, Search and Profile." },
		},
		logOutConfirm: {
			meta: { description: "Log Out asks first: \"Are you sure you want to log out?\" with a red Log Out." },
			on: { CONFIRM_LOG_OUT: "loggedOut" },
		},
		loggedOut: {
			meta: { description: "Logged out: the page goes to the site's generic /login (\"Sign In\", Continue, Login with Email Link), not to Mail's own \"Sign in to your account\" page." },
		},
		exchangesLoading: {
			meta: { description: "Mail Exchanges while the list loads: the table header over \"No mail exchanges found.\", the same as an empty history." },
			on: { EXCHANGES_FAIL: "exchangesFailed" },
		},
		exchangesFailed: {
			meta: { description: "The list failed: \"No mail exchanges found.\" stays, with the error in red under the table." },
		},
		exchangesEmpty: {
			meta: { description: "Mail Exchanges with none run: the Import and Export tabs, a Status filter whose \"any\" choice is blank, and \"No mail exchanges found.\"" },
		},
		exchangesImports: {
			meta: { description: "Imports with one of each state: In Progress, Completed, Failed and Queued badges, with when each started and its format. The rows are shaped: the demo site has no exchanges." },
			on: { SHOW_EXPORTS: "exchangesExports" },
		},
		exchangesExports: {
			meta: { description: "The Export tab adds an Archive Type column." },
		},
		exchangeLoading: {
			meta: { description: "An exchange's page while it loads: a blank page with no header, breadcrumb or spinner, only the app rail." },
		},
		exchangeCrashed: {
			meta: { description: "A running import's page once its data arrives: still blank. The template reads `user.data.is_system_manager`, the page never defines `user`, and the render throws \"Cannot read properties of undefined (reading 'data')\". Every exchange page, in all three areas, ends here." },
		},
		exchangeDone: {
			meta: { transient: true, description: "A finished export would show a Completed badge, the server's log and the archive to download. Not reachable: the page crashes on render (see the crashed state)." },
			on: { BACK_BY_BREADCRUMB: "exchangeBreadcrumbBroken" },
		},
		exchangeFailed: {
			meta: { transient: true, description: "A failed import would show a Failed badge and the server's log, with no way to retry. Not reachable: the page crashes on render." },
		},
		exchangeMissing: {
			meta: { description: "An exchange that does not exist: the page goes to the Import list without saying why." },
		},
		exchangeBreadcrumbBroken: {
			meta: { transient: true, description: "The Mail Exchanges breadcrumb on an exchange's page links to /mail-exchanges, without /mail, so it would leave Mail. Not reachable while the page crashes on render; read from the code." },
		},
		calendarExchanges: {
			meta: { description: "Calendar Exchanges, the same page for calendar imports and exports, with ICS and JMAP formats. The rows are shaped." },
		},
		contactsExchanges: {
			meta: { description: "Contacts Exchanges, the same page again for contacts, with VCF and JMAP formats. The rows are shaped." },
		},
		contactsExchangeCrashed: {
			meta: { description: "A finished contacts export's page: blank for the same reason as the Mail one, since the Contacts page is a copy of it." },
		},
	},
});

const PHONE = { width: 390, height: 844 };
const LOGIN = /\/api\/method\/login$/;
const RESET_LINK = /suite\.mail\.api\.account\.send_reset_password_link/;
const RESET_KEY = /suite\.mail\.api\.account\.get_user_for_reset_password_key/;
const SIGNUP_SETTINGS = /suite\.mail\.api\.get_signup_settings/;
const SIGNUP_DOMAINS = /suite\.mail\.api\.get_signup_domains/;
const SIGNUP = /suite\.mail\.api\.account\.signup$/;
const INVITATION = /\/api\/suite\/mail\/invitations\/[^/?]+(\?|$)/;
const EXCHANGE_LIST = /\/api\/suite\/mail\/exchanges(\?|$)/;
const EXCHANGE = /\/api\/suite\/mail\/exchanges\/get/;
const ATTACHMENT = /\/api\/suite\/mail\/exchanges\/attachment/;

type Doctype = "Mail Exchange" | "Calendar Exchange" | "Contacts Exchange";

interface Job {
	name: string;
	status: string;
	operation: "Import" | "Export";
	started_at: string;
	completed_at: string | null;
	output: string | null;
	import_format: string | null;
	export_format: string | null;
	export_archive_type: string | null;
}

const FORMATS: Record<Doctype, { import: string; export: string }> = {
	"Mail Exchange": { import: "mbox", export: "maildir" },
	"Calendar Exchange": { import: "ics", export: "jmap" },
	"Contacts Exchange": { import: "vcf", export: "vcf" },
};

const DONE_LOG = [
	"Exporting mailbox Inbox (412 messages)",
	"Exporting mailbox Sent (188 messages)",
	"Exporting mailbox Archive (1,204 messages)",
	"Wrote maya-mail-export.zip (182.4 MB)",
	"Export completed in 3m 12s",
].join("\n");

const FAILED_LOG = [
	"Reading archive vendor-mail-2023.mbox",
	"Imported 1,180 of 2,407 messages",
	"Error: message 1,181 is not valid MIME: missing boundary in multipart/mixed",
	"Import stopped.",
].join("\n");

function utc(minutesAgo: number): string {
	return new Date(Date.now() - minutesAgo * 60_000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function job(doctype: Doctype, name: string, operation: "Import" | "Export", status: string, minutesAgo: number): Job {
	const done = status === "Completed" || status === "Failed";
	return {
		name,
		status,
		operation,
		started_at: utc(minutesAgo),
		completed_at: done ? utc(minutesAgo - 3) : null,
		output: status === "Completed" ? DONE_LOG : status === "Failed" ? FAILED_LOG : null,
		import_format: operation === "Import" ? FORMATS[doctype].import : null,
		export_format: operation === "Export" ? FORMATS[doctype].export : null,
		export_archive_type: operation === "Export" ? ".zip" : null,
	};
}

/** One job of each state per operation, as the list endpoint would answer for `doctype`. */
function jobs(doctype: Doctype, operation: "Import" | "Export"): Job[] {
	const prefix = operation === "Import" ? "7f3k9" : "2b8q4";
	return [
		job(doctype, `${prefix}a01c`, operation, "In Progress", 4),
		job(doctype, `${prefix}b02d`, operation, "Completed", 60 * 26),
		job(doctype, `${prefix}c03e`, operation, "Failed", 60 * 24 * 6),
		job(doctype, `${prefix}d04f`, operation, "Queued", 1),
	];
}

/** Answers the exchange list with one job of each state, for whichever doctype and tab asks. */
async function shapeExchangeList(page: Page): Promise<void> {
	await page.route(EXCHANGE_LIST, async (route) => {
		const query = new URL(route.request().url()).searchParams;
		// SAFETY: the page only asks with one of the three exchange doctypes and operations.
		const doctype = (query.get("doctype") ?? "Mail Exchange") as Doctype;
		const operation = query.get("operation") === "Export" ? "Export" : "Import";
		const status = query.get("status");
		const items = jobs(doctype, operation).filter((item) => !status || item.status === status);
		await route.fulfill({ json: { data: { items, total: items.length } } });
	});
}

/** Answers one exchange's page with `found`, and its archive when it has one. */
async function shapeExchange(page: Page, found: Job): Promise<void> {
	await page.route(EXCHANGE, (route) => route.fulfill({ json: { data: found } }));
	const archive =
		found.status === "Completed" && found.operation === "Export"
			? { file_name: "maya-mail-export.zip", file_url: "/private/files/maya-mail-export.zip", file_type: "ZIP", file_size: 191_266_406 }
			: null;
	await page.route(ATTACHMENT, (route) => route.fulfill({ json: { data: archive } }));
}

/** Opens an exchange's page and waits for its render to throw, which leaves it blank. */
async function openCrashingExchange(scene: BaseScene, found: Job, path: string): Promise<void> {
	await shapeExchange(scene.page, found);
	// Vue catches the render error and logs it, so it arrives as a console message, not a page error.
	const crashed = scene.page.waitForEvent("console", { predicate: (message) => message.text().includes("reading 'data'") });
	await scene.goto(`/mail/${path}/${found.name}`);
	await crashed;
}

async function answer(page: Page, url: RegExp, message: unknown): Promise<void> {
	await page.route(url, (route) => route.fulfill({ json: { message } }));
}

function invitation(expired: boolean) {
	return {
		backup_email: "jordan.lee@gmail.com",
		account: "jordan@northwind.test",
		is_verified: 0,
		is_expired: expired ? 1 : 0,
		workspace_name: "Northwind",
		workspace_logo: "",
		invited_by_name: identityOf("maya").name,
		invited_by_image: null,
		invited_by_email: identityOf("maya").email,
		is_admin: 0,
		sets_up_site: 0,
		expires_at: new Date(Date.now() + (expired ? -2 : 5) * 86_400_000).toISOString().replace("T", " ").replace(/\.\d+Z$/, ""),
	};
}

async function openInvite(scene: BaseScene, expired: boolean, heading: string): Promise<void> {
	await scene.page.route(INVITATION, (route) => route.fulfill({ json: { data: invitation(expired) } }));
	await scene.goto("/mail/signup/4c1e0b7a9d2f");
	await expect(scene.page.getByText(heading)).toBeVisible();
}

function button(page: Page, name: string) {
	return page.getByRole("button", { name, exact: true });
}

export const mailAccount = defineFlow<Event, BaseScene>({
	id: "mailAccount",
	title: "Mail account",
	source: "frontend/src/apps/mail/layouts/LoginLayout.vue",
	open: (browser) => openDemoScene(browser),
	machine,
	async enter(scene) {
		// The scene signs in through the API; these pages are for someone signed out.
		await scene.context.clearCookies();
		await scene.goto("/mail/login");
		await expect(scene.page.getByText("Sign in to your account")).toBeVisible();
		await expect(button(scene.page, "Log In")).toBeVisible();
	},
	events: {
		async SUBMIT_SLOW(scene) {
			const maya = demoUser("maya");
			await scene.page.getByLabel("Email").fill(maya.email);
			await scene.page.getByLabel("Password").fill(maya.password);
			await scene.hold(LOGIN);
			const asked = scene.page.waitForRequest(LOGIN);
			await button(scene.page, "Log In").click();
			await asked;
		},
		async LOGIN_GOES_THROUGH(scene) {
			await scene.lastHold.release();
			await expect(scene.page).toHaveURL(/\/mail\/account\/[^/]+\/mailbox\//, { timeout: 30_000 });
			await expect(scene.page.getByRole("button", { name: "Compose", exact: true })).toBeVisible();
		},
		async SUBMIT_WRONG(scene) {
			await scene.page.getByLabel("Email").fill("jordan@northwind.test");
			await scene.page.getByLabel("Password").fill("not-the-password");
			await button(scene.page, "Log In").click();
			await expect(scene.page.getByText("Invalid login credentials")).toBeVisible();
		},
		async FORGOT_PASSWORD(scene) {
			await scene.page.getByRole("link", { name: "Forgot password?" }).click();
			await expect(button(scene.page, "Send Reset Link")).toBeVisible();
		},
		async SEND_RESET_SLOW(scene) {
			await scene.page.getByLabel("Email").fill("jordan@northwind.test");
			await scene.hold(RESET_LINK);
			const asked = scene.page.waitForRequest(RESET_LINK);
			await button(scene.page, "Send Reset Link").click();
			await asked;
		},
		async RESET_REFUSED(scene) {
			await scene.lastHold.release();
			await expect(scene.page.getByText(/does not exist/)).toBeVisible({ timeout: 15_000 });
		},
		async SEND_RESET(scene) {
			await answer(scene.page, RESET_LINK, identityOf("maya").email);
			await scene.page.getByLabel("Email").fill(identityOf("maya").email);
			await button(scene.page, "Send Reset Link").click();
			await expect(scene.page.getByText(`We have sent an email to ${identityOf("maya").email}`)).toBeVisible();
		},
		async OPEN_BAD_RESET_LINK(scene) {
			await scene.goto("/mail/reset-password/9d8c7b6a5f4e");
			await expect(scene.page).toHaveURL(/\/mail\/reset-password$/);
			await expect(button(scene.page, "Send Reset Link")).toBeVisible();
		},
		async OPEN_RESET_LINK(scene) {
			await answer(scene.page, RESET_KEY, identityOf("maya").email);
			await scene.goto("/mail/reset-password/9d8c7b6a5f4e");
			await expect(scene.page.getByLabel("New Password")).toBeVisible();
			await expect(scene.page.getByLabel("Email")).toHaveValue(identityOf("maya").email);
		},
		async OPEN_SIGNUP_CLOSED(scene) {
			await scene.goto("/mail/signup");
			await expect(scene.page).toHaveURL(/\/mail\/login$/);
			await expect(button(scene.page, "Log In")).toBeVisible();
		},
		async SIGNUP_OPENS(scene) {
			await answer(scene.page, SIGNUP_SETTINGS, { allow_signup: 1 });
			await answer(scene.page, SIGNUP_DOMAINS, ["northwind.test"]);
			await scene.page.reload();
			await expect(scene.page.getByRole("link", { name: "New member? Create an account." })).toBeVisible();
		},
		async CREATE_ACCOUNT(scene) {
			await scene.page.getByRole("link", { name: "New member? Create an account." }).click();
			await expect(scene.page.getByLabel("First Name")).toBeVisible();
		},
		async NEXT_NAME(scene) {
			await scene.page.getByLabel("First Name").fill("Jordan");
			await scene.page.getByLabel("Last Name").fill("Lee");
			await button(scene.page, "Next").click();
			await expect(scene.page.getByLabel("Username")).toBeVisible();
		},
		async NEXT_TAKEN_USERNAME(scene) {
			await scene.page.getByLabel("Username").fill("maya");
			await button(scene.page, "Next").click();
			await expect(scene.page.getByText("Username already taken.")).toBeVisible({ timeout: 15_000 });
			await expect(scene.page.getByLabel("Username")).toBeVisible();
		},
		async NEXT_USERNAME(scene) {
			await scene.page.getByLabel("Username").fill(`jordan${Date.now().toString(36)}`);
			await button(scene.page, "Next").click();
			await expect(scene.page.getByLabel("Backup Email")).toBeVisible({ timeout: 15_000 });
		},
		async NEXT_BACKUP_EMAIL(scene) {
			await scene.page.getByLabel("Backup Email").fill("jordan.lee@gmail.com");
			await button(scene.page, "Next").click();
			await expect(button(scene.page, "Sign Up")).toBeVisible();
		},
		async SIGN_UP(scene) {
			await answer(scene.page, SIGNUP, "8e1f2a3b4c");
			await scene.page.getByLabel("Password").fill("Lantern-Harbor-42");
			await button(scene.page, "Sign Up").click();
			await expect(scene.page.getByLabel("Verification Code")).toBeVisible();
		},
		async OPEN_BAD_INVITE(scene) {
			await scene.goto("/mail/signup/4c1e0b7a9d2f");
			await expect(scene.page.getByText("This invitation link does not work")).toBeVisible();
		},
		async OPEN_INVITE(scene) {
			await openInvite(scene, false, "Join Northwind on Frappe Suite");
		},
		async OPEN_EXPIRED_INVITE(scene) {
			await openInvite(scene, true, "This invitation has expired");
		},
		async OPEN_PROFILE(scene) {
			await scene.goto(`/mail/account/${await personalAccount(scene.api)}/profile`);
			await expect(scene.page.getByText(identityOf("maya").name, { exact: true }).first()).toBeVisible();
			await expect(scene.page.getByText("Push Subscriptions")).toBeVisible();
			await expect(button(scene.page, "Log Out")).toBeVisible();
		},
		async LOG_OUT(scene) {
			await button(scene.page, "Log Out").click();
			await expect(scene.page.getByText("Are you sure you want to log out?")).toBeVisible();
		},
		async CONFIRM_LOG_OUT(scene) {
			await scene.page.getByRole("dialog").getByRole("button", { name: "Log Out" }).click();
			await expect(scene.page).toHaveURL(/\/login\?redirect-to=/, { timeout: 15_000 });
			await expect(scene.page.getByText("Login with Email Link")).toBeVisible();
		},
		async PHONE_WIDTH(scene) {
			await scene.page.setViewportSize(PHONE);
			await scene.page.reload();
			await expect(scene.page.getByText("Search", { exact: true })).toBeVisible();
		},
		async OPEN_EXCHANGES(scene) {
			await scene.goto("/mail/mail-exchanges");
			await expect(scene.page.getByText("No mail exchanges found.")).toBeVisible();
		},
		async OPEN_EXCHANGES_SLOW(scene) {
			await scene.hold(EXCHANGE_LIST);
			const asked = scene.page.waitForRequest(EXCHANGE_LIST);
			await scene.goto("/mail/mail-exchanges");
			await asked;
			await expect(scene.page.getByText("Mail Exchanges").first()).toBeVisible();
		},
		async EXCHANGES_FAIL(scene) {
			await scene.lastHold.abort(500);
			await expect(scene.page.getByText("Something went wrong").first()).toBeVisible({ timeout: 30_000 });
		},
		async OPEN_EXCHANGES_FILLED(scene) {
			await shapeExchangeList(scene.page);
			await scene.goto("/mail/mail-exchanges");
			await expect(scene.page.getByText("In Progress", { exact: true }).first()).toBeVisible();
		},
		async SHOW_EXPORTS(scene) {
			await scene.page.getByRole("tab", { name: "Export" }).click();
			await expect(scene.page.getByText("Archive Type")).toBeVisible();
			await expect(scene.page).toHaveURL(/operation=Export/);
		},
		async OPEN_RUNNING(scene) {
			await openCrashingExchange(scene, job("Mail Exchange", "7f3k9a01c", "Import", "In Progress", 4), "mail-exchanges");
		},
		// Unreachable while the exchange pages crash on render.
		async OPEN_DONE() {},
		async OPEN_FAILED() {},
		async OPEN_EXCHANGE_SLOW(scene) {
			await scene.hold(EXCHANGE);
			const asked = scene.page.waitForRequest(EXCHANGE);
			await scene.goto("/mail/mail-exchanges/7f3k9a01c");
			await asked;
		},
		async OPEN_MISSING_EXCHANGE(scene) {
			await scene.goto("/mail/mail-exchanges/9z9z9z9z9z");
			await expect(scene.page).toHaveURL(/\/mail\/mail-exchanges$/, { timeout: 15_000 });
			await expect(scene.page.getByText("No mail exchanges found.")).toBeVisible();
		},
		async BACK_BY_BREADCRUMB() {},
		async OPEN_CALENDAR_EXCHANGES(scene) {
			await shapeExchangeList(scene.page);
			await scene.goto("/mail/calendar-exchanges");
			await expect(scene.page.getByText("Calendar Exchanges").first()).toBeVisible();
			await expect(scene.page.getByText("In Progress", { exact: true }).first()).toBeVisible();
		},
		async OPEN_CONTACTS_EXCHANGES(scene) {
			await shapeExchangeList(scene.page);
			await scene.goto("/mail/contacts-exchanges");
			await expect(scene.page.getByText("Contacts Exchanges").first()).toBeVisible();
			await expect(scene.page.getByText("In Progress", { exact: true }).first()).toBeVisible();
		},
		async OPEN_CONTACTS_DONE(scene) {
			await openCrashingExchange(scene, job("Contacts Exchange", "2b8q4b02d", "Export", "Completed", 60 * 26), "contacts-exchanges");
		},
	},
});
