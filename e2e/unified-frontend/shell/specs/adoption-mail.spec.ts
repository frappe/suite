import { expect, test, type Page } from "@playwright/test";

import { loginViaApi } from "../../../shared/auth";
import { MOBILE_VIEWPORT, patchAccount } from "../../helpers/shell";

/**
 * Stage 5 (spec section 9, ticket 018): Mail adopts the shell behind
 * `suite_flip_shell`. The Vite dev server does not render the boot, so each
 * journey sets the boot value the way the served page does.
 *
 * Administrator has the mail account `administrator@suite.test` on the local
 * Stalwart server, so these journeys use the real account.
 */

async function bootShellFlip(page: Page, on: boolean) {
	await page.addInitScript((value) => {
		Object.assign(window, { suite_flip_shell: value });
	}, on);
}

const MAILBOX_URL = /\/mail\/account\/[^/]+\/mailbox\/[^/]+$/;

const rail = (page: Page) => page.getByRole("navigation", { name: "Areas" });
const mailHeader = (page: Page) => page.locator("[data-slot='sidebar-header'] button", { hasText: "Mail" });
// On a phone only the shell frame draws frappe-ui's mobile shell around the page.
const mobileShell = (page: Page) => page.locator("[data-slot='mobile-shell']");
const unavailable = (page: Page) => page.getByRole("heading", { name: /Mail is unavailable/i });
const inboxLink = (page: Page) => page.locator("#sidebar").getByRole("link", { name: /^Inbox/ });

const mailTabBar = (page: Page) =>
	page.getByRole("navigation").filter({ has: page.getByRole("button", { name: "Profile" }) });

async function openHeaderMenu(page: Page) {
	await mailHeader(page).click();
	const menu = page.getByRole("menu");
	await expect(menu).toBeVisible();
	return menu;
}

test.describe("Mail in the shell", () => {
	test.beforeEach(async ({ page }) => {
		await bootShellFlip(page, true);
	});

	test("bare /mail lands on the inbox, with the rail and no standalone chrome", async ({ page }) => {
		await page.goto("/mail");
		await expect(page).toHaveURL(MAILBOX_URL);
		await expect(inboxLink(page)).toBeVisible();

		await expect(rail(page).getByRole("link", { name: /^Mail/ })).toHaveAttribute("aria-current", "page");
		// The header row shows the active mail account and no logo.
		await expect(mailHeader(page)).toContainText("administrator@suite.test");

		const menu = await openHeaderMenu(page);
		await expect(menu.getByRole("menuitem", { name: "Shortcuts" })).toBeVisible();
		for (const entry of ["Apps", "Settings", "Log Out"]) {
			await expect(menu.getByRole("menuitem", { name: entry })).toHaveCount(0);
		}
	});

	test("Mail's sign-in page stays outside the shell", async ({ browser, baseURL }) => {
		const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
		try {
			const page = await context.newPage();
			await bootShellFlip(page, true);
			await page.goto("/mail/login");
			await expect(page.getByRole("button", { name: "Log In", exact: true })).toBeVisible();
			await expect(rail(page)).toHaveCount(0);
		} finally {
			await context.close();
		}
	});

	test.describe("phone", () => {
		test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true, isMobile: true });

		test("bare /mail lands on the inbox in the shell, with Mail's own tab bar", async ({ page }) => {
			await page.goto("/mail");
			await expect(page).toHaveURL(MAILBOX_URL);

			await expect(mailTabBar(page).getByRole("button", { name: "Inbox" })).toBeVisible();
			await expect(mobileShell(page)).toBeVisible();
		});
	});
});

test.describe("Mail standalone chrome", () => {
	test("with the flip off, Mail has no rail and its header menu opens Suite Settings on Credentials", async ({ page }) => {
		await bootShellFlip(page, false);
		await page.goto("/mail");
		await expect(page).toHaveURL(MAILBOX_URL);
		await expect(inboxLink(page)).toBeVisible();
		await expect(rail(page)).toHaveCount(0);

		const menu = await openHeaderMenu(page);
		for (const entry of ["Apps", "Settings", "Log Out"]) {
			await expect(menu.getByRole("menuitem", { name: entry })).toBeVisible();
		}

		await menu.getByRole("menuitem", { name: "Settings" }).click();
		const settings = page.getByRole("dialog", { name: "Settings" });
		await expect(settings).toBeVisible();
		await expect(settings.getByRole("tab", { name: "Credentials", exact: true })).toHaveAttribute("aria-selected", "true");
		await expect(settings.getByRole("tabpanel").getByRole("heading", { name: "Credentials", exact: true })).toBeVisible();
	});

	test.describe("phone", () => {
		test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true, isMobile: true });

		test("with the flip off, Mail on a phone draws only its own tab bar, outside the shell", async ({ page }) => {
			await bootShellFlip(page, false);
			await page.goto("/mail");
			await expect(page).toHaveURL(MAILBOX_URL);
			await expect(mailTabBar(page).getByRole("button", { name: "Inbox" })).toBeVisible();
			await expect(mobileShell(page)).toHaveCount(0);
		});
	});

	test("with the flip off, Log Out in the Mail header signs out", async ({ browser, baseURL }) => {
		// A session of its own: logging out ends only this one, not the shared admin state.
		const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
		try {
			await loginViaApi(context.request);
			const page = await context.newPage();
			await bootShellFlip(page, false);
			await page.goto("/mail");
			await expect(inboxLink(page)).toBeVisible();

			const menu = await openHeaderMenu(page);
			await menu.getByRole("menuitem", { name: "Log Out" }).click();

			await expect(page).toHaveURL(/\/login/);
			const user = await context.request.get("/api/method/frappe.auth.get_logged_user");
			expect(user.ok()).toBe(false);
		} finally {
			await context.close();
		}
	});
});

test.describe("Mail pages that need no mail account", () => {
	// A signed-in user whose account has no mailbox: the platform session and Mail's own user
	// answer both say so.
	async function withoutMailbox(page: Page, mailUser: Record<string, unknown> = {}) {
		await patchAccount(page, { is_jmap_configured: false, capabilities: { jmap: false } });
		await page.route("**/api/method/suite.mail.api.account.get_user_info*", async (route) => {
			const response = await route.fetch();
			const body = (await response.json()) as { message: Record<string, unknown> };
			const message = { ...body.message, is_jmap_configured: false, accounts: [], ...mailUser };
			await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message }) });
		});
	}

	for (const flip of [true, false]) {
		test(`a MIME page opens without a mailbox, and the rest of Mail stays unavailable (flip ${flip ? "on" : "off"})`, async ({ page }) => {
			await bootShellFlip(page, flip);
			await withoutMailbox(page, { is_suite_admin: false });
			await page.route("**/api/method/suite.mail.api.mail.get_mime_message*", (route) =>
				route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						message: {
							message: "Subject: UF5 probe\r\n\r\nHello",
							message_id: { label: "Message ID", value: "<uf5@suite.test>" },
							created_at: { label: "Created At", value: "2026-09-30 10:00" },
							subject: { label: "Subject", value: "UF5 probe" },
							from: { label: "From", value: "alice@suite.test" },
							to: { label: "To", value: "bob@suite.test" },
						},
					}),
				}),
			);

			await page.goto("/mail/mime-message/uf5-probe");
			await expect(page.getByRole("heading", { name: "MIME Message" })).toBeVisible();
			await expect(page.getByText("UF5 probe").first()).toBeVisible();
			await expect(unavailable(page)).toHaveCount(0);
			await expect(rail(page)).toHaveCount(0);

			// Mail's routes are loaded now. Another Mail page still answers with the unavailable page.
			await page.evaluate(() => {
				history.pushState({}, "", "/mail");
				dispatchEvent(new PopStateEvent("popstate"));
			});
			await expect(unavailable(page)).toBeVisible();
			await expect(page).toHaveURL(/\/mail$/);
		});
	}

	test("an admin without a mailbox opens the Admin Dashboard", async ({ page }) => {
		await bootShellFlip(page, true);
		await withoutMailbox(page, { is_suite_admin: true, is_suite_cloud_configured: true });

		await page.goto("/mail/dashboard");
		await expect(page).toHaveURL(/\/mail\/dashboard$/);
		await expect(page.locator("#sidebar").getByRole("link", { name: "Overview" })).toBeVisible();
		await expect(unavailable(page)).toHaveCount(0);
	});
});
