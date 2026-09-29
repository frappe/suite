import { expect, test, type Page } from "@playwright/test";

import { loginViaApi } from "../../../shared/auth";
import { MOBILE_VIEWPORT, patchAccount } from "../../helpers/shell";

/**
 * Stage 5 (spec section 9, ticket 018): Mail, Calendar and Meet adopt the
 * shell behind `suite_flip_shell`. The server sends the key in the SPA boot
 * (`suite/www/suite.py`). The Vite dev server does not render that boot, so
 * each journey sets the boot value the way the served page does: a
 * `window.suite_flip_shell` assignment before the app loads.
 */

async function bootShellFlip(page: Page, on: boolean) {
	await page.addInitScript((value) => {
		Object.assign(window, { suite_flip_shell: value });
	}, on);
}

// Mail and Calendar need a mail account, so every area shows on the rail.
const MAIL_ACCOUNT = { is_jmap_configured: true, capabilities: { jmap: true, systemManager: true } };

const rail = (page: Page) => page.getByRole("navigation", { name: "Areas" });
const meetHome = (page: Page) => page.getByText("Start an open meeting, create a restricted meeting, or join with a code.");
const meetHeader = (page: Page) => page.locator("[data-slot='sidebar-header'] button", { hasText: "Meet" });

test.describe("Meet in the shell", () => {
	test.beforeEach(async ({ page }) => {
		await bootShellFlip(page, true);
		await patchAccount(page, MAIL_ACCOUNT);
	});

	test("the rail lists Meet last and marks it active, and the page drops its own sidebar", async ({ page }) => {
		await page.goto("/meet");
		await expect(meetHome(page)).toBeVisible();

		// The rail labels carry the Mail unread count, so read each label's first word.
		const items = rail(page).getByRole("link");
		await expect(items).toHaveCount(5);
		const labels = await items.evaluateAll((links) => links.map((link) => link.getAttribute("aria-label")?.split(",")[0]));
		expect(labels).toEqual(["Home", "Files", "Mail", "Calendar", "Meet"]);
		await expect(rail(page).getByRole("link", { name: "Meet" })).toHaveAttribute("aria-current", "page");
		await expect(meetHeader(page)).toHaveCount(0);
	});

	test("the audio test sits in the shell and a call stays outside it", async ({ page }) => {
		await page.goto("/meet/audio-test");
		await expect(page.getByRole("heading", { name: "Audio Notification Test" })).toBeVisible();
		await expect(rail(page)).toBeVisible();

		await rail(page).getByRole("link", { name: "Meet" }).click();
		await expect(meetHome(page)).toBeVisible();

		await page.goto("/meet/uf5-no-such-call");
		await expect(page).toHaveURL(/\/meet\/uf5-no-such-call$/);
		await expect(page.locator("#app")).not.toBeEmpty();
		await expect(rail(page)).toHaveCount(0);
		await expect(meetHome(page)).toHaveCount(0);
	});

	test.describe("phone", () => {
		test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true, isMobile: true });

		test("the bottom nav lists Meet and leads to it", async ({ page }) => {
			await page.goto("/home");
			const meet = page.locator("[data-slot='mobile-nav-item']").filter({ hasText: "Meet" });
			await expect(meet).toBeVisible();
			await meet.click();

			await expect(page).toHaveURL(/\/meet$/);
			await expect(meetHome(page)).toBeVisible();
			await expect(rail(page)).toHaveCount(0);
			await expect(page.locator("[data-slot='mobile-nav-item']").filter({ hasText: "Meet" })).toBeVisible();
		});
	});
});

test.describe("Meet standalone chrome", () => {
	test("with the flip off, Meet has no rail and its header menu opens Suite Settings on Devices", async ({ page }) => {
		await bootShellFlip(page, false);
		await page.goto("/meet");
		await expect(meetHome(page)).toBeVisible();
		await expect(rail(page)).toHaveCount(0);

		await meetHeader(page).click();
		const menu = page.getByRole("menu");
		for (const entry of ["Apps", "Settings", "Theme", "Log out"]) {
			await expect(menu.getByRole("menuitem", { name: entry })).toBeVisible();
		}

		await menu.getByRole("menuitem", { name: "Settings" }).click();
		const settings = page.getByRole("dialog", { name: "Settings" });
		await expect(settings).toBeVisible();
		await expect(settings.getByRole("tab", { name: "Devices", exact: true })).toHaveAttribute("aria-selected", "true");
		await expect(settings.getByRole("tabpanel").getByRole("heading", { name: "Devices", exact: true })).toBeVisible();
	});

	test("with the flip off, Log out in the Meet header signs out", async ({ browser, baseURL }) => {
		// A session of its own: logging out ends only this one, not the shared admin state.
		const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
		try {
			await loginViaApi(context.request);
			const page = await context.newPage();
			await bootShellFlip(page, false);
			await page.goto("/meet");
			await expect(meetHome(page)).toBeVisible();

			await meetHeader(page).click();
			await page.getByRole("menu").getByRole("menuitem", { name: "Log out" }).click();

			await expect(page).toHaveURL(/\/login/);
			const user = await context.request.get("/api/method/frappe.auth.get_logged_user");
			expect(user.ok()).toBe(false);
		} finally {
			await context.close();
		}
	});
});
