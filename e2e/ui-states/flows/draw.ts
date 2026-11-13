import { expect, type APIRequestContext, type Page, type Route } from "@playwright/test";
import { createDocument, discardNode, grantAccess, ROLE, type DriveNode } from "../../drive-backed-apps/helpers/drive";
import { demoUser, openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import { perScene, type BaseScene } from "../scene";

type Event =
	| { type: "OPEN_BLANK" }
	| { type: "DRAW_RECTANGLE" }
	| { type: "UNDO" }
	| { type: "DRAW_DIAMOND" }
	| { type: "DRAW_ELLIPSE" }
	| { type: "DRAW_LINE" }
	| { type: "DRAW_ARROW" }
	| { type: "DRAW_PEN" }
	| { type: "ERASE" }
	| { type: "RELEASE" }
	| { type: "TYPE_TEXT" }
	| { type: "FINISH_TEXT" }
	| { type: "OPEN_MORE" }
	| { type: "INSERT_IMAGE" }
	| { type: "LASER" }
	| { type: "LASSO" }
	| { type: "SELECT_SHAPE" }
	| { type: "OPEN_COLOR" }
	| { type: "ZOOM_IN" }
	| { type: "RENAME" }
	| { type: "OPEN_HELD" }
	| { type: "LOAD_FAILS" }
	| { type: "SAVE_HELD" }
	| { type: "SAVE_FAILS" }
	| { type: "OTHER_EDITS" }
	| { type: "OPEN_AS_VIEWER" }
	| { type: "PHONE" };

/**
 * A drawing opened at /d/:node. Draw keeps its own header (`App.vue`) with the
 * tool rail and a save status; `DrawSurface.vue` adds the recovery banner and
 * the view-only row; `InfiniteCanvas.vue` holds the tool, the selection, the
 * property bar, zoom and history. Load and save are separate flags in
 * `canvas/persistence.ts` (`drawingLoading`, `loadError`, `saving`, `error`,
 * `conflict`), not one status.
 */
const machine = setupFlow<Event>().createMachine({
	id: "draw",
	initial: "canvas",
	states: {
		canvas: {
			meta: { description: "A saved flowchart: a title, Brief, Review and Ship joined by arrows, with the tool rail in the header and “Saved” beside it." },
			on: {
				OPEN_BLANK: "emptyCanvas",
				DRAW_RECTANGLE: "rectangleDrawn",
				DRAW_DIAMOND: "diamondDrawn",
				DRAW_ELLIPSE: "ellipseDrawn",
				DRAW_LINE: "lineDrawn",
				DRAW_ARROW: "arrowDrawn",
				DRAW_PEN: "penStroke",
				TYPE_TEXT: "textEditing",
				OPEN_MORE: "moreTools",
				SELECT_SHAPE: "shapeSelected",
				ZOOM_IN: "zoomedIn",
				RENAME: "renaming",
				OPEN_HELD: "loading",
				SAVE_HELD: "saving",
				OTHER_EDITS: "conflict",
				OPEN_AS_VIEWER: "viewOnly",
				PHONE: "phone",
			},
		},
		emptyCanvas: {
			meta: { description: "A new drawing: an empty dotted canvas with the tool rail, zoom and history controls, and no hint of where to start." },
		},
		rectangleDrawn: {
			meta: { description: "The Rectangle tool: a rectangle dragged out and selected, the property bar at the bottom of the screen, and “Saving…” in the header." },
			on: { UNDO: "undone" },
		},
		undone: {
			meta: { description: "Undo removes the new rectangle: Redo is now enabled and the header says “Unsaved changes”." },
		},
		diamondDrawn: {
			meta: { description: "The Diamond tool: a diamond dragged out and selected." },
		},
		ellipseDrawn: {
			meta: { description: "The Ellipse tool: an ellipse dragged out and selected." },
		},
		lineDrawn: {
			meta: { description: "The Line tool: a straight line dragged out and selected, with handles at both ends." },
		},
		arrowDrawn: {
			meta: { description: "The Arrows tool: an arrow dragged out and selected." },
		},
		penStroke: {
			meta: { description: "The Draw tool: a freehand wave under the flowchart, and “Unsaved changes” in the header." },
			on: { ERASE: "erasing" },
		},
		erasing: {
			meta: { description: "The Eraser dragged across the stroke with the button still down: the stroke shows light grey, marked for removal." },
			on: { RELEASE: "erased" },
		},
		erased: {
			meta: { description: "Releasing the Eraser removes the stroke." },
		},
		textEditing: {
			meta: { description: "The Text tool: a click starts a text box, the typed words “Ship by Friday” show, and the property bar's text controls are enabled." },
			on: { FINISH_TEXT: "textPlaced" },
		},
		textPlaced: {
			meta: { description: "Escape finishes the text: the words stay on the canvas, selected with handles around them." },
		},
		moreTools: {
			meta: { description: "More tools: Insert Image, Laser Pointer and Lasso Select." },
			on: { INSERT_IMAGE: "imageInserted", LASER: "laserTrail", LASSO: "lassoSelected" },
		},
		imageInserted: {
			meta: { description: "Insert Image places the picked image on the canvas, selected. It lands on top of Review and Ship and covers part of them." },
		},
		laserTrail: {
			meta: { description: "The Laser Pointer leaves a red trail behind the pointer that fades within a second and is never saved." },
		},
		lassoSelected: {
			meta: { description: "Lasso Select: a loop drawn around the flowchart selects every object inside it." },
		},
		shapeSelected: {
			meta: { description: "The Brief rectangle selected: handles around it and the property bar with colour, font and order controls." },
			on: { OPEN_COLOR: "colorPicker" },
		},
		colorPicker: {
			meta: { description: "The colour popover for the rectangle: fill and border swatches, shades of the picked colour, a hex field, and border thickness and style." },
		},
		zoomedIn: {
			meta: { description: "Zoom in: the canvas at 110%, shown in the zoom control at the bottom left." },
		},
		renaming: {
			meta: { description: "Clicking the title turns it into a text field with the whole name selected." },
		},
		loading: {
			meta: { description: "The drawing is still loading: the header says “Loading…” over an empty canvas, and the tool rail looks ready to use." },
			on: { LOAD_FAILS: "loadFailed" },
		},
		loadFailed: {
			meta: { description: "The drawing failed to load: a banner above the header says “Something went wrong” with Reload, the header says “Could not load”, and the canvas is empty with the tool rail still shown." },
		},
		saving: {
			meta: { description: "A change on its way to the server: the status says “Saving…”." },
			on: { SAVE_FAILS: "saveFailed" },
		},
		saveFailed: {
			meta: { description: "The save failed: a banner says “Something went wrong” with Download recovery and Retry save, the header says “Unsaved changes”, and the new rectangle stays on screen." },
		},
		conflict: {
			meta: { description: "Leo saved first, then Maya changed the drawing: the banner shows the bare word “Conflict” with Download recovery and Save recovered copy, and a line below says “Recovery preview · editing paused”." },
		},
		viewOnly: {
			meta: { description: "Leo has View access: “View only” above the header, “Saved” and no Share button. The tool rail still shows and looks usable, though it does not respond." },
		},
		phone: {
			meta: { description: "At phone width the tool rail moves to a second row and the app's bottom tab bar shows. The drawing opens at 100% and is not fitted, so only Review is fully in view." },
		},
	},
});

/** The flowchart every path starts from, centred on the canvas's origin. */
const FLOWCHART = {
	rectangles: [
		{ id: "rectangle-brief", x: -400, y: -5, width: 200, height: 110, rotation: 0, cornerRadius: 8, order: 1, label: "Brief" },
		{ id: "diamond-review", kind: "diamond", x: -80, y: -15, width: 170, height: 130, rotation: 0, cornerRadius: 8, order: 3, label: "Review" },
		{ id: "ellipse-ship", kind: "ellipse", x: 220, y: -5, width: 180, height: 110, rotation: 0, cornerRadius: 8, order: 5, label: "Ship" },
		{
			id: "text-title",
			kind: "text",
			x: -400,
			y: -105,
			width: 260,
			height: 30,
			rotation: 0,
			cornerRadius: 0,
			text: "Beacon launch flow",
			fontSize: 24,
			wrap: false,
			fill: "#171717",
			fontFamily: "shantell",
			order: 6,
		},
	],
	lines: [
		{ id: "arrow-brief-review", kind: "arrow", start: { x: -190, y: 50 }, end: { x: -90, y: 50 }, order: 2 },
		{ id: "arrow-review-ship", kind: "arrow", start: { x: 100, y: 50 }, end: { x: 210, y: 50 }, order: 4 },
	],
};
const FLOWCHART_OBJECTS = 6;
const DOCUMENTS = /\/api\/suite\/draw\/documents\//;
const LEO = demoUser("leo");

/** Free canvas below the flowchart, in the 1440 × 900 viewport. */
const FREE = { x: 460, y: 640 };
/** The left border of the Brief rectangle; a click inside lands on its label. */
const BRIEF_EDGE = { x: 321, y: 524 };

const drawings = perScene<DriveNode>("draw: drawing");
const viewers = perScene<Page>("draw: viewer page");

async function createDrawing(scene: BaseScene, title: string, content: Record<string, unknown> | null): Promise<DriveNode> {
	const node = await createDocument(scene.api, scene.name(title), "Drawing");
	scene.defer(() => discardNode(scene.api, node.name));
	if (content) await writeDrawing(scene.api, node.name, content);
	return node;
}

async function writeDrawing(api: APIRequestContext, node: string, content: Record<string, unknown>): Promise<void> {
	const current = await api.get(`/api/suite/draw/documents/${node}`);
	// SAFETY: Draw's document read answers `{ data: { modified } }` among other fields.
	const { data } = (await current.json()) as { data: { modified: string } };
	const write = await api.put(`/api/suite/draw/documents/${node}`, {
		data: { content: JSON.stringify(content), base_modified: data.modified },
	});
	if (!write.ok()) throw new Error(`Seeding the drawing failed: ${write.status()}`);
}

function status(page: Page, text: string) {
	return page.getByRole("status").filter({ hasText: new RegExp(`^${text}$`) });
}

async function expectSaved(page: Page): Promise<void> {
	await expect(status(page, "Saved")).toBeVisible({ timeout: 20_000 });
}

function objects(page: Page, selected: number, total: number) {
	return page.getByRole("listbox", { name: `Drawing objects, ${selected} of ${total} selected` });
}

async function tool(page: Page, name: string): Promise<void> {
	await page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("button", { name, exact: true }).click();
}

async function moreTool(page: Page, name: string): Promise<void> {
	await page.getByRole("button", { name: "More tools" }).click();
	await page.getByRole("menuitem", { name }).click();
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
	await page.mouse.move(to.x, to.y, { steps: 6 });
	await page.mouse.up();
}

async function drawShape(page: Page, name: string): Promise<void> {
	await tool(page, name);
	await drag(page, FREE, { x: FREE.x + 170, y: FREE.y + 100 });
	await expect(objects(page, 1, FLOWCHART_OBJECTS + 1)).toBeAttached();
}

async function drawStroke(page: Page): Promise<void> {
	await page.mouse.move(FREE.x, FREE.y + 40);
	await page.mouse.down();
	for (let step = 1; step <= 20; step++) await page.mouse.move(FREE.x + step * 15, FREE.y + 40 + Math.sin(step / 2) * 30);
	await page.mouse.up();
}

/** Keeps the pointer moving while the screenshot is taken, so the laser trail has not faded. */
function keepPointing(page: Page): void {
	void (async () => {
		for (let step = 0; step < 40; step++) {
			await page.mouse.move(700 + Math.cos(step / 4) * 160, 680 + Math.sin(step / 4) * 60);
			await page.waitForTimeout(30);
		}
		await page.mouse.up();
	})().catch(() => undefined);
}

/** Holds Draw's document writes while reads pass, then fails them on demand. */
async function gateWrites(page: Page): Promise<{ fail(): Promise<void> }> {
	const held: Route[] = [];
	let failing = false;
	const reject = (route: Route) =>
		route
			.fulfill({
				status: 500,
				contentType: "application/json",
				body: JSON.stringify({ exc_type: "ServerError", message: "Something went wrong" }),
			})
			.catch(() => undefined);
	await page.route(DOCUMENTS, async (route) => {
		if (route.request().method() === "GET") await route.continue();
		else if (failing) await reject(route);
		else held.push(route);
	});
	return {
		async fail() {
			failing = true;
			await Promise.all(held.splice(0).map(reject));
		},
	};
}
const writes = perScene<{ fail(): Promise<void> }>("draw: held writes");

async function openAs(scene: BaseScene, role: number): Promise<Page> {
	await grantAccess(scene.api, drawings.get(scene).name, LEO.email, role);
	const page = await scene.pageAs(LEO);
	await page.goto(`/d/${drawings.get(scene).name}`);
	return page;
}

export const draw = defineFlow<Event, BaseScene>({
	id: "draw",
	title: "Draw",
	source: "frontend/src/apps/draw/App.vue, surface/DrawSurface.vue, components/InfiniteCanvas.vue, canvas/persistence.ts",
	open: (browser) => openDemoScene(browser, "maya"),
	machine,
	async enter(scene) {
		drawings.set(scene, await createDrawing(scene, "Launch flow", FLOWCHART));
		await scene.goto(`/d/${drawings.get(scene).name}`);
		await expectSaved(scene.page);
		await expect(objects(scene.page, 0, FLOWCHART_OBJECTS)).toBeAttached();
	},
	events: {
		async OPEN_BLANK(scene) {
			const blank = await createDrawing(scene, "Untitled sketch", null);
			await scene.goto(`/d/${blank.name}`);
			await expectSaved(scene.page);
			await expect(objects(scene.page, 0, 0)).toBeAttached();
		},
		async DRAW_RECTANGLE(scene) {
			await drawShape(scene.page, "Rectangle");
		},
		async UNDO(scene) {
			await scene.page.getByRole("button", { name: "Undo" }).click();
			await expect(objects(scene.page, 0, FLOWCHART_OBJECTS)).toBeAttached();
		},
		async DRAW_DIAMOND(scene) {
			await drawShape(scene.page, "Diamond");
		},
		async DRAW_ELLIPSE(scene) {
			await drawShape(scene.page, "Ellipse");
		},
		async DRAW_LINE(scene) {
			await drawShape(scene.page, "Line");
		},
		async DRAW_ARROW(scene) {
			await drawShape(scene.page, "Arrows");
		},
		async DRAW_PEN(scene) {
			await tool(scene.page, "Draw");
			await drawStroke(scene.page);
			await expect(scene.page.getByRole("option")).toHaveCount(FLOWCHART_OBJECTS + 1);
		},
		async ERASE(scene) {
			const { page } = scene;
			await tool(page, "Eraser");
			await page.mouse.move(FREE.x - 20, FREE.y + 40);
			await page.mouse.down();
			await page.mouse.move(FREE.x + 320, FREE.y + 50, { steps: 12 });
			// The button stays down: the stroke is only marked until release.
			await expect(page.getByRole("option")).toHaveCount(FLOWCHART_OBJECTS + 1);
		},
		async RELEASE(scene) {
			await scene.page.mouse.up();
			await expect(scene.page.getByRole("option")).toHaveCount(FLOWCHART_OBJECTS);
		},
		async TYPE_TEXT(scene) {
			await tool(scene.page, "Text");
			await scene.page.mouse.click(FREE.x + 400, FREE.y + 60);
			await scene.page.keyboard.type("Ship by Friday");
			await expect(scene.page.getByRole("textbox", { name: "Text editor" })).toBeFocused();
		},
		async FINISH_TEXT(scene) {
			await scene.page.keyboard.press("Escape");
			await expect(scene.page.getByRole("textbox", { name: "Text editor" })).toBeHidden();
		},
		async OPEN_MORE(scene) {
			await scene.page.getByRole("button", { name: "More tools" }).click();
			await expect(scene.page.getByRole("menuitem", { name: "Lasso Select" })).toBeVisible();
		},
		async INSERT_IMAGE(scene) {
			const chooser = scene.page.waitForEvent("filechooser");
			await scene.page.getByRole("menuitem", { name: "Insert Image" }).click();
			await (await chooser).setFiles(`${__dirname}/../fixtures/Logo.png`);
			await expect(objects(scene.page, 1, FLOWCHART_OBJECTS + 1)).toBeAttached({ timeout: 20_000 });
		},
		async LASER(scene) {
			const { page } = scene;
			await page.getByRole("menuitem", { name: "Laser Pointer" }).click();
			await expect(page.getByRole("menu")).toBeHidden();
			await page.mouse.move(500, 680);
			await page.mouse.down();
			await page.mouse.move(700, 700, { steps: 10 });
		},
		async LASSO(scene) {
			const { page } = scene;
			await page.getByRole("menuitem", { name: "Lasso Select" }).click();
			await page.mouse.move(280, 330);
			await page.mouse.down();
			for (const [x, y] of [
				[1160, 330],
				[1160, 620],
				[280, 620],
				[280, 340],
			]) {
				await page.mouse.move(x, y, { steps: 8 });
			}
			await page.mouse.up();
			await expect(objects(page, FLOWCHART_OBJECTS, FLOWCHART_OBJECTS)).toBeAttached();
		},
		async SELECT_SHAPE(scene) {
			await scene.page.mouse.click(BRIEF_EDGE.x, BRIEF_EDGE.y);
			await expect(objects(scene.page, 1, FLOWCHART_OBJECTS)).toBeAttached();
			await expect(scene.page.getByRole("toolbar", { name: "Property bar" })).toBeVisible();
		},
		async OPEN_COLOR(scene) {
			await scene.page.getByRole("button", { name: "Custom color" }).click();
			await expect(scene.page.getByText("Fill Color")).toBeVisible();
		},
		async ZOOM_IN(scene) {
			await scene.page.getByRole("button", { name: "Zoom in" }).click();
			await expect(scene.page.getByRole("button", { name: "Reset zoom to 100%" })).toHaveText(/110%/);
		},
		async RENAME(scene) {
			await scene.page.getByRole("button", { name: "Rename drawing" }).click();
			await expect(scene.page.getByRole("textbox", { name: "Drawing title" })).toBeFocused();
		},
		async OPEN_HELD(scene) {
			await scene.hold(DOCUMENTS);
			await scene.page.reload();
			await expect(status(scene.page, "Loading…")).toBeVisible();
		},
		async LOAD_FAILS(scene) {
			await scene.lastHold.abort(500);
			await expect(status(scene.page, "Could not load")).toBeVisible({ timeout: 30_000 });
			await expect(scene.page.getByRole("alert")).toBeVisible();
		},
		async SAVE_HELD(scene) {
			writes.set(scene, await gateWrites(scene.page));
			await drawShape(scene.page, "Rectangle");
			await expect(status(scene.page, "Saving…")).toBeVisible();
		},
		async SAVE_FAILS(scene) {
			await writes.get(scene).fail();
			await expect(scene.page.getByRole("button", { name: "Retry save" })).toBeVisible({ timeout: 30_000 });
		},
		async OTHER_EDITS(scene) {
			const leo = await openAs(scene, ROLE.EDIT);
			await expectSaved(leo);
			const saved = leo.waitForResponse(
				(response) => DOCUMENTS.test(response.url()) && response.request().method() === "PUT" && response.ok(),
				{ timeout: 20_000 },
			);
			await tool(leo, "Rectangle");
			await drag(leo, { x: 900, y: 640 }, { x: 1060, y: 730 });
			await saved;
			await drawShape(scene.page, "Ellipse");
			await expect(scene.page.getByRole("alert")).toBeVisible({ timeout: 20_000 });
		},
		async OPEN_AS_VIEWER(scene) {
			const page = await openAs(scene, ROLE.READ);
			viewers.set(scene, page);
			await expect(page.getByText("View only")).toBeVisible({ timeout: 20_000 });
		},
		async PHONE(scene) {
			await scene.page.setViewportSize({ width: 390, height: 844 });
			await expect(scene.page.getByRole("toolbar", { name: "Drawing tools" })).toBeVisible();
		},
	},
	settle: {
		async laserTrail(scene) {
			keepPointing(scene.page);
		},
	},
	frame(scene, state) {
		return state === "viewOnly" ? viewers.get(scene).locator("body") : null;
	},
});
