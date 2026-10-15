import type { Page } from "@playwright/test";

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
	await panel.getByLabel("New comment").fill(text);
	await panel.getByRole("button", { name: "Add" }).click();
	return panel;
}

// Types a line, selects its last word and starts a comment on it from the bubble menu
async function startCommentOnLastWord(page: Page, line: string) {
	await typeParagraph(page, line);
	await expectSaved(page);
	const word = line.split(" ").at(-1) ?? "";
	for (let left = word.length; left > 0; left--) {
		await page.keyboard.press("Shift+ArrowLeft");
	}

	await page.locator('[data-slot="bubble-menu"]').getByRole("button", { name: "Comment" }).click();
	const drafts = page.getByRole("complementary", { name: "Comments" }).getByRole("region", {
		name: "Not posted yet",
	});
	await expect(drafts).toContainText(word);
	return drafts;
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

	test("a comment on the document shows in its group and takes a reply, resolve, reopen and delete", async ({
		owner,
	}) => {
		const { page } = owner;
		await openWriterDocument(page, node);
		const panel = await commentOnDocument(page, "Whole document note");
		const group = panel.getByRole("region", { name: "Comments on the document" });
		await expect(group).toContainText("Whole document note");

		await group.getByRole("button", { name: "Reply" }).click();
		await group.getByLabel("Reply").fill("A reply");
		await group.getByRole("button", { name: "Send" }).click();
		await expect(group).toContainText("A reply");
		await group.getByRole("button", { name: "Resolve" }).click();
		await expect(group.getByRole("button", { name: "Reopen" })).toBeVisible();
		await group.getByRole("button", { name: "Reopen" }).click();
		await expect(group.getByRole("button", { name: "Resolve" })).toBeVisible();

		for (let left = 2; left > 0; left--) {
			await group.getByRole("button", { name: "Delete comment" }).first().click();
			await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
			await expect(panel.getByRole("button", { name: "Delete comment" })).toHaveCount(left - 1);
		}

		await expect(panel.getByText("No comments yet.")).toBeVisible();
	});

	test("another tab's comment shows in an open panel without reopening it", async ({
		owner,
		collaborator,
	}) => {
		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);
		const watching = await openComments(collaborator.page);
		await expect(watching.getByText("No comments yet.")).toBeVisible();

		await commentOnDocument(owner.page, "Seen from the other tab");

		await expect(
			watching.getByRole("region", { name: "Comments on the document" }),
		).toContainText("Seen from the other tab");
	});

	test("a comment on selected text shows on its words, and with deleted text once they go", async ({
		owner,
	}) => {
		const { page } = owner;
		await openWriterDocument(page, node);
		const drafts = await startCommentOnLastWord(page, "the commented sentence");

		await drafts.getByLabel("Comment on the text").fill("About this word");
		await drafts.getByRole("button", { name: "Comment" }).click();

		const panel = page.getByRole("complementary", { name: "Comments" });
		const onText = panel.getByRole("region", { name: "On the text" });
		await expect(onText).toContainText("About this word");
		await expect(onText).toContainText("sentence");
		await expect(drafts).toHaveCount(0);
		await expect(writerEditor(page).locator("[data-thread]")).toHaveText("sentence");

		await writerEditor(page).locator("[data-thread]").dblclick();
		await page.keyboard.press("Backspace");
		const deleted = panel.getByRole("region", { name: "Original text deleted" });
		await expect(deleted).toContainText("About this word");
		await expect(deleted).toContainText("sentence");
	});

	test("restoring a version puts a comment back on the words it brought back, for good", async ({
		owner,
	}) => {
		const { page } = owner;
		await openWriterDocument(page, node);
		const drafts = await startCommentOnLastWord(page, "the commented sentence");
		await drafts.getByLabel("Comment on the text").fill("About this word");
		await drafts.getByRole("button", { name: "Comment" }).click();
		const panel = page.getByRole("complementary", { name: "Comments" });
		await expect(panel.getByRole("region", { name: "On the text" })).toContainText("About this word");
		await saveNamedVersion(owner.context.request, node, "With the word");
		await writerEditor(page).locator("[data-thread]").dblclick();
		await page.keyboard.press("Backspace");
		await expect(panel.getByRole("region", { name: "Original text deleted" })).toContainText("About this word");
		await expectSaved(page);

		await page.getByRole("button", { name: /versions/i }).first().click();
		await page.getByRole("complementary", { name: "Versions" }).getByRole("button", { name: /^With the word/ }).click();
		await page.getByRole("button", { name: "Restore", exact: true }).click();
		await page.getByRole("dialog").getByRole("button", { name: "Restore", exact: true }).click();
		await expect(page.getByText("Version restored")).toBeVisible();

		await expect(writerEditor(page).locator("[data-thread]")).toHaveText("sentence");
		await page.reload();
		await expect(writerEditor(page).locator("[data-thread]")).toHaveText("sentence");
		const reopened = await openComments(page);
		await expect(reopened.getByRole("region", { name: "On the text" })).toContainText("About this word");
		await expect(reopened.getByRole("region", { name: "Original text deleted" })).toHaveCount(0);
	});

	test("an unposted comment stays on the device through a reload until discarded", async ({
		owner,
	}) => {
		const { page } = owner;
		await openWriterDocument(page, node);
		const drafts = await startCommentOnLastWord(page, "kept for later");
		await drafts.getByLabel("Comment on the text").fill("Not sent yet");

		await page.reload();
		const reopened = (await openComments(page)).getByRole("region", { name: "Not posted yet" });
		await expect(reopened.getByLabel("Comment on the text")).toHaveValue("Not sent yet");

		await reopened.getByRole("button", { name: "Discard" }).click();
		await page.getByRole("dialog").getByRole("button", { name: "Discard" }).click();
		await expect(reopened).toHaveCount(0);
		await page.reload();
		await expect((await openComments(page)).getByText("No comments yet.")).toBeVisible();
	});
});
