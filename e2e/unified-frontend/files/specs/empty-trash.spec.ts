import { expect, test } from "../../helpers/flips";

import { DRIVE, adminApi, createFolder, patchNode, roots, runTag, uploadFile } from "../../helpers/drive";

/**
 * Stage 10: Empty trash (spec §6.10).
 *
 * It deletes everything in the admin's personal Trash, which many journeys
 * write to and read. The `empty-trash` project runs this file as the teardown
 * of the `chromium` project, after every other journey has finished, so no
 * journey can lose its trashed node to it (`playwright.config.ts`).
 */

test("Empty trash deletes everything in the root's Trash", async ({ page, baseURL }) => {
	const api = await adminApi(baseURL!);
	try {
		const personal = (await roots(api)).personal.node;
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

		await expect(page.getByText(/items? deleted forever/)).toBeVisible();
		await expect(page.getByText("Trash is empty")).toBeVisible();
		await expect(page.getByRole("button", { name: "Empty trash" })).toBeDisabled();
		for (const node of [folder.name, file.name]) {
			expect((await api.get(`${DRIVE}/nodes/${node}`)).ok()).toBe(false);
		}
	} finally {
		await api.dispose();
	}
});
