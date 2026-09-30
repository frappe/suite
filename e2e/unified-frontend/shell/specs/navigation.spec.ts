import { expect, test } from "../../helpers/flips";

/** Ticket 001 route grammar and ticket 002 rail navigation. */

test("the root path redirects to /home", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveURL(/\/home$/);
	await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
});

test("the rail moves between Home and Drive", async ({ page }) => {
	await page.goto("/home");
	const rail = page.getByRole("navigation", { name: "Areas" });
	await expect(rail).toBeVisible();

	await rail.getByRole("link", { name: "Drive" }).click();
	await expect(page).toHaveURL(/\/drive$/);
	await expect(page.getByRole("navigation", { name: "File locations" })).toBeVisible();

	await rail.getByRole("link", { name: "Home" }).click();
	await expect(page).toHaveURL(/\/home$/);
	await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();
});

test("the contextual panel follows the active area", async ({ page }) => {
	await page.goto("/drive");
	const panel = page.getByRole("navigation", { name: "File locations" });
	await expect(panel.getByRole("link", { name: "My files" })).toBeVisible();

	await page.getByRole("navigation", { name: "File views" }).getByRole("link", { name: "Starred" }).click();
	await expect(page).toHaveURL(/\/drive\/starred$/);
	await expect(page.getByRole("navigation", { name: "File locations" })).toBeVisible();
});
