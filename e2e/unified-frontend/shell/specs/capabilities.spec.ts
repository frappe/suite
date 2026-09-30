import { expect, test } from "../../helpers/flips";

import { patchAccount } from "../../helpers/shell";

/**
 * Ticket 002: areas are filtered by platform capability.
 *
 * The test site may hold a real mail account for Administrator. The journeys
 * that need an account without jmap patch the real account answer, so they do
 * not depend on site data.
 */

test("an account without jmap sees no Mail or Calendar rail item", async ({ page }) => {
	await patchAccount(page, { is_jmap_configured: false, capabilities: { jmap: false } });
	await page.goto("/home");
	const rail = page.getByRole("navigation", { name: "Areas" });
	await expect(rail.getByRole("link", { name: "Home" })).toBeVisible();
	await expect(rail.getByRole("link", { name: "Drive" })).toBeVisible();
	await expect(rail.getByRole("link", { name: "Mail" })).toHaveCount(0);
	await expect(rail.getByRole("link", { name: "Calendar" })).toHaveCount(0);
});

test("a direct /mail URL answers with the unavailable surface and keeps the URL", async ({ page }) => {
	const productRequests: string[] = [];
	page.on("request", (request) => {
		if (/\/api\/suite\/mail\//.test(request.url())) productRequests.push(request.url());
	});

	await patchAccount(page, { is_jmap_configured: false, capabilities: { jmap: false } });
	await page.goto("/mail");
	await expect(page.getByRole("heading", { name: /Mail is unavailable/i })).toBeVisible();
	await expect(page.getByText("This area needs a configured mail account.")).toBeVisible();
	await expect(page).toHaveURL(/\/mail$/);
	expect(productRequests).toEqual([]);
});

test("a direct /calendar URL answers with the unavailable surface", async ({ page }) => {
	await patchAccount(page, { is_jmap_configured: false, capabilities: { jmap: false } });
	await page.goto("/calendar");
	await expect(page.getByRole("heading", { name: /Calendar is unavailable/i })).toBeVisible();
	await expect(page).toHaveURL(/\/calendar$/);
});

test("an account with jmap sees Mail and Calendar in the rail", async ({ page }) => {
	await patchAccount(page, { is_jmap_configured: true });
	await page.goto("/home");
	const rail = page.getByRole("navigation", { name: "Areas" });
	await expect(rail.getByRole("link", { name: "Mail" })).toBeVisible();
	await expect(rail.getByRole("link", { name: "Calendar" })).toBeVisible();
});
