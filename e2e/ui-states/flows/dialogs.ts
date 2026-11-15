import { expect, type Locator } from "@playwright/test";
import { fillFolder, fixture, folderPath, type FolderContent } from "../content";
import { defineFlow, setupFlow } from "../flow";
import {
	createFolder,
	grantAccess,
	ROLE,
	row,
	uploadFile,
	type DriveNode,
} from "../../drive-backed-apps/helpers/drive";
import { perScene, type Scene } from "../scene";

type Event =
	| { type: "OPEN_NEW" }
	| { type: "NEW_FOLDER" }
	| { type: "TYPE_NAME" }
	| { type: "CREATE_TAKEN" }
	| { type: "CREATE_SLOW" }
	| { type: "NEW_DOCUMENT" }
	| { type: "FROM_TEMPLATE" }
	| { type: "RENAME" }
	| { type: "RENAME_TAKEN" }
	| { type: "MOVE" }
	| { type: "BROWSE_TOP" }
	| { type: "OPEN_FOLDER" }
	| { type: "OPEN_EMPTY_FOLDER" }
	| { type: "MOVE_INTO_SHARED" }
	| { type: "CONFIRM_ACCESS" }
	| { type: "MOVE_SLOW" }
	| { type: "MOVE_SETTLES" }
	| { type: "COPY" }
	| { type: "COPY_HERE" }
	| { type: "BULK_MOVE_ONE_CLASH" }
	| { type: "BULK_MOVE_TWO_CLASH" }
	| { type: "SHOW_FAILURES" }
	| { type: "DETAILS" }
	| { type: "TRASH" };

/**
 * The dialogs a folder's New menu and row menu open, and the toasts their
 * actions end in. In the code this is `FilesPage.vue`'s loose refs
 * (`createOpen` + `createRequest`, `renameOpen`, `pickerOpen` + `pickerMode` +
 * `pickerBulk`, `templatesOpen`, `batchOutcome`, `activeNode`) and
 * `FolderPicker.vue`'s `checking` and `reviewingAccess`.
 */
const machine = setupFlow<Event>().createMachine({
	id: "dialogs",
	initial: "folder",
	states: {
		folder: {
			meta: { description: "A folder with folders, documents and files, before any dialog opens." },
			on: {
				OPEN_NEW: "newMenu",
				RENAME: "rename",
				MOVE: "movePickerHere",
				COPY: "copyPicker",
				BULK_MOVE_ONE_CLASH: "batchOutcomeOneFailed",
				BULK_MOVE_TWO_CLASH: "batchOutcomeSomeFailed",
				DETAILS: "infoDialog",
				TRASH: "trashToast",
			},
		},
		newMenu: {
			meta: { description: "New: Folder, one entry per document kind, Link and From template, then Upload files and Upload folder." },
			on: { NEW_FOLDER: "createFolder", NEW_DOCUMENT: "documentOpened", FROM_TEMPLATE: "templatePicker" },
		},
		createFolder: {
			meta: { description: "New folder opens with “Untitled folder” selected, so typing replaces it." },
			on: { TYPE_NAME: "createFolderFilled", CREATE_TAKEN: "createFolderDuplicate" },
		},
		createFolderFilled: {
			meta: { description: "A name typed, ready to create." },
			on: { CREATE_SLOW: "createFolderBusy" },
		},
		createFolderDuplicate: {
			meta: { description: "A sibling already has the name: “That name is taken in this folder.” shows under the form, with no toast. The free name the server answers with is not offered." },
		},
		createFolderBusy: {
			meta: { description: "Create pressed and the request still out: the button spins." },
		},
		documentOpened: {
			meta: { description: "New Document asks nothing: the untitled document is created at once and opens in the editor." },
		},
		templatePicker: {
			meta: { description: "New from template: a tab per document kind, the templates of that kind, and a Name prefilled “Untitled document” like any new document." },
		},
		rename: {
			meta: { description: "Rename opens with the current name selected." },
			on: { RENAME_TAKEN: "renameDuplicate" },
		},
		renameDuplicate: {
			meta: { description: "The new name is taken by a sibling: the refusal shows under the field." },
		},
		movePickerHere: {
			meta: { description: "Move to opens in the item's own folder. Move here is off, with the reason beside it." },
			on: {
				BROWSE_TOP: "movePickerRoot",
				OPEN_FOLDER: "movePickerInsideFolder",
				OPEN_EMPTY_FOLDER: "movePickerEmptyFolder",
				MOVE_INTO_SHARED: "moveAccessWiden",
			},
		},
		movePickerRoot: {
			meta: { description: "The top of My files in the picker: Back is off and the trail is one crumb." },
		},
		movePickerInsideFolder: {
			meta: { description: "Inside another folder: the trail grows and Move here turns on." },
			on: { MOVE_SLOW: "moveBusy" },
		},
		movePickerEmptyFolder: {
			meta: { description: "A folder with no folders inside: “No folders inside”, and the items can still go here." },
		},
		moveAccessWiden: {
			meta: { description: "The destination is shared more widely, so the move asks first and lists who gains access." },
			on: { CONFIRM_ACCESS: "movedToast" },
		},
		moveBusy: {
			meta: { description: "Move here pressed and the move still running: the button spins inside the open picker." },
			on: { MOVE_SETTLES: "movedToast" },
		},
		movedToast: {
			meta: { description: "The picker closes, the row leaves, and a toast names the destination with Undo." },
		},
		copyPicker: {
			meta: { description: "Make a copy opens in the item's own folder, where a copy is allowed." },
			on: { COPY_HERE: "copiedToast" },
		},
		copiedToast: {
			meta: { description: "The copy lands beside the original and a toast names where; a copy offers no Undo." },
		},
		batchOutcomeOneFailed: {
			meta: { description: "A bulk move where one item clashes with a name in the destination: an amber alert names it and says why, with no Details, a toast reports what moved, and the failed item stays selected." },
		},
		batchOutcomeSomeFailed: {
			meta: { description: "A bulk move where two of three items clash: an amber alert counts them and offers Details, a toast reports what moved, and the failed items stay selected." },
			on: { SHOW_FAILURES: "batchFailures" },
		},
		batchFailures: {
			meta: { description: "Details of the failed items: each by its icon and name, with why it failed." },
		},
		infoDialog: {
			meta: { description: "Details from the row menu: type, size, location, owner, dates and who it is shared with." },
		},
		trashToast: {
			meta: { description: "Move to trash: the row leaves and a toast offers Undo." },
		},
	},
});

const content = perScene<FolderContent>("dialogs: content");
const logo = fixture("Logo.png");

function designReviews(scene: Scene): DriveNode {
	const folder = content.get(scene).folders[0];
	if (!folder) throw new Error("dialogs: no Design reviews folder");
	return folder;
}

async function openNew(scene: Scene): Promise<Locator> {
	await scene.page.getByRole("button", { name: "New", exact: true }).click();
	const menu = scene.page.getByRole("menu");
	await expect(menu.getByRole("menuitem", { name: "From template" })).toBeVisible();
	return menu;
}

async function newFolder(scene: Scene): Promise<Locator> {
	const menu = await openNew(scene);
	await menu.getByRole("menuitem", { name: "Folder", exact: true }).first().click();
	const created = scene.dialog("New folder");
	await expect(created.getByRole("textbox", { name: "Name" })).toHaveValue("Untitled folder");
	return created;
}

async function openMovePicker(scene: Scene): Promise<Locator> {
	await scene.rowAction("Logo.png", "Move");
	const picker = scene.dialog("Move to");
	await expect(picker.getByRole("button", { name: "Design reviews", exact: true })).toBeVisible();
	return picker;
}

async function pickFolder(picker: Locator, title: string): Promise<void> {
	await picker.getByRole("button", { name: title, exact: true }).click();
	await expect(picker.getByRole("list", { name: `Folders in ${title}` }).or(picker.getByText("No folders inside"))).toBeVisible();
}

/** Selects `items` and moves them into Design reviews from the selection toolbar. */
async function moveToDesignReviews(scene: Scene, items: DriveNode[]): Promise<void> {
	for (const item of items) await row(scene.page, item.name).click({ modifiers: ["ControlOrMeta"] });
	await expect(scene.page.getByText(`${items.length} selected`)).toBeVisible();
	await scene.page.getByRole("button", { name: "Move", exact: true }).click();
	const picker = scene.dialog("Move to");
	await pickFolder(picker, "Design reviews");
	await picker.getByRole("button", { name: "Move here" }).click();
}

export const dialogs = defineFlow<Event>({
	id: "dialogs",
	title: "Create, rename, move, copy",
	folderTitle: "Design system",
	source: "frontend/src/apps/drive/files/pages/FilesPage.vue",
	machine,
	async enter(scene) {
		const filled = await fillFolder(scene.api, scene.folder.name);
		const shared = await createFolder(scene.api, "Client review", scene.folder.name);
		await grantAccess(scene.api, shared.name, scene.people.peer.email, ROLE.READ);
		await grantAccess(scene.api, filled.brief.name, scene.people.peer.email, ROLE.COMMENT);
		content.set(scene, filled);
		await scene.goto(folderPath(scene.folder));
		await expect(scene.page.getByRole("button", { name: "Actions for Logo.png", exact: true })).toBeVisible();
	},
	events: {
		async OPEN_NEW(scene) {
			await openNew(scene);
		},
		async NEW_FOLDER(scene) {
			await scene.page.getByRole("menuitem", { name: "Folder", exact: true }).first().click();
			await expect(scene.dialog("New folder").getByRole("textbox", { name: "Name" })).toHaveValue("Untitled folder");
		},
		async TYPE_NAME(scene) {
			const field = scene.dialog("New folder").getByRole("textbox", { name: "Name" });
			await field.fill("Press kit");
			await expect(field).toHaveValue("Press kit");
		},
		async CREATE_TAKEN(scene) {
			const created = scene.dialog("New folder");
			await created.getByRole("textbox", { name: "Name" }).fill("Design reviews");
			await created.getByRole("button", { name: "Create", exact: true }).click();
			await expect(created.getByText("That name is taken in this folder.")).toBeVisible();
		},
		async CREATE_SLOW(scene) {
			await scene.hold("**/api/suite/drive/nodes");
			const sent = scene.page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/api/suite/drive/nodes"));
			await scene.dialog("New folder").getByRole("button", { name: "Create", exact: true }).click();
			await sent;
		},
		async NEW_DOCUMENT(scene) {
			await scene.page.getByRole("menuitem", { name: "Document", exact: true }).click();
			await expect(scene.page).toHaveURL(/\/d\//);
			await expect(scene.page.getByText("Untitled document").first()).toBeVisible();
			await expect(scene.page.getByRole("dialog")).toHaveCount(0);
		},
		async FROM_TEMPLATE(scene) {
			await scene.page.getByRole("menuitem", { name: "From template" }).click();
			const picker = scene.dialog("New from template");
			await expect(picker.getByText("No templates yet").or(picker.getByRole("listbox", { name: "Templates" }))).toBeVisible();
			await expect(picker.getByRole("textbox", { name: "Name" })).toHaveValue("Untitled document");
		},
		async RENAME(scene) {
			await scene.rowAction("Quarterly planning", "Rename");
			await expect(scene.dialog("Rename").getByRole("textbox", { name: "Name" })).toHaveValue("Quarterly planning");
		},
		async RENAME_TAKEN(scene) {
			const rename = scene.dialog("Rename");
			await rename.getByRole("textbox", { name: "Name" }).fill("Design reviews");
			await rename.getByRole("button", { name: "Rename", exact: true }).click();
			await expect(rename.getByText("That name is taken in this folder.")).toBeVisible();
		},
		async MOVE(scene) {
			const picker = await openMovePicker(scene);
			await expect(picker.getByText("The item is already in this folder.")).toBeVisible();
		},
		async BROWSE_TOP(scene) {
			const picker = scene.dialog("Move to");
			await picker.getByRole("link", { name: "My files" }).or(picker.getByRole("button", { name: "My files", exact: true })).first().click();
			await expect(picker.getByRole("list", { name: "Folders in My files" })).toBeVisible();
		},
		async OPEN_FOLDER(scene) {
			await createFolder(scene.api, "Round 1", designReviews(scene).name);
			const picker = scene.dialog("Move to");
			await pickFolder(picker, "Design reviews");
			await expect(picker.getByRole("button", { name: "Round 1", exact: true })).toBeVisible();
			await expect(picker.getByRole("button", { name: "Move here" })).toBeEnabled();
		},
		async OPEN_EMPTY_FOLDER(scene) {
			const picker = scene.dialog("Move to");
			await picker.getByRole("button", { name: "Archive", exact: true }).click();
			await expect(picker.getByText("No folders inside")).toBeVisible();
		},
		async MOVE_INTO_SHARED(scene) {
			const picker = scene.dialog("Move to");
			await picker.getByRole("button", { name: "Client review", exact: true }).click();
			await expect(picker.getByText("No folders inside")).toBeVisible();
			await picker.getByRole("button", { name: "Move here" }).click();
			await expect(scene.dialog("More people will get access").getByText("Arjun Mehta")).toBeVisible();
		},
		async CONFIRM_ACCESS(scene) {
			await scene.dialog("More people will get access").getByRole("button", { name: "Move", exact: true }).click();
			await expect(scene.toast(/Moved “Logo.png” to/)).toBeVisible();
			await expect(row(scene.page, content.get(scene).logo.name)).toBeHidden();
		},
		async MOVE_SLOW(scene) {
			await scene.hold(`**/api/suite/drive/nodes/${content.get(scene).logo.name}`);
			const sent = scene.page.waitForRequest((request) => request.method() === "PATCH");
			await scene.dialog("Move to").getByRole("button", { name: "Move here" }).click();
			await sent;
		},
		async MOVE_SETTLES(scene) {
			await scene.lastHold.release();
			await expect(scene.toast("Moved “Logo.png” to Design reviews")).toBeVisible();
			await expect(row(scene.page, content.get(scene).logo.name)).toBeHidden();
		},
		async COPY(scene) {
			await scene.rowAction("Meeting notes.md", "Make a copy");
			await expect(scene.dialog("Make a copy").getByRole("button", { name: "Copy here" })).toBeEnabled();
		},
		async COPY_HERE(scene) {
			await scene.dialog("Make a copy").getByRole("button", { name: "Copy here" }).click();
			await expect(scene.toast(new RegExp(`Copied “Meeting notes.* to ${scene.folder.title}`))).toBeVisible();
			await expect(scene.page.getByRole("button", { name: /^Actions for Meeting notes.*\(/ })).toBeVisible();
		},
		async BULK_MOVE_ONE_CLASH(scene) {
			const { logo: logoRow, notes } = content.get(scene);
			await uploadFile(scene.api, "Logo.png", logo, designReviews(scene).name, "image/png");
			await moveToDesignReviews(scene, [logoRow, notes]);
			await expect(scene.page.getByText("“Logo.png” could not be moved")).toBeVisible();
			await expect(scene.page.getByText("That name is taken in this folder.")).toBeVisible();
			await expect(scene.page.getByRole("button", { name: "Details", exact: true })).toHaveCount(0);
			await expect(scene.toast(/Moved “Meeting notes.md” to/)).toBeVisible();
		},
		async BULK_MOVE_TWO_CLASH(scene) {
			const { logo: logoRow, notes, sheet } = content.get(scene);
			await uploadFile(scene.api, "Logo.png", logo, designReviews(scene).name, "image/png");
			await uploadFile(scene.api, "Meeting notes.md", Buffer.from("# Older notes\n"), designReviews(scene).name, "text/markdown");
			await moveToDesignReviews(scene, [logoRow, notes, sheet]);
			await expect(scene.page.getByText("2 of 3 items could not be moved")).toBeVisible();
			await expect(scene.toast(/Moved “Budget 2026” to/)).toBeVisible();
		},
		async SHOW_FAILURES(scene) {
			await scene.page.getByRole("button", { name: "Details", exact: true }).click();
			await expect(scene.dialog("Items that failed").getByText("That name is taken in this folder.")).toHaveCount(2);
		},
		async DETAILS(scene) {
			await scene.rowAction("Quarter review.pdf", "Details");
			await expect(scene.dialog("Details").getByText("Arjun Mehta")).toBeVisible();
		},
		async TRASH(scene) {
			await scene.rowAction("Budget 2026", "Move to trash");
			await expect(scene.toast("Moved “Budget 2026” to Trash")).toBeVisible();
			await expect(row(scene.page, content.get(scene).sheet.name)).toBeHidden();
		},
	},
});
