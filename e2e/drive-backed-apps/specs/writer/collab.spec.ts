import { expect, test } from "../../fixtures/test";
import {
	collabState,
	compactNow,
	editorBlocks,
	enableCollab,
	expectConverged,
	expectSaved,
	serverText,
	takeVersion,
	typeParagraph,
} from "../../helpers/collab";
import { discardNode } from "../../helpers/drive";
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
});
