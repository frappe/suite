import type { Page } from "@playwright/test";

/** Replace fields of the `/api/suite/account` answer for one page. */
export async function patchAccount(page: Page, patch: Record<string, unknown>): Promise<void> {
	await page.route("**/api/suite/account", async (route) => {
		const response = await route.fetch();
		const body = (await response.json()) as { data?: Record<string, unknown> };
		const account = { ...(body.data ?? body), ...patch };
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ data: account }),
		});
	});
}

/** Fail one Drive or product read so a section can be checked in isolation. */
export async function failRequest(page: Page, pattern: string | RegExp, status = 500): Promise<void> {
	await page.route(pattern, (route) =>
		route.fulfill({
			status,
			contentType: "application/json",
			body: JSON.stringify({
				errors: [{ type: "InternalServerError", message: "Injected failure for the journey" }],
			}),
		}),
	);
}

export const MOBILE_VIEWPORT = { width: 390, height: 844 };
