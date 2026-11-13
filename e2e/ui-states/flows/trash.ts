import { expect, type Locator } from "@playwright/test";
import { fixture } from "../content";
import { defineFlow, setupFlow } from "../flow";
import {
	createFolder,
	openRowMenu,
	trashNode,
	uploadFile,
} from "../../drive-backed-apps/helpers/drive";
import { WORKSPACE_FOLDER, type Scene } from "../scene";

type Event =
	| { type: "ITEMS_TRASHED" }
	| { type: "ROW_MENU" }
	| { type: "RESTORE" }
	| { type: "RESTORE_FAILS" }
	| { type: "RETRY" }
	| { type: "RESTORE_ORPHAN" }
	| { type: "RESTORE_HERE" }
	| { type: "DELETE_FOREVER" }
	| { type: "CONFIRM_DELETE" }
	| { type: "EMPTY_TRASH" }
	| { type: "CONFIRM_EMPTY" }
	| { type: "OPEN_TRASHED_FOLDER" }
	| { type: "OPEN_TRASHED_EMPTY" };

/**
 * Trash from empty to restored, deleted and emptied, and a trashed folder
 * opened read-only. In the code this is `useTrashActions.ts`'s `pending`,
 * `outcome` and `verb`, the `presentDialog` for a restore whose folder is
 * gone, the shared `confirm()` dialog, and `FilesPage.vue`'s `trashTabs`,
 * `trashedFolder` and `trashedNotice`.
 */
const machine = setupFlow<Event>().createMachine({
	id: "trash",
	initial: "trashEmpty",
	states: {
		trashEmpty: {
			meta: { description: "Nothing in Trash: the empty state says how long items stay. Empty trash stays, disabled." },
			on: { ITEMS_TRASHED: "trashListing" },
		},
		trashListing: {
			meta: { description: "Trashed folders and files, newest first, with Owner and Modified columns; no column says when each was trashed. An item whose folder is also in Trash is listed on its own." },
			on: {
				ROW_MENU: "trashRowMenu",
				RESTORE: "restoreToast",
				RESTORE_FAILS: "restoreFailedToast",
				RESTORE_ORPHAN: "restoreDestinationDialog",
				DELETE_FOREVER: "deleteForeverConfirm",
				EMPTY_TRASH: "emptyTrashConfirm",
				OPEN_TRASHED_FOLDER: "trashedFolderNotice",
				OPEN_TRASHED_EMPTY: "trashedFolderEmpty",
			},
		},
		trashRowMenu: {
			meta: { description: "A trashed row's menu: what Trash allows, ending in Restore and Delete forever." },
		},
		organizationTrash: {
			meta: {
				description: "Not on this site: it has no Organization root, so `trashTabs` is false and Trash shows no My files / Organization files tabs.",
				transient: true,
			},
		},
		restoreToast: {
			meta: { description: "Restore: the row leaves Trash and a toast offers Undo, which moves it back." },
		},
		restoreFailedToast: {
			meta: { description: "The restore request failed: an error toast with Retry, and the row stays." },
			on: { RETRY: "restoreToast" },
		},
		restoreDestinationDialog: {
			meta: { description: "The item's folder is in Trash too, so Restore asks where to put it, inside the same root. The copy says the folder is gone, though it is only in Trash." },
			on: { RESTORE_HERE: "restoredElsewhere" },
		},
		restoredElsewhere: {
			meta: { description: "Restored into the folder the user picked: the same toast with Undo." },
		},
		deleteForeverConfirm: {
			meta: { description: "Delete forever asks first: it cannot be undone." },
			on: { CONFIRM_DELETE: "deletedToast" },
		},
		deletedToast: {
			meta: { description: "Deleted forever: the row leaves and a toast without Undo says so." },
		},
		emptyTrashConfirm: {
			meta: { description: "Empty trash asks first: everything in this root's Trash goes forever." },
			on: { CONFIRM_EMPTY: "emptiedToast" },
		},
		emptiedToast: {
			meta: { description: "Trash emptied: the empty state returns and a toast counts what went." },
		},
		trashedFolderNotice: {
			meta: { description: "A trashed folder opened from Trash: the trail starts at Trash, an alert offers Restore and Delete forever, and there is no New." },
		},
		trashedFolderEmpty: {
			meta: { description: "A trashed folder that held nothing: the empty state says it was empty when it was moved to Trash." },
		},
	},
});

const logo = fixture("Logo.png");

async function seed(scene: Scene): Promise<void> {
	const { api } = scene;
	const parent = scene.folder.name;
	const folder = await createFolder(api, "Old campaign", parent);
	await uploadFile(api, "Banner.png", logo, folder.name, "image/png");
	await uploadFile(api, "Copy deck.md", Buffer.from("# Copy deck\n"), folder.name, "text/markdown");
	const emptyFolder = await createFolder(api, "Unused assets", parent);
	const release = await uploadFile(api, "Press release v1.md", Buffer.from("# Press release\n"), parent, "text/markdown");
	const retired = await createFolder(api, "Retired", parent);
	const orphan = await uploadFile(api, "Kickoff notes.md", Buffer.from("# Kickoff\n"), retired.name, "text/markdown");
	await trashNode(api, orphan.name);
	await trashNode(api, retired.name);
	for (const node of [folder, emptyFolder, release]) await trashNode(api, node.name);
}

function actionsFor(scene: Scene, title: string): Locator {
	return scene.page.getByRole("button", { name: `Actions for ${title}`, exact: true });
}

export const trash = defineFlow<Event>({
	id: "trash",
	title: "Trash",
	folderTitle: "Office move",
	source: "frontend/src/apps/drive/files/features/trash/useTrashActions.ts",
	machine,
	async enter(scene) {
		await scene.goto("/drive/trash");
		await expect(scene.page.getByRole("searchbox", { name: "Search all files" })).toBeVisible();
	},
	settle: {
		async trashEmpty(scene) {
			await expect(scene.page.getByText("Trash is empty")).toBeVisible();
		},
	},
	events: {
		async ITEMS_TRASHED(scene) {
			await seed(scene);
			await scene.page.reload();
			await expect(actionsFor(scene, "Press release v1.md")).toBeVisible();
			await expect(actionsFor(scene, "Kickoff notes.md")).toBeVisible();
		},
		async ROW_MENU(scene) {
			const menu = await openRowMenu(scene.page, "Press release v1.md");
			await expect(menu.getByRole("menuitem", { name: "Delete forever" })).toBeVisible();
		},
		async RESTORE(scene) {
			await scene.rowAction("Press release v1.md", "Restore");
			await expect(scene.toast("Restored “Press release v1.md”")).toBeVisible();
			await expect(actionsFor(scene, "Press release v1.md")).toBeHidden();
		},
		async RESTORE_FAILS(scene) {
			const hold = await scene.hold("**/api/suite/drive/nodes/batch");
			await hold.abort(500);
			await scene.rowAction("Press release v1.md", "Restore");
			await expect(scene.page.getByRole("button", { name: "Retry" })).toBeVisible();
		},
		async RETRY(scene) {
			await scene.lastHold.release();
			await scene.page.getByRole("button", { name: "Retry" }).click();
			await expect(scene.toast("Restored “Press release v1.md”")).toBeVisible();
			await expect(actionsFor(scene, "Press release v1.md")).toBeHidden();
		},
		async RESTORE_ORPHAN(scene) {
			await scene.rowAction("Kickoff notes.md", "Restore");
			const picker = scene.dialog("Restore to");
			await expect(picker.getByText("The folder this item was in is gone.", { exact: false })).toBeVisible();
			await expect(picker.getByRole("button", { name: WORKSPACE_FOLDER, exact: true })).toBeVisible();
		},
		async RESTORE_HERE(scene) {
			const picker = scene.dialog("Restore to");
			await picker.getByRole("button", { name: WORKSPACE_FOLDER, exact: true }).click();
			await expect(picker.getByRole("button", { name: scene.folder.title, exact: true })).toBeVisible();
			await picker.getByRole("button", { name: scene.folder.title, exact: true }).click();
			await expect(picker.getByRole("list", { name: `Folders in ${scene.folder.title}` }).or(picker.getByText("No folders inside"))).toBeVisible();
			await picker.getByRole("button", { name: "Restore here" }).click();
			await expect(scene.toast("Restored “Kickoff notes.md”")).toBeVisible();
			await expect(actionsFor(scene, "Kickoff notes.md")).toBeHidden();
		},
		async DELETE_FOREVER(scene) {
			await scene.rowAction("Press release v1.md", "Delete forever");
			await expect(scene.dialog("Delete forever?")).toBeVisible();
		},
		async CONFIRM_DELETE(scene) {
			await scene.dialog("Delete forever?").getByRole("button", { name: "Delete forever" }).click();
			await expect(scene.toast("Deleted “Press release v1.md” forever")).toBeVisible();
			await expect(actionsFor(scene, "Press release v1.md")).toBeHidden();
		},
		async EMPTY_TRASH(scene) {
			await scene.page.getByRole("button", { name: "Empty trash" }).click();
			await expect(scene.dialog("Empty trash?")).toBeVisible();
		},
		async CONFIRM_EMPTY(scene) {
			await scene.dialog("Empty trash?").getByRole("button", { name: "Empty trash" }).click();
			await expect(scene.toast(/^Deleted \d+ items? forever$/)).toBeVisible();
			await expect(scene.page.getByText("Trash is empty")).toBeVisible();
			await scene.settle();
			await expect(scene.toast(/^Deleted \d+ items? forever$/)).toBeVisible();
		},
		async OPEN_TRASHED_FOLDER(scene) {
			await scene.page.getByText("Old campaign", { exact: true }).click();
			await expect(scene.page.getByText("This folder is in Trash")).toBeVisible();
			await expect(actionsFor(scene, "Banner.png")).toBeVisible();
		},
		async OPEN_TRASHED_EMPTY(scene) {
			await scene.page.getByText("Unused assets", { exact: true }).click();
			await expect(scene.page.getByText("This folder is in Trash")).toBeVisible();
			await expect(scene.page.getByText("It was empty when it was moved to Trash.")).toBeVisible();
		},
	},
});
