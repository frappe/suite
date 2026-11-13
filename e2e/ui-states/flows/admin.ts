import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { createFolder, uploadFile } from "../../drive-backed-apps/helpers/drive";
import type { Credentials } from "../../shared/auth";
import { frappeData } from "../../shared/frappe";
import { DEMO_URL, demoUser, openDemoScene, setSuiteCloudStandIn } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import { perScene, type BaseScene } from "../scene";

type Event =
	| { type: "OVERVIEW_SLOW" }
	| { type: "OVERVIEW_FAILS" }
	| { type: "HEALTH_FAILS" }
	| { type: "SUSPENDED" }
	| { type: "STALE" }
	| { type: "USER_COUNT_FAILS" }
	| { type: "AS_MEMBER" }
	| { type: "PHONE" }
	| { type: "OPEN_NAV" }
	| { type: "OPEN_USERS" }
	| { type: "OPEN_STORAGE" }
	| { type: "OPEN_SETTINGS" }
	| { type: "USERS_SLOW" }
	| { type: "USERS_FAIL" }
	| { type: "SEARCH_MISS" }
	| { type: "FILTER_ADMINS" }
	| { type: "OPEN_INVITATIONS" }
	| { type: "OPEN_ROW_MENU" }
	| { type: "EDIT_PROFILE" }
	| { type: "CLEAR_NAME" }
	| { type: "SAVE_SLOW" }
	| { type: "SAVE_SETTLES" }
	| { type: "MAKE_ADMIN" }
	| { type: "CONFIRM_SLOW" }
	| { type: "CONFIRM_SETTLES" }
	| { type: "DISABLE" }
	| { type: "CONFIRM_DISABLE" }
	| { type: "OPEN_DISABLED_MENU" }
	| { type: "REACTIVATE" }
	| { type: "TRANSFER" }
	| { type: "PREVIEW_UNKNOWN" }
	| { type: "PREVIEW" }
	| { type: "TICK_ACCESS" }
	| { type: "RUN_TRANSFER" }
	| { type: "DEMOTE_SELF" }
	| { type: "CONFIRM_DEMOTE_SELF" }
	| { type: "DISABLE_SELF" }
	| { type: "SELECT_TWO" }
	| { type: "BULK_DISABLE" }
	| { type: "CONFIRM_BULK" }
	| { type: "OPEN_INVITE" }
	| { type: "TYPE_EMAILS" }
	| { type: "SEND_SLOW" }
	| { type: "SEND_INVALID" }
	| { type: "SEND" }
	| { type: "STORAGE_SLOW" }
	| { type: "STORAGE_FAILS" }
	| { type: "EDIT_LIMIT" }
	| { type: "TYPE_LIMIT" }
	| { type: "TYPE_NEGATIVE" }
	| { type: "SAVE_LIMIT_SLOW" }
	| { type: "SAVE_LIMIT_SETTLES" }
	| { type: "SAVE_LIMIT_FAILS" };

/**
 * Suite Admin on a site without Suite Cloud: Overview, Users, Storage and
 * General settings. `LocalUsersView.vue` keeps its dialogs as separate refs
 * (`inviting`, `editingProfile`, `transferUser`, `lifecycleOpen`, …) and
 * opens confirms through frappe-ui's imperative `dialog.confirm`, so this
 * machine is the only place their states sit side by side. The flow turns
 * the demo site's Suite Cloud stand-in off first, in case a run that was
 * stopped during `mailAdmin` left it on.
 */
const machine = setupFlow<Event>().createMachine({
	id: "admin",
	initial: "overview",
	states: {
		overview: {
			meta: { description: "Overview on a site without Suite Cloud: one KPI, Active users, and where Drive storage goes, split into Personal and Shared. No Mail section, since Mail admin needs Suite Cloud." },
			on: {
				OVERVIEW_SLOW: "overviewSkeleton",
				OVERVIEW_FAILS: "overviewFailed",
				HEALTH_FAILS: "overviewHealthUnknown",
				SUSPENDED: "overviewSuspended",
				STALE: "overviewStale",
				USER_COUNT_FAILS: "overviewUsersFailed",
				AS_MEMBER: "memberRedirected",
				PHONE: "phoneOverview",
				OPEN_USERS: "users",
				OPEN_STORAGE: "storage",
				OPEN_SETTINGS: "settings",
			},
		},
		overviewSkeleton: {
			meta: { description: "The storage report is still loading: three placeholder KPI tiles, a storage bar and a Domains card, although on this site the loaded page has one KPI tile and no Domains card." },
		},
		overviewFailed: {
			meta: { description: "The storage report failed: only the error message shows, with no KPI, no retry and no hint of what to do." },
		},
		overviewHealthUnknown: {
			meta: { description: "The service health check failed: an amber “Could not check service status” alert sits under the KPI, even on a site that has no Suite Cloud to check." },
		},
		overviewSuspended: {
			meta: { description: "Suite Cloud reports the site suspended (response shaped in the test): a red alert under the KPI says to contact the provider." },
		},
		overviewStale: {
			meta: { description: "Suite Cloud could not be reached (response shaped in the test): an amber alert says files and mail are still available." },
		},
		overviewUsersFailed: {
			meta: { description: "The user list failed while the storage report loaded: Active users shows a dash and an amber alert at the bottom says to open Users." },
		},
		memberRedirected: {
			meta: { description: "Leo, a member, opens /admin: the router sends him to Home without a message, and Admin is not in his switcher." },
		},
		phoneOverview: {
			meta: { description: "Overview at phone width: the admin sidebar is replaced by a menu button in the header, the app switcher moves to a bottom bar, and the cards take the full width." },
			on: { OPEN_NAV: "phoneNav" },
		},
		phoneNav: {
			meta: { description: "The menu button opens a bottom sheet titled Suite Admin with Overview, Users, Storage and, under Settings, General." },
		},
		users: {
			meta: { description: "Users without Suite Cloud: everyone on the site with a status badge and an actions menu, Maya marked Admin by a shield, and Invite users at the top. There is no Storage column." },
			on: {
				USERS_SLOW: "usersSkeleton",
				USERS_FAIL: "usersFailed",
				SEARCH_MISS: "usersSearchEmpty",
				FILTER_ADMINS: "usersAdminsOnly",
				OPEN_INVITATIONS: "invitationsRoute",
				OPEN_ROW_MENU: "rowMenu",
				DEMOTE_SELF: "demoteSelfConfirm",
				DISABLE_SELF: "disableSelfRefused",
				SELECT_TWO: "usersSelected",
				OPEN_INVITE: "invite",
			},
		},
		usersSkeleton: {
			meta: { description: "The user list is loading: eight placeholder rows and a placeholder count, with search and filters already usable." },
		},
		usersFailed: {
			meta: { description: "The user list failed: “Something went wrong” above an empty table header, the count reads “0 users”, and there is no retry and no empty-state text." },
		},
		usersSearchEmpty: {
			meta: { description: "A search that matches nobody: “No users found” with a hint to change the search or filters, and “0 users”." },
		},
		usersAdminsOnly: {
			meta: { description: "The Role filter set to Admins: only Maya remains." },
		},
		invitationsRoute: {
			meta: { description: "/admin/users/invitations without Suite Cloud renders the same user list as /admin/users, with no Invitations tab and no list of pending invitations." },
		},
		rowMenu: {
			meta: { description: "A member's actions menu: Edit profile, Make Admin and Disable user. Mail actions and storage limits need Suite Cloud, so they are hidden." },
			on: { EDIT_PROFILE: "editProfile", MAKE_ADMIN: "makeAdminConfirm", DISABLE: "disableConfirm" },
		},
		editProfile: {
			meta: { description: "Edit user profile with the display name filled in." },
			on: { CLEAR_NAME: "editProfileEmpty", SAVE_SLOW: "editProfileBusy" },
		},
		editProfileEmpty: {
			meta: { description: "The display name cleared: Save turns off, with no message saying why." },
		},
		editProfileBusy: {
			meta: { description: "Save pressed and the change still out: Save spins and Cancel is off." },
			on: { SAVE_SETTLES: "profileSaved" },
		},
		profileSaved: {
			meta: { description: "The dialog closes and the row shows the new name, without a toast." },
		},
		makeAdminConfirm: {
			meta: { description: "Make Priya Shah an Admin? The confirm says this changes business administration, not Drive sharing." },
			on: { CONFIRM_SLOW: "makeAdminBusy" },
		},
		makeAdminBusy: {
			meta: { description: "Confirm pressed and the role change still out: Confirm spins inside the confirm." },
			on: { CONFIRM_SETTLES: "madeAdmin" },
		},
		madeAdmin: {
			meta: { description: "The confirm closes and Priya's row gains the Admin shield." },
		},
		disableConfirm: {
			meta: { description: "Disable Priya Shah? The confirm says sessions end while incoming Mail and data are kept, and the confirm button is not red." },
			on: { CONFIRM_DISABLE: "userDisabled" },
		},
		userDisabled: {
			meta: { description: "Priya's row shows a grey Disabled badge." },
			on: { OPEN_DISABLED_MENU: "disabledRowMenu" },
		},
		disabledRowMenu: {
			meta: { description: "A disabled user's actions: Edit profile, Make Admin, Reactivate user and Transfer Drive." },
			on: { REACTIVATE: "reactivateConfirm", TRANSFER: "transferDialog" },
		},
		reactivateConfirm: {
			meta: { description: "Reactivate Priya Shah? Access returns once the readiness checks pass." },
		},
		transferDialog: {
			meta: { description: "Transfer retained Drive content: a field for a destination folder link or ID, and Preview transfer. There is no folder picker." },
			on: { PREVIEW_UNKNOWN: "transferPreviewFailed", PREVIEW: "transferPreview" },
		},
		transferPreviewFailed: {
			meta: { description: "A destination that is not a folder: the preview fails and the error shows under the field." },
		},
		transferPreview: {
			meta: { description: "The preview: destination user, usage before and after, the item count and size, who gains access, and a confirmation box. Transfer next batch stays off until it is ticked." },
			on: { TICK_ACCESS: "transferReady" },
		},
		transferReady: {
			meta: { description: "The access change confirmed: Transfer next batch turns on." },
			on: { RUN_TRANSFER: "transferDone" },
		},
		transferDone: {
			meta: { description: "The transfer finished: “Transfer complete” and one line per moved item, listed by node ID rather than by name." },
		},
		demoteSelfConfirm: {
			meta: { description: "Maya, the only Admin, picks Demote to member on her own row: the confirm opens like any other." },
			on: { CONFIRM_DEMOTE_SELF: "demoteSelfRefused" },
		},
		demoteSelfRefused: {
			meta: { description: "The server refuses with “The last active Admin cannot be demoted or disabled”, but the page shows only “Bad Request”, three times: inside the confirm, above the user list and in a toast. The reason is lost on the way to the page." },
		},
		disableSelfRefused: {
			meta: { description: "Maya confirms disabling her own account. The server answers “You cannot disable your own account”, but the page shows only “Bad Request”, inside the confirm, above the user list and in a toast." },
		},
		usersSelected: {
			meta: { description: "Two users ticked: a bar under the list counts them and offers Reactivate selected users and Disable selected users." },
			on: { BULK_DISABLE: "bulkDisableConfirm" },
		},
		bulkDisableConfirm: {
			meta: { description: "Disable users: the explanation and “2 users selected”, with Confirm." },
			on: { CONFIRM_BULK: "bulkRefused" },
		},
		bulkRefused: {
			meta: { description: "Bulk disable goes through the Mail admin API, which needs Suite Cloud: every user fails with “Suite Cloud is not configured”, and Retry failed users can only fail again." },
		},
		invite: {
			meta: { description: "Invite users: one address per line, and Send invitations off until something is typed." },
			on: { TYPE_EMAILS: "inviteFilled", SEND_INVALID: "inviteFailed" },
		},
		inviteFilled: {
			meta: { description: "An address typed: Send invitations turns on." },
			on: { SEND_SLOW: "inviteBusy", SEND: "inviteRefused" },
		},
		inviteBusy: {
			meta: { description: "Send pressed and the invitation still out: the button spins and Cancel is off." },
		},
		inviteFailed: {
			meta: { description: "An address that is not valid: the server's message shows under the field and the dialog stays open." },
		},
		inviteRefused: {
			meta: { description: "A valid address, but the site has no outgoing email account: Frappe's admin message, “Please setup default outgoing Email Account from Tools > Email Account”, shows under the field. It points to Desk, which a Suite Admin may not have." },
		},
		inviteSent: {
			meta: {
				description: "The dialog closes on success. Unreachable here: the demo site has no outgoing email account, so every invitation is refused. Without Suite Cloud nothing on the page would list the pending invitation either.",
				transient: true,
			},
		},
		storage: {
			meta: { description: "Storage without Suite Cloud: workspace usage split into Personal and Shared, then one row per Drive root with what it stores and its limit." },
			on: { STORAGE_SLOW: "storageSkeleton", STORAGE_FAILS: "storageFailed", EDIT_LIMIT: "limitDialog" },
		},
		storageSkeleton: {
			meta: { description: "The storage report is loading: a “Where storage goes” card and placeholder rows with checkboxes under “User storage limits”. The loaded page on this site has a different layout: “Workspace storage”, then a “Drive storage” table with Drive, Used and Limit columns and no checkboxes." },
		},
		storageFailed: {
			meta: { description: "The storage report failed: only the error message shows." },
		},
		limitDialog: {
			meta: { description: "Drive storage limit for one person's Drive, opened at 0, which the description calls the workspace default." },
			on: { TYPE_LIMIT: "limitFilled", TYPE_NEGATIVE: "limitNegative" },
		},
		limitFilled: {
			meta: { description: "5 GB typed, ready to save." },
			on: { SAVE_LIMIT_SLOW: "limitBusy", SAVE_LIMIT_FAILS: "limitFailed" },
		},
		limitNegative: {
			meta: { description: "A negative limit saved: the dialog stays open with no message, because the check throws outside the mutation and nothing shows its error." },
		},
		limitBusy: {
			meta: { description: "Save pressed and the limit still out: Save spins and Cancel is off." },
			on: { SAVE_LIMIT_SETTLES: "limitSaved" },
		},
		limitSaved: {
			meta: { description: "The dialog closes and the row's Limit reads 5 GB." },
		},
		limitFailed: {
			meta: { description: "Saving the limit failed: “Something went wrong” shows inside the dialog and again in a toast, and the typed limit stays." },
		},
		settings: {
			meta: { description: "General settings, headed “Business settings”: the logo, the workspace name with a pencil that makes it editable (it saves when the field loses focus), and the site address." },
		},
	},
});

const ADMIN: Credentials = { email: "Administrator", password: "admin" };
const PHONE = { width: 390, height: 844 };

interface Extra {
	email: string;
	password: string;
	personal_root: string;
}

/** Two people made for this path: Priya, the member the actions change, and Omar, who receives her Drive. */
interface Cast {
	priya: Extra;
	omar: Extra;
	/** Administrator, on the demo site. */
	admin: APIRequestContext;
}

const casts = perScene<Cast>("admin: cast");
const memberPage = perScene<Page>("admin: member page");
const transferFolder = perScene<string>("admin: transfer folder");

/** The password the path's own users sign in with, to seed their Drives. */
const CAST_PASSWORD = "Northwind-Cast-2026!";

const CAST = [
	["Priya", "Shah"],
	["Omar", "Haddad"],
] as const;

async function storageRoots(scene: BaseScene): Promise<{ name: string; user: string | null }[]> {
	return (await frappeData<{ roots: { name: string; user: string | null }[] }>(await scene.api.get("/api/suite/storage"))).roots;
}

/** Deletes the user, which archives their Drive root, then purges the root so Storage keeps no Archived row. */
async function removeMember(scene: BaseScene, admin: APIRequestContext, email: string, root: string | undefined): Promise<void> {
	const deleted = await admin.delete(`/api/resource/User/${encodeURIComponent(email)}`);
	if (!deleted.ok() && deleted.status() !== 404) throw new Error(`admin: could not delete ${email}: ${await deleted.text()}`);
	if (root) await scene.api.delete(`/api/suite/drive/roots/${root}`);
}

/** Removes cast members an earlier path left behind when a bench restart cut its cleanup short. */
async function sweepStaleCast(scene: BaseScene, admin: APIRequestContext): Promise<void> {
	const roots = await storageRoots(scene);
	for (const [first] of CAST) {
		const filters = JSON.stringify([["name", "like", `${first.toLowerCase()}.%@northwind.test`]]);
		const stale = await frappeData<{ name: string }[]>(await admin.get("/api/resource/User", { params: { filters } }));
		for (const { name } of stale) await removeMember(scene, admin, name, roots.find((root) => root.user === name)?.name);
	}
}

/** Creates one user through Administrator and removes them, with their Drive root, when the scene closes. */
async function castMember(scene: BaseScene, admin: APIRequestContext, first: string, last: string): Promise<Extra> {
	const email = `${first.toLowerCase()}.${scene.name("x").split(" ")[1]}@northwind.test`;
	await frappeData(
		await admin.post("/api/resource/User", {
			data: { email, first_name: first, last_name: last, send_welcome_email: 0, new_password: CAST_PASSWORD, roles: [{ role: "Suite User" }] },
		}),
	);
	const root = (await storageRoots(scene)).find((candidate) => candidate.user === email)?.name;
	if (!root) throw new Error(`admin: ${email} has no Drive root`);
	scene.defer(() => removeMember(scene, admin, email, root));
	return { email, password: CAST_PASSWORD, personal_root: root };
}

async function provisionCast(scene: BaseScene): Promise<Cast> {
	const admin = await scene.as(ADMIN);
	await sweepStaleCast(scene, admin);
	const [priya, omar] = [await castMember(scene, admin, ...CAST[0]), await castMember(scene, admin, ...CAST[1])];
	return { priya, omar, admin };
}

function actionsFor(page: Page, email: string): Locator {
	return page.getByRole("button", { name: `Actions for ${email}`, exact: true });
}

async function openActions(scene: BaseScene, email: string): Promise<Locator> {
	await actionsFor(scene.page, email).click();
	const menu = scene.page.getByRole("menu");
	await expect(menu.getByRole("menuitem", { name: "Edit profile" })).toBeVisible();
	return menu;
}

async function pick(scene: BaseScene, item: string): Promise<void> {
	await scene.page.getByRole("menu").getByRole("menuitem", { name: item, exact: true }).click();
}

function userRow(page: Page, name: string): Locator {
	return page.getByRole("row").filter({ hasText: name });
}

async function reloadOverview(scene: BaseScene): Promise<void> {
	await scene.page.reload();
}

const SUITE_STORAGE = /\/api\/suite\/storage(\?|$)/;
const SUITE_USERS = /\/api\/suite\/users(\?|$)/;
const HEALTH = /\/api\/suite\/admin\/health(\?|$)/;

async function shapeHealth(scene: BaseScene, health: { suspended: boolean; stale: boolean }): Promise<void> {
	await scene.page.route(HEALTH, (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ data: { cloud: false, alerts: [], fetched_at: null, ...health } }),
		}),
	);
	await reloadOverview(scene);
}

function limitDialog(scene: BaseScene): Locator {
	return scene.dialog("Drive storage limit");
}

function limitField(scene: BaseScene): Locator {
	return limitDialog(scene).getByLabel("Storage limit (GB)");
}

export const admin = defineFlow<Event, BaseScene>({
	id: "admin",
	title: "Admin",
	source: "frontend/src/composition/admin/LocalUsersView.vue",
	open: (browser) => openDemoScene(browser),
	async prepare(browser) {
		await setSuiteCloudStandIn(browser, false);
		return undefined;
	},
	machine,
	async enter(scene) {
		casts.set(scene, await provisionCast(scene));
		await scene.goto("/admin");
		await expect(scene.page.getByRole("link", { name: /Active users/ })).toBeVisible();
		await expect(scene.page.getByText("Where storage goes")).toBeVisible();
	},
	events: {
		async OVERVIEW_SLOW(scene) {
			await scene.hold(SUITE_STORAGE);
			await reloadOverview(scene);
			await expect(scene.page.getByText("Domains", { exact: true })).toBeVisible();
		},
		async OVERVIEW_FAILS(scene) {
			const hold = await scene.hold(SUITE_STORAGE);
			await hold.abort(500);
			await reloadOverview(scene);
			await expect(scene.page.getByText("Something went wrong").first()).toBeVisible({ timeout: 30_000 });
		},
		async HEALTH_FAILS(scene) {
			const hold = await scene.hold(HEALTH);
			await hold.abort(500);
			await reloadOverview(scene);
			await expect(scene.page.getByText("Could not check service status")).toBeVisible({ timeout: 30_000 });
		},
		async SUSPENDED(scene) {
			await shapeHealth(scene, { suspended: true, stale: false });
			await expect(scene.page.getByText("This site is suspended by Suite Cloud")).toBeVisible();
		},
		async STALE(scene) {
			await shapeHealth(scene, { suspended: false, stale: true });
			await expect(scene.page.getByText("Suite Cloud could not be reached")).toBeVisible();
		},
		async USER_COUNT_FAILS(scene) {
			const hold = await scene.hold(SUITE_USERS);
			await hold.abort(500);
			await reloadOverview(scene);
			await expect(scene.page.getByText("Could not load users")).toBeVisible({ timeout: 30_000 });
		},
		async AS_MEMBER(scene) {
			const page = await scene.pageAs(demoUser("leo"));
			memberPage.set(scene, page);
			await page.goto("/admin");
			await expect(page).toHaveURL(/\/home/);
			await page.waitForLoadState("networkidle");
		},
		async PHONE(scene) {
			// The app picks its phone or desktop layout once, at load, so reload after the resize.
			await scene.page.setViewportSize(PHONE);
			await scene.page.reload();
			await expect(scene.page.getByRole("button", { name: "Open navigation" })).toBeVisible();
		},
		async OPEN_NAV(scene) {
			await scene.page.getByRole("button", { name: "Open navigation" }).click();
			await expect(scene.page.getByRole("navigation", { name: "Administration" })).toBeVisible();
		},
		async OPEN_USERS(scene) {
			await scene.page.getByRole("navigation", { name: "Administration" }).getByText("Users", { exact: true }).click();
			await expect(scene.page).toHaveURL(/\/admin\/users$/);
			await expect(actionsFor(scene.page, casts.get(scene).priya.email)).toBeVisible();
		},
		async OPEN_STORAGE(scene) {
			await scene.page.getByRole("navigation", { name: "Administration" }).getByText("Storage", { exact: true }).click();
			await expect(scene.page.getByRole("heading", { name: "Drive storage" })).toBeVisible();
			await expect(scene.page.getByText(casts.get(scene).priya.email)).toBeVisible();
		},
		async OPEN_SETTINGS(scene) {
			await scene.page.getByRole("navigation", { name: "Administration" }).getByText("General", { exact: true }).click();
			await expect(scene.page).toHaveURL(/\/admin\/settings$/);
			await expect(scene.page.getByPlaceholder("Acme Inc.")).toBeVisible();
		},
		async USERS_SLOW(scene) {
			await scene.hold(SUITE_USERS);
			await scene.page.reload();
			await expect(scene.page.getByRole("textbox", { name: "Search users" })).toBeVisible();
		},
		async USERS_FAIL(scene) {
			const hold = await scene.hold(SUITE_USERS);
			await hold.abort(500);
			await scene.page.reload();
			await expect(scene.page.getByText("Something went wrong").first()).toBeVisible({ timeout: 30_000 });
		},
		async SEARCH_MISS(scene) {
			await scene.page.getByRole("textbox", { name: "Search users" }).fill("Rosalind");
			await expect(scene.page.getByText("No users found")).toBeVisible();
		},
		async FILTER_ADMINS(scene) {
			await scene.page.getByRole("combobox", { name: "Role" }).click();
			await scene.page.getByRole("option", { name: "Admins" }).click();
			await expect(scene.page.getByText("1 users")).toBeVisible();
		},
		async OPEN_INVITATIONS(scene) {
			await scene.goto("/admin/users/invitations");
			await expect(actionsFor(scene.page, casts.get(scene).priya.email)).toBeVisible();
		},
		async OPEN_ROW_MENU(scene) {
			await openActions(scene, casts.get(scene).priya.email);
			await expect(scene.page.getByRole("menuitem", { name: "Disable user" })).toBeVisible();
		},
		async EDIT_PROFILE(scene) {
			await pick(scene, "Edit profile");
			await expect(scene.dialog("Edit user profile").getByLabel("Display name")).toHaveValue("Priya Shah");
		},
		async CLEAR_NAME(scene) {
			const dialog = scene.dialog("Edit user profile");
			await dialog.getByLabel("Display name").fill("");
			await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
		},
		async SAVE_SLOW(scene) {
			const dialog = scene.dialog("Edit user profile");
			await dialog.getByLabel("Display name").fill("Priya Shah-Rao");
			await scene.hold(SUITE_USERS);
			const sent = scene.page.waitForRequest((r) => r.method() === "PATCH" && SUITE_USERS.test(r.url()));
			await dialog.getByRole("button", { name: "Save" }).click();
			await sent;
			await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
		},
		async SAVE_SETTLES(scene) {
			await scene.lastHold.release();
			await expect(scene.page.getByRole("dialog")).toHaveCount(0);
			await expect(scene.page.getByText("Priya Shah-Rao")).toBeVisible();
		},
		async MAKE_ADMIN(scene) {
			await pick(scene, "Make Admin");
			await expect(scene.dialog("Make Priya Shah an Admin?")).toBeVisible();
		},
		async CONFIRM_SLOW(scene) {
			await scene.hold(SUITE_USERS);
			const sent = scene.page.waitForRequest((r) => r.method() === "PATCH" && SUITE_USERS.test(r.url()));
			await scene.dialog("Make Priya Shah an Admin?").getByRole("button", { name: "Confirm" }).click();
			await sent;
		},
		async CONFIRM_SETTLES(scene) {
			await scene.lastHold.release();
			await expect(scene.page.getByRole("dialog")).toHaveCount(0);
			await expect(userRow(scene.page, "Priya Shah").getByRole("img", { name: "Admin" })).toBeVisible();
		},
		async DISABLE(scene) {
			await pick(scene, "Disable user");
			await expect(scene.dialog("Disable Priya Shah?")).toBeVisible();
		},
		async CONFIRM_DISABLE(scene) {
			// While Priya can still sign in, she leaves a file behind; Omar gets a folder to receive it.
			const { priya, omar } = casts.get(scene);
			await uploadFile(await scene.as(priya), "Handover notes.md", Buffer.from("# Handover\n\nOpen accounts and who to call.\n"), priya.personal_root, "text/markdown");
			transferFolder.set(scene, (await createFolder(await scene.as(omar), "From Priya", omar.personal_root)).name);
			await scene.dialog("Disable Priya Shah?").getByRole("button", { name: "Confirm" }).click();
			await expect(scene.page.getByRole("dialog")).toHaveCount(0);
			await expect(userRow(scene.page, "Priya Shah").getByText("Disabled")).toBeVisible();
		},
		async OPEN_DISABLED_MENU(scene) {
			await openActions(scene, casts.get(scene).priya.email);
			await expect(scene.page.getByRole("menuitem", { name: "Transfer Drive" })).toBeVisible();
		},
		async REACTIVATE(scene) {
			await pick(scene, "Reactivate user");
			await expect(scene.dialog("Reactivate Priya Shah?")).toBeVisible();
		},
		async TRANSFER(scene) {
			await pick(scene, "Transfer Drive");
			await expect(scene.dialog("Transfer retained Drive content").getByLabel("Destination folder")).toBeVisible();
		},
		async PREVIEW_UNKNOWN(scene) {
			const dialog = scene.dialog("Transfer retained Drive content");
			await dialog.getByLabel("Destination folder").fill("no-such-folder");
			await dialog.getByRole("button", { name: "Preview transfer" }).click();
			await expect(dialog.getByRole("button", { name: "Preview transfer" })).toBeEnabled();
			await expect(dialog.locator(".text-ink-red-4, [role=alert], .text-ink-red-6, .text-ink-red-5").first()).toBeVisible({ timeout: 30_000 });
		},
		async PREVIEW(scene) {
			const dialog = scene.dialog("Transfer retained Drive content");
			await dialog.getByLabel("Destination folder").fill(`${scene.baseURL}/drive/f/${transferFolder.get(scene)}`);
			await dialog.getByRole("button", { name: "Preview transfer" }).click();
			await expect(dialog.getByLabel("I confirm the destination access changes")).toBeVisible();
		},
		async TICK_ACCESS(scene) {
			const dialog = scene.dialog("Transfer retained Drive content");
			await dialog.getByLabel("I confirm the destination access changes").check();
			await expect(dialog.getByRole("button", { name: "Transfer next batch" })).toBeEnabled();
		},
		async RUN_TRANSFER(scene) {
			const dialog = scene.dialog("Transfer retained Drive content");
			await dialog.getByRole("button", { name: "Transfer next batch" }).click();
			await expect(dialog.getByText(/Transfer complete|retained nodes remain/)).toBeVisible({ timeout: 30_000 });
		},
		async DEMOTE_SELF(scene) {
			await openActions(scene, "maya@northwind.test");
			await pick(scene, "Demote to member");
			await expect(scene.dialog("Demote Maya Chen?")).toBeVisible();
		},
		async CONFIRM_DEMOTE_SELF(scene) {
			const dialog = scene.dialog("Demote Maya Chen?");
			await dialog.getByRole("button", { name: "Confirm" }).click();
			await expect(dialog.getByRole("alert")).toBeVisible();
		},
		async DISABLE_SELF(scene) {
			await openActions(scene, "maya@northwind.test");
			await pick(scene, "Disable user");
			const dialog = scene.dialog("Disable Maya Chen?");
			await dialog.getByRole("button", { name: "Confirm" }).click();
			await expect(dialog.getByRole("alert")).toBeVisible();
		},
		async SELECT_TWO(scene) {
			for (const name of ["Priya Shah", "Omar Haddad"]) await userRow(scene.page, name).getByRole("checkbox").check();
			await expect(scene.page.getByText("2 selected")).toBeVisible();
		},
		async BULK_DISABLE(scene) {
			await scene.page.getByRole("button", { name: "Disable selected users" }).click();
			await expect(scene.dialog("Disable users").getByText("2 users selected")).toBeVisible();
		},
		async CONFIRM_BULK(scene) {
			const dialog = scene.dialog("Disable users");
			await dialog.getByRole("button", { name: "Confirm" }).click();
			await expect(dialog.getByRole("button", { name: "Retry failed users" })).toBeVisible();
		},
		async OPEN_INVITE(scene) {
			await scene.page.getByRole("button", { name: "Invite users" }).click();
			await expect(scene.dialog("Invite users").getByRole("button", { name: "Send invitations" })).toBeDisabled();
		},
		async TYPE_EMAILS(scene) {
			const dialog = scene.dialog("Invite users");
			await dialog.getByLabel("Email addresses").fill(inviteAddress(scene));
			await expect(dialog.getByRole("button", { name: "Send invitations" })).toBeEnabled();
		},
		async SEND_SLOW(scene) {
			await scene.hold("**/api/suite/invitations");
			const sent = scene.page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/suite/invitations"));
			await scene.dialog("Invite users").getByRole("button", { name: "Send invitations" }).click();
			await sent;
			await expect(scene.dialog("Invite users").getByRole("button", { name: "Cancel" })).toBeDisabled();
		},
		async SEND_INVALID(scene) {
			const dialog = scene.dialog("Invite users");
			await dialog.getByLabel("Email addresses").fill("dana.whitfield@");
			await dialog.getByRole("button", { name: "Send invitations" }).click();
			await expect(dialog.getByText(/not a valid Email Address/)).toBeVisible();
		},
		async SEND(scene) {
			const dialog = scene.dialog("Invite users");
			await dialog.getByRole("button", { name: "Send invitations" }).click();
			await expect(dialog.getByText(/outgoing Email Account/)).toBeVisible();
		},
		async STORAGE_SLOW(scene) {
			await scene.hold(SUITE_STORAGE);
			await scene.page.reload();
			await expect(scene.page.getByText("User storage limits")).toBeVisible();
		},
		async STORAGE_FAILS(scene) {
			const hold = await scene.hold(SUITE_STORAGE);
			await hold.abort(500);
			await scene.page.reload();
			await expect(scene.page.getByText("Something went wrong").first()).toBeVisible({ timeout: 30_000 });
		},
		async EDIT_LIMIT(scene) {
			await scene.page.getByRole("button", { name: `Edit storage limit for ${casts.get(scene).priya.email}` }).click();
			await expect(limitField(scene)).toHaveValue("0");
		},
		async TYPE_LIMIT(scene) {
			await limitField(scene).fill("5");
			await expect(limitField(scene)).toHaveValue("5");
		},
		async TYPE_NEGATIVE(scene) {
			await limitField(scene).fill("-5");
			await limitDialog(scene).getByRole("button", { name: "Save" }).click();
			await expect(limitDialog(scene)).toBeVisible();
		},
		async SAVE_LIMIT_SLOW(scene) {
			await scene.hold(`**/api/suite/drive/roots/${casts.get(scene).priya.personal_root}`);
			const sent = scene.page.waitForRequest((r) => r.method() === "PATCH" && r.url().includes("/api/suite/drive/roots/"));
			await limitDialog(scene).getByRole("button", { name: "Save" }).click();
			await sent;
			await expect(limitDialog(scene).getByRole("button", { name: "Cancel" })).toBeDisabled();
		},
		async SAVE_LIMIT_SETTLES(scene) {
			await scene.lastHold.release();
			await expect(scene.page.getByRole("dialog")).toHaveCount(0);
			await expect(scene.page.getByRole("row").filter({ hasText: casts.get(scene).priya.email }).getByText("5 GB")).toBeVisible();
		},
		async SAVE_LIMIT_FAILS(scene) {
			const hold = await scene.hold(`**/api/suite/drive/roots/${casts.get(scene).priya.personal_root}`);
			await hold.abort(500);
			await limitDialog(scene).getByRole("button", { name: "Save" }).click();
			await expect(limitDialog(scene).getByText("Something went wrong")).toBeVisible({ timeout: 30_000 });
		},
	},
	settle: {
		async userDisabled(scene) {
			await expect(scene.page.getByRole("menu")).toHaveCount(0);
		},
	},
	frame(scene, state) {
		return state === "memberRedirected" ? memberPage.get(scene).locator("body") : null;
	},
});

function inviteAddress(scene: BaseScene): string {
	return `dana.whitfield.${scene.name("x").split(" ")[1]}@example.test`;
}
