import { expect, test } from "../../helpers/flips";

import { MOBILE_VIEWPORT } from "../../helpers/shell";

/**
 * Tickets 002 and 010: the phone shell replaces the rail with a bottom nav. A
 * tap on the active area opens that area's sidebar in a sheet. The avatar opens
 * the account sheet.
 */

test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true, isMobile: true });

const navItems = (page: import("@playwright/test").Page) =>
	page.locator("[data-slot='mobile-nav-item']");

test("the bottom nav replaces the rail and moves between areas", async ({ page }) => {
	await page.goto("/home");
	await expect(page.getByRole("navigation", { name: "Areas" })).toHaveCount(0);

	const nav = navItems(page);
	await expect(nav.filter({ hasText: "Home" })).toBeVisible();
	await expect(nav.filter({ hasText: "Drive" })).toBeVisible();
	await expect(nav.filter({ hasText: "Account" })).toBeVisible();
	await expect(nav.filter({ hasText: "More" })).toHaveCount(0);

	await nav.filter({ hasText: "Drive" }).click();
	await expect(page).toHaveURL(/\/drive$/);

	await nav.filter({ hasText: "Home" }).click();
	await expect(page).toHaveURL(/\/home$/);
});

test("a tap on the active area opens its sidebar in a bottom sheet", async ({ page }) => {
	await page.goto("/drive");
	await navItems(page).filter({ hasText: "Drive" }).click();

	const sheet = page.getByRole("dialog", { name: "Drive" });
	await expect(sheet).toBeVisible();
	await expect(page).toHaveURL(/\/drive$/);
	await expect(sheet.getByRole("link", { name: "Starred" })).toBeVisible();

	await sheet.getByRole("link", { name: "Starred" }).click();
	await expect(page).toHaveURL(/\/drive\/starred$/);
	await expect(sheet).toBeHidden();
});

test("the Files header opens the same sheet through the shell event", async ({ page }) => {
	await page.goto("/drive");
	await page.getByRole("button", { name: "My files" }).click();
	await expect(page.getByRole("dialog", { name: "Drive" })).toBeVisible();
});

test("the avatar opens the account sheet with Settings, Theme and Log out", async ({ page }) => {
	await page.goto("/home");
	await navItems(page).filter({ hasText: "Account" }).click();

	await expect(page.getByRole("dialog", { name: "Account" })).toBeVisible();
	const account = page.getByRole("navigation", { name: "Account" });
	await expect(account).toBeVisible();
	await expect(account.getByRole("button", { name: "Settings" })).toBeVisible();
	await expect(account.getByText("Theme")).toBeVisible();
	await expect(account.getByRole("button", { name: "Log out" })).toBeVisible();
	await expect(page).toHaveURL(/\/home$/);

	await account.getByRole("button", { name: "Settings" }).click();
	await expect(account).toBeHidden();
	await expect(page.getByRole("dialog").filter({ hasText: "Settings" }).first()).toBeVisible();
});

test("Home has no sidebar, so a tap on the active Home item opens no sheet", async ({ page }) => {
	await page.goto("/home");
	await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
	await navItems(page).filter({ hasText: "Home" }).click();

	await expect(page).toHaveURL(/\/home$/);
	await expect(page.getByRole("dialog")).toHaveCount(0);
});

// BottomSheet has no trigger element. reka's focus scope returns focus to the
// element that had it when the sheet opened. Each check first moves focus to a
// row inside the sheet, so the close must bring it back out.
test("closing a sheet returns focus to the control that opened it", async ({ page }) => {
	await page.goto("/drive");
	const filesSheet = page.getByRole("dialog", { name: "Drive" });
	const filesItem = navItems(page).filter({ hasText: "Drive" });
	await filesItem.click();
	await filesSheet.getByRole("link", { name: "Starred" }).focus();
	await page.keyboard.press("Escape");
	await expect(filesSheet).toBeHidden();
	await expect(filesItem).toBeFocused();

	const header = page.getByRole("button", { name: "My files" });
	await header.click();
	await filesSheet.getByRole("link", { name: "Recent" }).focus();
	await page.keyboard.press("Escape");
	await expect(filesSheet).toBeHidden();
	await expect(header).toBeFocused();

	const accountSheet = page.getByRole("dialog", { name: "Account" });
	const accountItem = navItems(page).filter({ hasText: "Account" });
	await accountItem.click();
	await accountSheet.getByRole("button", { name: "Log out" }).focus();
	await page.keyboard.press("Escape");
	await expect(accountSheet).toBeHidden();
	await expect(accountItem).toBeFocused();
});

test("an open sheet closes when the layout leaves phone width", async ({ page }) => {
	await page.goto("/drive");
	await navItems(page).filter({ hasText: "Drive" }).click();
	await expect(page.getByRole("dialog", { name: "Drive" })).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(page.getByRole("complementary", { name: "Drive" })).toBeVisible();
	await page.setViewportSize(MOBILE_VIEWPORT);
	await expect(navItems(page).first()).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);

	await navItems(page).filter({ hasText: "Account" }).click();
	await expect(page.getByRole("dialog", { name: "Account" })).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(page.getByRole("navigation", { name: "Areas" })).toBeVisible();
	await page.setViewportSize(MOBILE_VIEWPORT);
	await expect(navItems(page).first()).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);
});
