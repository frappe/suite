import { expect, test } from "../../fixtures/test";
import {
	collabState,
	compactNow,
	editorBlocks,
	enableCollab,
	expectConverged,
	expectSaved,
	holdDocument,
	logId,
	logRows,
	pastePicture,
	picturesLoaded,
	releaseDocument,
	serverText,
	takeVersion,
	typeParagraph,
} from "../../helpers/collab";
import {
	DRIVE,
	canReadNode,
	discardNode,
	getNode,
	openRowMenu,
	sidebarLink,
} from "../../helpers/drive";
import {
	createWriterDocument,
	openWriterDocument,
	shareWriterDocument,
	uniqueWriterTitle,
	writerEditor,
} from "../../helpers/writer";

test.describe("Writer collaboration", () => {
	let node = "";

	test.beforeEach(async ({ owner, collaborator, run, testApi }, testInfo) => {
		const file = await createWriterDocument(
			owner.page.request,
			uniqueWriterTitle(run.run_id, `collab ${testInfo.title}`),
		);
		node = file.name;
		await enableCollab(testApi, node);
		await shareWriterDocument(owner.page.request, node, {
			user: collaborator.user.user,
			read: true,
			write: true,
		});
	});

	test.afterEach(async ({ owner }) => {
		await discardNode(owner.context.request, node);
	});

	test("two people typing at once end with the same document", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);

		await Promise.all([
			typeParagraph(owner.page, "Owner wrote this line"),
			typeParagraph(collaborator.page, "Collaborator wrote this line"),
		]);
		await expectSaved(owner.page);
		await expectSaved(collaborator.page);

		await expectConverged(
			testApi,
			node,
			[owner.page, collaborator.page],
			["Owner wrote this line", "Collaborator wrote this line"],
		);
	});

	test("reloading a tab keeps every edit", async ({ owner, collaborator, testApi }) => {
		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);
		await typeParagraph(owner.page, "Kept across a reload");
		await typeParagraph(collaborator.page, "Also kept across a reload");
		await expectSaved(owner.page);
		await expectSaved(collaborator.page);
		const before = await expectConverged(
			testApi,
			node,
			[owner.page, collaborator.page],
			["Kept across a reload", "Also kept across a reload"],
		);

		await owner.page.reload();
		await openWriterDocument(owner.page, node);

		await expect.poll(() => editorBlocks(owner.page)).toEqual(before);
	});

	test("compaction leaves the document unchanged, for an open tab and a late joiner", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Written before compaction");
		await typeParagraph(owner.page, "Second line before compaction");
		await expectSaved(owner.page);
		const before = await expectConverged(
			testApi,
			node,
			[owner.page],
			["Written before compaction", "Second line before compaction"],
		);
		const logged = await collabState(testApi, node);
		expect(logged.head_rev).toBeGreaterThan(logged.checkpoint_rev);

		const compacted = await compactNow(testApi, node);

		expect(compacted).toEqual({
			checkpoint_rev: logged.head_rev,
			head_rev: logged.head_rev,
			tail_rows: 0,
		});
		expect(await serverText(testApi, node)).toEqual(before);

		await openWriterDocument(collaborator.page, node);
		await expect.poll(() => editorBlocks(collaborator.page)).toEqual(before);
		await expect.poll(() => editorBlocks(owner.page)).toEqual(before);

		await typeParagraph(collaborator.page, "Written after compaction");
		await expectSaved(collaborator.page);
		await expectConverged(
			testApi,
			node,
			[owner.page, collaborator.page],
			["Written before compaction", "Written after compaction"],
		);
	});

	test("edits made offline reach everyone after reconnecting", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		// A failed pull retries after up to 30 s, so reconnecting can take that long
		test.setTimeout(120_000);
		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);

		await collaborator.context.setOffline(true);
		await typeParagraph(collaborator.page, "Typed while offline");
		await typeParagraph(owner.page, "Typed while the other tab was offline");
		await expectSaved(owner.page);
		await expect(collaborator.page.getByText("Saved", { exact: true })).toBeHidden();

		await collaborator.context.setOffline(false);

		await expectConverged(
			testApi,
			node,
			[owner.page, collaborator.page],
			["Typed while offline", "Typed while the other tab was offline"],
			60_000,
		);
	});

	test("closing the last tab compacts, and the document then opens from the checkpoint", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Typed just before the last tab closed");

		// Closing with the edit still unsent sends it as the tab's final push, which asks for a compaction
		await owner.page.close();

		await expect
			.poll(
				async () => {
					const state = await collabState(testApi, node);
					return {
						compacted: state.head_rev > 0 && state.checkpoint_rev === state.head_rev,
						tail_rows: state.tail_rows,
					};
				},
				{ timeout: 30_000 },
			)
			.toEqual({ compacted: true, tail_rows: 0 });
		const stored = await serverText(testApi, node);
		expect(stored.join("\n")).toContain("Typed just before the last tab closed");

		await openWriterDocument(collaborator.page, node);
		await expect.poll(() => editorBlocks(collaborator.page)).toEqual(stored);
	});

	test("a tab older than the minimum Writer build opens read-only", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		// Only this tab is told its build is too old; the site setting would reach every spec
		await collaborator.context.route("**/api/**", async (route) => {
			const response = await route.fetch();
			await route.fulfill({
				response,
				headers: {
					...response.headers(),
					"x-suite-min-builds": JSON.stringify({ writer: "99999999999999" }),
				},
			});
		});
		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);

		await expect(writerEditor(collaborator.page)).toHaveAttribute("contenteditable", "false");
		await writerEditor(collaborator.page).click();
		await collaborator.page.keyboard.type("Typed in the old tab");
		await expect(writerEditor(collaborator.page)).not.toContainText("Typed in the old tab");

		await typeParagraph(owner.page, "Typed in the current tab");
		await expectSaved(owner.page);
		const blocks = await expectConverged(
			testApi,
			node,
			[owner.page, collaborator.page],
			["Typed in the current tab"],
		);
		expect(blocks.join("\n")).not.toContain("Typed in the old tab");
	});

	test("a tab that can't apply a change the server judges clean stops editing, and the others go on", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		test.setTimeout(300_000);
		// Only this browser fails to read one character, as an older browser might
		await owner.page.addInitScript(() => {
			const decode = TextDecoder.prototype.decode;
			TextDecoder.prototype.decode = function (this: TextDecoder, ...args: Parameters<TextDecoder["decode"]>) {
				const text = decode.apply(this, args);
				if (text.includes("\u00a7")) throw new TypeError("This browser can't read the text");
				return text;
			};
		});
		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);

		await typeParagraph(collaborator.page, "Marked \u00a7 here");
		await expectSaved(collaborator.page);

		// Each failed open asks again, a minute apart, until three clean verdicts stop this tab
		await expect(
			owner.page.getByText("This document can't be edited in this browser version."),
		).toBeVisible({ timeout: 240_000 });
		await expect(writerEditor(owner.page)).toHaveAttribute("contenteditable", "false");
		await typeParagraph(collaborator.page, "Still saving");
		await expectConverged(testApi, node, [collaborator.page], ["Marked \u00a7 here", "Still saving"]);
	});

	test("a document held for an admin is read-only for everyone until it is released", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);
		await typeParagraph(owner.page, "Before the hold");
		await expectSaved(owner.page);

		await holdDocument(testApi, node, "kernel_failed");
		for (const page of [owner.page, collaborator.page]) {
			await expect(
				page.getByText("This document is read-only while an admin reviews a change to it."),
			).toBeVisible();
			await expect(writerEditor(page)).toHaveAttribute("contenteditable", "false");
		}

		await releaseDocument(testApi, node);
		await holdDocument(testApi, node, "bad_checkpoint");
		await expect(
			owner.page.getByText("This document is in question and read-only while an admin reviews it."),
		).toBeVisible();

		await releaseDocument(testApi, node);
		await expect(writerEditor(collaborator.page)).toHaveAttribute("contenteditable", "true");
		await expect(owner.page.getByText("read-only while an admin reviews")).toBeHidden();
		await typeParagraph(collaborator.page, "After the release");
		await expectConverged(testApi, node, [owner.page, collaborator.page], [
			"Before the hold",
			"After the release",
		]);
	});

	test("an edit made while another tab previews a version shows after Back to current", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Written before the version");
		await expectSaved(owner.page);
		await takeVersion(owner.context.request, node, "Before the preview");
		await openWriterDocument(collaborator.page, node);

		await owner.page.getByRole("button", { name: /versions/i }).first().click();
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
			.poll(async () => (await serverText(testApi, node)).join("\n"))
			.toContain("Typed during the preview");

		await owner.page.getByRole("button", { name: "Back to current" }).click();

		await expectConverged(
			testApi,
			node,
			[owner.page, collaborator.page],
			["Written before the version", "Typed during the preview"],
		);
		await expectSaved(owner.page);
		await expect(owner.page.locator(".bg-surface-amber-2")).toHaveCount(0);
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
		await takeVersion(owner.context.request, node, "One");
		const showToc = page.getByRole("button", { name: "Show table of contents" });
		if (await showToc.isVisible()) await showToc.click();
		const tocHeading = page.getByText("Table of contents", { exact: true });
		const tocEntry = page.getByRole("link", { name: "First heading" });
		const tocGap = (await tocEntry.boundingBox())!.y - (await tocHeading.boundingBox())!.y;
		const text = page.getByLabel("Document editor").locator("p", { hasText: "Centred text" });
		let last = -1;
		await expect
			.poll(async () => last === (last = (await text.boundingBox())!.x), { intervals: [400] })
			.toBe(true);
		const before = await text.boundingBox();
		const column = await page.locator("#editor-scroll-container").boundingBox();
		const track = () =>
			page.evaluate(
				() =>
					new Promise<number[][]>((resolve) => {
						const p = document.querySelector('[aria-label="Document editor"] p')!;
						const frames: number[][] = [];
						const start = performance.now();
						const tick = () => {
							const width = document.querySelector("aside")?.getBoundingClientRect().width ?? 0;
							frames.push([p.getBoundingClientRect().x, width]);
							if (performance.now() - start < 600) requestAnimationFrame(tick);
							else resolve(frames);
						};
						requestAnimationFrame(tick);
					}),
			);
		const expectInStep = (frames: number[][]) => {
			expect(frames.some(([, width]) => width > 10 && width < 310)).toBe(true);
			const drift = Math.max(...frames.map(([x, width]) => Math.abs(before!.x - x - width / 2)));
			expect(drift).toBeLessThanOrEqual(1);
		};

		const opening = track();
		await page.getByRole("button", { name: /versions/i }).first().click();
		expectInStep(await opening);
		const aside = page.getByRole("complementary", { name: "Versions" });
		const row = aside.getByRole("button", { name: /^One/ });
		await expect(row).toBeVisible();
		const panel = (await aside.boundingBox())!;
		expect(panel).toMatchObject({ y: column!.y, height: column!.height, width: 320 });
		expect(panel.x + panel.width).toBe(column!.x + column!.width);
		expect((await text.boundingBox())!.x).toBe(before!.x - 160);
		const heading = (await aside.getByRole("heading", { name: "Versions" }).boundingBox())!;
		const first = (await row.boundingBox())!;
		expect(first.x).toBe(heading.x);
		expect(first.y - heading.y).toBe(tocGap);

		await page.getByRole("button", { name: /comments/i }).first().click();
		const comments = page.getByRole("complementary", { name: "Comments" });
		const input = (await comments.getByPlaceholder("Add a comment").boundingBox())!;
		const commentsHeading = (await comments.getByRole("heading", { name: "Comments" }).boundingBox())!;
		expect(input.x).toBe(commentsHeading.x);
		expect(input.y - commentsHeading.y).toBe(tocGap);

		const closing = track();
		await page.getByRole("button", { name: "Close panel" }).click();
		expectInStep(await closing);
		expect(await text.boundingBox()).toEqual(before);
	});

	test("a version preview shows its text where the editor's text sits, and Back to current returns to it", async ({
		owner,
	}) => {
		const { page } = owner;
		await page.setViewportSize({ width: 1440, height: 900 });
		await openWriterDocument(page, node);
		await typeParagraph(page, "First version");
		await expectSaved(page);
		await takeVersion(owner.context.request, node, "One");
		await typeParagraph(page, "Second version");
		await expectSaved(page);
		await takeVersion(owner.context.request, node, "Two");
		await page.getByRole("button", { name: /versions/i }).first().click();
		const panel = page.getByRole("complementary", { name: "Versions" });
		await expect.poll(async () => (await panel.boundingBox())?.width).toBe(320);
		const editorText = page.getByLabel("Document editor");
		const previewText = page.locator('[aria-label="Version preview"] .ProseMirror');
		const place = async (text: typeof editorText) => {
			const { x, y, width } = (await text.locator("p", { hasText: "First version" }).boundingBox())!;
			return { x, width, top: (await text.boundingBox())!.y, y };
		};
		const editing = await place(editorText);
		const look = (bar: ReturnType<typeof page.locator>) =>
			bar.evaluate((el) => {
				const style = getComputedStyle(el);
				return [style.backgroundColor, style.borderBottomColor, el.getBoundingClientRect().height];
			});
		const themes = ["light", "dark"] as const;
		const toolbar = page.getByRole("button", { name: "Bold" }).locator("xpath=ancestor::div[contains(@class, 'border-b')][1]");
		const toolbarLooks = [];
		for (const theme of themes) {
			await page.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), theme);
			toolbarLooks.push(await look(toolbar));
		}

		await panel.getByRole("button", { name: /^One/ }).click();
		await expect(previewText).toContainText("First version");
		const bar = page.getByRole("status").filter({ hasText: "Viewing One" });
		for (const [i, theme] of themes.entries()) {
			await page.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), theme);
			expect(await look(bar)).toEqual(toolbarLooks[i]);
			expect(await bar.getByRole("button", { name: "Back to current" }).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
		}
		// frappe-ui gives an empty read-only line a fixed height, so lines below one may sit a few px off.
		expect(await place(previewText)).toMatchObject({ x: editing.x, width: editing.width, top: editing.top });

		await panel.getByRole("button", { name: /^Two/ }).click();
		await expect(previewText).toContainText("Second version");
		expect(await place(previewText)).toMatchObject({ x: editing.x, width: editing.width, top: editing.top });

		await page.getByRole("button", { name: "Back to current" }).click();
		await expect(editorText).toBeVisible();
		expect(await place(editorText)).toEqual(editing);
	});
	test("a copy made in Drive keeps the text and its pictures, and takes its own edits", async ({
		owner,
		testApi,
	}) => {
		const { page } = owner;
		await openWriterDocument(page, node);
		await typeParagraph(page, "Text above the picture");
		await page.keyboard.press("Enter");
		await pastePicture(page);
		await expect.poll(() => picturesLoaded(page)).toEqual([true]);
		await expectSaved(page);
		const { title } = await getNode(page.request, node);

		await page.goto("/drive");
		const menu = await openRowMenu(page, title);
		const copying = page.waitForResponse(
			(response) =>
				response.request().method() === "POST" && response.url().includes(`/nodes/${node}/copy`),
		);
		await menu.getByRole("menuitem", { name: "Make a copy", exact: true }).click();
		await page
			.getByRole("dialog", { name: "Make a copy" })
			.getByRole("button", { name: "Copy here", exact: true })
			.click();
		const copied = await copying;
		expect(copied.ok(), await copied.text()).toBe(true);
		const copy = ((await copied.json()) as { data: { name: string } }).data.name;

		try {
			await openWriterDocument(page, copy);
			await typeParagraph(page, "Only in the copy");
			await expectSaved(page);
			expect(await serverText(testApi, copy)).toContain("Only in the copy");
			expect((await serverText(testApi, node)).join("\n")).not.toContain("Only in the copy");

			// The source's pictures go with it, so a copy that still named them would show none
			await discardNode(page.request, node);
			await page.reload();
			await expect(writerEditor(page)).toContainText("Text above the picture");
			await expect.poll(() => picturesLoaded(page)).toEqual([true]);
		} finally {
			await discardNode(page.request, copy);
		}
	});

	test("deleting a document forever from the Trash removes its log", async ({ owner, testApi }) => {
		const { page } = owner;
		await openWriterDocument(page, node);
		await typeParagraph(page, "Gone for good");
		await expectSaved(page);
		const { title } = await getNode(page.request, node);
		const log = await logId(testApi, node);
		expect((await logRows(testApi, log)).update).toBeGreaterThan(0);

		await page.goto("/drive");
		let menu = await openRowMenu(page, title);
		await menu.getByRole("menuitem", { name: "Move to trash", exact: true }).click();
		await sidebarLink(page, "Trash").click();
		menu = await openRowMenu(page, title);
		await menu.getByRole("menuitem", { name: "Delete forever", exact: true }).click();
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Delete forever", exact: true })
			.click();

		await expect.poll(() => canReadNode(page.request, node)).toBe(false);
		await expect
			.poll(() => logRows(testApi, log))
			.toEqual({ doc: 0, update: 0, session: 0, checkpoint: 0, recovery: 0 });
	});

	test("Drive refuses to restore a version over a collab document", async ({ owner, testApi }) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Kept in the version");
		await expectSaved(owner.page);
		const seq = await takeVersion(owner.context.request, node, "Before the change");
		await typeParagraph(owner.page, "Written after the version");
		await expectSaved(owner.page);
		const before = await serverText(testApi, node);

		const restore = await owner.context.request.post(
			`${DRIVE}/nodes/${node}/versions/${seq}/restore`,
		);

		expect(restore.status()).toBe(409);
		expect(await restore.text()).toContain("Open the document to restore this version");
		expect(await serverText(testApi, node)).toEqual(before);
	});

	test("Drive refuses to export a collab document and points to the editor", async ({ owner }) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Export me");
		await expectSaved(owner.page);

		const answer = await owner.context.request.get(`${DRIVE}/nodes/${node}/content?format=html`);

		expect(answer.status()).toBe(409);
		expect(await answer.text()).toContain("Open the document to download it");
	});
});
