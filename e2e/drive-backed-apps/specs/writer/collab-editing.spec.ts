import type { Page, Request, Route, WebSocket } from "@playwright/test";
import { expect, test } from "../../fixtures/test";
import {
	blockRuns,
	collabState,
	compactNow,
	editorBlocks,
	expectConverged,
	expectSaved,
	openForCollab,
	pasteHtml,
	serverBlocks,
	startCodeAndBold,
	trimmedRev,
	trimNow,
	typeParagraph,
} from "../../helpers/collab";
import { discardNode } from "../../helpers/drive";
import {
	createWriterDocument,
	openWriterDocument,
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

	test("text that is both code and bold keeps both through an edit", async ({ owner, testApi }) => {
		await startCodeAndBold(testApi, node);
		await openWriterDocument(owner.page, node);

		await writerEditor(owner.page).focus();
		await owner.page.keyboard.type("Typed ");
		await expectSaved(owner.page);

		await expectConverged(testApi, node, [owner.page], ["Typed plain both"]);
		const [edited] = await blockRuns(testApi, node);
		expect(edited).toEqual([
			["Typed plain ", {}],
			["both", { code: {}, bold: {} }],
		]);
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

	test("bold over a mention shows in the other tab and after a reload", async ({
		owner,
		collaborator,
	}) => {
		const mentionLine =
			'<p>a<span class="mention" data-type="mention" data-id="ann" data-label="Ann">@Ann</span>b</p>';
		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);
		await pasteHtml(owner.page, mentionLine);
		await expect(writerEditor(owner.page).getByText("Ann")).toBeVisible();

		await owner.page.keyboard.press("Shift+Home");
		await owner.page.getByRole("button", { name: "Bold" }).click();
		await expectSaved(owner.page);

		await expect(boldMention(owner.page)).toBeVisible();
		await expect(boldMention(collaborator.page)).toBeVisible();
		await collaborator.page.reload();
		await openWriterDocument(collaborator.page, node);
		await expect(boldMention(collaborator.page)).toBeVisible();
	});

	test("undo takes back this tab's typing and leaves the other person's", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);
		await typeParagraph(owner.page, "Owner typed this");
		await expectSaved(owner.page);
		await typeParagraph(collaborator.page, "Collaborator typed this");
		await expectConverged(
			testApi,
			node,
			[owner.page, collaborator.page],
			["Owner typed this", "Collaborator typed this"],
		);

		await owner.page.keyboard.press("ControlOrMeta+z");

		const blocks = await expectConverged(
			testApi,
			node,
			[owner.page, collaborator.page],
			["Collaborator typed this"],
		);
		expect(blocks.join("\n")).not.toContain("Owner typed this");
	});

	test("saving with the shortcut sends the edit and says so", async ({ owner, testApi }) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Saved by the shortcut");

		await owner.page.keyboard.press("ControlOrMeta+s");

		await expect(owner.page.getByText("Saved document")).toBeVisible();
		expect((await serverBlocks(testApi, node)).join("\n")).toContain("Saved by the shortcut");
	});

	test("an edit reaches the other tab over the realtime socket, without a poll", async ({
		owner,
		collaborator,
	}) => {
		const frames: string[] = [];
		function recordFrames(socket: WebSocket) {
			socket.on("framereceived", ({ payload }) => frames.push(String(payload)));
		}

		collaborator.page.on("websocket", recordFrames);

		const polls: string[] = [];
		function recordPoll(request: Request) {
			if (/\/api\/suite\/content\/[^/]+\/updates/.test(request.url())) {
				polls.push(request.url());
			}
		}

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
		await expect.poll(() => frames.some((frame) => frame.includes("suite_collab_row"))).toBe(true);
		expect(polls).toEqual([]);
	});

	test("each tab shows the other person's name in the users bar, and their first name at their caret", async ({
		owner,
		collaborator,
		run,
	}) => {
		function nameOf(user: { user: string }) {
			const userNumber = run.users.findIndex((each) => each.user === user.user) + 1;
			return `Drive Writer E2E ${userNumber}`;
		}

		function firstNameOf(user: { user: string }) {
			const [firstName] = nameOf(user).split(" ");
			return firstName;
		}

		function caretLabels(page: Page) {
			return page.locator(".collaboration-carets__label");
		}

		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);

		await typeParagraph(owner.page, "Owner's caret");
		await typeParagraph(collaborator.page, "Collaborator's caret");

		const collaboratorName = nameOf(collaborator.user);
		const ownerName = nameOf(owner.user);
		await expect(
			owner.page.getByRole("button", { name: `${collaboratorName} is here` }),
		).toBeVisible();
		await expect(
			collaborator.page.getByRole("button", { name: `${ownerName} is here` }),
		).toBeVisible();
		await expect(caretLabels(owner.page)).toHaveText([firstNameOf(collaborator.user)]);
		await expect(caretLabels(collaborator.page)).toHaveText([firstNameOf(owner.user)]);
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

	test("a tab offline while the rows it missed are trimmed rebuilds and keeps its own edit", async ({
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
		await typeParagraph(owner.page, "First line the other tab missed");
		await expectSaved(owner.page);
		await typeParagraph(owner.page, "Second line the other tab missed");
		await expectSaved(owner.page);
		const compacted = await compactNow(testApi, node);
		await trimNow(testApi, node);
		await expect
			.poll(() => trimmedRev(testApi, node), { timeout: 30_000 })
			.toBe(compacted.body_rev - 1);

		await collaborator.context.setOffline(false);

		await expectConverged(
			testApi,
			node,
			[owner.page, collaborator.page],
			["Typed while offline", "First line the other tab missed", "Second line the other tab missed"],
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

		async function compactionStatus() {
			const state = await collabState(testApi, node);
			const compacted = state.head_rev > 0 && state.body_rev === state.head_rev;
			return {
				compacted,
				tail_rows: state.tail_rows,
			};
		}

		await expect
			.poll(compactionStatus, { timeout: 30_000 })
			.toEqual({ compacted: true, tail_rows: 0 });
		const stored = await serverBlocks(testApi, node);
		expect(stored.join("\n")).toContain("Typed just before the last tab closed");

		const writes: string[] = [];
		const openedAt = Date.now();
		function recordWrite(request: Request) {
			const url = request.url();
			const method = request.method();
			const isWrite = /\/api\/suite\/content\/[^/]+\/(updates|stage)/.test(url);
			if (!isWrite || method === "GET") return;

			const elapsedMs = Date.now() - openedAt;
			writes.push(`${elapsedMs}ms ${method} ${url}`);
		}

		collaborator.page.on("request", recordWrite);
		await openWriterDocument(collaborator.page, node);
		try {
			await expect.poll(() => editorBlocks(collaborator.page)).toEqual(stored);
		} catch (error) {
			// Whether the reopened tab wrote anything tells a delete on its first render from a display miss
			const reopened = {
				server: await serverBlocks(testApi, node),
				editor: await collaborator.page.evaluate(editorJson),
				editorKind: await collaborator.page.evaluate(editorKind),
				writes,
			};
			const report = JSON.stringify(reopened);
			console.log(`R162 reopen: ${report}`);
			throw error;
		}
	});

	test("a second tab counts the first tab's unsent edit and shows Saved once it is sent", async ({
		owner,
	}) => {
		// A failed push retries after up to 30 s
		test.setTimeout(120_000);
		await owner.page.route(PUSHES, dropPushes);
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Held in the first tab");
		const firstCount = await unsentCount(owner.page);

		const second = await owner.context.newPage();
		await openWriterDocument(second, node);
		await expect(second.getByText(firstCount, { exact: true })).toBeVisible();
		await expect(second.getByText("Saved", { exact: true })).toBeHidden();
		expect(await editorBlocks(second)).not.toContain("Held in the first tab");

		await owner.page.unroute(PUSHES, dropPushes);
		await expect(second.getByText("Saved", { exact: true })).toBeVisible({ timeout: 60_000 });
		await expectSaved(owner.page);
	});

	test("an unsent edit left by a closed tab is sent once by the tab still open", async ({
		owner,
		testApi,
	}) => {
		await owner.page.route(PUSHES, dropPushes);
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Left by the closed tab");
		const firstCount = await unsentCount(owner.page);
		const second = await owner.context.newPage();
		await openWriterDocument(second, node);
		await expect(second.getByText(firstCount, { exact: true })).toBeVisible();

		await owner.page.close();

		await expectSaved(second);
		const stored = await serverBlocks(testApi, node);
		expect(stored.filter((block) => block === "Left by the closed tab")).toHaveLength(1);
		await expect.poll(() => editorBlocks(second)).toEqual(stored);
	});
});

const PUSHES = "**/api/suite/content/*/updates";

// Pushes fail as if offline; pulls still go through
function dropPushes(route: Route) {
	if (route.request().method() === "POST") {
		return route.abort();
	}

	return route.fallback();
}

// Runs in the page, so it reads nothing from this module
function editorJson() {
	const root = document.querySelector(".ProseMirror") as { editor?: { getJSON: () => object } } | null;
	return root?.editor?.getJSON() ?? null;
}

// Runs in the page: only the collab editor registers Tiptap's collaboration extension
function editorKind() {
	interface Mounted {
		editor?: { extensionManager: { extensions: { name: string }[] } };
	}
	const root = document.querySelector(".ProseMirror") as Mounted | null;
	if (!root?.editor) {
		return null;
	}

	const names = root.editor.extensionManager.extensions.map((extension) => extension.name);
	return names.includes("collaboration") ? "collab" : "plain";
}

// The header's "<n> unsent", once the tab holds unsent work
async function unsentCount(page: Page): Promise<string> {
	const count = page.getByText(/^\d+ unsent$/);
	await expect(count).toBeVisible();
	return (await count.textContent()) ?? "";
}

function boldMention(page: Page) {
	return writerEditor(page).locator("strong", { hasText: "Ann" });
}
