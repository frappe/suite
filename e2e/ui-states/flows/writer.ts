import { expect, type Locator, type Page } from "@playwright/test";
import { createDocument, discardNode, ROLE } from "../../drive-backed-apps/helpers/drive";
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
	updates,
	WRITER_DOCTYPE,
} from "./writer-sheets-helpers";

type Event =
	| { type: "RELOAD_HELD" }
	| { type: "FAILS" }
	| { type: "RELOAD_BODY_HELD" }
	| { type: "BODY_FAILS" }
	| { type: "OPEN_MISSING" }
	| { type: "OPEN_AS_STRANGER" }
	| { type: "OPEN_AS_VIEWER" }
	| { type: "OPEN_INSERT" }
	| { type: "PICK_EMBED" }
	| { type: "OPEN_TEXT_STYLE" }
	| { type: "OPEN_FONT" }
	| { type: "OPEN_COLOR" }
	| { type: "OPEN_LISTS" }
	| { type: "OPEN_ALIGN" }
	| { type: "OPEN_TABLE_PICKER" }
	| { type: "INSERT_TABLE" }
	| { type: "CLICK_TABLE" }
	| { type: "OPEN_ROW_OPTIONS" }
	| { type: "SLASH" }
	| { type: "FILTER" }
	| { type: "MENTION" }
	| { type: "PICK_PERSON" }
	| { type: "SELECT_TEXT" }
	| { type: "ADD_LINK" }
	| { type: "COMMENT" }
	| { type: "POST" }
	| { type: "CLICK_LINK" }
	| { type: "OPEN_DOCUMENT_MENU" }
	| { type: "LOCK" }
	| { type: "OPEN_COMMENTS" }
	| { type: "OPEN_VERSIONS" }
	| { type: "PREVIEW_VERSION" }
	| { type: "RESTORE" }
	| { type: "NAME_VERSION" }
	| { type: "RENAME_TAKEN" }
	| { type: "SHARE" }
	| { type: "GO_OFFLINE" }
	| { type: "RECONNECT" }
	| { type: "TYPE_HELD" }
	| { type: "SEED_RECOVERY" }
	| { type: "VIEW_COPY" }
	| { type: "PHONE" };

/**
 * A Writer document from `/d/:node`: the host's opening and refusals, the
 * editor's toolbar, inline menus and side panels, and what saving shows. In
 * the code this is `DocumentHost.vue`'s `loading`/`locked`/`error`/`refused`
 * chain, then `WriterSurface.vue`'s `hasLostReadAccess`/`hasFailedToOpen`/
 * `isLoading` chain over `useWriterCollab`'s `mode` ('opening' | 'readonly' |
 * 'unconverted' | 'live' | 'failed'), plus the `preview` union and `panel`.
 */
const machine = setupFlow<Event>().createMachine({
	id: "writer",
	initial: "ready",
	states: {
		ready: {
			meta: {
				description:
					"A Writer document with a heading, a link, a list and a table, saved. The amber strip says live updates are unavailable: this bench's socket server has no Suite collab handlers, so every live document polls.",
			},
			on: {
				RELOAD_HELD: "opening",
				RELOAD_BODY_HELD: "bodyLoading",
				OPEN_MISSING: "notFound",
				OPEN_AS_STRANGER: "noAccess",
				OPEN_AS_VIEWER: "viewOnly",
				OPEN_INSERT: "insertMenu",
				OPEN_TEXT_STYLE: "textStyleMenu",
				OPEN_FONT: "fontMenu",
				OPEN_COLOR: "colorPanel",
				OPEN_LISTS: "listsMenu",
				OPEN_ALIGN: "alignMenu",
				OPEN_TABLE_PICKER: "tableSizePicker",
				CLICK_TABLE: "tableControls",
				SLASH: "slashMenu",
				MENTION: "mentionMenu",
				SELECT_TEXT: "selectionToolbar",
				CLICK_LINK: "linkCard",
				OPEN_DOCUMENT_MENU: "documentMenu",
				OPEN_COMMENTS: "commentsEmpty",
				OPEN_VERSIONS: "versionsPanel",
				RENAME_TAKEN: "titleTaken",
				SHARE: "shareDialog",
				GO_OFFLINE: "offlineUnsaved",
				TYPE_HELD: "saving",
				SEED_RECOVERY: "recoveryBanner",
				PHONE: "phone",
			},
		},
		opening: {
			meta: { description: "The host opens the node: a header skeleton with the title the opener knew, and nothing under it yet." },
			on: { FAILS: "openFailed" },
		},
		openFailed: {
			meta: { description: "The node read failed: “Could not open this document”, “Something went wrong” and Try again, with the app rail back." },
		},
		bodyLoading: {
			meta: { description: "The node is open and the body is still loading: the real header, then a toolbar and paragraph skeleton." },
			on: { BODY_FAILS: "bodyFailed" },
		},
		bodyFailed: {
			meta: { description: "The body read failed: “This document couldn't be opened.” and Try again. The header keeps Share, Copy link and Star but loses the document menu, and the app rail comes back." },
		},
		notFound: {
			meta: {
				description:
					"A link to a document that does not exist. The host shows the same “You don’t have access to this document.” as a real refusal, by design, so the link does not say whether the item exists.",
			},
		},
		noAccess: {
			meta: { description: "Nisha opens a document nobody shared with her: a lock and “You don’t have access to this document.”" },
		},
		viewOnly: {
			meta: { description: "Leo, who has View, opens it: a View only badge, no toolbar and no Share button." },
		},
		insertMenu: {
			meta: { description: "Insert: Media (Image, Video, Attachment, From Drive, Embed) and Blocks (Table, Code block, Quote, Divider, Page break, Tab)." },
			on: { PICK_EMBED: "embedDialog" },
		},
		embedDialog: {
			meta: { description: "Insert Embed asks for a URL or embed code; Insert Embed stays off until there is one." },
		},
		textStyleMenu: {
			meta: { description: "Text style: Text, four headings, three kinds of list, code block and quote, the current one highlighted." },
		},
		fontMenu: {
			meta: { description: "Font: each family drawn in its own face, the current one highlighted." },
		},
		colorPanel: {
			meta: { description: "Color: text and background swatches in one panel." },
		},
		listsMenu: {
			meta: { description: "Lists: bulleted, numbered and to-do lists." },
		},
		alignMenu: {
			meta: { description: "Alignment: left, center, right and justify." },
		},
		tableSizePicker: {
			meta: { description: "Table opens a size grid under the button, three by three to start." },
			on: { INSERT_TABLE: "tableInserted" },
		},
		tableInserted: {
			meta: { description: "A new empty table with a header row, the caret in its first cell." },
		},
		tableControls: {
			meta: { description: "The caret in a table cell: row and column grips, Table options, and Add row and Add column at the edges." },
			on: { OPEN_ROW_OPTIONS: "tableRowMenu" },
		},
		tableRowMenu: {
			meta: { description: "Row options: Header row switch, row colors, insert, duplicate, clear, delete, and Delete table in red." },
		},
		slashMenu: {
			meta: { description: "Typing / on an empty line lists blocks to insert, grouped Text, Lists and so on, the first one highlighted." },
			on: { FILTER: "slashFiltered" },
		},
		slashFiltered: {
			meta: { description: "Typing after the slash narrows the list to the blocks that match." },
		},
		mentionMenu: {
			meta: { description: "Typing @ lists people, each marked “No access” when the document is not shared with them." },
			on: { PICK_PERSON: "mentionInserted" },
		},
		mentionInserted: {
			meta: { description: "The person picked is now a mention chip in the text." },
		},
		selectionToolbar: {
			meta: { description: "Selected text gets a floating bar: text style, marks, Link, Color, Highlight and Comment." },
			on: { ADD_LINK: "linkEditor", COMMENT: "commentDraft" },
		},
		linkEditor: {
			meta: { description: "Link from the selection bar: a “Paste or type a link” field with a tick. It is drawn near the top of the page, over the heading, not next to the selected text." },
		},
		commentDraft: {
			meta: { description: "Comment from the selection bar: the comments panel opens with a draft quoting the selected text." },
			on: { POST: "commentPosted" },
		},
		commentPosted: {
			meta: { description: "The comment posted: a thread in the panel and its text marked in the document." },
		},
		linkCard: {
			meta: { description: "Clicking a link shows its address with Open, Edit and Remove link." },
		},
		documentMenu: {
			meta: { description: "More document actions: Comments, Versions, Save version, Lock document, Download as DOCX or Markdown, and Import DOCX." },
			on: { LOCK: "locked" },
		},
		locked: {
			meta: { description: "Locked: a Locked badge beside the title and no toolbar, though the owner can still unlock it from the menu." },
		},
		commentsEmpty: {
			meta: { description: "The comments panel with no threads: how to add one, and Add a comment at the top." },
		},
		versionsPanel: {
			meta: { description: "The versions panel: Current version, then saved versions by day, one named “Before partner review”." },
			on: { PREVIEW_VERSION: "versionPreview", NAME_VERSION: "namingVersion" },
		},
		versionPreview: {
			meta: { description: "An older version shown read-only in the editor's place, with Restore and Back to current in a strip." },
			on: { RESTORE: "restoreConfirm" },
		},
		restoreConfirm: {
			meta: { description: "Restore asks first: the document goes back for everyone, and its current state is kept as a version." },
		},
		namingVersion: {
			meta: { description: "Save version opens a name field at the top of the versions panel." },
		},
		titleTaken: {
			meta: { description: "Renaming to a sibling's title: the refusal shows in red beside the title. It is cut off at “Try “P…”, so the free name it suggests cannot be read." },
		},
		shareDialog: {
			meta: { description: "Share from the header opens Drive's share dialog over the document." },
		},
		offlineUnsaved: {
			meta: { description: "Offline with an edit not yet sent: an Offline badge, and “Changes will sync” where the edited time was." },
			on: { RECONNECT: "syncedAgain" },
		},
		syncedAgain: {
			meta: { description: "Back online: the edit went out, the badge is gone and the header says Edited just now." },
		},
		saving: {
			meta: {
				description:
					"An edit sent and the push still out. The header reads Edited just now, as it does once saved: nothing on screen tells saving from saved.",
			},
		},
		documentFull: {
			meta: {
				description:
					"The document is at its size limit, so the last edit was refused: Not saved, and a strip saying why. Unreachable here: it needs Writer's test hooks (suite.writer.content.e2e_api), and the run's DEV_SERVER test server on port 8095 serves only the bench's default site, not the demo site.",
				transient: true,
			},
		},
		editingPaused: {
			meta: {
				description:
					"An admin held the document: Editing paused, no toolbar, and a strip saying why. Unreachable here: it needs Writer's test hooks (suite.writer.content.e2e_api), and the run's DEV_SERVER test server on port 8095 serves only the bench's default site, not the demo site.",
				transient: true,
			},
		},
		recoveryBanner: {
			meta: { description: "This device kept work it could not save: a blue strip says when, with View." },
			on: { VIEW_COPY: "recoveryPreview" },
		},
		recoveryPreview: {
			meta: { description: "The recovery copy shown read-only in the editor's place, with its actions in a strip." },
		},
		phone: {
			meta: { description: "At phone width the toolbar keeps what fits and folds the rest under More formatting." },
		},
		presence: {
			meta: {
				description:
					"Someone else in the document: their avatar in the header. Unreachable here: this bench's socket server does not answer suite_collab_rooms, so no presence reaches the page.",
				transient: true,
			},
		},
		remoteCursor: {
			meta: {
				description:
					"Someone else's caret and name in the text. Unreachable for the same reason as presence: carets travel over the collab socket.",
				transient: true,
			},
		},
	},
});

const documents = perScene<string>("writer: document");
const OTHER_PAGE_STATES = new Set(["noAccess", "viewOnly"]);

const CONTENT = [
	"<h1>Beacon beta launch</h1>",
	'<p>The beta opens to <a href="https://northwind.test/beacon">forty design partners</a> on 2 December.</p>',
	"<ul><li>Invite list frozen by Friday</li><li>Support rota agreed with Nisha</li></ul>",
	"<table><tr><th>Owner</th><th>Task</th></tr><tr><td>Leo</td><td>Onboarding emails</td></tr><tr><td>Arjun</td><td>Release build</td></tr></table>",
	"<p>Questions go to the #beacon channel.</p>",
].join("");

function editor(page: Page): Locator {
	return page.getByRole("textbox", { name: "Document editor" });
}

function toolbarButton(page: Page, name: string): Locator {
	return page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name, exact: true });
}

function panel(page: Page, name: string): Locator {
	return page.getByRole("complementary", { name });
}

async function paste(page: Page, html: string): Promise<void> {
	await editor(page).evaluate((element, markup) => {
		const clipboardData = new DataTransfer();
		clipboardData.setData("text/html", markup);
		element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
	}, html);
}

/** Puts the caret at the end of the last paragraph. */
async function caretAtEnd(page: Page): Promise<void> {
	await editor(page).getByText("Questions go to the #beacon channel.").click();
	await page.keyboard.press("End");
}

async function newLine(page: Page): Promise<void> {
	await caretAtEnd(page);
	await page.keyboard.press("Enter");
}

async function openDocumentMenu(page: Page): Promise<void> {
	await page.getByRole("button", { name: "More document actions" }).click();
	await expect(page.getByRole("menuitem", { name: "Versions" })).toBeVisible();
}

export const writer = defineFlow<Event, BaseScene>({
	id: "writer",
	title: "Writer",
	source: "frontend/src/composition/DocumentHost.vue, frontend/src/apps/writer/surface/WriterSurface.vue, useWriterCollab.ts (CollabMode)",
	open: (browser) => openDemoScene(browser, "maya"),
	machine,
	async enter(scene) {
		const node = await createPathDocument(scene, "Beacon beta launch plan", WRITER_DOCTYPE);
		documents.set(scene, node.name);
		await scene.goto(`/d/${node.name}`);
		await expect(editor(scene.page)).toBeVisible();
		await editor(scene.page).click();
		await paste(scene.page, CONTENT);
		await expect(editor(scene.page).locator("table")).toHaveCount(1);
		await expect(header(scene.page, "clean")).toBeVisible();
		await expectPollingBanner(scene.page);
	},
	frame(scene, state) {
		return OTHER_PAGE_STATES.has(state) ? framedPage(scene) : null;
	},
	events: {
		async RELOAD_HELD(scene) {
			await scene.hold(nodeRead(documents.get(scene)));
			await scene.page.reload();
			await expect(scene.page.getByRole("status", { name: /^Opening/ })).toBeVisible();
		},
		async FAILS(scene) {
			await scene.lastHold.abort(417);
			await expect(scene.page.getByRole("heading", { name: "Could not open this document" })).toBeVisible();
		},
		async RELOAD_BODY_HELD(scene) {
			await scene.hold(bodyRead(documents.get(scene)));
			await scene.page.reload();
			await expect(scene.page.getByRole("textbox", { name: "Document title" })).toBeVisible();
			await expect(scene.page.getByRole("status", { name: "Opening document" })).toBeVisible();
		},
		async BODY_FAILS(scene) {
			await scene.lastHold.abort(417);
			await expect(scene.page.getByRole("button", { name: "Try again" })).toBeVisible();
		},
		async OPEN_MISSING(scene) {
			await scene.goto("/d/zz00missing");
			await expect(scene.page.getByText(/have access to this document/)).toBeVisible();
		},
		async OPEN_AS_STRANGER(scene) {
			const page = await openAs(scene, "nisha", documents.get(scene));
			await expect(page.getByText(/have access to this document/)).toBeVisible();
		},
		async OPEN_AS_VIEWER(scene) {
			const node = documents.get(scene);
			await grantTo(scene, node, "leo", ROLE.READ);
			const page = await openAs(scene, "leo", node);
			await expect(page.getByText("View only", { exact: true })).toBeVisible();
			await expect(page.getByText("Onboarding emails")).toBeVisible();
		},
		async OPEN_INSERT(scene) {
			await caretAtEnd(scene.page);
			await toolbarButton(scene.page, "Insert").click();
			await expect(scene.page.getByRole("menuitem", { name: "Page break" })).toBeVisible();
		},
		async PICK_EMBED(scene) {
			await scene.page.getByRole("menuitem", { name: "Embed" }).click();
			await expect(scene.dialog("Insert Embed")).toBeVisible();
		},
		async OPEN_TEXT_STYLE(scene) {
			await caretAtEnd(scene.page);
			await toolbarButton(scene.page, "Text style").click();
			await expect(scene.page.getByRole("menuitem", { name: "Heading 2" })).toBeVisible();
		},
		async OPEN_FONT(scene) {
			await caretAtEnd(scene.page);
			await toolbarButton(scene.page, "Font").click();
			await expect(scene.page.getByRole("menu")).toBeVisible();
		},
		async OPEN_COLOR(scene) {
			await caretAtEnd(scene.page);
			await toolbarButton(scene.page, "Color").click();
			await expect(scene.page.getByRole("button", { name: "Red" }).first()).toBeVisible();
		},
		async OPEN_LISTS(scene) {
			await caretAtEnd(scene.page);
			await toolbarButton(scene.page, "Lists").click();
			await expect(scene.page.getByRole("menuitem", { name: /Bulleted list/ })).toBeVisible();
		},
		async OPEN_ALIGN(scene) {
			await caretAtEnd(scene.page);
			await toolbarButton(scene.page, "Alignment").click();
			await expect(scene.page.getByRole("menuitem", { name: "Align center" })).toBeVisible();
		},
		async OPEN_TABLE_PICKER(scene) {
			await newLine(scene.page);
			await toolbarButton(scene.page, "Table").click();
			await expect(scene.page.getByRole("grid", { name: /^Table size/ })).toBeVisible();
		},
		async INSERT_TABLE(scene) {
			await scene.page.getByLabel("3 × 3", { exact: true }).click();
			await expect(editor(scene.page).locator("table")).toHaveCount(2);
		},
		async CLICK_TABLE(scene) {
			await editor(scene.page).getByText("Onboarding emails").click();
			await expect(scene.page.getByRole("button", { name: "Row options" })).toBeVisible();
		},
		async OPEN_ROW_OPTIONS(scene) {
			await scene.page.getByRole("button", { name: "Row options" }).click();
			await expect(scene.page.getByRole("menuitem", { name: "Insert above" })).toBeVisible();
		},
		async SLASH(scene) {
			await newLine(scene.page);
			await scene.page.keyboard.type("/");
			await expect(scene.page.getByRole("button", { name: "Heading 2", exact: true })).toBeVisible();
		},
		async FILTER(scene) {
			await scene.page.keyboard.type("tab");
			await expect(scene.page.getByRole("button", { name: "Heading 2", exact: true })).toBeHidden();
			await expect(scene.page.getByText("Table", { exact: true }).first()).toBeVisible();
		},
		async MENTION(scene) {
			await newLine(scene.page);
			await scene.page.keyboard.type("Ask @");
			await expect(scene.page.getByRole("listbox", { name: "People" })).toBeVisible();
		},
		async PICK_PERSON(scene) {
			await scene.page.getByRole("option", { name: /Leo Park/ }).click();
			await expect(scene.page.getByRole("listbox", { name: "People" })).toBeHidden();
			await expect(editor(scene.page)).toContainText("Leo Park");
		},
		async SELECT_TEXT(scene) {
			await editor(scene.page).getByText("Support rota agreed with Nisha").click({ clickCount: 3 });
			await expect(scene.page.getByRole("toolbar", { name: "Selection" })).toBeVisible();
		},
		async ADD_LINK(scene) {
			await scene.page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Link" }).click();
			await expect(scene.page.getByRole("textbox", { name: "Link address" })).toBeVisible();
		},
		async COMMENT(scene) {
			await scene.page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Comment" }).click();
			await expect(panel(scene.page, "Comments").getByPlaceholder("Add a comment")).toBeVisible();
		},
		async POST(scene) {
			const comments = panel(scene.page, "Comments");
			await comments.getByPlaceholder("Add a comment").fill("Nisha confirmed the rota on Monday.");
			await comments.getByRole("button", { name: "Comment", exact: true }).click();
			await expect(comments.getByText("Nisha confirmed the rota on Monday.")).toBeVisible();
			await expect(comments.getByPlaceholder("Add a comment")).toBeHidden();
		},
		async CLICK_LINK(scene) {
			await editor(scene.page).getByText("forty design partners").click();
			await expect(scene.page.getByRole("button", { name: "Remove link" })).toBeVisible();
		},
		async OPEN_DOCUMENT_MENU(scene) {
			await openDocumentMenu(scene.page);
		},
		async LOCK(scene) {
			await scene.page.getByRole("menuitem", { name: "Lock document" }).click();
			await expect(scene.page.getByText("Locked", { exact: true })).toBeVisible();
		},
		async OPEN_COMMENTS(scene) {
			await openDocumentMenu(scene.page);
			await scene.page.getByRole("menuitem", { name: "Comments" }).click();
			await expect(panel(scene.page, "Comments").getByText(/No open comments/)).toBeVisible();
		},
		async OPEN_VERSIONS(scene) {
			const node = documents.get(scene);
			const saved = await scene.api.post(`/api/suite/drive/nodes/${node}/versions`, {
				data: { kind: "named", label: "Before partner review" },
			});
			if (!saved.ok()) throw new Error(`Saving a version failed: ${await saved.text()}`);
			await newLine(scene.page);
			await scene.page.keyboard.type("Partner feedback goes in the shared tracker from now on.");
			await expect(header(scene.page, "clean")).toBeVisible();
			await openDocumentMenu(scene.page);
			await scene.page.getByRole("menuitem", { name: "Versions" }).click();
			await expect(panel(scene.page, "Versions").getByText("Before partner review")).toBeVisible();
		},
		async PREVIEW_VERSION(scene) {
			await panel(scene.page, "Versions").getByRole("button", { name: /Before partner review/ }).click();
			await expect(scene.page.getByRole("button", { name: "Back to current" })).toBeVisible();
		},
		async RESTORE(scene) {
			await scene.page.getByRole("button", { name: "Restore this version" }).first().click();
			await expect(scene.page.getByRole("dialog").getByText("Restore this version?")).toBeVisible();
		},
		async NAME_VERSION(scene) {
			await panel(scene.page, "Versions").getByRole("button", { name: "Save version" }).click();
			await expect(scene.page.getByRole("textbox", { name: "Version name" })).toBeVisible();
		},
		async RENAME_TAKEN(scene) {
			const taken = scene.name("Partner FAQ");
			const sibling = await createDocument(scene.api, taken, WRITER_DOCTYPE);
			scene.defer(() => discardNode(scene.api, sibling.name));
			const title = scene.page.getByRole("textbox", { name: "Document title" });
			await title.click();
			await title.fill(taken);
			await title.press("Enter");
			await expect(scene.page.getByRole("alert")).toContainText("That name is taken");
		},
		async SHARE(scene) {
			await scene.page.getByRole("banner").getByRole("button", { name: "Share", exact: true }).first().click();
			await expect(scene.page.getByRole("heading", { name: "Who has access" })).toBeVisible();
		},
		async GO_OFFLINE(scene) {
			await scene.context.setOffline(true);
			await caretAtEnd(scene.page);
			await scene.page.keyboard.type(" Send questions before Thursday.");
			await expect(scene.page.getByText("Offline", { exact: true })).toBeVisible();
			await expect(scene.page.getByText("Changes will sync")).toBeVisible();
		},
		async RECONNECT(scene) {
			await scene.context.setOffline(false);
			await expect(scene.page.getByText("Changes will sync")).toBeHidden({ timeout: 20_000 });
			await expect(header(scene.page, "clean")).toBeVisible();
			await expect(scene.page.getByText("Offline", { exact: true })).toBeHidden();
		},
		async TYPE_HELD(scene) {
			await scene.hold(updates(documents.get(scene)));
			await caretAtEnd(scene.page);
			await scene.page.keyboard.type(" Send questions before Thursday.");
			await expect(header(scene.page, "saving")).toBeVisible();
		},
		async SEED_RECOVERY(scene) {
			const node = documents.get(scene);
			const copy = {
				node,
				title: "Beacon beta launch plan",
				savedAt: new Date(Date.now() - 25 * 60_000).toISOString(),
				html: `${CONTENT}<p>Draft reply to the design partners, not yet sent.</p>`,
			};
			await scene.page.evaluate(
				([key, value]) => localStorage.setItem(key, value),
				[`suite:writer-recovery:${node}:seeded`, JSON.stringify(copy)] as const,
			);
			await scene.page.reload();
			await expect(scene.page.getByText(/This device has unsaved work from/)).toBeVisible();
		},
		async VIEW_COPY(scene) {
			await scene.page.getByRole("button", { name: "View", exact: true }).click();
			await expect(scene.page.getByText(/Viewing recovery copy from/)).toBeVisible();
		},
		async PHONE(scene) {
			await scene.page.setViewportSize({ width: 390, height: 844 });
			await expect(editor(scene.page)).toBeVisible();
		},
	},
});
