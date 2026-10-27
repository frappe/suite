import { expect, test, type Page } from "@playwright/test";

import { adminApi } from "../../helpers/drive";
import { MOBILE_VIEWPORT, patchAccount } from "../../helpers/shell";

/** Stage 5 (spec section 9, ticket 018): Mail, Calendar and Meet in the shell. */

test.afterEach(async ({ page }) => {
	await page.unrouteAll({ behavior: "wait" });
});

// Mail and Calendar need a mail account, so every area shows on the rail.
const MAIL_ACCOUNT = { is_jmap_configured: true, capabilities: { jmap: true, systemManager: true } };

const rail = (page: Page) => page.getByRole("navigation", { name: "Areas" });
const meetHome = (page: Page) => page.getByRole("region", { name: "Meeting actions" });
const meetHeader = (page: Page) => page.locator("[data-slot='sidebar-header'] button", { hasText: "Meet" });

test.describe("Meet in the shell", () => {
	test.beforeEach(async ({ page }) => {
		await patchAccount(page, MAIL_ACCOUNT);
	});

	test("the rail lists Meet after Calendar and marks it active, and the page drops its own sidebar", async ({ page }) => {
		await page.goto("/meet");
		await expect(meetHome(page)).toBeVisible();

		// The rail labels carry the Mail unread count, so read each label's first word.
		const items = rail(page).getByRole("link");
		await expect(items).toHaveCount(6);
		const labels = await items.evaluateAll((links) => links.map((link) => link.getAttribute("aria-label")?.split(",")[0]));
		expect(labels).toEqual(["Home", "Drive", "Mail", "Calendar", "Meet", "People"]);
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

	test("Meet's guard sends a user who is not a System Manager from the audio test to Meet", async ({ page }) => {
		await patchAccount(page, { roles: { system_manager: false, suite_admin: false }, capabilities: { jmap: true, systemManager: false } });
		await page.goto("/meet/audio-test");
		await expect(page).toHaveURL(/\/meet$/);
		await expect(meetHome(page)).toBeVisible();
		await expect(page.getByRole("heading", { name: "Audio Notification Test" })).toHaveCount(0);
	});

	test("a guest opens an open call without a login redirect", async ({ browser, baseURL }) => {
		const api = await adminApi(baseURL!);
		const created = await api.post("/api/suite/meet/rooms", { data: { type: "open" } });
		expect(created.ok()).toBe(true);
		const { code } = ((await created.json()) as { data: { code: string } }).data;
		const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
		try {
			const page = await context.newPage();
			await page.goto(`/meet/${code}`);
			// The guest lobby asks for a name. A login redirect would never show it.
			await expect(page.getByText("Ready to join?")).toBeVisible();
			await expect(page.getByPlaceholder("Your name").or(page.getByLabel("Your name"))).toBeVisible();
			await expect(page).toHaveURL(new RegExp(`/meet/${code}$`));
			await expect(rail(page)).toHaveCount(0);
		} finally {
			await context.close();
			await api.delete(`/api/resource/Meet Room/${code}`);
			await api.dispose();
		}
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

const calendarHeader = (page: Page) => page.locator("[data-slot='sidebar-header'] button", { hasText: "Calendar" });
const calendarTabBar = (page: Page) => page.locator("nav").filter({ has: page.getByRole("button", { name: "Profile" }) });

test.describe("Calendar in the shell", () => {
	test.skip(!process.env.E2E_MAIL, "needs a mail server");

	test.beforeEach(async ({ page }) => {
		await patchAccount(page, MAIL_ACCOUNT);
	});

	test("the rail marks Calendar active and the header menu drops the standalone chrome", async ({ page }) => {
		await page.goto("/calendar");
		// Calendar's route guard (`beforeEnter` in its routes) expands the shortcut to the account's view.
		await expect(page).toHaveURL(/\/calendar\/account\/[^/]+\//);
		await expect(rail(page)).toBeVisible();
		await expect(rail(page).getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");

		await calendarHeader(page).click();
		const menu = page.getByRole("menu");
		await expect(menu.getByRole("menuitem", { name: "Shortcuts" })).toBeVisible();
		for (const entry of ["Apps", "Settings", "Log out"]) {
			await expect(menu.getByRole("menuitem", { name: entry })).toHaveCount(0);
		}
	});

	test.describe("phone", () => {
		test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true, isMobile: true });

		test("Calendar keeps its own tab bar inside the shell", async ({ page }) => {
			await page.goto("/calendar");
			await expect(page).toHaveURL(/\/calendar\/account\/[^/]+\//);
			await expect(calendarTabBar(page)).toBeVisible();
			await expect(rail(page)).toHaveCount(0);
			await expect(calendarHeader(page)).toHaveCount(0);

			await calendarTabBar(page).getByRole("button", { name: "Profile" }).click();
			await expect(page).toHaveURL(/\/calendar\/account\/[^/]+\/profile$/);
		});
	});
});
