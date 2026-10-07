import { resolve } from "node:path";
import { expect, test } from "../../fixtures/test";
import {
	bodyLimitProxy,
	collabState,
	compactNow,
	editorBlocks,
	enableCollab,
	expectConverged,
	expectSaved,
	fillUp,
	holdDocument,
	leaveNoRoom,
	logId,
	logRows,
	pastePicture,
	picturesLoaded,
	pasteText,
	pushInPieces,
	quarantineLast,
	releaseDocument,
	serverText,
	stateBytes,
	takeVersion,
	typeParagraph,
	writeNewerSchema,
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
	documentMenuButton,
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

	test("a quarantined change leaves every tab, and the writer's typing after it is kept aside", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);
		await typeParagraph(owner.page, "Kept line");
		await expectSaved(owner.page);
		await typeParagraph(collaborator.page, "Bad line");
		await expectSaved(collaborator.page);
		await expect(writerEditor(owner.page)).toContainText("Bad line");

		// Held pulls let the collaborator's next push be the one that learns its session was closed
		let letPullsThrough = () => {};
		const pullsHeld = new Promise<void>((resolve) => {
			letPullsThrough = resolve;
		});
		await collaborator.page.route("**/collab/updates**", async (route) => {
			if (route.request().method() === "GET") await pullsHeld;
			await route.fallback();
		});
		await quarantineLast(testApi, node, "kernel_failed");
		await expect(writerEditor(owner.page)).not.toContainText("Bad line");

		await typeParagraph(collaborator.page, "After the cut");
		await expect(
			collaborator.page.getByText("Your last edits couldn't be saved here and were kept as a recovery copy."),
		).toBeVisible();
		letPullsThrough();
		await expect(writerEditor(collaborator.page)).toHaveAttribute("contenteditable", "true");
		await expectConverged(testApi, node, [owner.page, collaborator.page], ["Kept line"]);
	});

	test("an edit that waits for room is saved once a compaction makes it", async ({ owner, testApi }) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Before the cap");
		await expectSaved(owner.page);
		const waited: string[] = [];
		owner.page.on("response", async (response) => {
			const pushed = response.request().method() === "POST" && response.url().includes("/collab/updates");
			if (pushed && response.status() === 423)
				waited.push(((await response.json()) as { collab: string }).collab);
		});

		await leaveNoRoom(testApi, node);
		await typeParagraph(owner.page, "After the wait");

		await expect.poll(() => waited, { timeout: 15_000 }).toContain("compacting");
		await expectConverged(testApi, node, [owner.page], ["Before the cap", "After the wait"], 30_000);
		const state = await collabState(testApi, node);
		expect(state.checkpoint_rev).toBeGreaterThan(0);
	});

	test("a change sent in pieces is saved whole and opens in the editor", async ({ owner, testApi }) => {
		const answer = await pushInPieces(owner.page.request, testApi, node, owner.user.user, 700_000);

		expect(answer).toEqual({ pieces: 3, status: 200 });
		expect((await logRows(testApi, await logId(testApi, node))).stage).toBe(0);
		await openWriterDocument(owner.page, node);
		await expect
			.poll(async () => (await editorBlocks(owner.page)).map((block) => block.length), { timeout: 15_000 })
			.toContain(700_000);
		expect((await serverText(testApi, node)).at(-1)).toBe("x".repeat(700_000));
	});

	test("a big paste through a proxy with a 1 MiB body limit is saved whole", async ({ owner, testApi, baseURL }) => {
		const proxy = await bodyLimitProxy(baseURL!);
		try {
			await owner.page.goto(`${proxy.origin}/d/${node}`);
			await expect(writerEditor(owner.page)).toBeVisible();
			const big = "v".repeat(2.5 * 2 ** 20);

			await pasteText(owner.page, big);

			await expectSaved(owner.page);
			const saved = await serverText(testApi, node);
			expect(saved.map((block) => block.length)).toContain(big.length);
			expect(saved.includes(big)).toBe(true);
			expect([proxy.seen.refused, proxy.seen.largest <= 2 ** 20]).toEqual([0, true]);
		} finally {
			await proxy.close();
		}
	});

	test("a paste a 200 KiB proxy refuses stays unsent, says so, and saves once the proxy lets it through", async ({
		owner,
		testApi,
		baseURL,
	}) => {
		test.setTimeout(90_000);
		const proxy = await bodyLimitProxy(baseURL!, 200 * 2 ** 10);
		try {
			await owner.page.goto(`${proxy.origin}/d/${node}`);
			await expect(writerEditor(owner.page)).toBeVisible();
			const big = "p".repeat(300 * 2 ** 10);

			await pasteText(owner.page, big);

			const refusing = owner.page.getByText("Your network is refusing uploads, so your latest changes aren't saved.");
			await expect(refusing).toBeVisible();
			expect(proxy.seen.refused).toBeGreaterThan(0);
			expect((await serverText(testApi, node)).includes(big)).toBe(false);

			proxy.lift();

			// The tab retries on its own backoff, up to half a minute
			await expect(owner.page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 45_000 });
			await expect(refusing).toBeHidden();
			expect((await serverText(testApi, node)).includes(big)).toBe(true);
		} finally {
			await proxy.close();
		}
	});

	test("a document at the cap opens in under three seconds", async ({ owner, testApi }) => {
		test.setTimeout(120_000);
		const length = 4 * 2 ** 20 - 64 * 2 ** 10;
		expect(await pushInPieces(owner.page.request, testApi, node, owner.user.user, length)).toEqual({
			pieces: 16,
			status: 200,
		});
		expect((await compactNow(testApi, node)).tail_rows).toBe(0);
		expect(await stateBytes(testApi, node)).toBeGreaterThanOrEqual(length);

		const started = Date.now();
		await owner.page.goto(`/d/${node}`);
		await expect
			.poll(async () => (await editorBlocks(owner.page)).map((block) => block.length), { intervals: [50] })
			.toContain(length);
		const took = Date.now() - started;

		expect(took).toBeLessThan(3000);
	});

	test("a change over a quarter mebibyte sent whole is refused and saves nothing", async ({ owner, testApi }) => {
		const before = await serverText(testApi, node);

		const answer = await pushInPieces(owner.page.request, testApi, node, owner.user.user, 300_000, true);

		expect(answer).toEqual({ pieces: 0, status: 413, collab: "too_large" });
		expect(await serverText(testApi, node)).toEqual(before);
	});

	test("a big paste is saved in pieces and reads back whole", async ({ owner, testApi }) => {
		const pieces: string[] = [];
		owner.page.on("request", (request) => {
			if (request.method() === "PUT" && request.url().includes("/collab/stage/")) pieces.push(request.url());
		});
		await openWriterDocument(owner.page, node);
		const big = "y".repeat(700_000);

		await pasteText(owner.page, big);

		await expect.poll(() => serverText(testApi, node), { timeout: 30_000 }).toContainEqual(expect.stringContaining(big));
		await expectSaved(owner.page);
		expect(pieces.length).toBeGreaterThanOrEqual(3);
		expect((await logRows(testApi, await logId(testApi, node))).stage).toBe(0);
	});

	test("a paste too large for one save is refused before it enters the document", async ({ owner, testApi }) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Before the huge paste");
		await expectSaved(owner.page);

		await pasteText(owner.page, "z".repeat(4.5 * 2 ** 20));

		await expect(owner.page.getByText("This is too large to add in one go. Add it in smaller parts.")).toBeVisible();
		await expect(writerEditor(owner.page)).not.toContainText("zzzz");
		await expectSaved(owner.page);
		const saved = (await serverText(testApi, node)).join("");
		expect([saved.includes("Before the huge paste"), saved.includes("zzzz")]).toEqual([true, false]);
	});

	test("a .docx too large for one save is refused before it enters the document", async ({ owner, testApi }) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Before the huge import");
		await expectSaved(owner.page);

		// One paragraph of 4.5 MiB of text, which zips to a few kilobytes
		const [chooser] = await Promise.all([
			owner.page.waitForEvent("filechooser"),
			(async () => {
				await documentMenuButton(owner.page).click();
				await owner.page.getByRole("menuitem", { name: "Import DOCX" }).click();
			})(),
		]);
		await chooser.setFiles(resolve(__dirname, "fixtures/import-too-large.docx"));

		await expect(owner.page.getByText("This file is too large to import.")).toBeVisible();
		await expect(writerEditor(owner.page)).not.toContainText("zzzz");
		await expectSaved(owner.page);
		const saved = (await serverText(testApi, node)).join("");
		expect([saved.includes("Before the huge import"), saved.includes("zzzz")]).toEqual([true, false]);
	});

	test("a paste into a full document is kept aside, and deletes save until there is room", async ({ owner, testApi }) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Before the document filled");
		await typeParagraph(owner.page, "Delete me");
		await expectSaved(owner.page);

		// Held pulls keep the tab from learning the document is full before the paste reaches the server
		let letPullsThrough = () => {};
		const pullsHeld = new Promise<void>((resolve) => {
			letPullsThrough = resolve;
		});
		await owner.page.route("**/collab/updates**", async (route) => {
			if (route.request().method() === "GET") await pullsHeld;
			await route.fallback();
		});
		await fillUp(testApi, node);
		await pasteText(owner.page, "Pasted after it filled");

		const banner =
			"This document is at its size limit. Your latest changes went to a recovery copy. Delete content to free space.";
		await expect(owner.page.getByText(banner)).toBeVisible();
		letPullsThrough();
		await expect(writerEditor(owner.page)).not.toContainText("Pasted after it filled");
		expect((await serverText(testApi, node)).join("")).not.toContain("Pasted after it filled");

		await writerEditor(owner.page).getByText("Delete me").click();
		await owner.page.keyboard.press("End");
		for (let i = 0; i < 3; i++) await owner.page.keyboard.press("Backspace");
		await expect(writerEditor(owner.page)).not.toContainText("Delete me");
		await expect.poll(async () => (await serverText(testApi, node)).join("")).not.toContain("Delete me");
		await expect(owner.page.getByText(banner)).toBeVisible();
		// Checked at once, as typing that went in would also leave once its refusal rebuilds the tab
		await owner.page.keyboard.type("Typed while full");
		expect(await writerEditor(owner.page).innerText()).not.toContain("Typed while full");

		await compactNow(testApi, node);
		await expect(owner.page.getByText(banner)).toBeHidden();
		await typeParagraph(owner.page, "Room again");
		await expectSaved(owner.page);
		expect((await serverText(testApi, node)).join("")).toContain("Room again");
	});

	test("a change the server finds too large stops saving and says to insert images as files", async ({ owner }) => {
		// The paste guard keeps real changes under the cap, so the server's answer to a bigger one is played here
		await owner.page.route("**/collab/stage/**", (route) =>
			route.fulfill({ status: 413, contentType: "application/json", body: JSON.stringify({ collab: "too_large" }) }),
		);
		await openWriterDocument(owner.page, node);

		await pasteText(owner.page, "w".repeat(700_000));

		await expect(
			owner.page.getByText("A change in this tab is too large to save. Insert large images as files."),
		).toBeVisible();
	});

	test("a document a newer Writer edited is read-only here and asks for a reload", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		const banner = "This document was edited in a newer version of Writer. Reload to edit it.";
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Before the newer Writer");
		await expectSaved(owner.page);

		await writeNewerSchema(testApi, node);
		await expect(owner.page.getByText(banner)).toBeVisible();
		await expect(writerEditor(owner.page)).toHaveAttribute("contenteditable", "false");

		await openWriterDocument(collaborator.page, node);
		await expect(collaborator.page.getByText(banner)).toBeVisible();
		await expect(writerEditor(collaborator.page)).toHaveAttribute("contenteditable", "false");
		await expectConverged(testApi, node, [owner.page, collaborator.page], ["Before the newer Writer"]);
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
			.toEqual({ doc: 0, update: 0, session: 0, checkpoint: 0, stage: 0, recovery: 0 });
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
