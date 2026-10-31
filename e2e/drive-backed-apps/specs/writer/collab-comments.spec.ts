import type { Locator, Page, Route } from "@playwright/test";

import { expect, test } from "../../fixtures/test";
import { expectSaved, openForCollab, saveNamedVersion, typeParagraph } from "../../helpers/collab";
import { discardNode } from "../../helpers/drive";
import {
	createWriterDocument,
	openWriterDocument,
	uniqueWriterTitle,
	writerEditor,
} from "../../helpers/writer";

async function openComments(page: Page) {
	await page.getByRole("banner").getByRole("button", { name: "Comments", exact: true }).click();
	return page.getByRole("complementary", { name: "Comments" });
}

async function commentOnDocument(page: Page, text: string) {
	const panel = await openComments(page);
	await panel.getByRole("button", { name: "Add a comment" }).click();
	await panel.getByLabel("Add a comment", { exact: true }).fill(text);
	await panel.getByRole("button", { name: "Comment", exact: true }).click();
	return panel;
}

// A thread's row in the list, by any of its words
function threadRow(panel: Locator, text: string) {
	return panel.getByRole("listitem").filter({ hasText: text });
}

// The button that opens and closes a thread; an open one's name drops the comment's words
function threadHeader(row: Locator) {
	return row.locator(":scope > button");
}

// Types a line, selects its last word and starts a comment on it from the bubble menu, in the panel it returns
async function startCommentOnLastWord(page: Page, line: string) {
	await typeParagraph(page, line);
	await expectSaved(page);
	const word = line.split(" ").at(-1) ?? "";
	for (let left = word.length; left > 0; left--) {
		await page.keyboard.press("Shift+ArrowLeft");
	}

	await page.locator('[data-slot="bubble-menu"]').getByRole("button", { name: "Comment" }).click();
	const panel = page.getByRole("complementary", { name: "Comments" });
	await expect(panel.getByLabel("Add a comment on the text")).toBeVisible();
	await expect(panel).toContainText(word);
	return panel;
}

// Fails each new thread as a dropped connection would, and lets the list through
function refuseNewThreads(route: Route) {
	if (route.request().method() === "POST") {
		return route.abort();
	}

	return route.fallback();
}

// Lets Drive take each new comment, then drops its answer as a lost connection would
async function loseAnswer(route: Route) {
	if (route.request().method() !== "POST") {
		return route.fallback();
	}

	await route.fetch();
	return route.abort();
}

test.describe("Writer collaboration comments", () => {
	let node = "";

	test.beforeEach(async ({ owner, collaborator, run, testApi }, testInfo) => {
		const title = uniqueWriterTitle(run.run_id, `comments ${testInfo.title}`);
		node = (await createWriterDocument(owner.page.request, title)).name;
		await openForCollab(testApi, owner.page.request, node, collaborator.user.user);
	});

	test.afterEach(async ({ owner }) => {
		await discardNode(owner.context.request, node);
	});

	test("a comment on the document shows on its row and takes a reply, resolve, reopen and delete", async ({
		owner,
	}) => {
		const { page } = owner;
		await openWriterDocument(page, node);
		const panel = await commentOnDocument(page, "Whole document note");
		const row = threadRow(panel, "Whole document note");

		await expect(threadHeader(row)).toHaveAttribute("aria-expanded", "true");
		await row.getByLabel("Reply", { exact: true }).fill("A reply");
		await row.getByRole("button", { name: "Send reply" }).click();
		await expect(row.getByText("A reply", { exact: true })).toBeVisible();
		await expect(row.getByLabel("Reply", { exact: true })).toHaveValue("");
		await expect(row.getByRole("button", { name: "Send reply" })).toHaveCount(0);
		await expect(threadHeader(row)).toHaveAttribute("aria-expanded", "true");
		await row.getByText("A reply", { exact: true }).hover();
		await row.getByRole("button", { name: "More comment actions" }).click();
		await page.getByRole("menuitem", { name: "Edit" }).click();
		await row.getByLabel("Edit comment").fill("A reply, edited");
		await row.getByRole("button", { name: "Save" }).click();
		await expect(row.getByText("A reply, edited", { exact: true })).toBeVisible();
		await row.getByRole("button", { name: "Resolve" }).click();
		await expect(row).toHaveCount(0);
		await page.getByRole("button", { name: "Undo" }).click();
		await expect(row).toHaveCount(1);
		await row.hover();
		await row.getByRole("button", { name: "Resolve" }).click();
		await expect(row).toHaveCount(0);
		await panel.getByRole("button", { name: "Resolved · 1" }).click();
		await threadHeader(row).click();
		await row.getByRole("button", { name: "Reopen" }).click();
		await threadHeader(row).click();
		await expect(row.getByLabel("Reply", { exact: true })).toBeFocused();

		for (const text of ["Whole document note", "A reply, edited"]) {
			await panel.getByText(text, { exact: true }).hover();
			await panel.getByRole("button", { name: "More comment actions" }).click();
			await page.getByRole("menuitem", { name: "Delete" }).click();
			await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
			await expect(panel.getByText(text, { exact: true })).toHaveCount(0);
		}

		await expect(panel.getByText("No open comments.", { exact: false })).toBeVisible();
	});

	test("another tab's comment shows in an open panel without reopening it", async ({
		owner,
		collaborator,
	}) => {
		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);
		const watching = await openComments(collaborator.page);
		await expect(watching.getByText("No open comments.", { exact: false })).toBeVisible();

		await commentOnDocument(owner.page, "Seen from the other tab");

		await expect(threadRow(watching, "Seen from the other tab")).toBeVisible();
	});

	test("a thread someone else changed shows unread until opened, and stays read through a reload", async ({
		owner,
		collaborator,
	}) => {
		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);
		const watching = await openComments(collaborator.page);
		const row = threadRow(watching, "Read me");

		const panel = await commentOnDocument(owner.page, "Read me");
		await expect(row).toContainText("Unread");
		await threadHeader(row).click();
		await expect(row).not.toContainText("Unread");
		await threadHeader(row).click();
		await threadRow(panel, "Read me").getByLabel("Reply", { exact: true }).fill("A reply");
		await owner.page.keyboard.press("Enter");
		await expect(row).toContainText("Unread");
		await threadHeader(row).click();
		await expect(row).not.toContainText("Unread");
		await collaborator.page.reload();
		await openComments(collaborator.page);

		await expect(row).toContainText("1 reply");
		await expect(row).not.toContainText("Unread");
		await expect(threadRow(panel, "Read me")).not.toContainText("Unread");
	});

	test("@ picks a person in a comment box, and the posted comment names them for everyone", async ({
		owner,
		collaborator,
	}) => {
		const { page } = owner;
		const [handle = ""] = collaborator.user.user.split("@");
		await openWriterDocument(page, node);
		const panel = await openComments(page);
		await panel.getByRole("button", { name: "Add a comment" }).click();
		const box = panel.getByLabel("Add a comment", { exact: true });
		await box.pressSequentially(`Ask @${handle}`);
		const option = panel.getByRole("option");
		await expect(option).toHaveCount(1);
		const name = (await option.locator(":scope > span").last().textContent())?.trim() ?? "";
		await page.keyboard.press("Enter");
		await expect(box).toHaveValue(`Ask @${name} `);
		await box.pressSequentially("to check");
		await panel.getByRole("button", { name: "Comment", exact: true }).click();
		await openWriterDocument(collaborator.page, node);
		const watching = await openComments(collaborator.page);

		for (const shown of [panel, watching]) {
			const row = threadRow(shown, "to check");
			await expect(row).toContainText(`Ask @${name} to check`);
		}
	});

	test("a comment on selected text shows on its words, and with deleted text once they go", async ({
		owner,
	}) => {
		const { page } = owner;
		await openWriterDocument(page, node);
		const drafts = await startCommentOnLastWord(page, "the commented sentence");

		await drafts.getByLabel("Add a comment on the text").fill("About this word");
		await drafts.getByRole("button", { name: "Comment", exact: true }).click();

		const panel = page.getByRole("complementary", { name: "Comments" });
		const row = threadRow(panel, "About this word");
		await expect(row).not.toContainText("Text deleted");
		await expect(drafts.getByLabel("Add a comment on the text")).toHaveCount(0);
		await expect(writerEditor(page).locator("[data-thread]")).toHaveText("sentence");

		await writerEditor(page).locator("[data-thread]").dblclick();
		await page.keyboard.press("Backspace");
		await expect(row).toContainText("Text deleted");
		await expect(row).toContainText("sentence");
	});

	test("restoring a version puts a comment back on the words it brought back, for good", async ({
		owner,
	}) => {
		const { page } = owner;
		await openWriterDocument(page, node);
		const drafts = await startCommentOnLastWord(page, "the commented sentence");
		await drafts.getByLabel("Add a comment on the text").fill("About this word");
		await drafts.getByRole("button", { name: "Comment", exact: true }).click();
		const panel = page.getByRole("complementary", { name: "Comments" });
		await expect(threadRow(panel, "About this word")).not.toContainText("Text deleted");
		await saveNamedVersion(owner.context.request, node, "With the word");
		await writerEditor(page).locator("[data-thread]").dblclick();
		await page.keyboard.press("Backspace");
		await expect(threadRow(panel, "About this word")).toContainText("Text deleted");
		await expectSaved(page);

		await page.getByRole("button", { name: /versions/i }).first().click();
		await page.getByRole("complementary", { name: "Versions" }).getByRole("button", { name: /^With the word/ }).click();
		await page.getByRole("complementary", { name: "Versions" }).getByRole("button", { name: "Restore this version" }).click();
		await page.getByRole("dialog").getByRole("button", { name: "Restore", exact: true }).click();
		await expect(page.getByText("Version restored")).toBeVisible();

		await expect(writerEditor(page).locator("[data-thread]")).toHaveText("sentence");
		await page.reload();
		await expect(writerEditor(page).locator("[data-thread]")).toHaveText("sentence");
		const reopened = await openComments(page);
		await expect(threadRow(reopened, "About this word")).toBeVisible();
		await expect(threadRow(reopened, "About this word")).not.toContainText("Text deleted");
	});

	test("an unposted comment stays on the device through a reload until discarded", async ({
		owner,
	}) => {
		const { page } = owner;
		await openWriterDocument(page, node);
		const drafts = await startCommentOnLastWord(page, "kept for later");
		await drafts.getByLabel("Add a comment on the text").fill("Not sent yet");

		await page.reload();
		const reopened = await openComments(page);
		await expect(reopened.getByLabel("Add a comment on the text")).toHaveValue("Not sent yet");

		await reopened.getByRole("button", { name: "Cancel" }).click();
		await page.getByRole("dialog").getByRole("button", { name: "Discard" }).click();
		await expect(reopened.getByLabel("Add a comment on the text")).toHaveCount(0);
		await page.reload();
		await expect((await openComments(page)).getByText("No open comments.", { exact: false })).toBeVisible();
	});

	test("a refused comment stays as sent through a reload, and Retry posts it once", async ({ owner }) => {
		const { page } = owner;
		await openWriterDocument(page, node);
		const drafts = await startCommentOnLastWord(page, "the refused sentence");
		await page.route("**/api/suite/drive/nodes/*/threads", refuseNewThreads);
		await drafts.getByLabel("Add a comment on the text").fill("Sent while offline");
		await drafts.getByRole("button", { name: "Comment", exact: true }).click();
		await expect(drafts).toContainText("Not posted ·");

		await page.unroute("**/api/suite/drive/nodes/*/threads", refuseNewThreads);
		await page.reload();
		const reopened = await openComments(page);
		await expect(reopened).toContainText("Not posted ·");
		await expect(reopened.getByLabel("Add a comment on the text")).toHaveCount(0);
		await reopened.getByRole("button", { name: "Retry" }).click();

		const row = threadRow(reopened, "Sent while offline");
		await expect(threadHeader(row)).toHaveAttribute("aria-expanded", "true");
		await expect(reopened).not.toContainText("Not posted");
		await expect(row).toHaveCount(1);
	});

	test("a comment Drive took but whose answer was lost makes one thread once retried", async ({ owner }) => {
		const { page } = owner;
		await openWriterDocument(page, node);
		await page.route("**/api/suite/drive/nodes/*/threads", loseAnswer);
		const panel = await commentOnDocument(page, "Answer lost");
		await expect(panel).toContainText("Not posted ·");

		await page.unroute("**/api/suite/drive/nodes/*/threads", loseAnswer);
		await panel.getByRole("button", { name: "Retry" }).click();

		await expect(panel).not.toContainText("Not posted");
		await expect(threadRow(panel, "Answer lost")).toHaveCount(1);
	});

	test("a reply Drive took but whose answer was lost shows once after sending it again", async ({ owner }) => {
		const { page } = owner;
		await openWriterDocument(page, node);
		const panel = await commentOnDocument(page, "Needs a reply");
		const row = threadRow(panel, "Needs a reply");
		await expect(threadHeader(row)).toHaveAttribute("aria-expanded", "true");

		await page.route("**/api/suite/drive/threads/*/comments", loseAnswer);
		const answerLost = page.waitForEvent("requestfailed", (request) =>
			/\/api\/suite\/drive\/threads\/[^/]+\/comments/.test(request.url()),
		);
		await row.getByLabel("Reply", { exact: true }).fill("Sent twice");
		await page.keyboard.press("Enter");
		await answerLost;
		await expect(row.getByLabel("Reply", { exact: true })).toHaveValue("Sent twice");

		await page.unroute("**/api/suite/drive/threads/*/comments", loseAnswer);
		await row.getByLabel("Reply", { exact: true }).press("Enter");

		await expect(row.getByLabel("Reply", { exact: true })).toHaveValue("");
		await expect(row.getByText("Sent twice", { exact: true })).toHaveCount(1);
	});
});
