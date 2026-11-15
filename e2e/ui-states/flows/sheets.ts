import { expect, type Locator, type Page } from "@playwright/test";
import { ROLE } from "../../drive-backed-apps/helpers/drive";
import { openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import { perScene, type BaseScene } from "../scene";
import {
	bodyRead,
	createPathDocument,
	expectPollingBanner,
	framedPage,
	grantTo,
	header,
	nodeRead,
	openAs,
	SHEET_DOCTYPE,
} from "./writer-sheets-helpers";

type Event =
	| { type: "RELOAD_HELD" }
	| { type: "FAILS" }
	| { type: "RELOAD_BODY_HELD" }
	| { type: "BODY_FAILS" }
	| { type: "OPEN_AS_VIEWER" }
	| { type: "EDIT_CELL" }
	| { type: "TYPE_FORMULA" }
	| { type: "SELECT_RANGE" }
	| { type: "SELECT_COLUMN" }
	| { type: "RIGHT_CLICK_CELL" }
	| { type: "RIGHT_CLICK_TAB" }
	| { type: "RENAME_TAB" }
	| { type: "ADD_SHEET" }
	| { type: "OPEN_FILE" }
	| { type: "OPEN_EDIT" }
	| { type: "OPEN_VIEW" }
	| { type: "OPEN_INSERT" }
	| { type: "OPEN_FORMAT" }
	| { type: "OPEN_DATA" }
	| { type: "SORT_RANGE" }
	| { type: "OPEN_DOCUMENT_MENU" }
	| { type: "FIND" }
	| { type: "SEARCH" }
	| { type: "CREATE_FILTER" }
	| { type: "OPEN_FILTER" }
	| { type: "HIDE_VALUE" }
	| { type: "NUMBER_FORMAT" }
	| { type: "FILL_COLOUR" }
	| { type: "BORDERS" }
	| { type: "CONDITIONAL_FORMAT" }
	| { type: "VALIDATION" }
	| { type: "CHART" }
	| { type: "OPEN_COMMENTS" }
	| { type: "POST_COMMENT" }
	| { type: "OPEN_VERSIONS" }
	| { type: "PREVIEW_VERSION" }
	| { type: "GO_OFFLINE" }
	| { type: "PHONE" };

/**
 * A spreadsheet from `/d/:node`: the host's opening, the grid's load, cell
 * editing, the menus, dialogs and side panels. In the code the grid is
 * `SheetEditor/index.vue`, which decides its screen from `loadError` (a
 * `kind` union), `isInitialLoad`, and a dozen independent `*.open` flags for
 * its overlays; `SheetsSurface.vue` adds `panel` and `preview`.
 */
const machine = setupFlow<Event>().createMachine({
	id: "sheets",
	initial: "ready",
	states: {
		ready: {
			meta: {
				description:
					"A pipeline by region with a total under it, saved, A1 selected. The amber strip over the grid says live updates are unavailable: this bench's socket server has no Suite collab handlers.",
			},
			on: {
				RELOAD_HELD: "opening",
				RELOAD_BODY_HELD: "gridLoading",
				OPEN_AS_VIEWER: "viewOnly",
				EDIT_CELL: "editingCell",
				TYPE_FORMULA: "formulaSuggestions",
				SELECT_RANGE: "rangeSelected",
				SELECT_COLUMN: "columnSelected",
				RIGHT_CLICK_CELL: "cellMenu",
				RIGHT_CLICK_TAB: "tabMenu",
				ADD_SHEET: "secondSheet",
				OPEN_FILE: "fileMenu",
				OPEN_EDIT: "editMenu",
				OPEN_VIEW: "viewMenu",
				OPEN_INSERT: "insertMenu",
				OPEN_FORMAT: "formatMenu",
				OPEN_DATA: "dataMenu",
				OPEN_DOCUMENT_MENU: "documentMenu",
				FIND: "findReplace",
				CREATE_FILTER: "filterOn",
				NUMBER_FORMAT: "numberFormatMenu",
				FILL_COLOUR: "fillColour",
				BORDERS: "bordersMenu",
				CONDITIONAL_FORMAT: "conditionalFormatDialog",
				VALIDATION: "validationDialog",
				CHART: "chartDialog",
				OPEN_COMMENTS: "commentsEmpty",
				OPEN_VERSIONS: "versionsPanel",
				GO_OFFLINE: "offlineUnsaved",
				PHONE: "phone",
			},
		},
		opening: {
			meta: { description: "The host opens the node: a header skeleton, and nothing under it yet." },
			on: { FAILS: "openFailed" },
		},
		openFailed: {
			meta: { description: "The node read failed: “Could not open this document”, “Something went wrong” and Try again." },
		},
		gridLoading: {
			meta: { description: "The node is open and the workbook is still loading: an empty grid under a spinner. The owner's header says View only and offers only File, Edit, View and Insert until the sheet joins its room." },
			on: { BODY_FAILS: "loadFailed" },
		},
		loadFailed: {
			meta: { description: "The workbook read failed: “Couldn't open this sheet”, “Check your connection, then reload.”, Reload and Back to home. The app rail returns and the editor's header goes." },
		},
		viewOnly: {
			meta: { description: "Leo, who has View, opens it: a View only badge, the formatting toolbar greyed out, and the data as Maya left it." },
		},
		editingCell: {
			meta: { description: "Typing in a cell: the text in the cell's editor and in the formula bar, before Enter." },
		},
		formulaSuggestions: {
			meta: { description: "Typing =AV lists the functions that match, with their arguments." },
		},
		rangeSelected: {
			meta: { description: "A range selected: its address in the name box, and Count, Sum and Avg at the bottom right." },
		},
		columnSelected: {
			meta: { description: "A column header clicked: the whole column selected." },
		},
		cellMenu: {
			meta: { description: "Right-click on a cell: insert and delete rows and columns, freeze, sort, validation, conditional format, protect, split, pivot, chart, slicer." },
		},
		tabMenu: {
			meta: { description: "Right-click on a sheet tab: Rename, Duplicate, Protect sheet, and Delete, which is off for the only sheet." },
			on: { RENAME_TAB: "tabRenaming" },
		},
		tabRenaming: {
			meta: { description: "Rename edits the tab's name in place, with all of it selected." },
		},
		secondSheet: {
			meta: { description: "Add sheet: an empty Sheet2, its tab selected." },
		},
		fileMenu: {
			meta: { description: "File: export as CSV or XLSX (with a note on what XLSX leaves out), Print, and import CSV or XLSX." },
		},
		editMenu: {
			meta: { description: "Edit: undo, redo, find and replace, paste special, clear, delete and move." },
		},
		viewMenu: {
			meta: { description: "View: zoom, freeze, hide, show formulas, notes and keyboard shortcuts." },
		},
		insertMenu: {
			meta: { description: "Insert: rows and columns, chart, pivot table, slicer, link, checkbox, dropdown, note and comment." },
		},
		formatMenu: {
			meta: { description: "Format: number formats, text styles, font, alignment, wrapping, merge, borders, fitting, conditional formatting, painter and clear." },
		},
		dataMenu: {
			meta: { description: "Data: sort and filter, validation, named ranges, split text, Smart Fill and protection." },
			on: { SORT_RANGE: "sortDialog" },
		},
		sortDialog: {
			meta: { description: "Sort range: the range's address in the title, the column to sort by and the order." },
		},
		documentMenu: {
			meta: { description: "More document actions: Comments and Versions." },
		},
		findReplace: {
			meta: { description: "Find & Replace opens at the top right: Find, Replace with, Find next, Replace and All." },
			on: { SEARCH: "findMatch" },
		},
		findMatch: {
			meta: { description: "Find next on “North” selects the matching cell." },
		},
		filterOn: {
			meta: { description: "Create a filter: each header cell gets a filter button." },
			on: { OPEN_FILTER: "filterPanel" },
		},
		filterPanel: {
			meta: { description: "A column's filter: sort buttons, Values or Condition, the values with checkboxes, and Apply." },
			on: { HIDE_VALUE: "filtered" },
		},
		filtered: {
			meta: { description: "West unticked and applied: its row is hidden and the row numbers skip it." },
		},
		numberFormatMenu: {
			meta: { description: "Number format: general, number, currency, date, time and more, in groups." },
		},
		fillColour: {
			meta: { description: "Fill colour: a swatch grid, no fill, and a hex field." },
		},
		bordersMenu: {
			meta: { description: "Borders: all, outside, inner, one side at a time, or none." },
		},
		conditionalFormatDialog: {
			meta: { description: "Conditional formatting: rule type, condition, value, the style to apply and the range." },
		},
		validationDialog: {
			meta: { description: "Data validation: a list of items, an error message, and what happens to an invalid value; Apply waits for an item." },
		},
		chartDialog: {
			meta: { description: "Insert chart from the table: source range, chart types, axis, series, options and a live preview." },
		},
		commentsEmpty: {
			meta: { description: "The comments panel on A1: a box to comment on the selected cell, and “No comments yet.”" },
			on: { POST_COMMENT: "commentPosted" },
		},
		commentPosted: {
			meta: { description: "A comment posted on A1: it shows in the panel as a thread." },
		},
		versionsPanel: {
			meta: { description: "The versions panel: Current version, Save version, and the automatic version taken when the sheet was made." },
			on: { PREVIEW_VERSION: "versionPreview" },
		},
		versionPreview: {
			meta: { description: "The automatic version, taken when the sheet was empty, shown read-only next to the versions list. The bar over the grid has Back, the version's name and time, Name this version, Make a copy and Restore this version. It says “No cells differ from the current version”, though every filled cell differs. The header switches to View only with four menus." },
		},
		offlineUnsaved: {
			meta: { description: "Offline with an edit not yet sent: an Offline badge in the header and the edit kept in the grid. Unlike Writer, the header still says Edited just now, not that changes will sync." },
		},
		phone: {
			meta: { description: "At phone width the six menus fold into Menu, the toolbar keeps what fits, and the app's tab bar sits under the sheet tabs. Crossing to this width reopens the grid: a spinner and a View only badge show for a moment first." },
		},
		presence: {
			meta: {
				description:
					"Someone else in the sheet: their avatar in the header. Unreachable here: this bench's socket server does not answer suite_collab_rooms, so no presence reaches the page.",
				transient: true,
			},
		},
		remoteCursor: {
			meta: {
				description: "Someone else's selection outlined in their colour with their name. Unreachable for the same reason as presence.",
				transient: true,
			},
		},
		sheetDenied: {
			meta: {
				description:
					"The grid's own “You don't have access to this sheet”. Unreachable from /d/: the host refuses a 403 or 404 before the grid mounts and shows its own refusal (see the Writer flow).",
				transient: true,
			},
		},
	},
});

const sheetsNodes = perScene<string>("sheets: document");
const OTHER_PAGE_STATES = new Set(["viewOnly"]);

const ROWS = [
	["Region", "Owner", "Deals", "Value"],
	["North", "Leo Park", "12", "48000"],
	["South", "Nisha Patel", "9", "35500"],
	["East", "Arjun Rao", "15", "61200"],
	["West", "Sofia Martinez", "7", "27900"],
];

function nameBox(page: Page): Locator {
	return page.getByRole("textbox", { name: "Name box" });
}

function formulaBar(page: Page): Locator {
	return page.getByRole("textbox", { name: "Cell value or formula" });
}

async function goTo(page: Page, address: string): Promise<void> {
	await nameBox(page).fill(address);
	await nameBox(page).press("Enter");
	await expect(nameBox(page)).toHaveValue(address);
}

async function gridReady(page: Page): Promise<void> {
	await expect(page.getByRole("tab", { name: "Sheet1" })).toBeVisible();
	await expect(page.locator(".sn-canvas-loading")).toHaveCount(0);
}

async function openMenu(page: Page, name: string, item: string): Promise<void> {
	await page.getByRole("navigation", { name: "Spreadsheet menus" }).getByRole("menuitem", { name, exact: true }).click();
	await expect(page.getByRole("menuitem", { name: item }).first()).toBeVisible();
}

async function openDocumentMenu(page: Page, item: string): Promise<void> {
	await page.getByRole("button", { name: "More document actions" }).click();
	await page.getByRole("menuitem", { name: item }).click();
}

export const sheets = defineFlow<Event, BaseScene>({
	id: "sheets",
	title: "Sheets",
	source: "frontend/src/composition/DocumentHost.vue, frontend/src/apps/sheets/surface/SheetsSurface.vue, components/SheetEditor/index.vue",
	open: (browser) => openDemoScene(browser, "maya"),
	machine,
	async enter(scene) {
		const node = await createPathDocument(scene, "November pipeline by region", SHEET_DOCTYPE);
		sheetsNodes.set(scene, node.name);
		const { page } = scene;
		await scene.goto(`/d/${node.name}`);
		await gridReady(page);
		for (const [index, row] of ROWS.entries()) {
			await goTo(page, `A${index + 1}`);
			for (const value of row) {
				await page.keyboard.type(value);
				await page.keyboard.press("Tab");
			}
		}
		await goTo(page, "D6");
		await page.keyboard.type("=SUM(D2:D5)");
		await page.keyboard.press("Enter");
		await goTo(page, "A1");
		await expect(formulaBar(page)).toHaveValue("Region");
		await expect(header(page, "clean")).toBeVisible();
		await expectPollingBanner(page);
	},
	frame(scene, state) {
		return OTHER_PAGE_STATES.has(state) ? framedPage(scene) : null;
	},
	events: {
		async RELOAD_HELD(scene) {
			await scene.hold(nodeRead(sheetsNodes.get(scene)));
			await scene.page.reload();
			await expect(scene.page.getByRole("status", { name: /^Opening/ })).toBeVisible();
		},
		async FAILS(scene) {
			await scene.lastHold.abort(417);
			await expect(scene.page.getByRole("heading", { name: "Could not open this document" })).toBeVisible();
		},
		async RELOAD_BODY_HELD(scene) {
			await scene.hold(bodyRead(sheetsNodes.get(scene)));
			await scene.page.reload();
			await expect(scene.page.getByRole("textbox", { name: "Spreadsheet title" })).toBeVisible();
			await expect(scene.page.locator(".sn-canvas-loading")).toBeVisible();
		},
		async BODY_FAILS(scene) {
			await scene.lastHold.abort(417);
			await expect(scene.page.getByText("Couldn't open this sheet")).toBeVisible({ timeout: 20_000 });
		},
		async OPEN_AS_VIEWER(scene) {
			const node = sheetsNodes.get(scene);
			await grantTo(scene, node, "leo", ROLE.READ);
			const page = await openAs(scene, "leo", node);
			await expect(page.getByText("View only", { exact: true })).toBeVisible();
			await gridReady(page);
		},
		async EDIT_CELL(scene) {
			await goTo(scene.page, "A7");
			await scene.page.keyboard.type("Pipeline total");
			await expect(formulaBar(scene.page)).toHaveValue("Pipeline total");
		},
		async TYPE_FORMULA(scene) {
			await goTo(scene.page, "F2");
			await scene.page.keyboard.type("=AV");
			await expect(scene.page.getByText("AVERAGEIF", { exact: true })).toBeVisible();
		},
		async SELECT_RANGE(scene) {
			await goTo(scene.page, "C2:D5");
			await expect(scene.page.getByText(/Sum: /)).toBeVisible();
		},
		async SELECT_COLUMN(scene) {
			await scene.page.locator("canvas").first().click({ position: { x: 350, y: 14 } });
			await expect(nameBox(scene.page)).toHaveValue("C:C");
		},
		async RIGHT_CLICK_CELL(scene) {
			await goTo(scene.page, "B3");
			await scene.page.locator("canvas").first().click({ position: { x: 230, y: 98 }, button: "right" });
			await expect(scene.page.getByText("Insert row above")).toBeVisible();
		},
		async RIGHT_CLICK_TAB(scene) {
			await scene.page.getByRole("tab", { name: "Sheet1" }).click({ button: "right" });
			await expect(scene.page.getByRole("button", { name: "Duplicate" })).toBeVisible();
		},
		async RENAME_TAB(scene) {
			await scene.page.getByRole("button", { name: "Rename" }).click();
			await expect(scene.page.getByRole("button", { name: "Duplicate" })).toBeHidden();
			await expect(scene.page.getByRole("textbox", { name: "Sheet name" })).toBeVisible();
		},
		async ADD_SHEET(scene) {
			await scene.page.getByRole("button", { name: "Add sheet" }).click();
			await expect(scene.page.getByRole("tab", { name: "Sheet2", selected: true })).toBeVisible();
		},
		async OPEN_FILE(scene) {
			await openMenu(scene.page, "File", "Export as CSV");
		},
		async OPEN_EDIT(scene) {
			await openMenu(scene.page, "Edit", "Find and replace");
		},
		async OPEN_VIEW(scene) {
			await openMenu(scene.page, "View", "Show formulas");
		},
		async OPEN_INSERT(scene) {
			await openMenu(scene.page, "Insert", "Pivot table…");
		},
		async OPEN_FORMAT(scene) {
			await openMenu(scene.page, "Format", "Conditional formatting…");
		},
		async OPEN_DATA(scene) {
			await goTo(scene.page, "A1:D5");
			await openMenu(scene.page, "Data", "Sort range…");
		},
		async SORT_RANGE(scene) {
			await scene.page.getByRole("menuitem", { name: "Sort range…" }).click();
			await expect(scene.page.getByRole("dialog", { name: /^Sort / })).toBeVisible();
		},
		async OPEN_DOCUMENT_MENU(scene) {
			await scene.page.getByRole("button", { name: "More document actions" }).click();
			await expect(scene.page.getByRole("menuitem", { name: "Versions" })).toBeVisible();
		},
		async FIND(scene) {
			await openMenu(scene.page, "Edit", "Find and replace");
			await scene.page.getByRole("menuitem", { name: "Find and replace" }).click();
			await expect(scene.page.getByRole("button", { name: "Close find and replace" })).toBeVisible();
		},
		async SEARCH(scene) {
			await scene.page.getByPlaceholder("Find", { exact: true }).fill("North");
			await scene.page.getByRole("button", { name: "Find next" }).click();
			await expect(nameBox(scene.page)).toHaveValue("A2");
		},
		async CREATE_FILTER(scene) {
			await openMenu(scene.page, "Data", "Create a filter");
			await scene.page.getByRole("menuitem", { name: "Create a filter" }).click();
			await expect(scene.page.getByRole("button", { name: "Filter column A" })).toBeVisible();
		},
		async OPEN_FILTER(scene) {
			await scene.page.getByRole("button", { name: "Filter column A" }).click();
			await expect(scene.page.getByRole("checkbox", { name: "West" })).toBeVisible();
		},
		async HIDE_VALUE(scene) {
			await scene.page.getByRole("checkbox", { name: "West" }).click();
			await scene.page.getByRole("button", { name: "Apply" }).click();
			await expect(scene.page.getByRole("checkbox", { name: "West" })).toBeHidden();
		},
		async NUMBER_FORMAT(scene) {
			await goTo(scene.page, "D2:D6");
			await scene.page.getByRole("button", { name: /^Number format/ }).click();
			await expect(scene.page.getByRole("menuitem", { name: "Custom format…" })).toBeVisible();
		},
		async FILL_COLOUR(scene) {
			await goTo(scene.page, "A1:D1");
			await scene.page.getByRole("button", { name: "Fill colour" }).first().click();
			await expect(scene.page.getByPlaceholder("rrggbb")).toBeVisible();
		},
		async BORDERS(scene) {
			await goTo(scene.page, "A1:D6");
			await scene.page.getByRole("button", { name: "Borders" }).click();
			await expect(scene.page.getByRole("menuitem", { name: "Outside borders" })).toBeVisible();
		},
		async CONDITIONAL_FORMAT(scene) {
			await goTo(scene.page, "D2:D5");
			await openMenu(scene.page, "Format", "Conditional formatting…");
			await scene.page.getByRole("menuitem", { name: "Conditional formatting…" }).click();
			await expect(scene.page.getByText("Rule type")).toBeVisible();
		},
		async VALIDATION(scene) {
			await goTo(scene.page, "A2:A5");
			await openMenu(scene.page, "Data", "Data validation…");
			await scene.page.getByRole("menuitem", { name: "Data validation…" }).click();
			await expect(scene.page.getByText("When the value is invalid")).toBeVisible();
		},
		async CHART(scene) {
			await goTo(scene.page, "A1:D5");
			await scene.page.getByRole("button", { name: "Chart" }).click();
			await expect(scene.page.getByRole("dialog", { name: "Insert chart" })).toBeVisible();
		},
		async OPEN_COMMENTS(scene) {
			await openDocumentMenu(scene.page, "Comments");
			await expect(scene.page.getByRole("complementary", { name: "Comments" }).getByText("No comments yet.")).toBeVisible();
		},
		async POST_COMMENT(scene) {
			const comments = scene.page.getByRole("complementary", { name: "Comments" });
			await comments.getByRole("textbox", { name: "New comment" }).fill("Leo, can you confirm the North numbers?");
			await comments.getByRole("button", { name: "Comment", exact: true }).click();
			await expect(comments.getByText("No comments yet.")).toBeHidden();
			await expect(comments.getByText("Leo, can you confirm the North numbers?").first()).toBeVisible();
		},
		async OPEN_VERSIONS(scene) {
			await openDocumentMenu(scene.page, "Versions");
			await expect(scene.page.getByRole("button", { name: /^Automatic version/ }).first()).toBeVisible();
		},
		async PREVIEW_VERSION(scene) {
			await scene.page.getByRole("button", { name: /^Automatic version/ }).first().click();
			await expect(scene.page.getByRole("button", { name: "Back to the current version" })).toBeVisible();
		},
		async GO_OFFLINE(scene) {
			await scene.context.setOffline(true);
			await goTo(scene.page, "C3");
			await scene.page.keyboard.type("11");
			await scene.page.keyboard.press("Enter");
			await expect(scene.page.getByText("Offline", { exact: true })).toBeVisible();
		},
		async PHONE(scene) {
			await scene.page.setViewportSize({ width: 390, height: 844 });
			await expect(scene.page.getByRole("navigation", { name: "Spreadsheet menus" }).getByRole("menuitem", { name: "Menu" })).toBeVisible();
			// Crossing to phone width opens the grid again; wait until it is back.
			await expect(scene.page.getByText("View only", { exact: true })).toBeHidden({ timeout: 20_000 });
			await expect(scene.page.locator(".sn-canvas-loading")).toHaveCount(0);
			await expectPollingBanner(scene.page);
		},
	},
});
