import { resolve } from "node:path";
import type { Request, Response, Route } from "@playwright/test";
import { expect, test } from "../../fixtures/test";
import {
	bodyLimitProxy,
	collabState,
	compactNow,
	editorBlocks,
	expectConverged,
	expectSaved,
	fillDocument,
	leaveNoRoom,
	logId,
	logRowCounts,
	openForCollab,
	pasteText,
	pushInPieces,
	serverBlocks,
	stateBytes,
	typeParagraph,
} from "../../helpers/collab";
import { discardNode } from "../../helpers/drive";
import {
	createWriterDocument,
	documentMenuButton,
	openWriterDocument,
	placeCaretIn,
	uniqueWriterTitle,
	writerEditor,
} from "../../helpers/writer";

test.describe("Writer collaboration", () => {
	let node = "";

	test.beforeEach(async ({ owner, collaborator, run, testApi }, testInfo) => {
		const title = uniqueWriterTitle(run.run_id, `collab ${testInfo.title}`);
		node = (await createWriterDocument(owner.page.request, title)).name;
		await openForCollab(testApi, owner.page.request, node, collaborator.user.user);
	});

	test.afterEach(async ({ owner }) => {
		await discardNode(owner.context.request, node);
	});

	test("an edit that waits for room is saved once a compaction makes it", async ({
		owner,
		testApi,
	}) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Before the cap");
		await expectSaved(owner.page);
		const waitReasons: string[] = [];
		const recordWait = async (response: Response) => {
			const isPush =
				response.request().method() === "POST" &&
				/\/api\/suite\/content\/[^/]+\/updates/.test(response.url());
			if (isPush && response.status() === 423) {
				const refusal = (await response.json()) as { collab: string };
				waitReasons.push(refusal.collab);
			}
		};
		owner.page.on("response", recordWait);

		await leaveNoRoom(testApi, node);
		await typeParagraph(owner.page, "After the wait");

		await expect.poll(() => waitReasons, { timeout: 15_000 }).toContain("compacting");
		await expectConverged(
			testApi,
			node,
			[owner.page],
			["Before the cap", "After the wait"],
			30_000,
		);
		const state = await collabState(testApi, node);
		expect(state.body_rev).toBeGreaterThan(0);
	});

	test("a change sent in pieces is saved whole and opens in the editor", async ({
		owner,
		testApi,
	}) => {
		const outcome = await pushInPieces(owner.page.request, testApi, node, owner.user.user, 700_000);

		expect(outcome).toEqual({ pieces: 3, status: 200 });
		const log = await logId(testApi, node);
		const rowCounts = await logRowCounts(testApi, log);
		expect(rowCounts.stage).toBe(0);
		await openWriterDocument(owner.page, node);
		await expect
			.poll(async () => (await editorBlocks(owner.page)).map((block) => block.length), {
				timeout: 15_000,
			})
			.toContain(700_000);
		expect((await serverBlocks(testApi, node)).at(-1)).toBe("x".repeat(700_000));
	});

	test("a big paste through a proxy with a 1 MiB body limit is saved whole", async ({
		owner,
		testApi,
		baseURL,
	}) => {
		const proxy = await bodyLimitProxy(baseURL!);
		try {
			await owner.page.goto(`${proxy.origin}/d/${node}`);
			await expect(writerEditor(owner.page)).toBeVisible();
			const bigPaste = "v".repeat(2.5 * 2 ** 20);

			await pasteText(owner.page, bigPaste);

			await expectSaved(owner.page);
			const saved = await serverBlocks(testApi, node);
			expect(saved.map((block) => block.length)).toContain(bigPaste.length);
			expect(saved.includes(bigPaste)).toBe(true);
			expect([proxy.bodyStats.refused, proxy.bodyStats.largest <= 2 ** 20]).toEqual([0, true]);
		} finally {
			await proxy.close();
		}
	});

	for (const bareRefusal of [false, true]) {
		const testTitle = bareRefusal
			? "a bare 413 from a proxy leaves a paste unsent, says so, and saves once let through"
			: "a paste a 200 KiB proxy refuses stays unsent, says so, and saves once the proxy lets it through";
		test(testTitle, async ({ owner, testApi, baseURL }) => {
			test.setTimeout(90_000);
			const proxy = await bodyLimitProxy(baseURL!, 200 * 2 ** 10, bareRefusal);
			try {
				await owner.page.goto(`${proxy.origin}/d/${node}`);
				await expect(writerEditor(owner.page)).toBeVisible();
				const bigPaste = "p".repeat(300 * 2 ** 10);

				await pasteText(owner.page, bigPaste);

				const refusalBanner = owner.page.getByText(
					"Your network is refusing uploads, so your latest changes aren't saved.",
				);
				await expect(refusalBanner).toBeVisible();
				expect(proxy.bodyStats.refused).toBeGreaterThan(0);
				expect((await serverBlocks(testApi, node)).includes(bigPaste)).toBe(false);

				proxy.liftLimit();

				// The tab retries on its own backoff, up to half a minute
				await expect(owner.page.getByText("Saved", { exact: true })).toBeVisible({
					timeout: 45_000,
				});
				await expect(refusalBanner).toBeHidden();
				expect((await serverBlocks(testApi, node)).includes(bigPaste)).toBe(true);
			} finally {
				await proxy.close();
			}
		});
	}

	test("a document at the cap opens in under three seconds", async ({ owner, testApi }) => {
		test.setTimeout(120_000);
		const length = 4 * 2 ** 20 - 64 * 2 ** 10;
		const outcome = await pushInPieces(owner.page.request, testApi, node, owner.user.user, length);
		expect(outcome).toEqual({
			pieces: 16,
			status: 200,
		});
		expect((await compactNow(testApi, node)).tail_rows).toBe(0);
		expect(await stateBytes(testApi, node)).toBeGreaterThanOrEqual(length);

		const started = Date.now();
		await owner.page.goto(`/d/${node}`);
		await expect
			.poll(async () => (await editorBlocks(owner.page)).map((block) => block.length), {
				intervals: [50],
			})
			.toContain(length);
		const openMs = Date.now() - started;

		expect(openMs).toBeLessThan(3000);
	});

	test("a change over a quarter mebibyte sent whole is refused and saves nothing", async ({
		owner,
		testApi,
	}) => {
		const unchangedBlocks = await serverBlocks(testApi, node);

		const outcome = await pushInPieces(
			owner.page.request,
			testApi,
			node,
			owner.user.user,
			300_000,
			true,
		);

		expect(outcome).toEqual({ pieces: 0, status: 413, collab: "too_large" });
		expect(await serverBlocks(testApi, node)).toEqual(unchangedBlocks);
	});

	test("a big paste is saved in pieces and reads back whole", async ({ owner, testApi }) => {
		const pieces: string[] = [];
		const recordPiece = (request: Request) => {
			const stagesPiece =
				request.method() === "PUT" && /\/api\/suite\/content\/[^/]+\/stage\//.test(request.url());
			if (stagesPiece) {
				pieces.push(request.url());
			}
		};
		owner.page.on("request", recordPiece);
		await openWriterDocument(owner.page, node);
		const bigPaste = "y".repeat(700_000);

		await pasteText(owner.page, bigPaste);

		await expect
			.poll(() => serverBlocks(testApi, node), { timeout: 30_000 })
			.toContainEqual(expect.stringContaining(bigPaste));
		await expectSaved(owner.page);
		expect(pieces.length).toBeGreaterThanOrEqual(3);
		const log = await logId(testApi, node);
		const rowCounts = await logRowCounts(testApi, log);
		expect(rowCounts.stage).toBe(0);
	});

	test("a paste too large for one save is refused before it enters the document", async ({
		owner,
		testApi,
	}) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Before the huge paste");
		await expectSaved(owner.page);

		await pasteText(owner.page, "z".repeat(4.5 * 2 ** 20));

		await expect(
			owner.page.getByText("This is too large to add in one go. Add it in smaller parts."),
		).toBeVisible();
		await expect(writerEditor(owner.page)).not.toContainText("zzzz");
		await expectSaved(owner.page);
		const saved = (await serverBlocks(testApi, node)).join("");
		expect([saved.includes("Before the huge paste"), saved.includes("zzzz")]).toEqual([
			true,
			false,
		]);
	});

	test("a .docx too large for one save is refused before it enters the document", async ({
		owner,
		testApi,
	}) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Before the huge import");
		await expectSaved(owner.page);

		// One paragraph of 4.5 MiB of text, which zips to a few kilobytes
		const chooseImport = async () => {
			await documentMenuButton(owner.page).click();
			await owner.page.getByRole("menuitem", { name: "Import DOCX" }).click();
		};
		const [chooser] = await Promise.all([owner.page.waitForEvent("filechooser"), chooseImport()]);
		await chooser.setFiles(resolve(__dirname, "fixtures/import-too-large.docx"));

		await expect(owner.page.getByText("This file is too large to import.")).toBeVisible();
		await expect(writerEditor(owner.page)).not.toContainText("zzzz");
		await expectSaved(owner.page);
		const saved = (await serverBlocks(testApi, node)).join("");
		expect([saved.includes("Before the huge import"), saved.includes("zzzz")]).toEqual([
			true,
			false,
		]);
	});

	test("a paste into a full document is kept aside, and deletes save until there is room", async ({
		owner,
		testApi,
	}) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Before the document filled");
		await typeParagraph(owner.page, "Delete me");
		await expectSaved(owner.page);

		// Held pulls keep the tab from learning the document is full before the paste reaches the server
		let letPullsThrough = () => {};
		const pullsHeld = new Promise<void>((resolve) => {
			letPullsThrough = resolve;
		});
		const holdPulls = async (route: Route) => {
			if (route.request().method() === "GET") {
				await pullsHeld;
			}
			await route.fallback();
		};
		await owner.page.route("**/api/suite/content/*/updates**", holdPulls);
		await fillDocument(testApi, node);
		await pasteText(owner.page, "Pasted after it filled");

		const banner =
			"This document is at its size limit. Your latest changes went to a recovery copy. Delete content to free space.";
		await expect(owner.page.getByText(banner)).toBeVisible();
		letPullsThrough();
		await expect(writerEditor(owner.page)).not.toContainText("Pasted after it filled");
		expect((await serverBlocks(testApi, node)).join("")).not.toContain("Pasted after it filled");

		await placeCaretIn(owner.page, "Delete me");
		await owner.page.keyboard.press("End");
		for (let i = 0; i < 3; i++) {
			await owner.page.keyboard.press("Backspace");
		}
		await expect(writerEditor(owner.page)).not.toContainText("Delete me");
		await expect
			.poll(async () => (await serverBlocks(testApi, node)).join(""))
			.not.toContain("Delete me");
		await expect(owner.page.getByText(banner)).toBeVisible();
		// Checked at once, as typing that went in would also leave once its refusal rebuilds the tab
		await owner.page.keyboard.type("Typed while full");
		expect(await writerEditor(owner.page).innerText()).not.toContain("Typed while full");

		await compactNow(testApi, node);
		await expect(owner.page.getByText(banner)).toBeHidden();
		await typeParagraph(owner.page, "Room again");
		await expectSaved(owner.page);
		expect((await serverBlocks(testApi, node)).join("")).toContain("Room again");
	});

	test("a tab opened on a full document takes only deletes until there is room", async ({
		owner,
		testApi,
	}) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Before the document filled");
		await typeParagraph(owner.page, "Delete me");
		await expectSaved(owner.page);
		await fillDocument(testApi, node);

		const tab = await owner.page.context().newPage();
		await openWriterDocument(tab, node);
		const banner = "This document is at its size limit. Delete content to free space.";
		await expect(tab.getByText(banner)).toBeVisible();
		await placeCaretIn(tab, "Before the document filled");
		await tab.keyboard.press("End");
		await tab.keyboard.type(" typed while full");
		expect(await writerEditor(tab).innerText()).not.toContain("typed while full");

		await placeCaretIn(tab, "Delete me");
		await tab.keyboard.press("End");
		for (let i = 0; i < 3; i++) {
			await tab.keyboard.press("Backspace");
		}
		await expect
			.poll(async () => (await serverBlocks(testApi, node)).join(""))
			.not.toContain("Delete me");
		// Pushes go out in order, so typing the tab had taken would be saved by now
		expect((await serverBlocks(testApi, node)).join("")).not.toContain("typed while full");

		await compactNow(testApi, node);
		await expect(tab.getByText(banner)).toBeHidden();
		await typeParagraph(tab, "Room again");
		await expectSaved(tab);
		expect((await serverBlocks(testApi, node)).join("")).toContain("Room again");
		await tab.close();
	});

	test("a change the server finds too large stops saving and says to insert images as files", async ({
		owner,
	}) => {
		// The paste guard keeps real changes under the cap, so the server's answer to a bigger one is played here
		const tooLarge = {
			status: 413,
			contentType: "application/json",
			body: JSON.stringify({ collab: "too_large" }),
		};
		await owner.page.route("**/api/suite/content/*/stage/**", (route) => route.fulfill(tooLarge));
		await openWriterDocument(owner.page, node);

		await pasteText(owner.page, "w".repeat(700_000));

		await expect(
			owner.page.getByText(
				"A change in this tab is too large to save. Insert large images as files.",
			),
		).toBeVisible();
	});
});
