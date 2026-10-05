import { expect, test } from "../../fixtures/test";
import {
	collabState,
	compactNow,
	editorBlocks,
	enableCollab,
	expectConverged,
	expectSaved,
	serverText,
	typeParagraph,
} from "../../helpers/collab";
import { discardNode } from "../../helpers/drive";
import {
	createWriterDocument,
	openWriterDocument,
	shareWriterDocument,
	uniqueWriterTitle,
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
		await discardNode(owner.page.request, node);
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
});
