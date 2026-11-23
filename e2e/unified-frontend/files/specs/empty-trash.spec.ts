import { expect, test } from "@playwright/test";

import { DRIVE, adminApi, createFolder, listView, patchNode, roots, runTag, uploadFile } from "../../helpers/drive";

/** Empty Trash is global: never run against a shared site. */

test.skip(process.env.E2E_DISPOSABLE_SITE !== "1", "Requires an explicitly disposable test site");

test("Empty trash deletes everything in the root's Trash", async ({ page, baseURL }) => {
	const api = await adminApi(baseURL!);
	try {
		const personal = (await roots(api)).personal.node;
		const trash = await listView(api, "trash");
		expect(trash.rows, "Refuse to empty Trash containing pre-existing records").toEqual([]);
		expect(trash.next_cursor).toBeNull();
		const folder = await createFolder(api, personal, runTag("uf10-empty"));
		const file = await uploadFile(api, personal, runTag("uf10-empty-file"), Buffer.from("x"));
		await patchNode(api, folder.name, { state: "Trashed" });
		await patchNode(api, file.name, { state: "Trashed" });

		await page.goto("/drive/trash?view=list");
		await expect(page.getByText(folder.title, { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Empty trash" }).click();
		const confirm = page.getByRole("dialog");
		await expect(confirm.getByText("Delete everything in Trash forever?")).toBeVisible();
		await confirm.getByRole("button", { name: "Empty trash" }).click();

		await expect(page.getByText(/^Deleted \d+ items? forever$/)).toBeVisible();
		await expect(page.getByText("Trash is empty")).toBeVisible();
		await expect(page.getByRole("button", { name: "Empty trash" })).toBeDisabled();
		for (const node of [folder.name, file.name]) {
			expect((await api.get(`${DRIVE}/nodes/${node}`)).ok()).toBe(false);
		}
	} finally {
		await api.dispose();
	}
});
