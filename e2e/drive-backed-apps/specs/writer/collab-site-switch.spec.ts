import { expect, test } from "../../fixtures/test";
import { disableCollab, expectSaved, openForCollab, serverBlocks, typeParagraph } from "../../helpers/collab";
import { discardNode } from "../../helpers/drive";
import {
	createWriterDocument,
	openWriterDocument,
	uniqueWriterTitle,
	writerEditor,
} from "../../helpers/writer";

// These switch collaboration off for the whole site, so their project runs after every other test
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

	test("switching Writer's collaboration off stops a tab and keeps its unsent edits as a recovery copy", async ({
		owner,
		testApi,
	}) => {
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Saved line");
		await expectSaved(owner.page);

		await disableCollab(testApi, node);
		await typeParagraph(owner.page, "Typed after the switch");

		await expect(
			owner.page.getByText(
				"Collaboration was switched off for this app, so saving stopped in this tab. Unsent changes were kept as a recovery copy.",
			),
		).toBeVisible();
		await expect(writerEditor(owner.page)).toHaveAttribute("contenteditable", "false");
		await expect(owner.page.getByText("This device has unsaved work from")).toBeVisible();
		const stored = await serverBlocks(testApi, node);
		expect(stored).toContain("Saved line");
		expect(stored).not.toContain("Typed after the switch");
	});

	test("an old editor's refused save keeps its work on this device", async ({
		owner,
		testApi,
	}) => {
		await disableCollab(testApi, node);
		await openWriterDocument(owner.page, node);
		const toolbarHeight = (await owner.page.locator('[data-slot="fixed-menu"]').boundingBox())!.height;
		await typeParagraph(owner.page, "Typed in the old editor");

		await expect(
			owner.page.getByText(
				"This document now saves as you edit, so saving stopped in this tab. Unsent changes were kept as a recovery copy. Reload to keep editing.",
			),
		).toBeVisible();
		await expect(writerEditor(owner.page)).toHaveAttribute("contenteditable", "false");
		expect(await serverBlocks(testApi, node)).not.toContain("Typed in the old editor");

		const kept = owner.page.getByRole("status").filter({ hasText: "This device has unsaved work from" });
		const stopped = owner.page.getByRole("status").filter({ hasText: "This document now saves as you edit" });
		const keptHeight = (await kept.boundingBox())!.height;
		await kept.getByRole("button", { name: "View" }).click();
		const viewing = owner.page.getByRole("status").filter({ hasText: "Viewing recovery copy from" });
		await expect(owner.page.getByLabel("Recovery copy")).toContainText("Typed in the old editor");
		// Strips with a button and without stand as tall as the editor toolbar
		expect([
			keptHeight,
			(await stopped.boundingBox())!.height,
			(await viewing.boundingBox())!.height,
		]).toEqual([toolbarHeight, toolbarHeight, toolbarHeight]);
		await expect(kept).toBeHidden();

		const downloaded = owner.page.waitForEvent("download");
		await viewing.getByRole("button", { name: /^Actions for/ }).click();
		await owner.page.getByRole("menuitem", { name: "Download" }).click();
		expect((await downloaded).suggestedFilename()).toBe(`${title} (recovered).html`);
		await viewing.getByRole("button", { name: /^Actions for/ }).click();
		await owner.page.getByRole("menuitem", { name: "Back to current" }).click();
		await expect(owner.page.getByLabel("Recovery copy")).toBeHidden();
		await expect(kept).toBeVisible();

		await owner.page.goto("/drive");
		const notice = owner.page.getByRole("status").filter({ hasText: "couldn't be saved" });
		await notice.getByRole("button", { name: "Review" }).click();
		const row = owner.page.getByRole("row").filter({ hasText: title });
		await row.getByText(title).click();
		await expect(viewing).toBeVisible();
		await expect(owner.page.getByLabel("Recovery copy")).toContainText("Typed in the old editor");

		await owner.page.goto("/drive/recovery");
		await row.getByRole("button", { name: /^Actions for/ }).click();
		await owner.page.getByRole("menuitem", { name: "Discard" }).click();
		await owner.page.getByRole("dialog").getByRole("button", { name: "Discard" }).click();
		await expect(owner.page.getByText("No recovery copies")).toBeVisible();
	});
});
