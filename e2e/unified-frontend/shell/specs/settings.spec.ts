import { type Locator, type Page } from "@playwright/test";

import { expect, test } from "../../helpers/flips";

import { failRequest, MOBILE_VIEWPORT, patchAccount } from "../../helpers/shell";

/**
 * Stage 4 (spec section 12): one settings list, shown as a dialog on desktop
 * and as a drill-in on phone. The journeys give the account jmap and System
 * Manager through the account answer, so every heading shows.
 */

const FIRST_TABS = [
	{ heading: "Account", tab: "Profile" },
	{ heading: "Drive", tab: "Statistics" },
	{ heading: "Mail", tab: "Credentials" },
	{ heading: "Calendar", tab: "Calendars" },
	{ heading: "Meet", tab: "Devices" },
	{ heading: "Workspace", tab: "General" },
];

const SETTINGS_SECTION = "section[aria-label]:has(> div > button)";

const FULL_ACCOUNT = {
	is_jmap_configured: true,
	roles: { system_manager: true },
	capabilities: { jmap: true, systemManager: true },
};

const PLAIN_ACCOUNT = {
	is_jmap_configured: false,
	roles: [],
	capabilities: { jmap: false, systemManager: false },
};

async function openSettingsFromAccountMenu(page: Page) {
	await page.getByRole("button", { name: "Account" }).click();
	await page.getByRole("menuitem", { name: "Settings" }).click();
	const settings = page.getByRole("dialog", { name: "Settings" });
	await expect(settings).toBeVisible();
	return settings;
}

/** Source modules the dev server served, by file name. */
function trackModules(page: Page): Set<string> {
	const served = new Set<string>();
	page.on("request", (request) => {
		const name = new URL(request.url()).pathname.split("/").pop();
		if (name?.endsWith(".vue")) served.add(name);
	});
	return served;
}

test.describe("desktop", () => {
	test("each heading opens its first tab", async ({ page }) => {
		await patchAccount(page, FULL_ACCOUNT);
		await page.goto("/home");
		const settings = await openSettingsFromAccountMenu(page);

		// The sidebar's group labels, in heading order.
		const headings = settings.getByRole("tablist").locator(":scope > div > div > div:first-child:not([role='tab'])");
		await expect(headings).toHaveText(FIRST_TABS.map(({ heading }) => heading));

		for (const { tab } of FIRST_TABS) {
			await settings.getByRole("tab", { name: tab, exact: true }).click();
			await expect(settings.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
			await expect(settings.getByRole("tabpanel").getByRole("heading", { name: tab, exact: true })).toBeVisible();
		}
	});

	test("a tab body loads only when its tab opens", async ({ page }) => {
		await patchAccount(page, FULL_ACCOUNT);
		const served = trackModules(page);
		await page.goto("/home");
		const settings = await openSettingsFromAccountMenu(page);
		await expect(settings.getByRole("tabpanel").getByRole("heading", { name: "Profile" })).toBeVisible();

		for (const body of ["PreferencesSettings.vue", "StatisticsSettings.vue", "CredentialsSettings.vue", "DeviceSettingsTab.vue"]) {
			expect(served.has(body), `${body} before its click`).toBe(false);
		}

		await settings.getByRole("tab", { name: "Statistics" }).click();
		await expect(settings.getByRole("tabpanel").getByRole("heading", { name: "Statistics" })).toBeVisible();
		expect(served.has("StatisticsSettings.vue")).toBe(true);
		expect(served.has("PreferencesSettings.vue")).toBe(false);
	});

	test("a system manager's account menu offers Open Desk and a disabled Upgrade plan", async ({ page }) => {
		await patchAccount(page, FULL_ACCOUNT);
		await page.goto("/home");
		await page.getByRole("button", { name: "Account" }).click();

		const menu = page.getByRole("menu");
		await expect(menu.getByText("Administrator").first()).toBeVisible();
		await expect(menu.getByRole("menuitem", { name: "Open Desk" })).toHaveAttribute("href", "/app");
		const upgrade = menu.getByRole("menuitem", { name: "Upgrade plan" });
		await expect(upgrade).toHaveAttribute("aria-disabled", "true");
		await upgrade.getByText("Upgrade plan").hover();
		await expect(page.getByText("Not available yet").first()).toBeVisible();
	});

	test("a plain user sees no Workspace group and no Open Desk", async ({ page }) => {
		await patchAccount(page, PLAIN_ACCOUNT);
		await page.goto("/home");
		await page.getByRole("button", { name: "Account" }).click();

		const menu = page.getByRole("menu");
		await expect(menu.getByRole("menuitem", { name: "Settings" })).toBeVisible();
		await expect(menu.getByRole("menuitem", { name: "Open Desk" })).toHaveCount(0);
		await expect(menu.getByRole("menuitem", { name: "Upgrade plan" })).toHaveCount(0);

		await menu.getByRole("menuitem", { name: "Settings" }).click();
		const settings = page.getByRole("dialog", { name: "Settings" });
		await expect(settings.getByRole("tab", { name: "Profile" })).toBeVisible();
		await expect(settings.getByText("Workspace", { exact: true })).toHaveCount(0);
		await expect(settings.getByRole("tab", { name: "Users" })).toHaveCount(0);
		await expect(settings.getByText("Mail", { exact: true })).toHaveCount(0);
	});
});

const USAGE = "**/api/suite/drive/roots/*/usage*";

/** Answer the usage route with the real answer, some fields replaced, once `release` runs. */
async function holdUsage(page: Page, breakdown: Record<string, unknown>) {
	let release = () => {};
	const released = new Promise<void>((resolve) => (release = resolve));
	await page.route(USAGE, async (route) => {
		const url = new URL(route.request().url());
		expect(url.searchParams.get("expand")).toBe("breakdown");
		const response = await route.fetch();
		const body = (await response.json()) as { data: Record<string, unknown> };
		expect(body.data).toHaveProperty("by_type");
		expect(body.data).toHaveProperty("largest");
		await released;
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ data: { ...body.data, ...breakdown } }),
		});
	});
	return release;
}

const FILLED = {
	by_type: [
		{ type: "PDF", bytes: 900_000 },
		{ type: "Image", bytes: 500_000 },
	],
	largest: [
		{ node: "n1", title: "report.pdf", size: 900_000, mime: "application/pdf", kind: "file", type: "PDF" },
		{ node: "n2", title: "photo.png", size: 500_000, mime: "image/png", kind: "file", type: "Image" },
	],
};

for (const phone of [false, true]) {
	test.describe(phone ? "drive statistics on a phone" : "drive statistics", () => {
		if (phone) test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true, isMobile: true });

		async function openStatistics(page: Page) {
			await page.goto("/home");
			if (!phone) {
				const settings = await openSettingsFromAccountMenu(page);
				await settings.getByRole("tab", { name: "Statistics" }).click();
				return settings.getByRole("tabpanel");
			}
			await page.locator("[data-slot='mobile-nav-item']").filter({ hasText: "Account" }).click();
			await page.getByRole("navigation", { name: "Account" }).getByRole("button", { name: "Settings" }).click();
			const settings = page.getByRole("dialog", { name: "Settings" });
			await settings
				.getByRole("region", { name: "Drive", exact: true })
				.getByRole("button", { name: "Statistics", exact: true })
				.click();
			return settings.getByRole("region", { name: "Statistics", exact: true });
		}

		async function headingTops(panel: Locator) {
			const tops = [];
			for (const name of ["By type", "Largest files"]) {
				const heading = panel.getByRole("heading", { name, exact: true });
				await expect(heading).toBeVisible();
				tops.push((await heading.boundingBox())?.y);
			}
			return tops;
		}

		test("failed, loading and loaded share one layout", async ({ page }) => {
			await patchAccount(page, FULL_ACCOUNT);
			await failRequest(page, USAGE);
			let panel = await openStatistics(page);
			await expect(panel.getByText("Storage use could not load.", { exact: true })).toBeVisible();
			const failed = await headingTops(panel);

			await page.unroute(USAGE);
			const release = await holdUsage(page, FILLED);
			panel = await openStatistics(page);
			await expect(panel.getByText("Loading…")).toBeVisible();
			expect(await headingTops(panel)).toEqual(failed);

			release();
			await expect(panel.getByText("report.pdf")).toBeVisible();
			await expect(panel.getByRole("listitem").filter({ hasText: "PDF" }).first()).toContainText("900 KB");
			await expect(panel.getByRole("listitem").filter({ hasText: "photo.png" })).toContainText("500 KB");
			expect(await headingTops(panel)).toEqual(failed);
		});

		test("usage with no active file explains what still counts", async ({ page }) => {
			await patchAccount(page, FULL_ACCOUNT);
			const release = await holdUsage(page, { used_bytes: 4096, by_type: [], largest: [] });
			release();
			const panel = await openStatistics(page);
			await expect(
				panel.getByText("No active files. Files in the trash and their versions still count towards storage."),
			).toBeVisible();
			await expect(panel.getByText("No files", { exact: true })).toBeVisible();
			await expect(panel.getByText("4 KB used")).toBeVisible();
		});
	});
}

test.describe("phone", () => {
	test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true, isMobile: true });

	async function openDrillIn(page: Page) {
		await page.locator("[data-slot='mobile-nav-item']").filter({ hasText: "Account" }).click();
		await page.getByRole("navigation", { name: "Account" }).getByRole("button", { name: "Settings" }).click();
		const settings = page.getByRole("dialog", { name: "Settings" });
		await expect(settings).toBeVisible();
		return settings;
	}

	test("each heading opens its first tab", async ({ page }) => {
		await patchAccount(page, FULL_ACCOUNT);
		await page.goto("/home");
		const settings = await openDrillIn(page);

		for (const { heading, tab } of FIRST_TABS) {
			const section = settings.getByRole("region", { name: heading, exact: true });
			await section.getByRole("button", { name: tab, exact: true }).click();
			const tabPage = settings.getByRole("region", { name: tab, exact: true });
			await expect(tabPage.getByRole("heading", { name: tab, exact: true })).toBeVisible();
			await tabPage.getByRole("button", { name: "Back" }).click();
			await expect(tabPage).toBeHidden();
		}
	});

	test("back goes tab, then list, then closed", async ({ page }) => {
		await patchAccount(page, FULL_ACCOUNT);
		await page.goto("/home");
		const settings = await openDrillIn(page);

		await settings.getByRole("button", { name: "Preferences", exact: true }).click();
		const tabPage = settings.getByRole("region", { name: "Preferences" });
		await expect(tabPage).toBeVisible();

		await page.goBack();
		await expect(tabPage).toBeHidden();
		await expect(settings).toBeVisible();

		await page.goBack();
		await expect(settings).toBeHidden();
		await expect(page).toHaveURL(/\/home$/);
	});

	test("focus stays in Settings and the page behind is hidden", async ({ page }) => {
		await patchAccount(page, PLAIN_ACCOUNT);
		await page.goto("/home");
		const settings = await openDrillIn(page);
		await expect(settings.getByRole("button", { name: "Profile", exact: true })).toBeVisible();

		for (let press = 0; press < 12; press += 1) {
			await page.keyboard.press("Tab");
			expect(await settings.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
		}
		// Hidden from assistive technology: the page's heading has no role while Settings is open.
		await expect(page.getByRole("heading", { name: "Home", level: 1 })).toHaveCount(0);
	});

	test("an entry from an earlier open does not keep Settings open", async ({ page }) => {
		await patchAccount(page, FULL_ACCOUNT);
		await page.goto("/home");
		const settings = await openDrillIn(page);

		// Close with Back, then step Forward onto the closed open's entry.
		await page.goBack();
		await expect(settings).toBeHidden();
		await page.goForward();
		await expect(settings).toBeHidden();

		// A new open, then Back onto the earlier open's entry: Settings closes.
		await openDrillIn(page);
		await page.goBack();
		await expect(settings).toBeHidden();
	});

	test("Mail's Profile page lists the same settings as the Settings list", async ({ page }) => {
		await patchAccount(page, FULL_ACCOUNT);
		await page.goto("/mail");
		// Mail's own tab bar.
		await page.getByRole("button", { name: /Profile$/ }).click();
		await expect(page).toHaveURL(/\/profile$/);

		// A settings heading: a named section holding its rows.
		const profileSections = page.locator(SETTINGS_SECTION);
		const mail = page.getByRole("region", { name: "Mail", exact: true });
		for (const tab of ["Credentials", "Automation", "Import", "Export"]) {
			await expect(mail.getByRole("button", { name: tab, exact: true })).toBeVisible();
		}
		const profileHeadings = await profileSections.evaluateAll((sections) =>
			sections.map((section) => section.getAttribute("aria-label")),
		);

		// A row opens its tab in Settings.
		await mail.getByRole("button", { name: "Credentials", exact: true }).click();
		const settings = page.getByRole("dialog", { name: "Settings" });
		const tabPage = settings.getByRole("region", { name: "Credentials", exact: true });
		await expect(tabPage.getByRole("heading", { name: "Credentials", exact: true })).toBeVisible();

		// Back shows the Settings list: the same headings as the Profile page.
		await page.goBack();
		await expect(tabPage).toBeHidden();
		const listHeadings = await settings
			.locator(SETTINGS_SECTION)
			.evaluateAll((sections) => sections.map((section) => section.getAttribute("aria-label")));
		expect(listHeadings).toEqual(profileHeadings);

		await page.goBack();
		await expect(settings).toBeHidden();
		await expect(page).toHaveURL(/\/profile$/);
	});
});
