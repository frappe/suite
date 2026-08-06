import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "../../fixtures/test";
import { createFolder, driveEntities, waitForDriveEntity } from "../../helpers/drive";
import type { Page } from "@playwright/test";

const uploadFixture = resolve(__dirname, "fixtures/drive-upload.txt");

// Playwright's mouse-driven dragTo doesn't start an HTML5 drag in Chromium, so
// drive the same three events the row handlers listen for.
async function dragRowOnto(page: Page, source: string, target: string) {
	await page.evaluate(
		({ source, target }) => {
			const row = (name: string) =>
				document.querySelector(`[data-testid="drive-entity-${name}"]`);
			const from = row(source);
			const to = row(target);
			if (!from || !to) throw new Error(`missing row: ${!from ? source : target}`);
			const dataTransfer = new DataTransfer();
			from.dispatchEvent(new DragEvent("dragstart", { dataTransfer, bubbles: true }));
			to.dispatchEvent(
				new DragEvent("dragover", { dataTransfer, bubbles: true, cancelable: true }),
			);
			to.dispatchEvent(new DragEvent("drop", { dataTransfer, bubbles: true }));
			from.dispatchEvent(new DragEvent("dragend", { dataTransfer, bubbles: true }));
		},
		{ source, target },
	);
}

async function uploadInto(page: Page, folder: string, fileName: string) {
	await page.goto(`/drive/d/${folder}`);
	await Promise.all([
		page.waitForResponse(
			(response) => response.url().includes("upload_file") && response.ok(),
		),
		page.getByTestId("drive-file-input").setInputFiles({
			name: fileName,
			mimeType: "text/plain",
			buffer: readFileSync(uploadFixture),
		}),
	]);
	return waitForDriveEntity(page.request, fileName, folder);
}

test("expands a folder inline in the list view and moves a subfile into another folder", async ({
	owner,
	run,
}) => {
	const suffix = `${run.run_id}-${Date.now()}`;
	const sourceName = `tree-source-${suffix}`;
	const destinationName = `tree-dest-${suffix}`;
	const fileName = `tree-child-${suffix}.txt`;

	await owner.page.goto("/drive");
	const source = await createFolder(owner.page, sourceName);
	const destination = await createFolder(owner.page, destinationName);
	const child = await uploadInto(owner.page, source.name, fileName);

	await owner.page.goto("/drive");
	const sourceRow = owner.page.getByTestId(`drive-entity-${source.name}`);
	await expect(sourceRow).toBeVisible();
	const childRow = owner.page.getByTestId(`drive-entity-${child.name}`);
	await expect(childRow).toHaveCount(0);

	await owner.page.getByTestId(`drive-expand-${source.name}`).click();
	await expect(childRow).toBeVisible();
	await expect(childRow).toContainText(fileName.replace(/\.txt$/, ""));
	// Expanding must not navigate away from the folder listing.
	await expect(owner.page).toHaveURL(/\/drive(\?.*)?$/);

	await childRow.click();
	await expect(owner.page).toHaveURL(new RegExp(`/drive/f/${child.name}`));
	const refreshedSubtree = owner.page.waitForResponse(
		(response) => response.url().includes("suite.drive.api.list.files") && response.url().includes(source.name),
	);
	await Promise.all([refreshedSubtree, owner.page.goBack()]);
	await expect(childRow).toBeVisible();

	await dragRowOnto(owner.page, child.name, destination.name);

	await expect(childRow).toHaveCount(0);
	await expect
		.poll(async () =>
			(await driveEntities(owner.page.request, destination.name)).map(
				(entity) => entity.name,
			),
		)
		.toContain(child.name);
	expect(
		(await driveEntities(owner.page.request, source.name)).map((entity) => entity.name),
	).not.toContain(child.name);

	// The destination shows the moved file once expanded.
	await owner.page.reload();
	await owner.page.getByTestId(`drive-expand-${destination.name}`).click();
	await expect(childRow).toBeVisible();
});

test("collapsing a folder hides its children again", async ({ owner, run }) => {
	const suffix = `${run.run_id}-${Date.now()}`;
	const folderName = `tree-collapse-${suffix}`;
	const fileName = `tree-collapse-child-${suffix}.txt`;

	await owner.page.goto("/drive");
	const folder = await createFolder(owner.page, folderName);
	const child = await uploadInto(owner.page, folder.name, fileName);

	await owner.page.goto("/drive");
	const toggle = owner.page.getByTestId(`drive-expand-${folder.name}`);
	const childRow = owner.page.getByTestId(`drive-entity-${child.name}`);

	await toggle.click();
	await expect(childRow).toBeVisible();
	await toggle.click();
	await expect(childRow).toHaveCount(0);
});
