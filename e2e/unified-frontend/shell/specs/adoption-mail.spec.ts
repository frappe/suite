import { expect, test, type Page } from "@playwright/test";

import { MOBILE_VIEWPORT, patchAccount } from "../../helpers/shell";

/**
 * Stage 5 (spec section 9, ticket 018): Mail in the shell.
 *
 * Administrator has the mail account `administrator@suite.test` on the local
 * Stalwart server, so the inbox journeys use the real account and run only
 * with `E2E_MAIL` set.
 */

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
	test("bare /mail lands on the inbox, with the rail and no standalone chrome", async ({ page }) => {
		test.skip(!process.env.E2E_MAIL, "needs a mail server");
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
			test.skip(!process.env.E2E_MAIL, "needs a mail server");
			await page.goto("/mail");
			await expect(page).toHaveURL(MAILBOX_URL);

			await expect(mailTabBar(page).getByRole("button", { name: "Inbox" })).toBeVisible();
			await expect(mobileShell(page)).toBeVisible();
		});
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

	test("a MIME page opens without a mailbox, and the rest of Mail stays unavailable", async ({ page }) => {
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
						cc: { label: "CC", value: null },
						bcc: { label: "BCC", value: null },
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
});
