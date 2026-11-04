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
 * Calendar reads go to JMAP. Administrator has a mail account on this site
 * (`administrator@suite.test` on the local Stalwart server), and its calendar
 * holds real events. The rows below stub `GET /api/suite/calendar/events`, so
 * each journey checks the rendering against a known answer.
 */
const EVENT_FIXTURE = [
	calendarEvent({
		id: "w4-event-1",
		title: "W4 standup",
		start: isoIn(2),
		duration: "PT30M",
		conferencing: { meeting_id: "w4meetcode", url: "https://example.invalid/w4meetcode" },
	}),
	calendarEvent({
		id: "w4-event-2",
		title: "W4 review",
		start: tomorrowAtNoon(),
		duration: "PT60M",
	}),
];

/** A whole `events_get` row: the client validates every field the server sends. */
function calendarEvent(fields: { id: string; title: string; start: string; duration: string; conferencing?: unknown }) {
	const now = new Date().toISOString();
	return {
		name: fields.id,
		account: "administrator@suite.test",
		uid: fields.id,
		time_zone: "UTC",
		status: "confirmed",
		description: "",
		show_without_time: 0,
		recurrence_id: null,
		recurrence_rule: null,
		organizer: "administrator@suite.test",
		calendars: [],
		created: null,
		draft: 0,
		recurrence_id_time_zone: "",
		privacy: "public",
		free_busy_status: "busy",
		locations: [],
		alerts: [],
		use_default_alerts: 0,
		created_utc: now,
		updated_utc: now,
		origin: true,
		may_invite_self: 0,
		may_invite_others: 0,
		hide_attendees: 0,
		creation: now,
		modified: now,
		sequence: 0,
		links: [],
		participants: [],
		conferencing: null,
		...fields,
	};
}

/** Tomorrow at noon local time: Upcoming covers today and tomorrow only, so `now + 26h` can fall past it. */
function tomorrowAtNoon(): string {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12).toISOString().replace(/\.\d+Z$/, "Z");
}

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

test("Recent's View all opens the Recent view", async ({ page }) => {
	await page.goto("/home");
	await page.locator('section[aria-labelledby="home-recent-heading"]').getByText("View all").click();
	await expect(page).toHaveURL(/\/drive\/recent$/);
});

test("Upcoming lists today's and tomorrow's events and offers Join for a conferencing one", async ({ page }) => {
	await stubEvents(page);
	await page.goto("/home");
	await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();

	const rows = page.getByTestId("upcoming-rows");
	const standup = rows.getByRole("link", { name: "Join W4 standup" });
	const review = rows.getByRole("link", { name: "Open W4 review" });
	await expect(standup).toHaveAttribute("href", "/meet/w4meetcode");
	await expect(review).toHaveAttribute("href", "/calendar");
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	await expect(review).toContainText(String(tomorrow.getDate()));
});

test("Upcoming reports an empty calendar when the account has no events", async ({ page }) => {
	await stubEvents(page, []);
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
	expect(created.parent_node).toBe((await roots(api)).personal.node);
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
