import { expect, test, type Page } from "@playwright/test";

import { MOBILE_VIEWPORT, patchAccount } from "../../helpers/shell";

/**
 * Stage 5 (spec sections 3.5, 3.15 and 9.3, ticket 018): one Suite PWA, the
 * phone bottom nav in Mail and Calendar.
 */

/**
 * Records each service worker registration before the browser runs it. The
 * dev server has no built `sw.js`, so the browser rejects the registration;
 * the call itself is what the platform controls.
 */
async function recordWorkerRegistrations(page: Page) {
	await page.addInitScript(() => {
		const calls: Array<{ url: string; options: unknown }> = [];
		Object.assign(window, { __workerRegistrations: calls });
		const container = navigator.serviceWorker;
		if (!container) return;
		const register = container.register.bind(container);
		container.register = (url: string | URL, options?: RegistrationOptions) => {
			calls.push({ url: String(url), options: options ?? null });
			return register(url, options);
		};
	});
}

const workerRegistrations = (page: Page) =>
	page.evaluate(() => (window as unknown as { __workerRegistrations: Array<{ url: string; options: unknown }> }).__workerRegistrations);

const MAIL_ACCOUNT = { is_jmap_configured: true, capabilities: { jmap: true, systemManager: true } };

const bottomNavItems = (page: Page) => page.locator("[data-slot='mobile-nav-item']");
const tabBar = (page: Page) => page.locator("nav").filter({ has: page.getByRole("button", { name: "Profile" }) });
const manifestLinks = (page: Page) => page.locator("link[rel='manifest']");

test.describe("one Suite PWA", () => {
	test.afterEach(async ({ page }) => {
		// Account reads can outlive the final manifest assertion.
		await page.unrouteAll({ behavior: "wait" });
	});

	test.beforeEach(async ({ page }) => {
		await patchAccount(page, MAIL_ACCOUNT);
	});

	test("every area links the Suite manifest, and Mail and Calendar their own", async ({ page }) => {
		// Under the app's base: `/` on Vite's dev server, the built assets' prefix otherwise.
		const manifestOf = (app: string) =>
			new RegExp(`^(/assets/suite/frontend)?/pwa/${app}/manifest\\.webmanifest$`);
		const expected = { "/home": "suite", "/drive": "suite", "/meet": "suite", "/mail": "mail", "/calendar": "calendar" };
		for (const [path, app] of Object.entries(expected)) {
			await page.goto(path);
			await expect(manifestLinks(page)).toHaveCount(1);
			await expect(manifestLinks(page)).toHaveAttribute("href", manifestOf(app));
		}

		const manifestAt = async (path: string) => {
			await page.goto(path);
			await expect(manifestLinks(page)).toHaveCount(1);
			const href = (await manifestLinks(page).getAttribute("href"))!;
			return (await (await page.request.get(href)).json()) as Record<string, unknown>;
		};
		const suite = await manifestAt("/home");
		expect(suite.id).toBe("/suite");
		expect(suite.start_url).toBe("/suite/start");
		const mail = await manifestAt("/mail");
		expect(mail.id).toBe("/mail");
		expect(mail.scope).toBe("/mail");
	});

	test("a signed-in user registers the push worker once per page, in Home and in Mail", async ({ page }) => {
		test.skip(!process.env.E2E_MAIL, "needs a mail server");
		await recordWorkerRegistrations(page);
		await page.goto("/home");
		await expect.poll(() => workerRegistrations(page)).toHaveLength(1);
		const [call] = await workerRegistrations(page);
		expect(call.url).toMatch(/^\/assets\/suite\/frontend\/sw\.js(\?config=.*)?$/);
		expect(call.options).toEqual({ type: "module" });

		// Mail no longer registers a worker of its own: a page load in Mail registers one.
		await page.goto("/mail");
		await expect(page).toHaveURL(/\/mail\/account\//);
		await expect(page.locator("#sidebar").getByRole("link", { name: /^Inbox/ })).toBeVisible();
		await expect.poll(() => workerRegistrations(page)).toHaveLength(1);
		expect((await workerRegistrations(page))[0]).toEqual(call);
	});
});

test("a signed-out visitor registers no push worker", async ({ browser, baseURL }) => {
	const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
	try {
		const page = await context.newPage();
		await recordWorkerRegistrations(page);
		await page.goto("/mail/login");
		await expect(page.getByRole("button", { name: "Log In", exact: true })).toBeVisible();
		await expect(manifestLinks(page)).toHaveCount(1);
		expect(await workerRegistrations(page)).toEqual([]);
	} finally {
		await context.close();
	}
});

test.describe("phone bottom nav in the shell", () => {
	test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true, isMobile: true });

	test("Mail and Calendar show only their own tab bar; Home and Meet keep the bottom nav", async ({ page }) => {
		test.skip(!process.env.E2E_MAIL, "needs a mail server");
		await patchAccount(page, MAIL_ACCOUNT);

		await page.goto("/home");
		await expect(bottomNavItems(page).filter({ hasText: "Mail" })).toBeVisible();

		await page.goto("/mail");
		await expect(page).toHaveURL(/\/mail\/account\//);
		await expect(tabBar(page).getByRole("button", { name: "Inbox" })).toBeVisible();
		await expect(bottomNavItems(page)).toHaveCount(0);

		await page.goto("/calendar");
		await expect(page).toHaveURL(/\/calendar\/account\//);
		await expect(tabBar(page)).toBeVisible();
		await expect(bottomNavItems(page)).toHaveCount(0);

		await page.goto("/meet");
		await expect(bottomNavItems(page).filter({ hasText: "Meet" })).toBeVisible();
	});

	test("a mail server outage keeps the bottom nav, so the user can leave Mail", async ({ page }) => {
		// Without a real mailbox Mail's guard never reads the mailbox list the stub fails.
		test.skip(!process.env.E2E_MAIL, "needs a mail server");
		await patchAccount(page, MAIL_ACCOUNT);
		// Stalwart is down: the mailbox list fails, as Mail's route guard expects of an outage.
		await page.route("**/api/method/suite.mail.api.mail.get_mailboxes*", (route) =>
			route.fulfill({
				status: 500,
				contentType: "application/json",
				body: JSON.stringify({ exc_type: "MailServerUnavailableError", exception: "MailServerUnavailableError" }),
			}),
		);
		await page.goto("/mail");
		await expect(page.getByRole("heading", { name: "Mail server unavailable" })).toBeVisible();
		const home = bottomNavItems(page).filter({ hasText: "Home" });
		await expect(home).toBeVisible();
		await home.click();
		await expect(page).toHaveURL(/\/home$/);
	});

	test("an installed app applies the top safe area once in Mail and Calendar, as in Home", async ({ page }) => {
		test.skip(!process.env.E2E_MAIL, "needs a mail server");
		const INSET = 47;
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: INSET, bottom: 0, left: 0, right: 0 } });
		await patchAccount(page, MAIL_ACCOUNT);

		// Where the page's content starts: below the shell's header target, plus the page's own padding.
		// The headless shell ignores an emulated `display-mode`, so the probe makes every
		// `display-mode: standalone` rule apply, as an installed app would.
		const contentTop = (page: Page, pageRoot: string) =>
			page.evaluate((selector) => {
				const rules = (list: CSSRuleList): CSSRule[] =>
					[...list].flatMap((rule) => (rule instanceof CSSGroupingRule ? [rule, ...rules(rule.cssRules)] : [rule]));
				for (const sheet of document.styleSheets)
					for (const rule of rules(sheet.cssRules))
						if (rule instanceof CSSMediaRule && rule.media.mediaText.includes("display-mode: standalone"))
							rule.media.mediaText = "all";
				const target = document.querySelector<HTMLElement>("[data-slot='mobile-shell'] > div:first-child")!;
				const root = document.querySelector<HTMLElement>(selector);
				const shellInset = parseFloat(getComputedStyle(target).paddingTop);
				const pageInset = root ? parseFloat(getComputedStyle(root).paddingTop) : 0;
				return { shellInset, pageInset };
			}, pageRoot);

		await page.goto("/home");
		await expect(bottomNavItems(page).filter({ hasText: "Home" })).toBeVisible();
		expect(await contentTop(page, "body")).toEqual({ shellInset: INSET, pageInset: 0 });

		await page.goto("/mail");
		await expect(tabBar(page).getByRole("button", { name: "Inbox" })).toBeVisible();
		expect(await contentTop(page, ".mail-app-root")).toEqual({ shellInset: 0, pageInset: INSET });

		await page.goto("/calendar");
		await expect(tabBar(page)).toBeVisible();
		const calendarRoot = await tabBar(page).evaluate((bar) => {
			bar.parentElement!.dataset.probe = "calendar-root";
			return true;
		});
		expect(calendarRoot).toBe(true);
		expect(await contentTop(page, "[data-probe='calendar-root']")).toEqual({ shellInset: 0, pageInset: INSET });
	});

	test("a user without a mailbox keeps the bottom nav on the Mail unavailable page", async ({ page }) => {
		await patchAccount(page, { is_jmap_configured: false, capabilities: { jmap: false } });
		await page.goto("/mail");
		await expect(page.getByRole("heading", { name: /Mail is unavailable/i })).toBeVisible();
		await expect(bottomNavItems(page).filter({ hasText: "Home" })).toBeVisible();
	});
});
