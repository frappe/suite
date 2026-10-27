import { expect, test } from "@playwright/test";

import { adminApi, createFolder, purge, roots, runTag } from "../../helpers/drive";

/** Ticket 006: Locations and Views, both roots on a business site. */

// Only a business site has an Organization root, and nothing in the app creates
// one on a fresh site (a migrated legacy Drive team does). Those journeys skip
// without it; the personal-only journey stubs the roots instead.
const NO_ORGANIZATION = "needs a business site with an Organization root";

async function hasOrganizationRoot(baseURL: string): Promise<boolean> {
	const api = await adminApi(baseURL);
	const discovered = await roots(api);
	await api.dispose();
	return Boolean(discovered.organization);
}

test("a business site lists both roots in the Locations section", async ({ page, baseURL }) => {
	test.skip(!(await hasOrganizationRoot(baseURL!)), NO_ORGANIZATION);
	await page.goto("/drive");
	const locations = page.getByRole("group", { name: "Locations" });
	await expect(locations.getByRole("link", { name: "My files" })).toBeVisible();
	await expect(locations.getByRole("link", { name: "Organization files" })).toBeVisible();

	const views = page.getByRole("group", { name: "Views" });
	for (const name of ["Shared with me", "Recent", "Starred", "Trash"]) {
		await expect(views.getByRole("link", { name })).toBeVisible();
	}
	await expect(page.getByRole("link", { name: "All", exact: true })).toHaveCount(0);
});

test("Organization files opens the site's shared root", async ({ page, baseURL }) => {
	const api = await adminApi(baseURL!);
	const discovered = await roots(api);
	if (!discovered.organization) await api.dispose();
	test.skip(!discovered.organization, NO_ORGANIZATION);
	const folder = await createFolder(api, discovered.organization!.node, runTag("w4-org"));

	try {
		await page.goto("/drive/organization");
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

	await page.goto("/drive");
	const locations = page.getByRole("group", { name: "Locations" });
	await expect(locations.getByRole("link", { name: "My files" })).toBeVisible();
	await expect(locations.getByRole("link", { name: "Organization files" })).toHaveCount(0);

	await page.goto("/drive/trash");
	// Other parallel journeys may have items in Trash; only the root controls matter here.
	await expect(page.getByRole("button", { name: "Empty trash", exact: true })).toBeVisible();
	await expect(page.getByRole("radio", { name: "Organization files" })).toHaveCount(0);
});

test("Trash shows one root at a time through its tabs", async ({ page, baseURL }) => {
	test.skip(!(await hasOrganizationRoot(baseURL!)), NO_ORGANIZATION);
	await page.goto("/drive/trash");
	await expect(page.getByRole("radio", { name: "My files" })).toBeChecked();
	await expect(page.getByRole("radio", { name: "Organization files" })).toBeVisible();

	await page.getByRole("radio", { name: "Organization files" }).click();
	await expect(page).toHaveURL(/root=organization/);
});
