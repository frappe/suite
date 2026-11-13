import { expect, type Route } from "@playwright/test";
import type { Credentials } from "../../shared/auth";
import { acrossRestarts } from "../bench";
import { fillFolder, folderPath, type FolderContent } from "../content";
import { defineFlow, setupFlow } from "../flow";
import {
	DRIVE,
	type DriveNode,
	grantAccess,
	ROLE,
	row,
	sidebarLink,
	trashNode,
	uploadFile,
} from "../../drive-backed-apps/helpers/drive";
import { perScene, recreateFolder, type Scene } from "../scene";

type Event =
	| { type: "GO_ORGANIZATION" }
	| { type: "GO_SHARED" }
	| { type: "GO_SHARED_EMPTY" }
	| { type: "OPEN_SHARED_FOLDER" }
	| { type: "GO_RECENT" }
	| { type: "GO_RECENT_EMPTY" }
	| { type: "GO_STARRED" }
	| { type: "GO_STARRED_EMPTY" }
	| { type: "GO_TRASH" }
	| { type: "GO_TRASH_EMPTY" }
	| { type: "KEEP_UNSAVED_WORK" }
	| { type: "REVIEW_RECOVERY" }
	| { type: "GO_RECOVERY" }
	| { type: "OPEN_FOLDER" }
	| { type: "SHOW_GRID" }
	| { type: "NARROW" }
	| { type: "OPEN_PLACES" }
	| { type: "SIGN_IN_AS_NEW_USER" };

/**
 * Every place the Drive sidebar leads to, filled and empty. In the code the
 * place is `FilesPage.vue`'s `destination` prop, one per route in
 * `pages/routes.ts`; `concreteDestination` picks the children listing or a
 * saved view, `emptyState()` the copy, and `discovered` whether Organization
 * files and the Trash tabs show. Recovery copies is its own page,
 * `RecoveryPage.vue`, reached from `RecoveryNotice.vue`.
 */
const machine = setupFlow<Event>().createMachine({
	id: "places",
	initial: "myFiles",
	states: {
		myFiles: {
			meta: { description: "My files: the user's own root, with the sidebar's Locations and Views." },
			on: {
				GO_ORGANIZATION: "organizationMissing",
				GO_SHARED: "sharedWithMe",
				GO_RECENT: "recent",
				GO_STARRED: "starred",
				GO_TRASH: "trash",
				KEEP_UNSAVED_WORK: "recoveryNotice",
				OPEN_FOLDER: "folder",
				SIGN_IN_AS_NEW_USER: "myFilesEmpty",
			},
		},
		organizationMissing: {
			meta: { description: "Organization files at /drive/organization. This site has no Organization root, so the sidebar has no link to it, the listing query never runs, and skeleton rows stay forever." },
		},
		sharedWithMe: {
			meta: { description: "Shared with me: what other people shared, each row with its owner. The folder sits in the sharer's own files, which the user cannot read, so the row names no location." },
			on: { OPEN_SHARED_FOLDER: "sharedFolder" },
		},
		sharedFolder: {
			meta: { description: "A folder someone shared to read: the trail is the folder alone, Shared with me stays highlighted, and there is no New." },
		},
		recent: {
			meta: { description: "Recent: files the user opened, newest first, with an Opened column; folders are left out." },
		},
		starred: {
			meta: { description: "Starred: the user's starred items, each row with a star and where it lives." },
		},
		trash: {
			meta: { description: "Trash: trashed items with Empty trash. With no Organization root there are no My files / Organization tabs." },
		},
		recoveryNotice: {
			meta: { description: "My files with the notice that a document has changes that couldn't be saved, and Review." },
			on: { REVIEW_RECOVERY: "recovery" },
		},
		recovery: {
			meta: { description: "Recovery copies: work kept on this device, one row per copy, with its size and when it was kept." },
		},
		folder: {
			meta: { description: "A folder of the user's own, as a list: folders first, then files." },
			on: { SHOW_GRID: "folderGrid", NARROW: "phone" },
		},
		folderGrid: {
			meta: { description: "The same folder as a grid: a card per item, with a preview where the file has one." },
		},
		phone: {
			meta: { description: "The folder on a phone: a back button, the place as a menu title, and the grid a phone defaults to." },
			on: { OPEN_PLACES: "phonePlaces" },
		},
		phonePlaces: {
			meta: { description: "On a phone the sidebar's places open in a bottom sheet from the title." },
		},
		myFilesEmpty: {
			meta: { description: "My files for a new user: nothing yet, with the hint to use New." },
			on: {
				GO_SHARED_EMPTY: "sharedEmpty",
				GO_RECENT_EMPTY: "recentEmpty",
				GO_STARRED_EMPTY: "starredEmpty",
				GO_TRASH_EMPTY: "trashEmpty",
				GO_RECOVERY: "recoveryEmpty",
			},
		},
		sharedEmpty: {
			meta: { description: "Shared with me before anyone shared anything." },
		},
		recentEmpty: {
			meta: { description: "Recent before the user opened any file." },
		},
		starredEmpty: {
			meta: { description: "Starred before the user starred anything." },
		},
		trashEmpty: {
			meta: { description: "An empty Trash, saying how long trashed items stay." },
		},
		recoveryEmpty: {
			meta: { description: "Recovery copies when this device keeps none. Each document type (Writer, Slides) shows its own empty state, so “No recovery copies” appears twice." },
		},
	},
});

const SHARED_TITLE = "Brand assets";
/** Writer's page copy (`apps/writer/recovery/copies.ts`), as a tab that lost its connection keeps it. */
const RECOVERY_KEY = "suite:writer-recovery:";

const content = perScene<FolderContent>("places: content");
const sharedFolder = perScene<DriveNode>("places: shared folder");

/**
 * Shows the page as `user` while `scene.api` stays the actor's, so the
 * scene still cleans up its own folder. Page requests go through the other
 * user's session; their `Set-Cookie` is dropped so the actor's stays.
 */
async function showAs(scene: Scene, user: Credentials): Promise<void> {
	const other = await scene.as(user);
	const origin = new URL(scene.baseURL).origin;
	await scene.page.route(
		(url) => url.origin === origin && !url.pathname.startsWith("/assets/"),
		async (route: Route) => {
			const request = route.request();
			const { cookie: _cookie, ...headers } = await request.allHeaders();
			const response = await acrossRestarts(scene.baseURL, () =>
				other.fetch(request.url(), {
					method: request.method(),
					headers,
					data: request.postDataBuffer() ?? undefined,
					maxRedirects: 0,
				}),
			);
			const answered = response.headers();
			delete answered["set-cookie"];
			await route.fulfill({ response, headers: answered });
		},
	);
}

async function goPlace(scene: Scene, label: string, title: string): Promise<void> {
	await sidebarLink(scene.page, label).click();
	await expect(scene.page.locator("header").filter({ visible: true }).getByText(title, { exact: true })).toBeVisible();
}

async function expectEmpty(scene: Scene, title: string): Promise<void> {
	await expect(scene.page.getByText(title, { exact: true })).toBeVisible();
}

async function expectItem(scene: Scene, node: DriveNode): Promise<void> {
	await expect(row(scene.page, node.name)).toBeVisible();
}

export const places = defineFlow<Event>({
	id: "places",
	title: "Places",
	folderTitle: "Website relaunch",
	source: "frontend/src/apps/drive/files/pages/FilesPage.vue",
	machine,
	async enter(scene) {
		content.set(scene, await fillFolder(scene.api, scene.folder.name));
		await scene.goto("/drive");
		await expect(scene.page.getByRole("button", { name: /^Actions for / }).first()).toBeVisible();
	},
	events: {
		async GO_ORGANIZATION(scene) {
			await expect(sidebarLink(scene.page, "My files")).toBeVisible();
			await expect(sidebarLink(scene.page, "Organization files")).toHaveCount(0);
			await scene.goto("/drive/organization");
			await expect(scene.page.getByText("Organization files").first()).toBeVisible();
		},
		async GO_SHARED_EMPTY(scene) {
			await goPlace(scene, "Shared with me", "Shared with me");
			await expectEmpty(scene, "Nothing shared with you yet");
		},
		async GO_SHARED(scene) {
			const peer = await scene.as(scene.people.peer);
			const folder = await recreateFolder(peer, SHARED_TITLE);
			await uploadFile(peer, "Colour palette.md", Buffer.from("# Palette\n"), folder.name, "text/markdown");
			await grantAccess(peer, folder.name, scene.people.actor.email, ROLE.READ);
			sharedFolder.set(scene, folder);
			await goPlace(scene, "Shared with me", "Shared with me");
			await expectItem(scene, folder);
		},
		async OPEN_SHARED_FOLDER(scene) {
			await row(scene.page, sharedFolder.get(scene).name).click();
			await expect(scene.page.getByRole("button", { name: "Actions for Colour palette.md" })).toBeVisible();
		},
		async GO_RECENT_EMPTY(scene) {
			await goPlace(scene, "Recent", "Recent");
			await expectEmpty(scene, "No recent files");
		},
		async GO_RECENT(scene) {
			const { document, brief } = content.get(scene);
			for (const node of [brief, document]) {
				const visit = await scene.api.post(`${DRIVE}/nodes/${node.name}/visit`, { data: {} });
				expect(visit.ok()).toBe(true);
			}
			await goPlace(scene, "Recent", "Recent");
			await expectItem(scene, document);
		},
		async GO_STARRED_EMPTY(scene) {
			await goPlace(scene, "Starred", "Starred");
			await expectEmpty(scene, "No starred files");
		},
		async GO_STARRED(scene) {
			const { folders, sheet } = content.get(scene);
			for (const node of [folders[0], sheet]) {
				if (!node) continue;
				const star = await scene.api.put(`${DRIVE}/nodes/${node.name}/favourite`, { data: {} });
				expect(star.ok()).toBe(true);
			}
			await goPlace(scene, "Starred", "Starred");
			await expectItem(scene, sheet);
		},
		async GO_TRASH_EMPTY(scene) {
			await goPlace(scene, "Trash", "Trash");
			await expectEmpty(scene, "Trash is empty");
		},
		async GO_TRASH(scene) {
			const { notes, logo } = content.get(scene);
			await trashNode(scene.api, notes.name);
			await trashNode(scene.api, logo.name);
			await goPlace(scene, "Trash", "Trash");
			await expectItem(scene, logo);
		},
		async KEEP_UNSAVED_WORK(scene) {
			const { document } = content.get(scene);
			const copy = {
				node: document.name,
				title: document.title,
				savedAt: new Date().toISOString(),
				html: "<h1>Launch brief</h1><p>Goals for the relaunch, written while offline.</p>",
			};
			await scene.page.evaluate(
				([key, value]) => localStorage.setItem(key, value),
				[`${RECOVERY_KEY}${document.name}:ui-states`, JSON.stringify(copy)] as const,
			);
			await scene.page.reload();
			await expect(scene.page.getByText("1 document has changes that couldn't be saved.")).toBeVisible();
		},
		async REVIEW_RECOVERY(scene) {
			await scene.page.getByRole("button", { name: "Review" }).click();
			await expect(scene.page.getByRole("heading", { name: "Recovery copies" })).toBeVisible();
			await expect(scene.page.getByText("Launch brief").first()).toBeVisible();
		},
		async GO_RECOVERY(scene) {
			await scene.goto("/drive/recovery");
			// Each document type's section shows its own empty state, so the message appears once per type.
			await expect(scene.page.getByText("No recovery copies", { exact: true }).first()).toBeVisible();
		},
		async OPEN_FOLDER(scene) {
			await scene.goto(folderPath(scene.folder));
			await expectItem(scene, content.get(scene).logo);
		},
		async SHOW_GRID(scene) {
			await scene.page.getByRole("button", { name: "View settings" }).click();
			await scene.page.getByRole("group", { name: "View settings" }).getByRole("radio", { name: "Grid" }).click();
			await scene.page.keyboard.press("Escape");
			await expect(scene.page.getByRole("listitem").filter({ has: scene.page.getByText("Logo.png") })).toBeVisible();
			await expect(scene.page.getByRole("group", { name: "View settings" })).toBeHidden();
		},
		async NARROW(scene) {
			await scene.page.setViewportSize({ width: 390, height: 844 });
			await expect(scene.page.getByRole("button", { name: scene.folder.title })).toBeVisible();
			await expect(scene.page.getByRole("listitem").first()).toBeVisible();
		},
		async OPEN_PLACES(scene) {
			await scene.page.getByRole("button", { name: scene.folder.title }).click();
			await expect(scene.page.getByRole("dialog").getByRole("link", { name: "Shared with me" })).toBeVisible();
		},
		async SIGN_IN_AS_NEW_USER(scene) {
			await showAs(scene, scene.people.fresh);
			await scene.page.reload();
			await expectEmpty(scene, "No files yet");
		},
	},
});
