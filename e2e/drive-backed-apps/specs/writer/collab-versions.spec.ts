import { readFile } from "node:fs/promises";

import type { Locator, Page, Route } from "@playwright/test";

import { expect, test } from "../../fixtures/test";
import {
	dropLog,
	expectConverged,
	expectSaved,
	makeLegacy,
	openForCollab,
	pastePicture,
	picturesLoaded,
	serverBlocks,
	saveNamedVersion,
	typeParagraph,
} from "../../helpers/collab";
import { discardNode, getNode, mediaNodes, purgeNode, trashNode } from "../../helpers/drive";
import {
	createWriterDocument,
	openWriterDocument,
	uniqueWriterTitle,
	writerEditor,
} from "../../helpers/writer";

test.describe("Writer collaboration", () => {
	let node = "";
	let title = "";

	test.beforeEach(async ({ owner, collaborator, run, testApi }, testInfo) => {
		title = uniqueWriterTitle(run.run_id, `collab ${testInfo.title}`);
		node = (await createWriterDocument(owner.page.request, title)).name;
		await openForCollab(testApi, owner.page.request, node, collaborator.user.user);
	});

	test.afterEach(async ({ owner }) => {
		await discardNode(owner.context.request, node);
	});

	test("an edit made while another tab previews a version shows after going back to Current version", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Written before the version");
		await expectSaved(owner.page);
		await saveNamedVersion(owner.context.request, node, "Before the preview");
		await openWriterDocument(collaborator.page, node);

		await owner.page
			.getByRole("button", { name: /versions/i })
			.first()
			.click();
		await owner.page
			.getByRole("complementary", { name: "Versions" })
			.getByRole("button", { name: /^Before the preview/ })
			.click();
		await expect(owner.page.getByText("Viewing Before the preview")).toBeVisible();
		await expect(owner.page.getByLabel("Version preview")).toContainText(
			"Written before the version",
		);

		await typeParagraph(collaborator.page, "Typed during the preview");
		await expectSaved(collaborator.page);
		await expect
			.poll(async () => (await serverBlocks(testApi, node)).join("\n"))
			.toContain("Typed during the preview");

		await owner.page
			.getByRole("complementary", { name: "Versions" })
			.getByRole("button", { name: "Current version", exact: true })
			.click();

		await expectConverged(
			testApi,
			node,
			[owner.page, collaborator.page],
			["Written before the version", "Typed during the preview"],
		);
		await expectSaved(owner.page);
		await expect(owner.page.locator(".bg-surface-amber-2")).toHaveCount(0);
	});

	test("a restored version shows in every tab, the state before it is kept, and Ctrl+Z leaves it", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		const { page } = owner;
		await openWriterDocument(page, node);
		await typeParagraph(page, "Kept in the version");
		await expectSaved(page);
		await saveNamedVersion(owner.context.request, node, "Draft one");
		// Undoing this cut after the restore would type " version" in a second time
		for (let i = 0; i < " version".length; i++) {
			await page.keyboard.press("Backspace");
		}

		await typeParagraph(page, "Typed after the version");
		await expectSaved(page);
		await openWriterDocument(collaborator.page, node);
		const panel = await openVersions(page);

		await restoreFromPreview(page, panel, "Draft one");

		await expect(page.getByText("Version restored")).toBeVisible();
		const restored = await expectConverged(testApi, node, [page, collaborator.page], ["Kept in the version"]);
		expect(restored.filter(Boolean)).toEqual(["Kept in the version"]);
		await expect(panel.getByRole("button", { name: /^Before restoring version \d+/ })).toHaveCount(1);
		await panel.getByRole("button", { name: /^Before restoring version \d+/ }).click();
		await expect(page.getByLabel("Version preview")).toContainText("Typed after the version");
		await panel.getByRole("button", { name: "Current version", exact: true }).click();

		await page.getByLabel("Document editor").click();
		await page.keyboard.press("ControlOrMeta+z");
		await typeParagraph(collaborator.page, "Typed after the restore");
		await expectSaved(collaborator.page);
		const afterUndo = await expectConverged(
			testApi,
			node,
			[page, collaborator.page],
			["Kept in the version", "Typed after the restore"],
		);
		expect(afterUndo.filter(Boolean).sort()).toEqual(["Kept in the version", "Typed after the restore"]);
	});

	test("a second restore within a minute restores nothing and says how long to wait", async ({
		owner,
		testApi,
	}) => {
		const { page } = owner;
		await openWriterDocument(page, node);
		await typeParagraph(page, "First words");
		await expectSaved(page);
		await saveNamedVersion(owner.context.request, node, "One");
		await typeParagraph(page, "Second words");
		await expectSaved(page);
		await saveNamedVersion(owner.context.request, node, "Two");
		const panel = await openVersions(page);
		await restoreFromPreview(page, panel, "One");
		await expect(page.getByText("Version restored")).toBeVisible();

		await restoreFromPreview(page, panel, "Two");

		await expect(page.getByText(/^A restore just ran\. Try again in \d+ seconds\.$/)).toBeVisible();
		await panel.getByRole("button", { name: "Current version", exact: true }).click();
		const blocks = await expectConverged(testApi, node, [page], ["First words"]);
		expect(blocks.filter(Boolean)).toEqual(["First words"]);
	});

	test("a document edited without collaboration restores a version, and the next autosave keeps it", async ({
		owner,
		run,
		testApi,
	}) => {
		const { page } = owner;
		const plain = (await createWriterDocument(page.request, uniqueWriterTitle(run.run_id, "plain"))).name;
		try {
			// Other tests run alongside, so collaboration stays on and only this document loses its log
			await dropLog(testApi, plain);
			await makeLegacy(testApi, plain);
			await openWriterDocument(page, plain);
			await writerEditor(page).click();
			await page.keyboard.type("Kept in the version");
			await saveByShortcut(page);
			const panel = await openVersions(page);
			await nameVersion(page, "Draft one");
			await expect(panel.getByRole("button", { name: /^Draft one/ })).toBeVisible();
			// Unsaved when the restore starts, so an autosave is still waiting in the editor
			await writerEditor(page).click();
			await page.keyboard.press("End");
			await page.keyboard.type(" and typed after");

			await restoreFromPreview(page, panel, "Draft one");

			await expect(page.getByText("Version restored")).toBeVisible();
			await expect(writerEditor(page)).toHaveText("Kept in the version");
			await panel.getByRole("button", { name: AUTOMATIC_VERSION }).first().click();
			await expect(page.getByLabel("Version preview")).toContainText("Kept in the version and typed after");
			await panel.getByRole("button", { name: "Current version", exact: true }).click();
			// Past the editor's five-second autosave
			await page.waitForTimeout(6_000);
			await page.reload();
			await expect(writerEditor(page)).toHaveText("Kept in the version");
		} finally {
			await discardNode(owner.context.request, plain);
		}
	});

	test("restoring a version takes its binned picture out of the bin", async ({ owner }) => {
		const { page } = owner;
		const picture = await pictureInVersion(page, node);
		const { title: pictureTitle } = await getNode(page.request, picture);
		await trashNode(page.request, picture);
		await page.reload();
		await expect.poll(() => picturesLoaded(page)).toEqual([false]);

		const dialog = await openRestoreDialog(page);
		await expect(dialog).toContainText(`These images are in the bin and come back with it: ${pictureTitle}.`);
		await dialog.getByRole("button", { name: "Restore", exact: true }).click();

		await expect(page.getByText("Version restored")).toBeVisible();
		expect((await getNode(page.request, picture)).state).toBe("Active");
		await expect.poll(() => picturesLoaded(page)).toEqual([true]);
	});

	test("restoring a version names its deleted picture, which then shows broken", async ({ owner }) => {
		const { page } = owner;
		const picture = await pictureInVersion(page, node);
		await trashNode(page.request, picture);
		await purgeNode(page.request, picture);
		await page.reload();

		const dialog = await openRestoreDialog(page);
		await expect(dialog).toContainText("These images will show broken: An image with no name (deleted).");
		await dialog.getByRole("button", { name: "Restore", exact: true }).click();

		await expect(page.getByText("Version restored")).toBeVisible();
		await expect(writerEditor(page)).not.toContainText("Typed after the version");
		await expect.poll(() => picturesLoaded(page)).toEqual([false]);
	});

	test("the first edit to a document takes an automatic version the server keeps", async ({
		owner,
	}) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "First words");
		await expectSaved(owner.page);

		await owner.page
			.getByRole("button", { name: /versions/i })
			.first()
			.click();
		const versions = owner.page
			.getByRole("complementary", { name: "Versions" })
			.getByRole("button", { name: AUTOMATIC_VERSION });
		await expect(versions).toHaveCount(1);
		await versions.click();

		const preview = owner.page.getByLabel("Version preview");
		await expect(preview).not.toHaveText("");
		const versionText = (await preview.innerText()).trim();
		expect("First words".startsWith(versionText), versionText).toBe(true);
	});

	test("a previewed version downloads as the HTML it shows, named after the document and the version", async ({
		owner,
	}) => {
		const { page } = owner;
		await openWriterDocument(page, node);
		await typeParagraph(page, "Kept in the version");
		await expectSaved(page);
		await saveNamedVersion(owner.context.request, node, "Draft one");
		await typeParagraph(page, "Typed after the version");
		await expectSaved(page);

		await page
			.getByRole("button", { name: /versions/i })
			.first()
			.click();
		const panel = page.getByRole("complementary", { name: "Versions" });
		async function download() {
			const downloaded = page.waitForEvent("download");
			await panel.getByRole("button", { name: "More version actions" }).click();
			await page.getByRole("menuitem", { name: "Download" }).click();
			const file = await downloaded;
			return [file.suggestedFilename(), await readFile((await file.path())!, "utf8")];
		}

		await panel.getByRole("button", { name: /^Draft one/ }).click();
		await expect(page.getByLabel("Version preview")).toContainText("Kept in the version");
		const [namedFile, namedHTML] = await download();
		expect(namedFile).toBe(`${title} (Draft one).html`);
		expect(namedHTML).toContain("<p>Kept in the version</p>");
		expect(namedHTML).not.toContain("Typed after the version");

		const automatic = panel.getByRole("button", { name: AUTOMATIC_VERSION }).first();
		await automatic.click();
		await expect(page.getByText(/^Viewing Today, \d{1,2}:\d{2}/)).toBeVisible();
		const [automaticFile] = await download();
		expect([automaticFile.startsWith(title), automaticFile.slice(title.length)]).toEqual([
			true,
			expect.stringMatching(/^ \(v\d+\)\.html$/),
		]);
	});

	test("Save version saves the typing first and keeps it in the named version", async ({
		owner,
	}) => {
		const { page } = owner;
		await page.route(PUSHES, slowPushes);
		await openWriterDocument(page, node);
		const panel = await openVersions(page);
		await typeParagraph(page, "Typed just before saving");

		await nameVersion(page, "Right after typing");

		await expect(panel.getByText("Saving first…")).toBeVisible();
		await panel.getByRole("button", { name: /^Right after typing/ }).click();
		await expect(page.getByLabel("Version preview")).toContainText("Typed just before saving");
		await page.unroute(PUSHES, slowPushes);
	});

	test("Save version while offline takes no version and says why", async ({ owner }) => {
		const { page, context } = owner;
		await openWriterDocument(page, node);
		const panel = await openVersions(page);
		await context.setOffline(true);
		await typeParagraph(page, "Typed offline");

		await nameVersion(page, "Offline try");

		await expect(
			page.getByText("No version was taken: you're offline, so your changes aren't saved yet."),
		).toBeVisible({ timeout: 15_000 });
		await context.setOffline(false);
		await expect(panel.getByRole("button", { name: /^Offline try/ })).toHaveCount(0);
	});

	test("closing the Versions or Comments panel returns focus to the button that opened it", async ({
		owner,
	}) => {
		const { page } = owner;
		await openWriterDocument(page, node);
		for (const name of ["Versions", "Comments"]) {
			const opener = page.getByRole("banner").getByRole("button", { name, exact: true });
			await opener.click();
			await page
				.getByRole("complementary", { name })
				.getByRole("button", { name: "Close panel" })
				.click();
			await expect(opener).toBeFocused();
		}
	});

	test("the Versions panel takes the table of contents' place on the right and moves the text like it", async ({
		owner,
	}) => {
		const { page } = owner;
		await page.setViewportSize({ width: 1440, height: 900 });
		await openWriterDocument(page, node);
		await typeParagraph(page, "Centred text");
		await page.keyboard.press("Enter");
		await page.keyboard.type("## First heading");
		await page.keyboard.press("Enter");
		await page.keyboard.type("## Second heading");
		await expectSaved(page);
		await saveNamedVersion(owner.context.request, node, "One");
		const showToc = page.getByRole("button", { name: "Show table of contents" });
		if (await showToc.isVisible()) {
			await showToc.click();
		}

		const tocHeading = page.getByText("Table of contents", { exact: true });
		const tocEntry = page.getByRole("link", { name: "First heading" });
		const tocEntryBox = (await tocEntry.boundingBox())!;
		const tocHeadingBox = (await tocHeading.boundingBox())!;
		const tocGap = tocEntryBox.y - tocHeadingBox.y;
		const centredLine = page
			.getByLabel("Document editor")
			.locator("p", { hasText: "Centred text" });
		let lastX = -1;
		await expect
			.poll(async () => lastX === (lastX = (await centredLine.boundingBox())!.x), {
				intervals: [400],
			})
			.toBe(true);
		const restingBox = await centredLine.boundingBox();
		const column = await page.locator("#editor-scroll-container").boundingBox();
		const sampleFrames = () => {
			const line = document.querySelector('[aria-label="Document editor"] p')!;
			const frames: number[][] = [];
			const start = performance.now();
			const sampleUntilDone = (resolve: (frames: number[][]) => void) => {
				const tick = () => {
					const asideWidth = document.querySelector("aside")?.getBoundingClientRect().width ?? 0;
					frames.push([line.getBoundingClientRect().x, asideWidth]);
					if (performance.now() - start < 600) {
						requestAnimationFrame(tick);
					} else {
						resolve(frames);
					}
				};
				requestAnimationFrame(tick);
			};

			return new Promise<number[][]>(sampleUntilDone);
		};
		const sampleMotion = () => page.evaluate(sampleFrames);
		const expectInStep = (frames: number[][]) => {
			expect(frames.some(([, width]) => width > 10 && width < 310)).toBe(true);
			const drift = Math.max(
				...frames.map(([x, width]) => Math.abs(restingBox!.x - x - width / 2)),
			);
			expect(drift).toBeLessThanOrEqual(1);
		};

		const opening = sampleMotion();
		await page
			.getByRole("button", { name: /versions/i })
			.first()
			.click();
		expectInStep(await opening);
		const versionsPanel = page.getByRole("complementary", { name: "Versions" });
		const row = versionsPanel.getByRole("button", { name: /^One/ });
		await expect(row).toBeVisible();
		const panelBox = (await versionsPanel.boundingBox())!;
		expect(panelBox).toMatchObject({ y: column!.y, height: column!.height, width: 321 });
		expect(panelBox.x + panelBox.width).toBe(column!.x + column!.width);
		expect((await centredLine.boundingBox())!.x).toBe(restingBox!.x - panelBox.width / 2);
		const headingBox = (await versionsPanel
			.getByRole("heading", { name: "Versions" })
			.boundingBox())!;
		const firstRowBox = (await versionsPanel
			.getByRole("button", { name: "Current version", exact: true })
			.boundingBox())!;
		expect(
			await versionsPanel
				.getByRole("button", { name: "Current version", exact: true })
				.evaluate((button) => {
					const range = document.createRange();
					range.selectNodeContents(button);
					return range.getBoundingClientRect().x;
				}),
		).toBe(headingBox.x);
		expect(firstRowBox.y - headingBox.y).toBe(tocGap);

		await page
			.getByRole("button", { name: /comments/i })
			.first()
			.click();
		const comments = page.getByRole("complementary", { name: "Comments" });
		const commentsHeading = (await comments
			.getByRole("heading", { name: "Comments" })
			.boundingBox())!;
		expect(
			await comments.getByRole("button", { name: "Add a comment…" }).evaluate((button) => {
				const range = document.createRange();
				range.selectNodeContents(button);
				return range.getBoundingClientRect().x;
			}),
		).toBe(commentsHeading.x);
		expect(
			(await comments.getByRole("button", { name: "Add a comment…" }).boundingBox())!.y -
				commentsHeading.y,
		).toBe(tocGap);

		const closing = sampleMotion();
		await page.getByRole("button", { name: "Close panel" }).click();
		expectInStep(await closing);
		expect(await centredLine.boundingBox()).toEqual(restingBox);
	});

	test("a version preview shows its text where the editor's text sits, and Current version returns to it", async ({
		owner,
	}) => {
		const { page } = owner;
		await page.setViewportSize({ width: 1440, height: 900 });
		await openWriterDocument(page, node);
		await typeParagraph(page, "First version");
		await expectSaved(page);
		await saveNamedVersion(owner.context.request, node, "One");
		await typeParagraph(page, "Second version");
		await expectSaved(page);
		await saveNamedVersion(owner.context.request, node, "Two");
		await page
			.getByRole("button", { name: /versions/i })
			.first()
			.click();
		const panel = page.getByRole("complementary", { name: "Versions" });
		await expect.poll(async () => (await panel.boundingBox())?.width).toBe(321);
		const editorText = page.getByLabel("Document editor");
		const previewText = page.locator('[aria-label="Version preview"] .ProseMirror');
		const linePlacement = async (text: typeof editorText) => {
			const line = text.locator("p", { hasText: "First version" });
			const { x, y, width } = (await line.boundingBox())!;
			const { y: top } = (await text.boundingBox())!;
			return { x, width, top, y };
		};
		const editorPlacement = await linePlacement(editorText);
		const readLook = (element: Element) => {
			const style = getComputedStyle(element);
			return [
				style.backgroundColor,
				style.borderBottomColor,
				element.getBoundingClientRect().height,
			];
		};
		const barLook = (bar: ReturnType<typeof page.locator>) => bar.evaluate(readLook);
		const themes = ["light", "dark"] as const;
		const toolbar = page
			.getByRole("button", { name: "Bold" })
			.locator("xpath=ancestor::div[contains(@class, 'border-b')][1]");
		const toolbarLooks = [];
		for (const theme of themes) {
			await page.evaluate(
				(theme) => document.documentElement.setAttribute("data-theme", theme),
				theme,
			);
			toolbarLooks.push(await barLook(toolbar));
		}

		await panel.getByRole("button", { name: /^One/ }).click();
		await expect(previewText).toContainText("First version");
		const bar = page.getByRole("status").filter({ hasText: "Viewing One" });
		for (const [i, theme] of themes.entries()) {
			await page.evaluate(
				(theme) => document.documentElement.setAttribute("data-theme", theme),
				theme,
			);
			expect(await barLook(bar)).toEqual(toolbarLooks[i]);
			expect(
				await bar
					.getByRole("button", { name: "Restore this version" })
					.evaluate((button) => getComputedStyle(button).backgroundColor),
			).toBe("rgba(0, 0, 0, 0)");
		}
		// frappe-ui gives an empty read-only line a fixed height, so lines below one may sit a few px off.
		expect(await linePlacement(previewText)).toMatchObject({
			x: editorPlacement.x,
			width: editorPlacement.width,
			top: editorPlacement.top,
		});

		await panel.getByRole("button", { name: /^Two/ }).click();
		await expect(previewText).toContainText("Second version");
		expect(await linePlacement(previewText)).toMatchObject({
			x: editorPlacement.x,
			width: editorPlacement.width,
			top: editorPlacement.top,
		});

		await panel.getByRole("button", { name: "Current version", exact: true }).click();
		await expect(editorText).toBeVisible();
		expect(await linePlacement(editorText)).toEqual(editorPlacement);
	});
});

const PUSHES = "**/api/suite/content/*/updates";

// Pushes reach the server two seconds late, so the typing is still unsaved when the version is asked for
async function slowPushes(route: Route) {
	await new Promise((resolve) => setTimeout(resolve, 2_000));
	await route.continue();
}

async function saveByShortcut(page: Page) {
	const saved = page.waitForResponse((response) => response.url().endsWith("/save_html") && response.ok());
	await page.keyboard.press("ControlOrMeta+s");
	await saved;
}

// An automatic version's row goes by the time it was taken
const AUTOMATIC_VERSION = /^\d{1,2}:\d{2}/;

async function openVersions(page: Page) {
	await page
		.getByRole("button", { name: /versions/i })
		.first()
		.click();
	return page.getByRole("complementary", { name: "Versions" });
}

async function nameVersion(page: Page, label: string) {
	await page.getByRole("button", { name: "More document actions" }).click();
	await page.getByRole("menuitem", { name: "Save version" }).click();
	await page.getByLabel("Version name").fill(label);
	await page.keyboard.press("Enter");
}

// A version holding one picture, then more text so the restore changes something
async function pictureInVersion(page: Page, node: string): Promise<string> {
	await openWriterDocument(page, node);
	await typeParagraph(page, "Words above the picture");
	await page.keyboard.press("Enter");
	await pastePicture(page);
	await expect.poll(() => picturesLoaded(page)).toEqual([true]);
	await expectSaved(page);
	await saveNamedVersion(page.request, node, "With a picture");
	await typeParagraph(page, "Typed after the version");
	await expectSaved(page);
	const [picture] = await mediaNodes(page.request, node);
	return picture;
}

async function openRestoreDialog(page: Page): Promise<Locator> {
	const panel = await openVersions(page);
	await panel.getByRole("button", { name: /^With a picture/ }).click();
	await panel.getByRole("button", { name: "Restore this version" }).click();
	return page.getByRole("dialog");
}

async function restoreFromPreview(page: Page, panel: Locator, label: string) {
	await panel.getByRole("button", { name: new RegExp(`^${label}`) }).click();
	await expect(page.getByText(`Viewing ${label}`)).toBeVisible();
	await panel.getByRole("button", { name: "Restore this version" }).click();
	await page.getByRole("dialog").getByRole("button", { name: "Restore", exact: true }).click();
}
