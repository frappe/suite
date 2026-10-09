import { resolve } from "node:path";
import type { Page, Request, Response, Route, WebSocket } from "@playwright/test";
import { expect, test } from "../../fixtures/test";
import {
	bodyLimitProxy,
	collabState,
	compactNow,
	editorBlocks,
	enableCollab,
	expectConverged,
	expectSaved,
	fillDocument,
	holdDocument,
	leaveNoRoom,
	logId,
	logRowCounts,
	pastePicture,
	picturesLoaded,
	pasteText,
	pushInPieces,
	quarantineLast,
	releaseDocument,
	serverBlocks,
	stateBytes,
	saveNamedVersion,
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
	placeCaretIn,
	shareWriterDocument,
	uniqueWriterTitle,
	writerEditor,
} from "../../helpers/writer";

/** What Drive answers to a copy. */
type CopyReply = { data: { name: string } };

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
		const convergedBlocks = await expectConverged(
			testApi,
			node,
			[owner.page, collaborator.page],
			["Kept across a reload", "Also kept across a reload"],
		);

		await owner.page.reload();
		await openWriterDocument(owner.page, node);

		await expect.poll(() => editorBlocks(owner.page)).toEqual(convergedBlocks);
	});

	test("an edit reaches the other tab over the realtime socket, without a poll", async ({
		owner,
		collaborator,
	}) => {
		const frames: string[] = [];
		const recordFrames = (socket: WebSocket) => {
			socket.on("framereceived", ({ payload }) => frames.push(String(payload)));
		};
		collaborator.page.on("websocket", recordFrames);

		const polls: string[] = [];
		const recordPoll = (request: Request) => {
			if (/\/api\/suite\/content\/[^/]+\/updates/.test(request.url())) {
				polls.push(request.url());
			}
		};
		collaborator.page.on("request", recordPoll);
		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);
		await expect.poll(() => frames.some((frame) => frame.includes('"roster"'))).toBe(true);
		await typeParagraph(collaborator.page, "Collaborator is here");
		await expect(writerEditor(owner.page)).toContainText("Collaborator is here");

		polls.length = 0;
		await typeParagraph(owner.page, "Heard live");

		await expect(writerEditor(collaborator.page)).toContainText("Heard live", { timeout: 3000 });
		// Longer than one poll tick
		await collaborator.page.waitForTimeout(6000);
		expect(frames.some((frame) => frame.includes("suite_collab_row"))).toBe(true);
		expect(polls).toEqual([]);
	});

	test("each tab shows the other person's name, in the users bar and at their caret", async ({
		owner,
		collaborator,
		run,
	}) => {
		const nameOf = (user: { user: string }) =>
			`Drive Writer E2E ${run.users.findIndex((each) => each.user === user.user) + 1}`;
		const caretLabels = (page: Page) => page.locator(".collaboration-carets__label");
		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);

		await typeParagraph(owner.page, "Owner's caret");
		await typeParagraph(collaborator.page, "Collaborator's caret");

		await expect(
			owner.page.getByRole("button", { name: `${nameOf(collaborator.user)} is here` }),
		).toBeVisible();
		await expect(
			collaborator.page.getByRole("button", { name: `${nameOf(owner.user)} is here` }),
		).toBeVisible();
		await expect(caretLabels(owner.page)).toHaveText([nameOf(collaborator.user)]);
		await expect(caretLabels(collaborator.page)).toHaveText([nameOf(owner.user)]);
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
		const writtenBlocks = await expectConverged(
			testApi,
			node,
			[owner.page],
			["Written before compaction", "Second line before compaction"],
		);
		const uncompactedState = await collabState(testApi, node);
		expect(uncompactedState.head_rev).toBeGreaterThan(uncompactedState.body_rev);

		const compacted = await compactNow(testApi, node);

		expect(compacted).toEqual({
			body_rev: uncompactedState.head_rev,
			head_rev: uncompactedState.head_rev,
			tail_rows: 0,
		});
		expect(await serverBlocks(testApi, node)).toEqual(writtenBlocks);

		await openWriterDocument(collaborator.page, node);
		await expect.poll(() => editorBlocks(collaborator.page)).toEqual(writtenBlocks);
		await expect.poll(() => editorBlocks(owner.page)).toEqual(writtenBlocks);

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

		const compactionStatus = async () => {
			const state = await collabState(testApi, node);
			const compacted = state.head_rev > 0 && state.body_rev === state.head_rev;
			return {
				compacted,
				tail_rows: state.tail_rows,
			};
		};
		await expect
			.poll(compactionStatus, { timeout: 30_000 })
			.toEqual({ compacted: true, tail_rows: 0 });
		const stored = await serverBlocks(testApi, node);
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
		const askForNewerBuild = async (route: Route) => {
			const response = await route.fetch();
			const headers = {
				...response.headers(),
				"x-suite-min-builds": JSON.stringify({ writer: "99999999999999" }),
			};
			await route.fulfill({ response, headers });
		};
		await collaborator.context.route("**/api/**", askForNewerBuild);
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
		await collaborator.context.unrouteAll({ behavior: "ignoreErrors" });
	});

	test("a tab that can't apply a change the server judges clean stops editing, and the others go on", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		test.setTimeout(300_000);
		// Only this browser fails to read one character, as an older browser might
		const failOnSectionSign = () => {
			const originalDecode = TextDecoder.prototype.decode;
			TextDecoder.prototype.decode = function (
				this: TextDecoder,
				...args: Parameters<TextDecoder["decode"]>
			) {
				const text = originalDecode.apply(this, args);
				if (text.includes("\u00a7")) {
					throw new TypeError("This browser can't read the text");
				}

				return text;
			};
		};
		await owner.page.addInitScript(failOnSectionSign);
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
		await expectConverged(
			testApi,
			node,
			[collaborator.page],
			["Marked \u00a7 here", "Still saving"],
		);
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
		await expectConverged(
			testApi,
			node,
			[owner.page, collaborator.page],
			["Before the hold", "After the release"],
		);
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
		const holdPulls = async (route: Route) => {
			if (route.request().method() === "GET") {
				await pullsHeld;
			}
			await route.fallback();
		};
		await collaborator.page.route("**/api/suite/content/*/updates**", holdPulls);
		await quarantineLast(testApi, node, "kernel_failed");
		await expect(writerEditor(owner.page)).not.toContainText("Bad line");

		await typeParagraph(collaborator.page, "After the cut");
		await expect(
			collaborator.page.getByText(
				"Your last edits couldn't be saved here and were kept as a recovery copy.",
			),
		).toBeVisible();
		letPullsThrough();
		await expect(writerEditor(collaborator.page)).toHaveAttribute("contenteditable", "true");
		await expectConverged(testApi, node, [owner.page, collaborator.page], ["Kept line"]);
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
			expect([proxy.traffic.refused, proxy.traffic.largest <= 2 ** 20]).toEqual([0, true]);
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
				expect(proxy.traffic.refused).toBeGreaterThan(0);
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
		// The hook writes no row to hear live, so the tab pulls as it does on coming back online
		await owner.page.evaluate(() => window.dispatchEvent(new Event("online")));
		await expect(owner.page.getByText(banner)).toBeVisible();
		await expect(writerEditor(owner.page)).toHaveAttribute("contenteditable", "false");

		await openWriterDocument(collaborator.page, node);
		await expect(collaborator.page.getByText(banner)).toBeVisible();
		await expect(writerEditor(collaborator.page)).toHaveAttribute("contenteditable", "false");
		await expectConverged(
			testApi,
			node,
			[owner.page, collaborator.page],
			["Before the newer Writer"],
		);
	});

	test("an edit made while another tab previews a version shows after Back to current", async ({
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
		expect(panelBox).toMatchObject({ y: column!.y, height: column!.height, width: 320 });
		expect(panelBox.x + panelBox.width).toBe(column!.x + column!.width);
		expect((await centredLine.boundingBox())!.x).toBe(restingBox!.x - 160);
		const headingBox = (await versionsPanel
			.getByRole("heading", { name: "Versions" })
			.boundingBox())!;
		const firstRowBox = (await row.boundingBox())!;
		expect(firstRowBox.x).toBe(headingBox.x);
		expect(firstRowBox.y - headingBox.y).toBe(tocGap);

		await page
			.getByRole("button", { name: /comments/i })
			.first()
			.click();
		const comments = page.getByRole("complementary", { name: "Comments" });
		const inputBox = (await comments.getByPlaceholder("Add a comment").boundingBox())!;
		const commentsHeading = (await comments
			.getByRole("heading", { name: "Comments" })
			.boundingBox())!;
		expect(inputBox.x).toBe(commentsHeading.x);
		expect(inputBox.y - commentsHeading.y).toBe(tocGap);

		const closing = sampleMotion();
		await page.getByRole("button", { name: "Close panel" }).click();
		expectInStep(await closing);
		expect(await centredLine.boundingBox()).toEqual(restingBox);
	});

	test("a version preview shows its text where the editor's text sits, and Back to current returns to it", async ({
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
		await expect.poll(async () => (await panel.boundingBox())?.width).toBe(320);
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
			const backToCurrent = bar.getByRole("button", { name: "Back to current" });
			const backToCurrentFill = await backToCurrent.evaluate(
				(button) => getComputedStyle(button).backgroundColor,
			);
			expect(backToCurrentFill).toBe("rgba(0, 0, 0, 0)");
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

		await page.getByRole("button", { name: "Back to current" }).click();
		await expect(editorText).toBeVisible();
		expect(await linePlacement(editorText)).toEqual(editorPlacement);
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
		const isCopyAnswer = (response: Response) => {
			const isPost = response.request().method() === "POST";
			return isPost && response.url().includes(`/nodes/${node}/copy`);
		};
		const copying = page.waitForResponse(isCopyAnswer);
		await menu.getByRole("menuitem", { name: "Make a copy", exact: true }).click();
		await page
			.getByRole("dialog", { name: "Make a copy" })
			.getByRole("button", { name: "Copy here", exact: true })
			.click();
		const copied = await copying;
		expect(copied.ok(), await copied.text()).toBe(true);
		const copyReply = (await copied.json()) as CopyReply;
		const copyNode = copyReply.data.name;

		try {
			await openWriterDocument(page, copyNode);
			await typeParagraph(page, "Only in the copy");
			await expectSaved(page);
			expect(await serverBlocks(testApi, copyNode)).toContain("Only in the copy");
			expect((await serverBlocks(testApi, node)).join("\n")).not.toContain("Only in the copy");

			// The source's pictures go with it, so a copy that still named them would show none
			await discardNode(page.request, node);
			await page.reload();
			await expect(writerEditor(page)).toContainText("Text above the picture");
			await expect.poll(() => picturesLoaded(page)).toEqual([true]);
		} finally {
			await discardNode(page.request, copyNode);
		}
	});

	test("deleting a document forever from the Trash removes its log", async ({ owner, testApi }) => {
		const { page } = owner;
		await openWriterDocument(page, node);
		await typeParagraph(page, "Gone for good");
		await expectSaved(page);
		const { title } = await getNode(page.request, node);
		const log = await logId(testApi, node);
		expect((await logRowCounts(testApi, log)).update).toBeGreaterThan(0);

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
			.poll(() => logRowCounts(testApi, log))
			.toEqual({ doc: 0, update: 0, session: 0, checkpoint: 0, stage: 0, recovery: 0 });
	});

	test("Drive refuses to restore a version over a collab document", async ({ owner, testApi }) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Kept in the version");
		await expectSaved(owner.page);
		const versionSeq = await saveNamedVersion(owner.context.request, node, "Before the change");
		await typeParagraph(owner.page, "Written after the version");
		await expectSaved(owner.page);
		const unchangedBlocks = await serverBlocks(testApi, node);

		const restoreResponse = await owner.context.request.post(
			`${DRIVE}/nodes/${node}/versions/${versionSeq}/restore`,
		);

		expect(restoreResponse.status()).toBe(409);
		expect(await restoreResponse.text()).toContain("Open the document to restore this version");
		expect(await serverBlocks(testApi, node)).toEqual(unchangedBlocks);
	});

	test("Drive refuses to export a collab document and points to the editor", async ({ owner }) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Export me");
		await expectSaved(owner.page);

		const exportResponse = await owner.context.request.get(
			`${DRIVE}/nodes/${node}/content?format=html`,
		);

		expect(exportResponse.status()).toBe(409);
		expect(await exportResponse.text()).toContain("Open the document to download it");
	});
});
