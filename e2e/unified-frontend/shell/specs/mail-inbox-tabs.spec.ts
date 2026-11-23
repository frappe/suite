import { expect, test, type Page } from "@playwright/test";

/**
 * A split Inbox names its categories as tabs in the title bar, and the open tab is
 * underlined on the bar's bottom border.
 *
 * The categories come from the user's mail settings, so the user info is patched to split
 * the Inbox into every category. Needs a mail account for the signed-in user, so it runs
 * only with `E2E_MAIL` set.
 */

const CATEGORIES = ["primary", "updates", "forums", "promotions", "social"];

async function splitInbox(page: Page): Promise<void> {
	await page.route("**/api/method/suite.mail.api.account.get_user_info*", async (route) => {
		const response = await route.fetch();
		// SAFETY: the endpoint answers `{ message: <user info> }`; only the split's fields change.
		const body = (await response.json()) as { message: Record<string, unknown> };
		body.message = {
			...body.message,
			email_classification: true,
			split_inbox: 1,
			inbox_tabs: CATEGORIES,
		};
		await route.fulfill({ response, json: body });
	});
}

test.describe("Inbox category tabs", () => {
	test.skip(!process.env.E2E_MAIL, "needs a mail server");

	for (const [category, name] of [
		["primary", "Primary"],
		["updates", "Updates"],
	] as const) {
		test(`the open tab, ${name}, is underlined on the title bar's border`, async ({ page }) => {
			await splitInbox(page);
			await page.goto(`/mail${category === "primary" ? "" : `?category=${category}`}`);

			const tabs = page.getByTestId("inbox-tabs");
			const tab = tabs.getByRole("tab", { name: new RegExp(`^${name}`) });
			await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });

			const underline = tabs.locator("[data-slot='tab-indicator']");
			// The indicator slides into place; wait until it has come to rest under the tab.
			await expect(async () => {
				const [line, under] = [await underline.boundingBox(), await tab.boundingBox()];
				expect(line && under && Math.abs(line.x - under.x) < 1 && Math.abs(line.width - under.width) < 1).toBe(true);
			}).toPass();

			// What paints at the underline's middle is the underline itself, not what lies
			// behind it: a clipped underline is not there for the eye.
			const painted = await underline.evaluate((line) => {
				const box = line.getBoundingClientRect();
				// Whole pixels: the underline is one pixel tall, and a half-pixel point rounds off it.
				const hit = document.elementFromPoint(Math.floor(box.x + box.width / 2), Math.floor(box.y));
				return !!hit && line.contains(hit);
			});
			expect(painted).toBe(true);

			// It lies on the title bar's bottom border, across the whole bar's width of tabs.
			const header = await page.locator("header, [data-slot='page-header']").filter({ has: tabs }).first().boundingBox();
			const line = await underline.boundingBox();
			expect(header && line && Math.round(line.y + line.height)).toBe(header && Math.round(header.y + header.height));
		});
	}
});
