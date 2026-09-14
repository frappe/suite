import { expect, test } from "@playwright/test";

import { adminApi, createDocument, purge, roots, runTag } from "../../helpers/drive";

/** Ticket 002: every route sets its own page title and favicon. */

const DRIVE_FAVICON = "/assets/suite/drive/images/logo.svg";
const SUITE_FAVICON = "/assets/suite/frontend/logo.svg";

function favicon(page: import("@playwright/test").Page) {
	return page.locator("link[rel='icon']").first();
}

test("each area route sets its title and favicon", async ({ page }) => {
	await page.goto("/home");
	await expect(page).toHaveTitle("Home");
	await expect(favicon(page)).toHaveAttribute("href", SUITE_FAVICON);

	await page.goto("/files");
	await expect(page).toHaveTitle("My files");
	await expect(favicon(page)).toHaveAttribute("href", DRIVE_FAVICON);

	await page.goto("/files/starred");
	await expect(page).toHaveTitle("Starred");
	await expect(favicon(page)).toHaveAttribute("href", DRIVE_FAVICON);

	await page.goto("/files/trash");
	await expect(page).toHaveTitle("Trash");
});

test("client-side navigation updates the title", async ({ page }) => {
	await page.goto("/files");
	await expect(page).toHaveTitle("My files");
	await page.getByRole("navigation", { name: "File views" }).getByRole("link", { name: "Recent" }).click();
	await expect(page).toHaveURL(/\/files\/recent$/);
	await expect(page).toHaveTitle("Recent");
});

test("a hosted document sets the page title to the document title", async ({ page, baseURL }) => {
	// DocumentHost.vue registers usePageTitle() with the session title, so the
	// static route title "Document" only shows while the session opens.
	const api = await adminApi(baseURL!);
	const discovered = await roots(api);
	const title = runTag("w4-title");
	const document = await createDocument(api, discovered.personal.node, title, "Writer Document");
	try {
		await page.goto(`/d/${document.name}`);
		await expect(page).toHaveTitle(title);
	} finally {
		await purge(api, document.name);
		await api.dispose();
	}
});
