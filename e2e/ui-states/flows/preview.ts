import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";
import { setup } from "xstate";
import { folderPath } from "../content";
import { defineFlow } from "../flow";
import { purgeNode, row, trashNode, uploadFile, type DriveNode } from "../../drive-backed-apps/helpers/drive";
import type { Hold, Scene } from "../scene";
import { holdUnretried } from "./upload";

type Event =
	| { type: "OPEN_SLOW" }
	| { type: "LOADS" }
	| { type: "FAILS" }
	| { type: "TRY_AGAIN" }
	| { type: "OPEN_MARKDOWN" }
	| { type: "SHOW_SOURCE" }
	| { type: "OPEN_TEXT" }
	| { type: "OPEN_CODE" }
	| { type: "OPEN_IMAGE" }
	| { type: "OPEN_UNKNOWN" }
	| { type: "OPEN_EMPTY" }
	| { type: "OPEN_WITHOUT_ACCESS" }
	| { type: "OPEN_MENU" }
	| { type: "PICK_NEW_VERSION" }
	| { type: "REPLACE" }
	| { type: "FINISHES" };

/**
 * A non-native file opened from the listing. `DocumentHost.vue` decides
 * loading, failed, refused or surface from `loading`, `error`, `locked` and
 * `refused`; inside the surface `previewKind()`, `empty` and `opensAsSheet`
 * pick the viewer, and `UploadNewVersion.vue` adds a badge while a replace runs.
 */
const machine = setup({ types: { events: {} as Event } }).createMachine({
	id: "preview",
	initial: "folder",
	states: {
		folder: {
			meta: { description: "A folder with one file of each kind the preview knows: PDF, Markdown, text, code, picture, an archive and an empty file." },
			on: {
				OPEN_SLOW: "headerSkeleton",
				OPEN_MARKDOWN: "markdown",
				OPEN_TEXT: "plainText",
				OPEN_CODE: "code",
				OPEN_IMAGE: "image",
				OPEN_UNKNOWN: "fallback",
				OPEN_EMPTY: "emptyFile",
				OPEN_WITHOUT_ACCESS: "refused",
			},
		},
		headerSkeleton: {
			meta: { description: "The file is still opening: the header's shape with the file's name, which the listing put on the history entry." },
			on: { LOADS: "pdf", FAILS: "openFailed" },
		},
		openFailed: {
			meta: { description: "The file could not be read: \"Could not open this document\" with the reason and Try again." },
			on: { TRY_AGAIN: "pdf" },
		},
		pdf: {
			meta: { description: "A PDF in a frame under the file header: back to the folder, previous and next file, Download, Fullscreen and the menu. Headless Chromium has no PDF viewer, so the frame is blank here; a phone draws pages with pdf.js instead." },
		},
		markdown: {
			meta: { description: "A Markdown file opens rendered, with a Preview and Source toggle in the header." },
			on: { SHOW_SOURCE: "markdownSource" },
		},
		markdownSource: {
			meta: { description: "The same Markdown file as highlighted source." },
		},
		plainText: {
			meta: { description: "A .txt file as plain text with line numbers." },
			on: { OPEN_MENU: "menu" },
		},
		code: {
			meta: { description: "A TypeScript file as highlighted source." },
		},
		image: {
			meta: { description: "A picture, centred and scaled to fit." },
		},
		fallback: {
			meta: { description: "A type the browser cannot draw and Drive made no preview for: \"No preview\" with Download." },
		},
		emptyFile: {
			meta: { description: "A file of zero bytes, here a .docx: \"Empty file\", and no Download or Fullscreen in the header. An empty text file shows the text viewer instead, as `FilePreviewSurface.vue` checks text before empty." },
		},
		refused: {
			meta: { description: "A file the user cannot read: the lock and \"You don’t have access to this document.\", with no header." },
		},
		menu: {
			meta: { description: "The header's menu for a file the user can edit: Copy link, Rename, Move, Make a copy, Upload new version, Details, Move to trash." },
			on: { PICK_NEW_VERSION: "confirmReplace" },
		},
		confirmReplace: {
			meta: { description: "A new version was picked: the confirm warns that the current file is not kept." },
			on: { REPLACE: "newVersionUploading" },
		},
		newVersionUploading: {
			meta: { description: "The new bytes are uploading: an \"Uploading new version…\" badge after the title and an orange dot on the Drive rail item. The upload tracker stays closed, and the menu button's tooltip shows because focus returns to it." },
			on: { FINISHES: "replaced" },
		},
		replaced: {
			meta: { description: "The replace finished: \"New version uploaded\" and the preview shows the new text." },
		},
		editedNote: {
			meta: {
				description: "Unreachable: `DocumentHeader.vue` shows the edited note only with a `saveState`, and the file preview passes none, so a file never shows when it was edited, even after a replace.",
				transient: true,
			},
		},
	},
});

interface Files {
	pdf: DriveNode;
	markdown: DriveNode;
	text: DriveNode;
	code: DriveNode;
	image: DriveNode;
	archive: DriveNode;
	empty: DriveNode;
}

const MARKDOWN = "# Launch plan\n\nThe site goes live in **two** steps.\n\n1. Staging review\n2. Public launch\n\n> Freeze copy a week before.\n\n```sh\nnpm run build\n```\n";
const TEXT = "Release notes\n\n- New homepage hero\n- Faster image loading\n- Fixed the footer links on phones\n";
const NEW_TEXT = "Release notes, version 2\n\n- New homepage hero\n- Pricing page\n";
const CODE = 'interface Page {\n\ttitle: string;\n\tpath: string;\n}\n\nexport function sitemap(pages: Page[]): string {\n\treturn pages.map((page) => `<url><loc>${page.path}</loc></url>`).join("\\n");\n}\n';
const ZIP = Buffer.from("504b0506000000000000000000000000000000000000", "hex");
const CHUNKS = /\/api\/suite\/drive\/uploads\/[^/]+\/chunk/;

const fixture = (name: string) => readFileSync(resolve(__dirname, "..", "fixtures", name));
const seeded = new WeakMap<Scene, Files>();
const holds = new WeakMap<Scene, Hold>();

function files(scene: Scene): Files {
	const found = seeded.get(scene);
	if (!found) throw new Error("preview: the scene has no files");
	return found;
}

/**
 * Opens a file as the user does, with a double-click. The double-click's text
 * selection survives the route change and highlights the whole preview, so it
 * is cleared before the screenshot.
 */
async function open(scene: Scene, node: DriveNode): Promise<void> {
	await doubleClick(scene, node);
	await expect(fileName(scene.page)).toHaveValue(node.title);
}

async function doubleClick(scene: Scene, node: DriveNode): Promise<void> {
	await row(scene.page, node.name).dblclick();
	await scene.page.evaluate(() => window.getSelection()?.removeAllRanges());
}

function fileName(page: Page) {
	return page.getByRole("textbox", { name: "File name" });
}

function nodeRead(node: DriveNode): RegExp {
	return new RegExp(`/api/suite/drive/nodes/${node.name}\\?`);
}

export const preview = defineFlow<Event>({
	id: "preview",
	title: "File preview",
	folderTitle: "Launch assets",
	source: "frontend/src/apps/drive/files/features/preview/FilePreviewSurface.vue",
	machine,
	async enter(scene) {
		const parent = scene.folder.name;
		seeded.set(scene, {
			pdf: await uploadFile(scene.api, "Quarter review.pdf", fixture("Quarter review.pdf"), parent, "application/pdf"),
			markdown: await uploadFile(scene.api, "Launch plan.md", Buffer.from(MARKDOWN), parent, "text/markdown"),
			text: await uploadFile(scene.api, "Release notes.txt", Buffer.from(TEXT), parent, "text/plain"),
			code: await uploadFile(scene.api, "sitemap.ts", Buffer.from(CODE), parent, "text/plain"),
			image: await uploadFile(scene.api, "Logo.png", fixture("Logo.png"), parent, "image/png"),
			archive: await uploadFile(scene.api, "Press kit.zip", ZIP, parent, "application/zip"),
			empty: await uploadFile(scene.api, "Speaker notes.docx", Buffer.alloc(0), parent, "application/octet-stream"),
		});
		await scene.goto(folderPath(scene.folder));
		// The shell's first boot can take a while when the dev server rebuilds.
		await expect(scene.page.getByRole("button", { name: /^Actions for / }).first()).toBeVisible({ timeout: 30_000 });
	},
	settle: {
		async pdf(scene) {
			await expect(scene.page.locator("iframe, embed, object, canvas").first()).toBeVisible();
		},
	},
	events: {
		async OPEN_SLOW(scene) {
			const { pdf } = files(scene);
			holds.set(scene, await holdUnretried(scene.page, nodeRead(pdf)));
			await doubleClick(scene, pdf);
			await expect(scene.page.getByRole("status", { name: `Opening ${pdf.title}` })).toBeVisible();
		},
		async LOADS(scene) {
			await holds.get(scene)?.release();
			await expect(fileName(scene.page)).toHaveValue(files(scene).pdf.title);
		},
		async FAILS(scene) {
			await holds.get(scene)?.abort(500);
			await expect(scene.page.getByText("Could not open this document")).toBeVisible();
		},
		async TRY_AGAIN(scene) {
			await holds.get(scene)?.release();
			await scene.page.getByRole("button", { name: "Try again" }).click();
			await expect(fileName(scene.page)).toHaveValue(files(scene).pdf.title);
		},
		async OPEN_MARKDOWN(scene) {
			await open(scene, files(scene).markdown);
			await expect(scene.page.getByRole("heading", { name: "Launch plan" })).toBeVisible();
		},
		async SHOW_SOURCE(scene) {
			await scene.page.getByLabel("Markdown view").getByText("Source", { exact: true }).click();
			await expect(scene.page.getByText("# Launch plan")).toBeVisible();
		},
		async OPEN_TEXT(scene) {
			await open(scene, files(scene).text);
			await expect(scene.page.getByText("Faster image loading")).toBeVisible();
		},
		async OPEN_CODE(scene) {
			await open(scene, files(scene).code);
			await expect(scene.page.getByText("export function sitemap")).toBeVisible();
		},
		async OPEN_IMAGE(scene) {
			const { image } = files(scene);
			await open(scene, image);
			await expect(scene.page.getByRole("img", { name: image.title })).toBeVisible();
			await expect.poll(() => scene.page.getByRole("img", { name: image.title }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
		},
		async OPEN_UNKNOWN(scene) {
			await open(scene, files(scene).archive);
			await expect(scene.page.getByRole("heading", { name: "No preview" })).toBeVisible();
		},
		async OPEN_EMPTY(scene) {
			await open(scene, files(scene).empty);
			await expect(scene.page.getByRole("heading", { name: "Empty file" })).toBeVisible();
		},
		async OPEN_WITHOUT_ACCESS(scene) {
			const peer = await scene.as(scene.people.peer);
			const secret = await uploadFile(peer, scene.name("Salary bands.txt"), Buffer.from("Private\n"));
			await scene.goto(`/d/${secret.name}`);
			await expect(scene.page.getByText("You don’t have access to this document.")).toBeVisible();
			await trashNode(peer, secret.name);
			await purgeNode(peer, secret.name);
		},
		async OPEN_MENU(scene) {
			await scene.page.getByRole("button", { name: "More file actions" }).click();
			await expect(scene.page.getByRole("menuitem", { name: "Upload new version" })).toBeVisible();
		},
		async PICK_NEW_VERSION(scene) {
			const [chooser] = await Promise.all([
				scene.page.waitForEvent("filechooser"),
				scene.page.getByRole("menuitem", { name: "Upload new version" }).click(),
			]);
			await chooser.setFiles({ name: "Release notes.txt", mimeType: "text/plain", buffer: Buffer.from(NEW_TEXT) });
			await expect(scene.page.getByRole("dialog").getByText("Upload new version?")).toBeVisible();
		},
		async REPLACE(scene) {
			holds.set(scene, await holdUnretried(scene.page, CHUNKS));
			await scene.page.getByRole("dialog").getByRole("button", { name: "Replace" }).click();
			await expect(scene.page.getByText("Uploading new version…")).toBeVisible();
		},
		async FINISHES(scene) {
			await holds.get(scene)?.release();
			await expect(scene.page.getByText("New version uploaded")).toBeVisible();
			await expect(scene.page.getByText("Pricing page")).toBeVisible();
		},
	},
});
