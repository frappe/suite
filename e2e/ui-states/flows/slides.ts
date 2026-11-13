import { expect, type Page } from "@playwright/test";
import { grantAccess, ROLE, type DriveNode } from "../../drive-backed-apps/helpers/drive";
import { demoUser, openDemoScene } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import { perScene, type BaseScene, type Hold } from "../scene";
import { copySeededDeck, createDeck, expectEditor, withoutServiceWorker } from "./slides-helpers";
import { header, updates } from "./writer-sheets-helpers";

type Event =
	| { type: "OPEN_HELD" }
	| { type: "HOST_FAILS" }
	| { type: "RETRY_HELD" }
	| { type: "DECK_FAILS" }
	| { type: "OPEN_MISSING" }
	| { type: "OPEN_AS_VIEWER" }
	| { type: "OPEN_NEW" }
	| { type: "PICK_THEME" }
	| { type: "SELECT_TEXT" }
	| { type: "EDIT_TEXT" }
	| { type: "RIGHT_CLICK_SHAPE" }
	| { type: "ADD_IMAGE" }
	| { type: "RIGHT_CLICK_IMAGE" }
	| { type: "CROP" }
	| { type: "OPEN_SHAPES" }
	| { type: "DRAW_RECTANGLE" }
	| { type: "OPEN_LINES" }
	| { type: "OPEN_TABLE" }
	| { type: "INSERT_TABLE" }
	| { type: "RIGHT_CLICK_BLANK" }
	| { type: "RIGHT_CLICK_THUMBNAIL" }
	| { type: "ADD_SLIDE" }
	| { type: "PICK_LAYOUT" }
	| { type: "OPEN_DECK_MENU" }
	| { type: "CHANGE_THEME" }
	| { type: "SHORTCUTS" }
	| { type: "OPEN_PRESENT_OPTIONS" }
	| { type: "PRESENT" }
	| { type: "NEXT" }
	| { type: "LAST" }
	| { type: "FINISH" }
	| { type: "EXIT" }
	| { type: "EXPORT" }
	| { type: "OPEN_COMMENTS" }
	| { type: "START_COMMENT" }
	| { type: "ADD_COMMENT" }
	| { type: "OPEN_VERSIONS" }
	| { type: "SAVE_VERSION" }
	| { type: "NAME_VERSION" }
	| { type: "OPEN_OFFLINE" }
	| { type: "SAVE_COPY" }
	| { type: "TYPE_HELD" }
	| { type: "PHONE" };

/**
 * A presentation opened at /d/:node. The host (`DocumentHost.vue`) chooses
 * between its header skeleton, a failure, a refusal and the surface; the
 * surface (`SlidesSurface.vue`) then chooses between unreadable, its own
 * skeleton, a load error, the phone viewer and the editor. The editor saves
 * through the deck's collaboration room (`useConvertedRoom.ts`), so a second
 * tab edits alongside the first. The slideshow is the `slides-slideshow` route
 * at /d/:node/present.
 */
const machine = setupFlow<Event>().createMachine({
	id: "slides",
	initial: "editor",
	states: {
		editor: {
			meta: { description: "A five-slide deck open for editing: the slide list on the left, the first slide in the middle, the toolbar below it, and the slide's Background, Transition and Playback settings on the right." },
			on: {
				OPEN_HELD: "hostOpening",
				OPEN_MISSING: "noAccess",
				OPEN_AS_VIEWER: "viewOnly",
				OPEN_NEW: "themePicker",
				SELECT_TEXT: "textSelected",
				RIGHT_CLICK_SHAPE: "elementMenu",
				ADD_IMAGE: "imageSelected",
				OPEN_SHAPES: "shapesMenu",
				OPEN_LINES: "linesMenu",
				OPEN_TABLE: "tablePicker",
				RIGHT_CLICK_BLANK: "canvasMenu",
				RIGHT_CLICK_THUMBNAIL: "slideMenu",
				ADD_SLIDE: "layoutPicker",
				OPEN_DECK_MENU: "deckMenu",
				OPEN_PRESENT_OPTIONS: "presentOptions",
				PRESENT: "showFirst",
				EXPORT: "exportPrint",
				OPEN_COMMENTS: "commentsEmpty",
				OPEN_VERSIONS: "versions",
				OPEN_OFFLINE: "offlineDialog",
				TYPE_HELD: "saving",
				PHONE: "phoneViewer",
			},
		},
		hostOpening: {
			meta: { description: "The document's details are still loading: the Suite rail, a grey header skeleton and an empty page." },
			on: { HOST_FAILS: "hostFailed" },
		},
		hostFailed: {
			meta: { description: "The document's details failed to load: “Could not open this document”, a line asking to try again in a moment, and Try again." },
			on: { RETRY_HELD: "deckOpening" },
		},
		deckOpening: {
			meta: { description: "The header has loaded and the slides are still loading: grey blocks for the slide list and the slide, and Present is disabled. The header says “View only” to Maya, who owns the deck, until the slides arrive." },
			on: { DECK_FAILS: "deckFailed" },
		},
		deckFailed: {
			meta: { description: "The slides failed to load: a lock icon over “Something went wrong”, with no way to try again. The header still says “View only” to the deck's owner." },
		},
		noAccess: {
			meta: { description: "A link to a presentation that does not exist, or that this person cannot open: “You don’t have access to this document.”" },
		},
		viewOnly: {
			meta: { description: "Leo has View access: a “View only” badge beside the title, and the slides without the toolbar, the properties panel or Add slide." },
		},
		themePicker: {
			meta: { description: "A new, empty presentation opens with “Select theme”: Light and Dark, with no close button." },
			on: { PICK_THEME: "themedDeck" },
		},
		themedDeck: {
			meta: { description: "Dark picked: the new deck's only slide is black with a Title and Subtitle placeholder." },
		},
		textSelected: {
			meta: { description: "A heading selected: handles around it, and the panel shows Frame, Arrange, Font and Paragraph." },
			on: { EDIT_TEXT: "textEditing" },
		},
		textEditing: {
			meta: { description: "Double-clicking the heading starts text editing with its words selected." },
		},
		elementMenu: {
			meta: { description: "Right-click on the callout box selects it and opens the element menu: Copy, Duplicate, Flip horizontal, Flip vertical, Order, Align, Lock and Delete." },
		},
		imageSelected: {
			meta: { description: "An image uploaded from the toolbar lands selected in the middle of the slide, over the subtitle; the panel shows Image with Replace and Crop, and a toast says it was uploaded." },
			on: { RIGHT_CLICK_IMAGE: "imageMenu" },
		},
		imageMenu: {
			meta: { description: "Right-click on the image: the element menu with Crop added." },
			on: { CROP: "cropping" },
		},
		cropping: {
			meta: { description: "Crop mode: the image's outline turns into dashed crop edges with bars at the corners and sides." },
		},
		shapesMenu: {
			meta: { description: "The shapes tool's menu: Rectangle, Oval, Diamond, Triangle and Pentagon." },
			on: { DRAW_RECTANGLE: "shapeSelected" },
		},
		shapeSelected: {
			meta: { description: "A rectangle dragged out on the slide, dark grey and selected; the panel shows Style with stroke, fill and corner radius." },
		},
		linesMenu: {
			meta: { description: "The lines tool's menu: Line, Arrow, Double arrow, Connector and Elbow connector." },
		},
		tablePicker: {
			meta: { description: "The table tool opens an 8 × 6 grid of cells, labelled Insert table, for picking a size." },
			on: { INSERT_TABLE: "tableSelected" },
		},
		tableSelected: {
			meta: { description: "A 3 × 3 table inserted and selected over the subtitle; the panel shows Table (rows, columns, headers, banded rows) and Grid." },
		},
		canvasMenu: {
			meta: { description: "Right-click on an empty part of the slide: Select all and Lock all, then New, Duplicate and Delete for the slide." },
		},
		slideMenu: {
			meta: { description: "Right-click on a slide in the list: New, Duplicate and Delete." },
		},
		layoutPicker: {
			meta: { description: "Add slide asks for one of the theme's seven layouts: “Select a layout”." },
			on: { PICK_LAYOUT: "slideAdded" },
		},
		slideAdded: {
			meta: { description: "The Title layout added as slide 6 and opened: a white slide with “Title” in the middle." },
		},
		deckMenu: {
			meta: { description: "The presentation menu: Back to folder, Change theme, Shortcuts, Duplicate and Delete." },
			on: { CHANGE_THEME: "themeChanger", SHORTCUTS: "shortcuts" },
		},
		themeChanger: {
			meta: { description: "Change theme opens “Set theme”, with a tick under Light, the deck's current theme, and a close button." },
		},
		shortcuts: {
			meta: { description: "Keyboard shortcuts, opened from the presentation menu: Suite, Insert, Edit, Move, Format text and Slideshow, with a search box." },
		},
		presentOptions: {
			meta: { description: "The menu beside Present: From the start and On loop." },
		},
		showFirst: {
			meta: { description: "The slideshow at /present: the first slide fills the screen, with black bars above and below." },
			on: { NEXT: "showSecond" },
		},
		showSecond: {
			meta: { description: "The right arrow key moves the slideshow to the second slide." },
			on: { LAST: "showLast" },
		},
		showLast: {
			meta: { description: "The End key jumps to the fifth and last slide." },
			on: { FINISH: "showEnd" },
		},
		showEnd: {
			meta: { description: "Past the last slide: the end screen with Back and Replay." },
			on: { EXIT: "backFromShow" },
		},
		backFromShow: {
			meta: { description: "Back leaves the slideshow and opens the editor at the slide where the show ended, 5 of 5." },
		},
		exportPrint: {
			meta: { description: "Export opens the browser's print: in print media the editor is gone and the slides are laid out one after another." },
		},
		commentsEmpty: {
			meta: { description: "The comments panel on a deck with no comments: an “Add a comment” box at the top and “No open comments. Add one above.” A deck takes comments on the whole deck only, not on a slide or its text." },
			on: { START_COMMENT: "commentDraft" },
		},
		commentDraft: {
			meta: { description: "The comment box opened: a focused field, and Cancel and a Comment button that stays disabled until something is written." },
			on: { ADD_COMMENT: "commentPosted" },
		},
		commentPosted: {
			meta: { description: "The comment added: it shows under the box with Maya Chen's avatar, name and time, a Reply field, and a check to resolve it." },
		},
		versions: {
			meta: { description: "The versions panel on a new deck: “No versions yet.” with a line about what a version keeps, and Save version at the top." },
			on: { SAVE_VERSION: "versionNaming" },
		},
		versionNaming: {
			meta: { description: "Save version asks for a name first: “Save a version” with a required Name field." },
			on: { NAME_VERSION: "versionSaved" },
		},
		versionSaved: {
			meta: { description: "The named version is listed with its time, Maya's name and Restore, and a toast says “Version saved”." },
		},
		offlineDialog: {
			meta: { description: "The offline-copy button asks before keeping a copy on this device: “Save offline copy”." },
			on: { SAVE_COPY: "availableOffline" },
		},
		availableOffline: {
			meta: { description: "The copy is kept: a toast says “Available offline” and the cloud button's tooltip says the same." },
		},
		saving: {
			meta: {
				description:
					"The Text tool added a text box and its save is still out. The header reads Edited just now, as it does once saved: nothing on screen tells saving from saved.",
			},
		},
		phoneViewer: {
			meta: { description: "At phone width the deck opens in a viewer: one slide at a time with arrows and “1 of 5” above the app's bottom tab bar, and no editing tools." },
		},
	},
});

interface Probe {
	page: Page;
	node: Hold;
	deck: Hold | null;
}

const decks = perScene<DriveNode>("slides: deck");
const probes = perScene<Probe>("slides: probe page");
const others = perScene<Page>("slides: other page");
const PROBE_STATES = new Set(["hostOpening", "hostFailed", "deckOpening", "deckFailed"]);
const OTHER_STATES = new Set(["viewOnly"]);
const LEO = demoUser("leo");

/** The slide's top-left heading, in the 1440 × 900 viewport. */
const HEADING = { x: 500, y: 349 };
/** Inside the card on the first slide, clear of its text. */
const CARD = { x: 1062, y: 630 };
/** Empty slide background between the cards. */
const BLANK = { x: 1000, y: 520 };
/** The second slide in the slide list. */
const SECOND_THUMBNAIL = { x: 110, y: 268 };
/** Where an uploaded image lands: the middle of the slide. */
const IMAGE = { x: 688, y: 474 };

function deckPath(scene: BaseScene): string {
	return `/d/${decks.get(scene).name}`;
}

function toolbar(page: Page) {
	return page.locator("svg.lucide-shapes").locator("xpath=ancestor::div[contains(@class,'bottom-10')]");
}

function commentsPanel(page: Page) {
	return page.getByRole("complementary", { name: "Comments" });
}

async function rightClick(page: Page, at: { x: number; y: number }): Promise<void> {
	await page.mouse.click(at.x, at.y, { button: "right" });
}

/** The slideshow ignores keys until its first slide has mounted; press again until `arrived` holds. */
async function pressUntil(page: Page, key: string, arrived: () => Promise<void>): Promise<void> {
	await expect(async () => {
		await page.keyboard.press(key);
		await arrived();
	}).toPass({ timeout: 15_000 });
}

async function openAs(scene: BaseScene, role: number): Promise<Page> {
	await grantAccess(scene.api, decks.get(scene).name, LEO.email, role);
	const page = await scene.pageAs(LEO);
	await page.goto(deckPath(scene));
	return page;
}

export const slides = defineFlow<Event, BaseScene>({
	id: "slides",
	title: "Slides",
	source: "frontend/src/composition/DocumentHost.vue, frontend/src/apps/slides/surface/SlidesSurface.vue",
	open: (browser) => openDemoScene(browser, "maya"),
	machine,
	async enter(scene) {
		decks.set(scene, await copySeededDeck(scene, "Q4 planning deck"));
		await scene.goto(deckPath(scene));
		await expectEditor(scene.page);
	},
	events: {
		async OPEN_HELD(scene) {
			const page = await scene.pageAs(demoUser("maya"));
			await withoutServiceWorker(page);
			const node = decks.get(scene).name;
			probes.set(scene, { page, node: await scene.hold(new RegExp(`/api/suite/drive/nodes/${node}\\?`), page), deck: null });
			await page.goto(deckPath(scene));
			await expect(page.getByRole("status", { name: /^Opening/ }).first()).toBeVisible();
		},
		async HOST_FAILS(scene) {
			const { page, node } = probes.get(scene);
			await node.abort(500);
			await expect(page.getByText("Could not open this document")).toBeVisible({ timeout: 30_000 });
		},
		async RETRY_HELD(scene) {
			const probe = probes.get(scene);
			probe.deck = await scene.hold(/get_public_presentation/, probe.page);
			await probe.node.release();
			await probe.page.getByRole("button", { name: "Try again" }).click();
			await expect(probe.page.getByRole("status", { name: "Opening presentation" })).toBeVisible({ timeout: 15_000 });
		},
		async DECK_FAILS(scene) {
			const { page, deck } = probes.get(scene);
			if (!deck) throw new Error("The deck read was never held");
			await deck.abort(500);
			await expect(page.getByRole("status", { name: "Opening presentation" })).toBeHidden({ timeout: 30_000 });
			await expect(page.getByText("Something went wrong")).toBeVisible();
		},
		async OPEN_MISSING(scene) {
			await scene.goto("/d/zzzzzzzzzz");
			await expect(scene.page.getByText(/have access to this document/)).toBeVisible({ timeout: 15_000 });
		},
		async OPEN_AS_VIEWER(scene) {
			const page = await openAs(scene, ROLE.READ);
			others.set(scene, page);
			await expectEditor(page);
			await expect(page.locator("svg.lucide-shapes")).toBeHidden();
		},
		async OPEN_NEW(scene) {
			const blank = await createDeck(scene, "Board update");
			await scene.goto(`/d/${blank.name}?new=1`);
			await expect(scene.page.getByText("Select theme")).toBeVisible({ timeout: 20_000 });
		},
		async PICK_THEME(scene) {
			await scene.dialog("Select theme").locator(".aspect-video").nth(1).click();
			await expect(scene.page.getByText("Select theme")).toBeHidden();
			await expect(scene.page.getByText("1 of 1", { exact: true })).toBeVisible();
		},
		async SELECT_TEXT(scene) {
			await scene.page.mouse.click(HEADING.x, HEADING.y);
			await expect(scene.page.getByText("Paragraph", { exact: true })).toBeVisible();
		},
		async EDIT_TEXT(scene) {
			await scene.page.mouse.dblclick(HEADING.x, HEADING.y);
			await expect.poll(() => scene.page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable)).toBe(true);
		},
		async RIGHT_CLICK_SHAPE(scene) {
			await rightClick(scene.page, CARD);
			await expect(scene.page.getByRole("menuitem", { name: "Flip horizontal" })).toBeVisible();
		},
		async ADD_IMAGE(scene) {
			await toolbar(scene.page).locator("input[type=file]").setInputFiles(`${__dirname}/../fixtures/Logo.png`);
			await expect(scene.page.getByText("Replace", { exact: true })).toBeVisible({ timeout: 20_000 });
		},
		async RIGHT_CLICK_IMAGE(scene) {
			await rightClick(scene.page, IMAGE);
			await expect(scene.page.getByRole("menuitem", { name: "Crop" })).toBeVisible();
		},
		async CROP(scene) {
			await scene.page.getByRole("menuitem", { name: "Crop" }).click();
			await expect(scene.page.getByRole("menu")).toBeHidden();
		},
		async OPEN_SHAPES(scene) {
			await scene.page.locator("svg.lucide-shapes").click();
			await expect(scene.page.getByRole("menuitem", { name: "Pentagon" })).toBeVisible();
		},
		async DRAW_RECTANGLE(scene) {
			const { page } = scene;
			await page.getByRole("menuitem", { name: "Rectangle" }).click();
			await page.mouse.move(800, 480);
			await page.mouse.down();
			await page.mouse.move(900, 520, { steps: 5 });
			await page.mouse.move(1000, 560, { steps: 5 });
			await page.mouse.up();
			await expect(page.getByText("Style", { exact: true })).toBeVisible();
		},
		async OPEN_LINES(scene) {
			await toolbar(scene.page).locator(":scope > *").nth(3).click();
			await expect(scene.page.getByRole("menuitem", { name: "Elbow connector" })).toBeVisible();
		},
		async OPEN_TABLE(scene) {
			await scene.page.locator("svg.lucide-table").click();
			await expect(scene.page.getByRole("dialog").filter({ hasText: "Insert table" })).toBeVisible();
		},
		async INSERT_TABLE(scene) {
			const cell = scene.page.getByRole("dialog").locator("div.flex.gap-1 > div.size-4").nth(2 * 8 + 2);
			await cell.hover();
			await cell.click();
			await expect(scene.page.getByRole("dialog")).toBeHidden();
			await expect(scene.page.getByText("Table", { exact: true }).first()).toBeVisible();
		},
		async RIGHT_CLICK_BLANK(scene) {
			await rightClick(scene.page, BLANK);
			await expect(scene.page.getByRole("menuitem", { name: "Select all" })).toBeVisible();
		},
		async RIGHT_CLICK_THUMBNAIL(scene) {
			await rightClick(scene.page, SECOND_THUMBNAIL);
			await expect(scene.page.getByRole("menuitem")).toHaveCount(3);
		},
		async ADD_SLIDE(scene) {
			await scene.page.getByText("Add slide").click();
			await expect(scene.page.getByRole("dialog", { name: "Select a layout" })).toBeVisible();
		},
		async PICK_LAYOUT(scene) {
			const dialog = scene.page.getByRole("dialog", { name: "Select a layout" });
			await dialog.locator(".grid > div").nth(1).click();
			await expect(dialog).toBeHidden();
			await expect(scene.page.getByText("6 of 6", { exact: true })).toBeVisible();
		},
		async OPEN_DECK_MENU(scene) {
			await scene.page.getByRole("button", { name: "Presentation menu" }).click();
			await expect(scene.page.getByRole("menuitem", { name: "Change theme" })).toBeVisible();
		},
		async CHANGE_THEME(scene) {
			await scene.page.getByRole("menuitem", { name: "Change theme" }).click();
			await expect(scene.page.getByText("Set theme")).toBeVisible();
		},
		async SHORTCUTS(scene) {
			await scene.page.getByRole("menuitem", { name: "Shortcuts" }).click();
			await expect(scene.page.getByRole("dialog")).toBeVisible();
		},
		async OPEN_PRESENT_OPTIONS(scene) {
			await scene.page.getByRole("button", { name: "Presentation options" }).click();
			await expect(scene.page.getByRole("menuitem", { name: "On loop" })).toBeVisible();
		},
		async PRESENT(scene) {
			await scene.page.getByRole("button", { name: "Present", exact: true }).click();
			await expect(scene.page).toHaveURL(/\/present/);
		},
		async NEXT(scene) {
			await pressUntil(scene.page, "ArrowRight", async () => expect(scene.page).toHaveURL(/slide=2/, { timeout: 2_000 }));
		},
		async LAST(scene) {
			await pressUntil(scene.page, "End", async () => expect(scene.page).toHaveURL(/slide=5/, { timeout: 2_000 }));
		},
		async FINISH(scene) {
			await pressUntil(scene.page, "ArrowRight", async () =>
				expect(scene.page.getByRole("button", { name: "Replay" })).toBeVisible({ timeout: 2_000 }),
			);
		},
		async EXIT(scene) {
			// Escape is ignored while the show is fullscreen, as it always is here; Back is the way out.
			await scene.page.getByRole("button", { name: "Back" }).click();
			await expect(scene.page).not.toHaveURL(/\/present/);
			await expect(scene.page.getByText("5 of 5", { exact: true })).toBeVisible();
		},
		async EXPORT(scene) {
			const { page } = scene;
			await page.evaluate(() => {
				window.print = () => undefined;
			});
			await page.getByRole("button", { name: "Export", exact: true }).click();
			await expect(page.locator(".slide-page")).toHaveCount(5);
			await page.emulateMedia({ media: "print" });
		},
		async OPEN_COMMENTS(scene) {
			await scene.page.getByRole("button", { name: "Comments" }).click();
			await expect(commentsPanel(scene.page).getByText("No open comments. Add one above.")).toBeVisible();
		},
		async START_COMMENT(scene) {
			await commentsPanel(scene.page).getByRole("button", { name: "Add a comment" }).click();
			await expect(commentsPanel(scene.page).getByRole("combobox", { name: "Add a comment" })).toBeFocused();
		},
		async ADD_COMMENT(scene) {
			const panel = commentsPanel(scene.page);
			const text = "Can we move the hiring slide before the roadmap?";
			await panel.getByRole("combobox", { name: "Add a comment" }).fill(text);
			await panel.getByRole("button", { name: "Comment", exact: true }).click();
			await expect(panel.getByText(text)).toBeVisible();
			await expect(panel.getByText("No open comments", { exact: false })).toBeHidden();
		},
		async OPEN_VERSIONS(scene) {
			await scene.page.getByRole("button", { name: "Versions" }).click();
			await expect(scene.page.getByRole("button", { name: "Save version" })).toBeVisible();
		},
		async SAVE_VERSION(scene) {
			await scene.page.getByRole("button", { name: "Save version" }).click();
			await expect(scene.dialog("Save a version")).toBeVisible();
		},
		async NAME_VERSION(scene) {
			const dialog = scene.dialog("Save a version");
			await dialog.getByRole("textbox").fill("Before the board review");
			await dialog.getByRole("button", { name: "Save", exact: true }).click();
			await expect(dialog).toBeHidden();
			await expect(scene.page.getByText("Before the board review")).toBeVisible({ timeout: 15_000 });
		},
		async OPEN_OFFLINE(scene) {
			await scene.page.locator("button:has(svg.lucide-cloud-download)").click();
			await expect(scene.page.getByRole("dialog", { name: "Save offline copy" })).toBeVisible();
		},
		async SAVE_COPY(scene) {
			await scene.page.getByRole("button", { name: "Save copy" }).click();
			await expect(scene.toast("Available offline")).toBeVisible({ timeout: 20_000 });
		},
		async TYPE_HELD(scene) {
			await scene.hold(updates(decks.get(scene).name));
			await scene.page.locator("svg.lucide-type").click();
			await expect(header(scene.page, "saving")).toBeVisible({ timeout: 20_000 });
		},
		async PHONE(scene) {
			await scene.page.setViewportSize({ width: 390, height: 844 });
			await scene.page.reload();
			await expect(scene.page.getByRole("navigation", { name: "Slides" })).toBeVisible({ timeout: 20_000 });
		},
	},
	frame(scene, state) {
		if (PROBE_STATES.has(state)) return probes.get(scene).page.locator("body");
		if (OTHER_STATES.has(state)) return others.get(scene).locator("body");
		return null;
	},
});
