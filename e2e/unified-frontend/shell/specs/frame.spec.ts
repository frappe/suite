import { type Locator, type Page } from "@playwright/test";

import { expect, test } from "../../helpers/flips";

import { adminApi, createDocument, purge, roots, runTag } from "../../helpers/drive";

/**
 * Ticket 010: the shell draws a rail and one box. A page draws its own
 * sidebar, and the sidebar keeps one width, so an area switch does not move
 * the layout.
 */

async function box(locator: Locator) {
	await expect(locator).toBeVisible();
	const found = await locator.boundingBox();
	expect(found).not.toBeNull();
	return found!;
}

const rail = (page: Page) => page.getByRole("navigation", { name: "Areas" });
const sidebar = (page: Page) => page.locator("[data-area-sidebar]");
const contentPane = (page: Page) => page.locator("[data-shell-content-pane]");

test("an area switch keeps the rail, the sidebar and the content box in place", async ({ page }) => {
	await page.goto("/home");
	await expect(sidebar(page)).toHaveAttribute("data-area-sidebar", "home");
	const homeRail = await box(rail(page));
	const homeSidebar = await box(sidebar(page));
	const homeContent = await box(contentPane(page));
	expect(homeSidebar.width).toBe(224);

	await rail(page).getByRole("link", { name: "Drive" }).click();
	await expect(page).toHaveURL(/\/drive$/);
	await expect(sidebar(page)).toHaveAttribute("data-area-sidebar", "files");

	expect(await box(rail(page))).toEqual(homeRail);
	expect(await box(sidebar(page))).toEqual(homeSidebar);
	expect((await box(contentPane(page))).x).toBe(homeContent.x);
	expect((await box(contentPane(page))).width).toBe(homeContent.width);
});

test("the area sidebar is a named landmark beside the page header", async ({ page }) => {
	await page.goto("/drive");
	const landmark = page.getByRole("complementary", { name: "Drive" });
	await expect(landmark.getByRole("navigation", { name: "File locations" })).toBeVisible();
	// The sidebar sits beside the header, not under it.
	const sidebarBox = await box(landmark);
	const paneBox = await box(contentPane(page));
	expect(sidebarBox.y).toBeLessThanOrEqual(paneBox.y);
	expect(sidebarBox.x + sidebarBox.width).toBeLessThanOrEqual(paneBox.x + 1);
});

test("a root id in /drive/f/ replaces itself with the root's own route", async ({ page, baseURL }) => {
	const api = await adminApi(baseURL!);
	const discovered = await roots(api);
	await api.dispose();

	await page.goto("/home");
	await page.goto(`/drive/f/${discovered.personal.node}`);
	await expect(page).toHaveURL(/\/drive$/);
	await page.goBack();
	await expect(page).toHaveURL(/\/home$/);

	if (discovered.organization?.node) {
		await page.goto(`/drive/f/${discovered.organization.node}`);
		await expect(page).toHaveURL(/\/drive\/organization$/);
	}
});

test("a /d/ document keeps the rail and draws no area sidebar", async ({ page, baseURL }) => {
	const api = await adminApi(baseURL!);
	const discovered = await roots(api);
	const doc = await createDocument(api, discovered.personal.node, runTag("uf1-doc"), "Writer Document");
	try {
		await page.goto(`/d/${doc.name}`);
		await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 20_000 });
		await expect(rail(page)).toBeVisible();
		await expect(sidebar(page)).toHaveCount(0);
	} finally {
		await purge(api, doc.name);
		await api.dispose();
	}
});
