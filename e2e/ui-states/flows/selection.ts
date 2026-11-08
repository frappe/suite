import { expect, type Locator } from "@playwright/test";
import { setup } from "xstate";
import { fillFolder, folderPath, type FolderContent } from "../content";
import { defineFlow } from "../flow";
import { openRowMenu, row } from "../../drive-backed-apps/helpers/drive";
import type { Scene } from "../scene";

type Event =
	| { type: "OPEN_MORE" }
	| { type: "FOCUS_ROW" }
	| { type: "SPACE" }
	| { type: "RIGHT_CLICK_ROW" }
	| { type: "RIGHT_CLICK_EMPTY" }
	| { type: "OPEN_ROW_MENU" }
	| { type: "CONTROL_CLICK" }
	| { type: "SHIFT_CLICK" }
	| { type: "SELECT_ALL" }
	| { type: "RIGHT_CLICK_SELECTED" }
	| { type: "DRAG" }
	| { type: "DONE" };

/**
 * Selecting rows in a folder listing. In the code this is `FilesPage.vue`'s
 * `selectionState` (`selected` + `anchor`, `features/selection.ts`), the
 * `selectionMode` it derives, `contextOpen` + `contextRow` for the
 * right-click menu, and `useMarquee`'s `box` while a drag is on.
 */
const machine = setup({ types: { events: {} as Event } }).createMachine({
	id: "selection",
	initial: "none",
	states: {
		none: {
			meta: { description: "Nothing selected: type icons, search and Type filter in the toolbar, and the pointer's row lit." },
			on: {
				OPEN_MORE: "moreMenu",
				FOCUS_ROW: "focused",
				RIGHT_CLICK_ROW: "contextMenu",
				RIGHT_CLICK_EMPTY: "paneMenu",
				OPEN_ROW_MENU: "rowMenu",
				CONTROL_CLICK: "one",
				DRAG: "marquee",
			},
		},
		moreMenu: {
			meta: { description: "More file actions with nothing selected: the folder's own Share, Copy link and Rename, then Select rows, Select all and Keyboard shortcuts." },
		},
		focused: {
			meta: { description: "A row reached with the keyboard: a focus ring around it. Enter opens it, Space selects it." },
			on: { SPACE: "one" },
		},
		contextMenu: {
			meta: { description: "Right-click on a row: the row's own menu at the pointer, and the row lit as if selected while it shows." },
		},
		paneMenu: {
			meta: { description: "Right-click on empty space below the rows: the New menu's options at the pointer." },
		},
		rowMenu: {
			meta: { description: "The row's Actions button: the same menu as a right-click, anchored to the button." },
		},
		one: {
			meta: { description: "One row selected: checkboxes replace the type icons, Select all shows a dash, and the toolbar becomes Move, Download, Star, Move to trash, “1 selected” and Done. Search, Type, View settings and More leave." },
			on: { SHIFT_CLICK: "many", SELECT_ALL: "all" },
		},
		many: {
			meta: { description: "A Shift-click range from the anchor: the selected rows read as one block." },
			on: { RIGHT_CLICK_SELECTED: "bulkMenu", DONE: "cleared" },
		},
		all: {
			meta: { description: "Select all in the header: every loaded row checked." },
		},
		bulkMenu: {
			meta: { description: "Right-click inside a selection of several: the toolbar's bulk actions, headed with the count." },
		},
		marquee: {
			meta: { description: "Dragging from empty space: a rectangle, and every row it touches selected as it goes." },
		},
		cleared: {
			meta: { description: "Done: the selection clears and the plain toolbar comes back; More now sits under the pointer." },
		},
	},
});

const content = new WeakMap<Scene, FolderContent>();

function contentOf(scene: Scene): FolderContent {
	const found = content.get(scene);
	if (!found) throw new Error("selection: the scene has no content");
	return found;
}

function menu(scene: Scene): Locator {
	return scene.page.getByRole("menu");
}

async function expectSelected(scene: Scene, count: number): Promise<void> {
	await expect(scene.page.getByText(`${count} selected`, { exact: true })).toBeVisible();
}

export const selection = defineFlow<Event>({
	id: "selection",
	title: "Selection",
	folderTitle: "Website relaunch",
	source: "frontend/src/apps/drive/files/features/selection.ts",
	machine,
	async enter(scene) {
		content.set(scene, await fillFolder(scene.api, scene.folder.name));
		await scene.goto(folderPath(scene.folder));
		await expect(scene.page.getByRole("button", { name: "Actions for Logo.png", exact: true })).toBeVisible();
		await row(scene.page, contentOf(scene).document.name).hover();
	},
	events: {
		async OPEN_MORE(scene) {
			await scene.page.getByRole("button", { name: "More file actions" }).click();
			await expect(menu(scene).getByRole("menuitem", { name: "Select rows" })).toBeVisible();
		},
		async FOCUS_ROW(scene) {
			await scene.page.mouse.move(0, 0);
			const target = row(scene.page, contentOf(scene).document.name);
			await scene.page.getByRole("searchbox", { name: "Search all files" }).focus();
			await target.focus();
			await scene.page.keyboard.press("Shift");
			await expect(target).toBeFocused();
		},
		async SPACE(scene) {
			await scene.page.keyboard.press("Space");
			await expectSelected(scene, 1);
		},
		async RIGHT_CLICK_ROW(scene) {
			await row(scene.page, contentOf(scene).brief.name).click({ button: "right" });
			await expect(menu(scene).getByRole("menuitem", { name: "Rename" })).toBeVisible();
		},
		async RIGHT_CLICK_EMPTY(scene) {
			await scene.page.mouse.click(860, 640, { button: "right" });
			await expect(menu(scene).getByRole("menuitem", { name: "From template" })).toBeVisible();
		},
		async OPEN_ROW_MENU(scene) {
			const opened = await openRowMenu(scene.page, "Quarter review.pdf");
			await expect(opened.getByRole("menuitem", { name: "Rename" })).toBeVisible();
		},
		async CONTROL_CLICK(scene) {
			await row(scene.page, contentOf(scene).sheet.name).click({ modifiers: ["ControlOrMeta"] });
			await expectSelected(scene, 1);
			await expect(scene.page.getByRole("button", { name: "Done" })).toBeVisible();
		},
		async SHIFT_CLICK(scene) {
			await row(scene.page, contentOf(scene).logo.name).click({ modifiers: ["Shift"] });
			await expectSelected(scene, 3);
		},
		async SELECT_ALL(scene) {
			await scene.page.getByRole("checkbox", { name: "Select all" }).click();
			await expectSelected(scene, 8);
			await expect(scene.page.getByRole("checkbox", { name: "Select all" })).toHaveAttribute("aria-checked", "true");
		},
		async RIGHT_CLICK_SELECTED(scene) {
			await row(scene.page, contentOf(scene).document.name).click({ button: "right" });
			await expect(menu(scene).getByText("3 selected")).toBeVisible();
			await expect(menu(scene).getByRole("menuitem", { name: "Move to trash" })).toBeVisible();
		},
		async DRAG(scene) {
			await scene.page.mouse.move(900, 640);
			await scene.page.mouse.down();
			await scene.page.mouse.move(820, 500, { steps: 4 });
			await scene.page.mouse.move(760, 300, { steps: 8 });
			await expectSelected(scene, 4);
		},
		async DONE(scene) {
			await scene.page.getByRole("button", { name: "Done" }).click();
			await expect(scene.page.getByRole("searchbox", { name: "Search all files" })).toBeVisible();
			await expect(scene.page.getByRole("checkbox", { name: /^Select / })).toHaveCount(0);
		},
	},
});
