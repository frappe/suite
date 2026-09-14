import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
	adminApi,
	createDocument,
	createFolder,
	getNode,
	purge,
	roots,
	runTag,
	visit,
	type DriveNode,
} from "../../helpers/drive";
import { failRequest } from "../../helpers/shell";

/** Tickets 004 and 005: the Home surface, its two sections and the bell. */

test.describe.configure({ mode: "serial" });

let api: APIRequestContext;
let home: DriveNode;
let recent: DriveNode;

/**
 * Calendar reads go to JMAP. Administrator has no mail account on this site, so
 * `GET /api/suite/calendar/events` answers 200 with an empty list. The rows
 * below are a stub of that same answer, used only to check the rendering.
 */
const EVENT_FIXTURE = [
	{
		id: "w4-event-1",
		uid: "w4-event-1",
		title: "W4 standup",
		start: isoIn(2),
		duration: "PT30M",
		status: "confirmed",
		conferencing: { meeting_id: "w4meetcode", url: "https://example.invalid/w4meetcode" },
	},
	{
		id: "w4-event-2",
		uid: "w4-event-2",
		title: "W4 review",
		start: isoIn(26),
		duration: "PT60M",
		status: "confirmed",
	},
];

function isoIn(hours: number): string {
	return new Date(Date.now() + hours * 3_600_000).toISOString().replace(/\.\d+Z$/, "Z");
}

async function stubEvents(page: Page, rows: unknown[] = EVENT_FIXTURE) {
	await page.route("**/api/suite/calendar/events*", (route) =>
		route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: rows }) }),
	);
}

test.beforeAll(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	home = await createFolder(api, personal, runTag("w4-home"));
	recent = await createDocument(api, home.name, "home-recent-doc", "Writer Document");
	await visit(api, recent.name);
});

test.afterAll(async () => {
	await purge(api, home.name);
	await api.dispose();
});

test("Recent lists the documents the account opened", async ({ page }) => {
	await page.goto("/home");
	await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
	const tiles = page.getByTestId("recent-rows");
	await expect(tiles.getByText("home-recent-doc")).toBeVisible();

	await tiles.getByText("home-recent-doc").click();
	await expect(page).toHaveURL(new RegExp(`/d/${recent.name}/home-recent-doc`));
});

test("Upcoming groups the events and offers Join for a conferencing one", async ({ page }) => {
	await stubEvents(page);
	await page.goto("/home");
	await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();

	const rows = page.getByTestId("upcoming-rows");
	await expect(rows.getByText("W4 standup")).toBeVisible();
	await expect(rows.getByText("W4 review")).toBeVisible();
	await expect(rows.getByText("Today")).toBeVisible();
	await expect(rows.getByRole("link", { name: "Join" })).toHaveAttribute("href", "/meet/w4meetcode");
});

test("Upcoming reports an empty calendar when the account has no events", async ({ page }) => {
	await page.goto("/home");
	await expect(page.getByText("Nothing scheduled")).toBeVisible();
	await expect(page.getByTestId("recent-rows")).toBeVisible();
});

test("a failing Recent read leaves Upcoming intact", async ({ page }) => {
	await stubEvents(page);
	await failRequest(page, "**/api/suite/drive/views/recents*");
	await page.goto("/home");

	await expect(page.getByTestId("recent-error")).toBeVisible();
	await expect(page.getByTestId("recent-error").getByRole("button", { name: "Retry" })).toBeVisible();
	await expect(page.getByTestId("upcoming-rows").getByText("W4 standup")).toBeVisible();
});

test("a failing Upcoming read leaves Recent intact", async ({ page }) => {
	await failRequest(page, "**/api/suite/calendar/events*");
	await page.goto("/home");

	await expect(page.getByTestId("upcoming-error")).toBeVisible();
	await expect(page.getByTestId("upcoming-error").getByRole("button", { name: "Retry" })).toBeVisible();
	await expect(page.getByTestId("recent-rows").getByText("home-recent-doc")).toBeVisible();
});

test("New Document creates a Writer node in the Personal Root and opens it", async ({ page }) => {
	await page.goto("/home");
	await page.getByRole("button", { name: "New", exact: true }).click();
	await page.getByRole("menuitem", { name: "Document" }).click();

	await expect(page).toHaveURL(/\/d\/[a-z0-9]+/);
	const node = page.url().split("/d/")[1]!.split("/")[0]!;
	const created = await getNode(api, node);
	expect(created.content_doctype).toBe("Writer Document");
	expect(created.parent).toBe((await roots(api)).personal.node);
	await purge(api, node);
});

test("New Spreadsheet creates a Sheet node and opens it", async ({ page }) => {
	await page.goto("/home");
	await page.getByRole("button", { name: "New", exact: true }).click();
	await page.getByRole("menuitem", { name: "Spreadsheet" }).click();

	await expect(page).toHaveURL(/\/d\/[a-z0-9]+/);
	const node = page.url().split("/d/")[1]!.split("/")[0]!;
	expect((await getNode(api, node)).content_doctype).toBe("Sheet");
	await purge(api, node);
});

test("New Presentation creates a Presentation node and opens it", async ({ page }) => {
	await page.goto("/home");
	await page.getByRole("button", { name: "New", exact: true }).click();
	await page.getByRole("menuitem", { name: "Presentation" }).click();

	await expect(page).toHaveURL(/\/d\/[a-z0-9]+/);
	const node = page.url().split("/d/")[1]!.split("/")[0]!;
	expect((await getNode(api, node)).content_doctype).toBe("Presentation");
	await purge(api, node);
});
