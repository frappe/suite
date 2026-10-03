import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "../../fixtures/test";
import {
	createFolder,
	createFolderViaUi,
	discardNode,
	grantAccess,
	openRowMenu,
	publishNode,
	ROLE,
	row,
	rowMenuItems,
	sidebarLink,
	trail,
	uniqueName,
	uploadViaUi,
	waitForChild,
} from "../../helpers/drive";

const uploadFixture = resolve(__dirname, "fixtures/drive-upload.txt");

test("the phone layout navigates Drive through the bottom bar and its sheet", async ({ owner }) => {
	const { page } = owner;
	await page.setViewportSize({ width: 700, height: 900 });
	await page.goto("/drive");

	const nav = page.locator('[data-slot="mobile-nav"]');
	await expect(nav).toBeVisible();
	const driveItem = nav.locator('[data-slot="mobile-nav-item"]', { hasText: "Drive" });
	await expect(driveItem).toHaveAttribute("data-state", "active");
	// The desktop sidebar is folded away; a tap on the active area opens it as a sheet.
	await expect(page.getByRole("link", { name: "Recent", exact: true })).toBeHidden();
	await driveItem.click();
	const sheet = page.getByRole("dialog", { name: "Drive" });
	await expect(sheet).toBeVisible();
	await sheet.getByRole("link", { name: "Recent", exact: true }).click();
	await expect(page).toHaveURL(/\/drive\/recent\/?$/);
	await expect(sheet).toBeHidden();

	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(nav).toBeHidden();
	await expect(sidebarLink(page, "My files")).toBeVisible();
});

test("a file is created, uploaded, opened, renamed, trashed and restored from the page", async ({
	owner,
	run,
}) => {
	const { page } = owner;
	const request = page.request;
	const folderName = uniqueName(run.run_id, "folder");
	const uploadedName = uniqueName(run.run_id, "upload", ".txt");
	const renamedName = uniqueName(run.run_id, "renamed with spaces", ".txt");

	await page.goto("/drive");
	await expect.poll(() => trail(page)).toEqual(["My files"]);

	await createFolderViaUi(page, folderName);
	const folder = await waitForChild(request, folderName);

	await uploadViaUi(page, {
		name: uploadedName,
		mimeType: "text/plain",
		buffer: readFileSync(uploadFixture),
	});
	const uploaded = await waitForChild(request, uploadedName);
	await expect(row(page, uploaded.name)).toContainText(uploadedName);

	// A file opens in the document host; the listing is one step back.
	await row(page, uploaded.name).click();
	await expect(page).toHaveURL(new RegExp(`/d/${uploaded.name}`));
	await expect(page.getByText("Drive Playwright upload fixture.")).toBeVisible();
	await page.goBack();
	await expect(row(page, uploaded.name)).toBeVisible();

	let menu = await openRowMenu(page, uploadedName);
	await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
	const renameDialog = page.getByRole("dialog", { name: "Rename" });
	await renameDialog.getByRole("textbox", { name: "Name" }).fill(renamedName);
	await renameDialog.getByRole("button", { name: "Rename", exact: true }).click();
	await expect(renameDialog).toBeHidden();
	await expect(row(page, uploaded.name)).toContainText(renamedName);

	menu = await openRowMenu(page, renamedName);
	await menu.getByRole("menuitem", { name: "Move to trash", exact: true }).click();
	await expect(page.getByText(`Moved “${renamedName}” to Trash`)).toBeVisible();
	await expect(row(page, uploaded.name)).toHaveCount(0);

	await sidebarLink(page, "Trash").click();
	await expect(page).toHaveURL(/\/drive\/trash/);
	await expect(row(page, uploaded.name)).toContainText(renamedName);
	menu = await openRowMenu(page, renamedName);
	await menu.getByRole("menuitem", { name: "Restore", exact: true }).click();
	await expect(page.getByText(`Restored “${renamedName}”`)).toBeVisible();
	await expect(row(page, uploaded.name)).toHaveCount(0);

	await sidebarLink(page, "My files").click();
	await expect(row(page, uploaded.name)).toContainText(renamedName);
	await expect(row(page, folder.name)).toContainText(folderName);

	await discardNode(request, uploaded.name);
	await discardNode(request, folder.name);
});

test("a shared folder opens read-only for a collaborator and for the public", async ({
	owner,
	collaborator,
	guestPage,
	run,
}) => {
	const folderName = uniqueName(run.run_id, "shared-folder");
	const folder = await createFolder(owner.page.request, folderName);
	await grantAccess(owner.page.request, folder.name, collaborator.user.user, ROLE.COMMENT);

	await collaborator.page.goto(`/drive/f/${folder.name}`);
	await expect.poll(() => trail(collaborator.page)).toContain(folderName);
	// A commenter may look, not change: the folder menu offers neither rename nor share.
	await collaborator.page.getByRole("button", { name: "More file actions" }).click();
	const folderMenu = collaborator.page.getByRole("menu");
	await expect(folderMenu).toBeVisible();
	await expect(folderMenu.getByRole("menuitem", { name: "Rename folder" })).toHaveCount(0);
	await expect(folderMenu.getByRole("menuitem", { name: "Share folder" })).toHaveCount(0);
	await collaborator.page.keyboard.press("Escape");
	await expect(collaborator.page.getByRole("button", { name: "New", exact: true })).toHaveCount(0);

	await publishNode(owner.page.request, folder.name);
	await guestPage.goto(`/drive/f/${folder.name}`);
	await expect(guestPage.getByText(folderName, { exact: true }).first()).toBeVisible();
	await expect(guestPage.getByRole("button", { name: "Sign in" }).first()).toBeVisible();
	await expect(guestPage.getByRole("button", { name: "New", exact: true })).toHaveCount(0);

	// The owner's own listing still carries every action.
	await owner.page.goto("/drive");
	expect(await rowMenuItems(owner.page, folderName)).toEqual(
		expect.arrayContaining(["Share", "Rename", "Move", "Move to trash"]),
	);

	await discardNode(owner.page.request, folder.name);
});
