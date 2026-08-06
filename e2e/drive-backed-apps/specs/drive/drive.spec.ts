import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "../../fixtures/test";
import {
	openEntityActions,
	setDriveAccess,
	shareCurrentEntity,
	waitForDriveEntity,
} from "../../helpers/drive";

const uploadFixture = resolve(__dirname, "fixtures/drive-upload.txt");

function uniqueName(runId: string, label: string, extension = "") {
	return `${label}-${runId}-${Date.now()}${extension}`;
}

test.describe.serial("Drive critical paths", () => {
	test("shows mobile navigation below the tablet breakpoint", async ({ owner }) => {
		const { page } = owner;
		await page.setViewportSize({ width: 700, height: 900 });
		await page.goto("/drive");

		await expect(page.locator("#sidebar")).toBeHidden();
		await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
	});

	test("authenticated home and file lifecycle", async ({ owner, run }) => {
		const { page } = owner;
		const folderName = uniqueName(run.run_id, "folder");
		const uploadedName = uniqueName(run.run_id, "upload", ".txt");
		const renamedName = uniqueName(run.run_id, "renamed with spaces", ".txt");
		const uploadedLabel = uploadedName.replace(/\.txt$/, "");
		const renamedLabel = renamedName.replace(/\.txt$/, "");

		await page.goto("/drive");
		await expect(page.getByRole("link", { name: "Home", exact: true }).first()).toBeVisible();

		await page.getByRole("button", { name: "Create", exact: true }).click();
		await page.getByRole("menuitem", { name: "Folder", exact: true }).click();
		const folderDialog = page.getByRole("dialog", { name: "Create a folder" });
		await folderDialog.getByRole("textbox", { name: "Name:" }).fill(folderName);
		await folderDialog.getByRole("button", { name: "Create", exact: true }).click();
		const folder = await waitForDriveEntity(page.request, folderName);
		await expect(page.getByTestId(`drive-entity-${folder.name}`)).toContainText(folderName);

		const [uploadResponse] = await Promise.all([
			page.waitForResponse(
				(response) => response.url().includes("upload_file") && response.ok(),
			),
			page.getByTestId("drive-file-input").setInputFiles({
				name: uploadedName,
				mimeType: "text/plain",
				buffer: readFileSync(uploadFixture),
			}),
		]);
		expect(uploadResponse.ok()).toBe(true);
		const uploaded = await waitForDriveEntity(page.request, uploadedName);
		await expect(page.getByTestId(`drive-entity-${uploaded.name}`)).toContainText(uploadedLabel);

		await openEntityActions(page, uploaded.name);
		await page.getByRole("button", { name: "Rename", exact: true }).click();
		// Renaming is inline in the row, not a dialog.
		const renameInput = page
			.getByTestId(`drive-entity-${uploaded.name}`)
			.getByRole("textbox");
		await renameInput.fill("");
		// Typed key by key: the row is a <button>, so a space must not activate it.
		await renameInput.pressSequentially(renamedLabel);
		await expect(renameInput).toHaveValue(renamedLabel);
		await expect(page).toHaveURL(/\/drive\/?$/);
		await renameInput.press("Enter");
		await expect(page.getByTestId(`drive-entity-${uploaded.name}`)).toContainText(renamedLabel);

		await openEntityActions(page, uploaded.name);
		await page.getByRole("button", { name: "Delete", exact: true }).click();
		await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
		await page.getByRole("link", { name: "Trash", exact: true }).click();
		await expect(page.getByTestId(`drive-entity-${uploaded.name}`)).toContainText(renamedLabel);
		await openEntityActions(page, uploaded.name);
		await page.getByRole("button", { name: "Restore", exact: true }).click();
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Restore", exact: true })
			.click();
		await expect(page.getByTestId(`drive-entity-${uploaded.name}`)).toBeHidden();
	});

	test("direct-user UI share and public read behavior", async ({
		owner,
		collaborator,
		guestPage,
		run,
	}) => {
		const folderName = uniqueName(run.run_id, "shared-folder");
		await owner.page.goto("/drive");
		await owner.page.getByRole("button", { name: "Create", exact: true }).click();
		await owner.page.getByRole("menuitem", { name: "Folder", exact: true }).click();
		const dialog = owner.page.getByRole("dialog", { name: "Create a folder" });
		await dialog.getByRole("textbox", { name: "Name:" }).fill(folderName);
		await dialog.getByRole("button", { name: "Create", exact: true }).click();
		const folder = await waitForDriveEntity(owner.page.request, folderName);

		await owner.page.getByTestId(`drive-entity-${folder.name}`).click();
		await expect(owner.page).toHaveURL(new RegExp(`/drive/d/${folder.name}`));
		await shareCurrentEntity(owner.page, folderName, collaborator.user.email);

		await collaborator.page.goto(`/drive/d/${folder.name}`);
		await expect(collaborator.page.getByText(folderName, { exact: true })).toBeVisible();
		await collaborator.page.getByRole("button", { name: "Entity actions" }).click();
		await expect(collaborator.page.getByRole("menuitem", { name: "Rename" })).toHaveCount(0);
		await expect(collaborator.page.getByRole("menuitem", { name: "Share" })).toHaveCount(0);
		await collaborator.page.keyboard.press("Escape");

		await setDriveAccess(owner.page.request, folder.name, "");
		await guestPage.goto(`/drive/d/${folder.name}`);
		await expect(guestPage.getByText(folderName, { exact: true })).toBeVisible();
		await expect(guestPage.getByRole("button", { name: "Sign In" })).toBeVisible();
		await expect(guestPage.getByRole("button", { name: "Create", exact: true })).toBeHidden();
	});
});
