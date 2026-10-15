import type { Response } from "@playwright/test";
import { expect, test } from "../../fixtures/test";
import {
	ageCopy,
	expectSaved,
	logId,
	logRowCounts,
	openForCollab,
	pastePicture,
	picturesLoaded,
	serverBlocks,
	saveNamedVersion,
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
	uniqueWriterTitle,
	writerEditor,
} from "../../helpers/writer";

/** What Drive answers to a copy. */
type CopyReply = { data: { name: string } };

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
			.toEqual({
				doc: 0,
				update: 0,
				session: 0,
				checkpoint: 0,
				stage: 0,
				recovery: 0,
				projection: 0,
				copy: 0,
			});
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

	test("Drive exports the copy a tab rendered and refuses once it is behind", async ({ owner, testApi }) => {
		const exportDocument = () =>
			owner.context.request.get(`${DRIVE}/nodes/${node}/content?download=1`);
		await owner.page.clock.install();
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Export me");
		await expectSaved(owner.page);
		await expect.poll(() => ageCopy(testApi, node)).toBeGreaterThan(0);
		await owner.page.clock.fastForward(60_000);

		await typeParagraph(owner.page, "From the head");
		await expectSaved(owner.page);
		await expect
			.poll(async () => {
				const exported = await exportDocument();
				return [exported.status(), await exported.text()];
			})
			.toEqual([200, expect.stringContaining("From the head")]);

		await typeParagraph(owner.page, "Not rendered yet");
		await expectSaved(owner.page);
		const behind = await exportDocument();
		expect(behind.status()).toBe(409);
		expect(await behind.text()).toContain("Open the document to refresh its export");
	});
});
