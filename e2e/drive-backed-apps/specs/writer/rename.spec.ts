import { expect, test } from "../../fixtures/test";
import { discardNode, getNode } from "../../helpers/drive";
import {
	createWriterDocument,
	documentTitle,
	openWriterDocument,
	uniqueWriterTitle,
} from "../../helpers/writer";

test("the title field selects on click, renames on Enter and persists", async ({ owner, run }) => {
	const title = uniqueWriterTitle(run.run_id, "rename");
	const file = await createWriterDocument(owner.page.request, title);
	await openWriterDocument(owner.page, file.name);

	const input = documentTitle(owner.page);
	await expect(input).toHaveValue(title);

	// A click puts the caret in the title with the whole name selected, ready for a retype.
	await input.click();
	await expect(input).toBeFocused();
	await owner.page.waitForTimeout(400);
	await expect(input).toBeFocused();
	const selectionLength = await input.evaluate(
		(el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0),
	);
	expect(selectionLength).toBe(title.length);

	const newTitle = `${title} renamed`;
	await input.fill(newTitle);
	await input.press("Enter");
	await expect(input).toHaveValue(newTitle);
	await expect.poll(async () => (await getNode(owner.page.request, file.name)).title).toBe(newTitle);

	await owner.page.reload();
	await expect(documentTitle(owner.page)).toHaveValue(newTitle);

	await discardNode(owner.page.request, file.name);
});

test("Escape cancels the rename without changing the name", async ({ owner, run }) => {
	test.fail(
		true,
		"B84: Escape restores the draft, then TextInput's change event on blur writes the typed name back and renameOnBlur saves it",
	);
	const title = uniqueWriterTitle(run.run_id, "cancel");
	const file = await createWriterDocument(owner.page.request, title);
	await openWriterDocument(owner.page, file.name);

	const input = documentTitle(owner.page);
	await input.click();
	await input.fill("Discarded name");
	await input.press("Escape");

	await expect(input).toHaveValue(title);
	await expect(input).not.toBeFocused();
	await owner.page.reload();
	await expect(documentTitle(owner.page)).toHaveValue(title);

	await discardNode(owner.page.request, file.name);
});
