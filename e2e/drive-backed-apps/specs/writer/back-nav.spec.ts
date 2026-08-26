import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures/test";
import { createWriterDocument, uniqueWriterTitle, writerEditor } from "../../helpers/writer";

/**
 * Leaving a document used to abort Vue's unmount: ToC/ToCMobile read
 * `editor.view.dom` in beforeUnmount, and tiptap's post-destroy `view` proxy
 * throws on keys it does not stub. The URL changed but the old component stayed
 * mounted, so the document list never rendered.
 */
const UNMOUNT_ABORT = /editor view is not available|beforeUnmount|Unhandled error during execution/i;

function collectErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
	page.on("console", (m) => {
		if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
	});
	return errors;
}

async function openFirstDocument(page: Page, testId: string) {
	await page.goto("/writer");
	const row = page.getByTestId(testId);
	await expect(row).toBeVisible();
	await row.click();
	await expect(writerEditor(page)).toBeVisible();
	return row;
}

test("browser back from a document renders the document list", async ({ owner, run }) => {
	const errors = collectErrors(owner.page);
	const title = uniqueWriterTitle(run.run_id, "backnav");
	const file = await createWriterDocument(owner.page.request, title);

	const row = await openFirstDocument(owner.page, `writer-document-${file.name}`);
	await expect(owner.page).toHaveURL(new RegExp(`/writer/w/${file.name}`));

	await owner.page.goBack();

	await expect(owner.page).toHaveURL(/\/writer\/?$/);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await expect(writerEditor(owner.page)).toBeHidden();
	expect(errors.filter((e) => UNMOUNT_ABORT.test(e))).toEqual([]);
});

test("Back to Home from a document renders the document list", async ({ owner, run }) => {
	const errors = collectErrors(owner.page);
	const title = uniqueWriterTitle(run.run_id, "backhome");
	const file = await createWriterDocument(owner.page.request, title);

	const row = await openFirstDocument(owner.page, `writer-document-${file.name}`);

	await owner.page.locator('#navbar [aria-haspopup="menu"]').first().click();
	await owner.page.getByText("Back to Home").click();

	await expect(owner.page).toHaveURL(/\/writer\/?$/);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await expect(writerEditor(owner.page)).toBeHidden();
	expect(errors.filter((e) => UNMOUNT_ABORT.test(e))).toEqual([]);
});
