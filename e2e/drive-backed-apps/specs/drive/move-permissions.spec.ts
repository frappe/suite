import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "../../fixtures/test";
import {
	createFolder,
	discardNode,
	grantAccess,
	moveViaPicker,
	ROLE,
	roleOn,
	row,
	rowMenuItems,
	uniqueName,
	uploadFile,
	waitForChild,
} from "../../helpers/drive";

const uploadFixture = resolve(__dirname, "fixtures/drive-upload.txt");

test("a file moved into a nested shared folder is readable, and only readable, through the share", async ({
	owner,
	collaborator,
	run,
}) => {
	const request = owner.page.request;
	const parent = await createFolder(request, uniqueName(run.run_id, "parent"));
	const child = await createFolder(request, uniqueName(run.run_id, "child"), parent.name);
	const fileName = uniqueName(run.run_id, "nested", ".txt");
	const file = await uploadFile(request, fileName, readFileSync(uploadFixture), parent.name);

	// Move through the folder picker, from the parent's listing into its child.
	await owner.page.goto(`/drive/f/${parent.name}`);
	await expect(row(owner.page, file.name)).toBeVisible();
	await moveViaPicker(owner.page, fileName, child.title);
	await expect(row(owner.page, file.name)).toHaveCount(0);
	await waitForChild(request, fileName, child.name);

	await grantAccess(request, parent.name, collaborator.user.user, ROLE.READ);

	// The share on the parent reaches the file two levels down, as Read and nothing more.
	await collaborator.page.goto(`/drive/f/${child.name}`);
	await expect(row(collaborator.page, file.name)).toBeVisible();
	expect(await roleOn(collaborator.page.request, file.name)).toBe(ROLE.READ);
	const actions = await rowMenuItems(collaborator.page, fileName);
	expect(actions).toContain("Download");
	expect(actions).not.toContain("Rename");
	expect(actions).not.toContain("Move");
	expect(actions).not.toContain("Move to trash");
	expect(actions).not.toContain("Share");

	await discardNode(request, parent.name);
});
