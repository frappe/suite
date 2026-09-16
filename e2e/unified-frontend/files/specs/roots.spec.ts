import { expect, test } from "@playwright/test";

import { adminApi, createFolder, purge, roots, runTag } from "../../helpers/drive";

/** Ticket 006: Locations and Views, both roots on a business site. */

test("a business site lists both roots in the Locations section", async ({ page }) => {
	await page.goto("/files");
	const locations = page.getByRole("navigation", { name: "File locations" });
	await expect(locations.getByRole("link", { name: "My files" })).toBeVisible();
	await expect(locations.getByRole("link", { name: "Organization files" })).toBeVisible();

	const views = page.getByRole("navigation", { name: "File views" });
	for (const name of ["Shared with me", "Recent", "Starred", "Trash"]) {
		await expect(views.getByRole("link", { name })).toBeVisible();
	}
	await expect(page.getByRole("link", { name: "All", exact: true })).toHaveCount(0);
});

test("Organization files opens the site's shared root", async ({ page, baseURL }) => {
	const api = await adminApi(baseURL!);
	const discovered = await roots(api);
	expect(discovered.organization?.node).toBeTruthy();
	const folder = await createFolder(api, discovered.organization!.node, runTag("w4-org"));

	try {
		await page.goto("/files/organization");
		await expect(page).toHaveTitle("Organization files");
		await expect(page.getByText(folder.title, { exact: true })).toBeVisible();
	} finally {
		await purge(api, folder.name);
		await api.dispose();
	}
});

test("a personal-only site hides Organization files and its Trash tabs", async ({ page, baseURL }) => {
	const api = await adminApi(baseURL!);
	const discovered = await roots(api);
	await api.dispose();

	await page.route("**/api/suite/drive/roots", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ data: { personal: discovered.personal, organization: null } }),
		}),
	);

	await page.goto("/files");
	const locations = page.getByRole("navigation", { name: "File locations" });
	await expect(locations.getByRole("link", { name: "My files" })).toBeVisible();
	await expect(locations.getByRole("link", { name: "Organization files" })).toHaveCount(0);

	await page.goto("/files/trash");
	await expect(page.getByText("Trash is empty")).toBeVisible();
	await expect(page.getByRole("radio", { name: "Organization files" })).toHaveCount(0);
});

test("Trash shows one root at a time through its tabs", async ({ page }) => {
	await page.goto("/files/trash");
	await expect(page.getByRole("radio", { name: "My files" })).toBeChecked();
	await expect(page.getByRole("radio", { name: "Organization files" })).toBeVisible();

	await page.getByRole("radio", { name: "Organization files" }).click();
	await expect(page).toHaveURL(/root=organization/);
});
