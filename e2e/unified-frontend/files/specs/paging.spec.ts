import { expect, test, type APIRequestContext } from "@playwright/test";

import { adminApi, children, createFolder, purge, roots, runTag, type DriveNode } from "../../helpers/drive";

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

test("the server answers a 60-row window with a cursor", async () => {
	const first = await children(api, folder.name, "?order_by=title&ascending=true");
	expect(first.rows).toHaveLength(60);
	expect(first.next_cursor).toBeTruthy();

	const second = await children(
		api,
		folder.name,
		`?order_by=title&ascending=true&cursor=${encodeURIComponent(first.next_cursor!)}`,
	);
	expect(second.rows).toHaveLength(TOTAL - 60);
	expect(second.next_cursor).toBeNull();
});

test("the listing loads the next window when the sentinel becomes visible", async ({ page }) => {
	await page.goto(`/files/f/${folder.name}?view=list&sort=title&dir=asc`);
	const rows = page.locator("[data-node]");
	await expect(rows).toHaveCount(60, { timeout: 20_000 });

	await rows.last().scrollIntoViewIfNeeded();
	await expect(rows).toHaveCount(TOTAL, { timeout: 20_000 });
	await expect(page.getByText("row-065", { exact: true })).toBeVisible();
});

test("changing the sort restarts the listing without a cursor", async ({ page }) => {
	await page.goto(`/files/f/${folder.name}?view=list&sort=title&dir=asc`);
	const rows = page.locator("[data-node]");
	await expect(rows).toHaveCount(60, { timeout: 20_000 });
	await rows.last().scrollIntoViewIfNeeded();
	await expect(rows).toHaveCount(TOTAL, { timeout: 20_000 });

	const requests: string[] = [];
	page.on("request", (request) => {
		if (/\/children\?/.test(request.url())) requests.push(request.url());
	});

	await page.getByRole("button", { name: "Name" }).click();
	await expect(page).toHaveURL(/dir=desc/);
	await expect(rows).toHaveCount(60, { timeout: 20_000 });
	await expect(page.getByText("row-065", { exact: true })).toBeVisible();
	expect(requests.length).toBeGreaterThan(0);
	expect(requests.filter((url) => url.includes("cursor="))).toEqual([]);
});

test("changing the group restarts the listing without a cursor", async ({ page }) => {
	await page.goto(`/files/f/${folder.name}?view=list&sort=title&dir=asc`);
	const rows = page.locator("[data-node]");
	await expect(rows).toHaveCount(60, { timeout: 20_000 });
	await rows.last().scrollIntoViewIfNeeded();
	await expect(rows).toHaveCount(TOTAL, { timeout: 20_000 });

	const requests: string[] = [];
	page.on("request", (request) => {
		if (/\/children\?/.test(request.url())) requests.push(request.url());
	});

	await page.getByRole("button", { name: "View settings" }).click();
	await page.getByRole("menuitem", { name: "Owner" }).click();
	await expect(page).toHaveURL(/group=owner/);
	await expect(rows).toHaveCount(60, { timeout: 20_000 });
	expect(requests.filter((url) => url.includes("cursor="))).toEqual([]);
	expect(requests.some((url) => url.includes("group_by=owner"))).toBe(true);
});

// The walk stops at the first failed window (fixed here). Before the fix it
// retried the same cursor at 46 requests per 5 seconds.
test("a failed next window keeps the loaded rows and offers a retry", async ({ page }) => {
	await page.goto(`/files/f/${folder.name}?view=list&sort=title&dir=asc`);
	const rows = page.locator("[data-node]");
	await expect(rows).toHaveCount(60, { timeout: 20_000 });

	await page.route(/\/children\?.*cursor=/, (route) =>
		route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({ errors: [{ type: "InternalServerError", message: "Injected failure" }] }),
		}),
	);
	await rows.last().scrollIntoViewIfNeeded();

	await expect(page.getByRole("button", { name: "Retry loading more" })).toBeVisible();
	await expect(rows).toHaveCount(60);
	await expect(page.getByText("Could not refresh files")).toBeVisible();

	await page.unroute(/\/children\?.*cursor=/);
	await page.getByRole("button", { name: "Retry loading more" }).click();
	await expect(rows).toHaveCount(TOTAL, { timeout: 20_000 });
});
