import { expect, test } from "@playwright/test";

import { MOBILE_VIEWPORT } from "../../helpers/shell";

/** Ticket 002: the mobile shell replaces the rail with a bottom nav and a sheet. */

test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true, isMobile: true });

test("the bottom nav replaces the rail and moves between areas", async ({ page }) => {
	await page.goto("/home");
	await expect(page.getByRole("navigation", { name: "Areas" })).toHaveCount(0);

	const nav = page.locator("[data-slot='mobile-nav-item']");
	await expect(nav.filter({ hasText: "Home" })).toBeVisible();
	await expect(nav.filter({ hasText: "Files" })).toBeVisible();
	await expect(nav.filter({ hasText: "More" })).toBeVisible();

	await nav.filter({ hasText: "Files" }).click();
	await expect(page).toHaveURL(/\/files$/);
});

test("More opens the contextual panel in a bottom sheet", async ({ page }) => {
	await page.goto("/files");
	await page.locator("[data-slot='mobile-nav-item']").filter({ hasText: "More" }).click();

	const sheet = page.getByRole("dialog", { name: "Files" });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole("link", { name: "Starred" })).toBeVisible();
	await expect(sheet.getByRole("button", { name: "Account" })).toBeVisible();

	await sheet.getByRole("link", { name: "Starred" }).click();
	await expect(page).toHaveURL(/\/files\/starred$/);
});

test("the Files header opens the same sheet through the shell event", async ({ page }) => {
	await page.goto("/files");
	await page.getByRole("button", { name: "My files" }).click();
	await expect(page.getByRole("dialog", { name: "Files" })).toBeVisible();
});
