import { expect, test } from "@playwright/test";

/** Ticket 001 route grammar and ticket 002 rail navigation. */

test("the root path redirects to /home", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveURL(/\/home$/);
	await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
});

test("the rail moves between Home and Files", async ({ page }) => {
	await page.goto("/home");
	const rail = page.getByRole("navigation", { name: "Areas" });
	await expect(rail).toBeVisible();

	await rail.getByRole("link", { name: "Files" }).click();
	await expect(page).toHaveURL(/\/files$/);
	await expect(page.getByRole("navigation", { name: "File locations" })).toBeVisible();

	await rail.getByRole("link", { name: "Home" }).click();
	await expect(page).toHaveURL(/\/home$/);
	await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();
});

test("the contextual panel follows the active area", async ({ page }) => {
	await page.goto("/files");
	const panel = page.getByRole("navigation", { name: "File locations" });
	await expect(panel.getByRole("link", { name: "My files" })).toBeVisible();

	await page.getByRole("navigation", { name: "File views" }).getByRole("link", { name: "Starred" }).click();
	await expect(page).toHaveURL(/\/files\/starred$/);
	await expect(page.getByRole("navigation", { name: "File locations" })).toBeVisible();
});

test("the legacy /drive page stays reachable beside the new Files area", async ({ page }) => {
	const response = await page.goto("/drive");
	expect(response?.status()).toBeLessThan(400);
	await expect(page).toHaveURL(/\/drive/);
	await expect(page.locator("#app")).toBeVisible();
	// The new shell rail must not wrap a legacy page (frame: 'none').
	await expect(page.getByRole("navigation", { name: "Areas" })).toHaveCount(0);
});
