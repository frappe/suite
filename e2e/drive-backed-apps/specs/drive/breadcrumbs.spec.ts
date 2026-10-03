import { expect, test } from "../../fixtures/test";
import {
	breadcrumbs,
	createFolder,
	discardNode,
	moveViaPicker,
	row,
	sidebarLink,
	trail,
	trashNode,
	uniqueName,
} from "../../helpers/drive";

test("each place names itself in the trail", async ({ owner, run }) => {
	const page = owner.page;
	await page.goto("/drive");
	await expect.poll(() => trail(page)).toEqual(["My files"]);

	for (const section of ["Shared with me", "Recent", "Starred", "Trash"]) {
		await sidebarLink(page, section).click();
		await expect.poll(() => trail(page)).toEqual([section]);
	}

	await sidebarLink(page, "My files").click();
	await expect.poll(() => trail(page)).toEqual(["My files"]);

	// A trashed folder is reached from Trash, so its trail starts there.
	const trashedName = uniqueName(run.run_id, "trashed");
	const trashed = await createFolder(page.request, trashedName);
	await trashNode(page.request, trashed.name);
	await page.goto(`/drive/f/${trashed.name}`);
	await expect.poll(() => trail(page)).toEqual(["Trash", trashedName]);

	await discardNode(page.request, trashed.name);
});

test("nested folders build the trail, and crumbs, history and deep links all walk it", async ({
	owner,
	run,
}) => {
	const page = owner.page;
	const parentName = uniqueName(run.run_id, "parent");
	const parent = await createFolder(page.request, parentName);
	const childName = uniqueName(run.run_id, "child");
	const child = await createFolder(page.request, childName, parent.name);

	await page.goto(`/drive/f/${parent.name}`);
	await expect.poll(() => trail(page)).toEqual(["My files", parentName]);

	await row(page, child.name).click();
	await expect(page).toHaveURL(new RegExp(child.name));
	await expect.poll(() => trail(page)).toEqual(["My files", parentName, childName]);

	// An ancestor crumb navigates back up.
	await breadcrumbs(page).filter({ hasText: parentName }).click();
	await expect(page).toHaveURL(new RegExp(parent.name));
	await expect.poll(() => trail(page)).toEqual(["My files", parentName]);

	// Browser history restores the previous trail.
	await page.goBack();
	await expect.poll(() => trail(page)).toEqual(["My files", parentName, childName]);

	// A deep link shows the whole trail, also after a reload.
	await page.goto(`/drive/f/${child.name}`);
	await expect.poll(() => trail(page)).toEqual(["My files", parentName, childName]);
	await page.reload();
	await expect.poll(() => trail(page)).toEqual(["My files", parentName, childName]);

	await discardNode(page.request, parent.name);
});

test("renaming and moving a folder update its trail", async ({ owner, run }) => {
	const page = owner.page;
	const original = uniqueName(run.run_id, "renamecrumb");
	const folder = await createFolder(page.request, original);
	const destinationName = uniqueName(run.run_id, "dest");
	const destination = await createFolder(page.request, destinationName);

	await page.goto(`/drive/f/${folder.name}`);
	await expect.poll(() => trail(page)).toEqual(["My files", original]);

	// The open folder renames from its own menu.
	const renamed = `${original}-renamed`;
	await page.getByRole("button", { name: "More file actions" }).click();
	await page.getByRole("menuitem", { name: "Rename folder" }).click();
	const dialog = page.getByRole("dialog", { name: "Rename" });
	await dialog.getByRole("textbox", { name: "Name" }).fill(renamed);
	await dialog.getByRole("button", { name: "Rename", exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect.poll(() => trail(page)).toEqual(["My files", renamed]);
	await page.reload();
	await expect.poll(() => trail(page)).toEqual(["My files", renamed]);

	// Moved from its parent's listing, the folder's trail passes through the destination.
	await sidebarLink(page, "My files").click();
	await moveViaPicker(page, renamed, destinationName);
	await expect(row(page, folder.name)).toHaveCount(0);

	await page.goto(`/drive/f/${folder.name}`);
	await expect.poll(() => trail(page)).toEqual(["My files", destinationName, renamed]);

	await discardNode(page.request, destination.name);
});
