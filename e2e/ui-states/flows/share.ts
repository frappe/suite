import { expect, type Locator, type Page } from "@playwright/test";
import { setup } from "xstate";
import { folderPath } from "../content";
import { defineFlow } from "../flow";
import {
	createFolder,
	grantAccess,
	openRowMenu,
	ROLE,
	type DriveNode,
} from "../../drive-backed-apps/helpers/drive";
import { loginViaApi } from "../../shared/auth";
import type { Hold, Scene } from "../scene";

type Event =
	| { type: "LOADS" }
	| { type: "FAILS" }
	| { type: "TYPE_NAME" }
	| { type: "PICK" }
	| { type: "SHARE" }
	| { type: "CLOSE" }
	| { type: "OPEN_ROW_MENU" }
	| { type: "SET_EXPIRY" }
	| { type: "SAVE_FAILS" }
	| { type: "ORGANIZATION_ON" }
	| { type: "CONFIRM_OWN" }
	| { type: "PUBLIC_ON" }
	| { type: "NEW_LINK" }
	| { type: "CREATE" }
	| { type: "DONE" }
	| { type: "SET_PASSWORD" }
	| { type: "OPEN_INHERITED" }
	| { type: "DENY_HERE" }
	| { type: "REMOVE_PERSON" }
	| { type: "OPEN_AS_MANAGER" }
	| { type: "LOWER_OWN" }
	| { type: "CONFIRM" };

/**
 * The share dialog from its first paint to every row, picker, link and
 * inherited form. In the code this is `ShareBody.vue`'s v-if chain over
 * `useShare.ts` refs (`node`, `loadError`, `canManage`), the picker's `staged`
 * list, `creatingLink`, the inline `editing` form and per-row `errors`.
 */
const machine = setup({ types: { events: {} as Event } }).createMachine({
	id: "share",
	initial: "loading",
	states: {
		loading: {
			meta: { description: "Grants still loading: skeleton rows under Who has access." },
			on: { LOADS: "ready", FAILS: "loadError" },
		},
		loadError: {
			meta: { description: "The grants read failed: what failed, the server's message and a Retry that reads again." },
		},
		ready: {
			meta: { description: "Owner first, then people, everyone in the organization, web access, with the picker on top." },
			on: {
				TYPE_NAME: "pickerTyping",
				OPEN_ROW_MENU: "rowMenu",
				SAVE_FAILS: "rowError",
				ORGANIZATION_ON: "organizationLowersOwn",
				PUBLIC_ON: "publicOn",
				NEW_LINK: "linkDialog",
				OPEN_INHERITED: "organizationInherited",
				OPEN_AS_MANAGER: "managerReady",
			},
		},
		pickerTyping: {
			meta: { description: "A name typed in the picker: matching people and groups drop down." },
			on: { PICK: "pickerPicked" },
		},
		pickerPicked: {
			meta: { description: "A person picked and waiting: role select, Notify by email, Cancel and Share; the access list steps aside." },
			on: { SHARE: "personAdded", CLOSE: "discardConfirm" },
		},
		discardConfirm: {
			meta: { description: "Closing with someone picked but not added asks before discarding them." },
		},
		personAdded: {
			meta: { description: "The person shared with now has their own row, with the role chosen." },
		},
		rowMenu: {
			meta: { description: "A person's row menu: the roles inline with the current one ticked, then Set expiry, Remove and, on a folder, Remove here and inside." },
			on: { SET_EXPIRY: "expiryEditor" },
		},
		expiryEditor: {
			meta: { description: "Set expiry opens an inline date field with Save and Cancel under the row." },
		},
		rowError: {
			meta: { description: "A role change the server refused: the message shows under that row, and the transport's toast repeats it." },
		},
		organizationLowersOwn: {
			meta: { description: "The owner sets Everyone to View: the org's row would sit nearer than the owner's root grant, so “Change your own access?” warns they will only be able to view it." },
			on: { CONFIRM_OWN: "ownerLostManage" },
		},
		ownerLostManage: {
			meta: { description: "The owner confirmed: they now hold View on their own folder and the dialog says they can no longer share it." },
		},
		organizationOn: {
			meta: {
				description: "Everyone in the organization at View with the owner still managing. Unreachable from the owner's own folder: see organizationLowersOwn.",
				transient: true,
			},
		},
		publicOn: {
			meta: { description: "Public on the web switched on: anyone can view everything in the folder." },
		},
		linkDialog: {
			meta: { description: "Create share link: access, expiry a month out, and a password." },
			on: { CREATE: "linkCreated" },
		},
		linkCreated: {
			meta: { description: "Link created: its URL in one row with Copy link as the only action." },
			on: { DONE: "linkRow" },
		},
		linkRow: {
			meta: { description: "Back in the dialog, the link listed last with its expiry and password." },
			on: { SET_PASSWORD: "passwordEditor" },
		},
		passwordEditor: {
			meta: { description: "Change password opens an inline password field under the link row." },
		},
		organizationInherited: {
			meta: { description: "A folder inside a shared one: the organization and a person reach it via the parent, greyed with a via chip." },
			on: { DENY_HERE: "organizationDenied", REMOVE_PERSON: "notice" },
		},
		organizationDenied: {
			meta: { description: "Deny access here: the organization row reads Denied here, with Allow again in its menu." },
		},
		notice: {
			meta: { description: "Removing someone who keeps access from the parent says so in a notice." },
		},
		managerReady: {
			meta: { description: "A person with Manage of their own opens the dialog: their own row carries a menu." },
			on: { LOWER_OWN: "lowerOwnAccessConfirm" },
		},
		lowerOwnAccessConfirm: {
			meta: { description: "Lowering their own role asks first: “Change your own access?” says what they will still be able to do." },
			on: { CONFIRM: "managerLostManage" },
		},
		managerLostManage: {
			meta: { description: "After giving Manage away: the dialog says they can no longer share it and only managers see who has access." },
		},
		cannotManage: {
			meta: {
				description: "Someone with Edit but not Manage opens Share. Unreachable: Share is hidden without Manage (nodeActions.ts, session canShare); only managerLostManage and ownerLostManage show this body.",
				transient: true,
			},
		},
	},
});

interface Seeded {
	launch: DriveNode;
	agency: DriveNode;
	handover: DriveNode;
}

const seeded = new WeakMap<Scene, Seeded>();
const holds = new WeakMap<Scene, Hold>();
const managers = new WeakMap<Scene, Page>();
const MANAGER_STATES = new Set(["managerReady", "lowerOwnAccessConfirm", "managerLostManage"]);

const GRANTS = "**/api/suite/drive/nodes/*/grants*";
/** One principal's grant write; the grants list and explain reads carry no principal path. */
const GRANT_WRITE = /\/api\/suite\/drive\/nodes\/[^/]+\/grants\/[^?]+/;

function seed(scene: Scene): Seeded {
	const found = seeded.get(scene);
	if (!found) throw new Error("share: the scene has no content");
	return found;
}

function dialog(page: Page): Locator {
	return page.getByRole("dialog").filter({ hasText: "Share" }).first();
}

function accessButton(page: Page, name: string | RegExp): Locator {
	const label = typeof name === "string" ? new RegExp(`^Access for ${name}`) : name;
	return dialog(page).getByRole("button", { name: label });
}

async function openShare(page: Page, title: string): Promise<Locator> {
	const menu = await openRowMenu(page, title);
	await menu.getByRole("menuitem", { name: "Share", exact: true }).click();
	const shown = dialog(page);
	await expect(shown).toBeVisible();
	return shown;
}

async function expectReady(page: Page): Promise<void> {
	await expect(dialog(page).getByRole("heading", { name: "Who has access" })).toBeVisible();
}

async function chooseRole(page: Page, label: string): Promise<void> {
	await page.getByRole("menuitem", { name: label, exact: true }).click();
}

/** A second browser signed in as the peer, closed with the scene's own context. */
async function managerPage(scene: Scene): Promise<Page> {
	const browser = scene.context.browser();
	if (!browser) throw new Error("share: the scene has no browser");
	const context = await browser.newContext({
		baseURL: scene.baseURL,
		viewport: { width: 1440, height: 900 },
		colorScheme: "light",
	});
	scene.context.once("close", () => void context.close());
	await loginViaApi(context.request, scene.people.peer);
	const page = await context.newPage();
	managers.set(scene, page);
	return page;
}

export const share = defineFlow<Event>({
	id: "share",
	title: "Share dialog",
	folderTitle: "Partner portal",
	source: "frontend/src/apps/drive/files/features/share/",
	machine,
	async enter(scene) {
		const { api, people } = scene;
		const launch = await createFolder(api, "Launch plan", scene.folder.name);
		await grantAccess(api, launch.name, people.peer.email, ROLE.EDIT);
		const agency = await createFolder(api, "Agency", scene.folder.name);
		// The org's row sits nearer than the owner's root grant and would win (§5.3), so the owner holds Manage here too.
		await grantAccess(api, agency.name, people.actor.email, ROLE.MANAGE);
		await grantAccess(api, agency.name, "$GENERAL", ROLE.READ);
		await grantAccess(api, agency.name, people.fresh.email, ROLE.READ);
		const pressKit = await createFolder(api, "Press kit", agency.name);
		await grantAccess(api, pressKit.name, people.actor.email, ROLE.MANAGE);
		await grantAccess(api, pressKit.name, people.fresh.email, ROLE.EDIT);
		const handover = await createFolder(api, "Handover", scene.folder.name);
		await grantAccess(api, handover.name, people.peer.email, ROLE.MANAGE);
		seeded.set(scene, { launch, agency, handover });
		await scene.goto(folderPath(scene.folder));
		holds.set(scene, await scene.hold(GRANTS));
		await openShare(scene.page, "Launch plan");
		await expect(dialog(scene.page).getByLabel("Loading who has access")).toBeVisible();
	},
	frame(scene, state) {
		const manager = managers.get(scene);
		return manager && MANAGER_STATES.has(state) ? manager.locator("body") : null;
	},
	events: {
		async LOADS(scene) {
			await holds.get(scene)?.release();
			await expectReady(scene.page);
			await expect(accessButton(scene.page, "Arjun Mehta")).toBeVisible();
		},
		async FAILS(scene) {
			await holds.get(scene)?.abort(417);
			await expect(dialog(scene.page).getByText("Something went wrong")).toBeVisible();
		},
		async TYPE_NAME(scene) {
			await dialog(scene.page).getByRole("combobox", { name: "Add people, groups or emails" }).fill("Sana");
			await expect(scene.page.getByRole("option", { name: /Sana Iqbal/ }).first()).toBeVisible();
		},
		async PICK(scene) {
			await scene.page.getByRole("option", { name: /Sana Iqbal/ }).first().click();
			await expect(dialog(scene.page).getByRole("list", { name: "People to add" })).toBeVisible();
			await expect(dialog(scene.page).getByRole("button", { name: "Share", exact: true })).toBeVisible();
		},
		async SHARE(scene) {
			await dialog(scene.page).getByRole("button", { name: "Share", exact: true }).click();
			await expect(accessButton(scene.page, "Sana Iqbal")).toBeVisible();
		},
		async CLOSE(scene) {
			await scene.page.keyboard.press("Escape");
			await expect(scene.page.getByText("Discard 1 person?")).toBeVisible();
		},
		async OPEN_ROW_MENU(scene) {
			await accessButton(scene.page, "Arjun Mehta").click();
			await expect(scene.page.getByRole("menuitem", { name: "Comment", exact: true })).toBeVisible();
			await expect(scene.page.getByRole("menuitem", { name: "Remove", exact: true })).toBeVisible();
		},
		async SET_EXPIRY(scene) {
			await scene.page.getByRole("menuitem", { name: "Set expiry" }).click();
			await expect(dialog(scene.page).getByRole("button", { name: "Save" })).toBeVisible();
		},
		async SAVE_FAILS(scene) {
			holds.set(scene, await scene.hold(GRANT_WRITE));
			await holds.get(scene)?.abort(417);
			await accessButton(scene.page, "Arjun Mehta").click();
			await chooseRole(scene.page, "Comment");
			await expect(dialog(scene.page).getByText("Something went wrong")).toBeVisible();
			await expect(accessButton(scene.page, "Arjun Mehta")).toHaveText(/Edit/);
		},
		async ORGANIZATION_ON(scene) {
			await accessButton(scene.page, /^Access for Everyone/).click();
			await chooseRole(scene.page, "View");
			await expect(scene.page.getByText("Change your own access?")).toBeVisible();
		},
		async CONFIRM_OWN(scene) {
			await scene.page.getByRole("button", { name: "Change", exact: true }).click();
			await expect(scene.page.getByText("You can no longer share this item.")).toBeVisible();
		},
		async PUBLIC_ON(scene) {
			await dialog(scene.page).getByRole("switch", { name: "Public on the web" }).click();
			await expect(dialog(scene.page).getByText("Anyone can view everything in it")).toBeVisible();
		},
		async NEW_LINK(scene) {
			await dialog(scene.page).getByRole("button", { name: "Sharing options" }).click();
			await scene.page.getByRole("menuitem", { name: "Create share link" }).click();
			const link = scene.page.getByRole("dialog", { name: "Create share link" });
			await expect(link).toBeVisible();
			await link.getByRole("switch", { name: "Password protected" }).click();
			await link.locator("input[type=password]").fill("relaunch-2026");
			await expect(link.getByRole("button", { name: "Create link" })).toBeEnabled();
		},
		async CREATE(scene) {
			const link = scene.page.getByRole("dialog", { name: "Create share link" });
			await link.getByRole("button", { name: "Create link" }).click();
			const created = scene.page.getByRole("dialog", { name: "Link created" });
			await expect(created.getByRole("button", { name: "Copy link" })).toBeVisible();
		},
		async DONE(scene) {
			const link = scene.page.getByRole("dialog", { name: "Link created" });
			await link.getByRole("button", { name: "Close" }).click();
			await expect(link).toBeHidden();
			await expect(dialog(scene.page).getByText(/Password set/)).toBeVisible();
		},
		async SET_PASSWORD(scene) {
			await accessButton(scene.page, /^Access for Anyone with this link/).click();
			await scene.page.getByRole("menuitem", { name: "Change password" }).click();
			await expect(dialog(scene.page).getByLabel("Link password")).toBeVisible();
		},
		async OPEN_INHERITED(scene) {
			await scene.page.keyboard.press("Escape");
			await expect(dialog(scene.page)).toBeHidden();
			await scene.goto(folderPath(seed(scene).agency));
			await openShare(scene.page, "Press kit");
			await expect(dialog(scene.page).getByText("via Agency").first()).toBeVisible();
		},
		async DENY_HERE(scene) {
			await accessButton(scene.page, /^Access for Everyone/).click();
			await scene.page.getByRole("menuitem", { name: "Deny access here" }).click();
			await expect(accessButton(scene.page, /^Access for Everyone.*Denied/)).toBeVisible();
		},
		async REMOVE_PERSON(scene) {
			await accessButton(scene.page, /^Access for Sana Iqbal: Edit/).click();
			await scene.page.getByRole("menuitem", { name: "Remove", exact: true }).click();
			await expect(dialog(scene.page).getByRole("status")).toContainText("still has access");
		},
		async OPEN_AS_MANAGER(scene) {
			const page = await managerPage(scene);
			await page.goto("/drive/shared-with-me");
			await openShare(page, "Handover");
			await expectReady(page);
			await expect(accessButton(page, "Arjun Mehta")).toBeVisible();
		},
		async LOWER_OWN(scene) {
			const page = managers.get(scene);
			if (!page) throw new Error("share: no manager page");
			await accessButton(page, "Arjun Mehta").click();
			await chooseRole(page, "Edit");
			await expect(page.getByText("Change your own access?")).toBeVisible();
		},
		async CONFIRM(scene) {
			const page = managers.get(scene);
			if (!page) throw new Error("share: no manager page");
			await page.getByRole("button", { name: "Change", exact: true }).click();
			await expect(page.getByText("You can no longer share this item.")).toBeVisible();
		},
	},
});
