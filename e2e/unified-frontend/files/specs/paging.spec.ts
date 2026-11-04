import { type APIRequestContext, type Page, expect, test } from "@playwright/test";

import { adminApi, createFolder, purge, roots, runTag, type DriveNode } from "../../helpers/drive";

/** Ticket 006: 60-row windows, opaque cursors and infinite loading. */

test.describe.configure({ mode: "serial" });

const TOTAL = 65;

let api: APIRequestContext;
let folder: DriveNode;

test.beforeAll(async ({ baseURL }) => {
	test.setTimeout(180_000);
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	folder = await createFolder(api, personal, runTag("w4-paging"));
	for (let start = 0; start < TOTAL; start += 5) {
		await Promise.all(
			Array.from({ length: Math.min(5, TOTAL - start) }, (_, offset) =>
				createFolder(api, folder.name, `row-${String(start + offset + 1).padStart(3, "0")}`),
			),
		);
	}
});

test.afterAll(async () => {
	await purge(api, folder.name);
	await api.dispose();
});

/** Hold the first cursor response so the 60-row window is observable even on a fast load. */
async function openFirstWindow(page: Page): Promise<() => void> {
	let release!: () => void;
	const held = new Promise<void>((resolve) => { release = resolve; });
	await page.route(/\/children\?.*cursor=/, async (route) => {
		await held;
		await route.continue();
	}, { times: 1 });
	await page.goto(`/drive/f/${folder.name}?view=list&sort=title&dir=asc`);
	await expect(page.locator("[data-node]")).toHaveCount(60, { timeout: 20_000 });
	return release;
}

test("the listing loads the next window when the sentinel becomes visible", async ({ page }) => {
	const release = await openFirstWindow(page);
	const rows = page.locator("[data-node]");
	const nextWindow = page.waitForResponse((response) => /\/children\?.*cursor=/.test(response.url()) && response.ok());
	await rows.last().scrollIntoViewIfNeeded();
	release();
	await nextWindow;
	await expect(rows).toHaveCount(TOTAL, { timeout: 20_000 });
	await expect(page.getByText("row-065", { exact: true })).toBeVisible();
});

test("changing the sort restarts the listing without a cursor", async ({ page }) => {
	const release = await openFirstWindow(page);
	const rows = page.locator("[data-node]");
	await rows.last().scrollIntoViewIfNeeded();
	release();
	await expect(rows).toHaveCount(TOTAL, { timeout: 20_000 });

	const restarted = page.waitForRequest((request) => {
		const url = new URL(request.url());
		return url.pathname.endsWith("/children") && url.searchParams.get("ascending") === "false";
	});
	await page.getByRole("button", { name: "Name" }).click();
	const request = await restarted;
	expect(new URL(request.url()).searchParams.has("cursor")).toBe(false);
	await expect(page).toHaveURL(/dir=desc/);
	await expect(rows.first()).toContainText("row-065");
});

// The walk stops at the first failed window (fixed here). Before the fix it
// retried the same cursor at 46 requests per 5 seconds.
test("a failed next window keeps the loaded rows and offers a retry", async ({ page }) => {
	const rows = page.locator("[data-node]");
	let failed = 0;
	let failing = true;
	await page.route(/\/children\?.*cursor=/, (route) => {
		if (!failing) return route.continue();
		failed += 1;
		return route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({ errors: [{ type: "InternalServerError", message: "Injected failure" }] }),
		});
	});
	await page.goto(`/drive/f/${folder.name}?view=list&sort=title&dir=asc`);
	await expect(rows).toHaveCount(60, { timeout: 20_000 });
	await rows.last().scrollIntoViewIfNeeded();
	await expect.poll(() => failed, { message: "a next-window request was sent and failed" }).toBeGreaterThan(0);

	await expect(page.getByRole("button", { name: "Retry loading more" })).toBeVisible();
	await expect(rows).toHaveCount(60);
	await expect(page.getByText("Could not refresh files"), `failed next-window requests so far: ${failed}`).toBeVisible();

	// Bring the explicit retry into view while requests still fail.
	const retry = page.getByRole("button", { name: "Retry loading more" });
	await retry.scrollIntoViewIfNeeded();
	await expect(retry).toBeInViewport();
	failing = false;
	const nextWindow = page.waitForResponse((response) => /\/children\?.*cursor=/.test(response.url()) && response.ok());
	await retry.click();
	await nextWindow;
	await expect(rows).toHaveCount(TOTAL, { timeout: 20_000 });
});
