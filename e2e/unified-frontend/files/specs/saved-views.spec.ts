import { expect, test, type APIRequestContext } from "@playwright/test";

import {
	adminApi,
	createDocument,
	createFolder,
	patchNode,
	purge,
	roots,
	runTag,
	star,
	visit,
	type DriveNode,
} from "../../helpers/drive";

/** Ticket 006: the saved views and the presentation keys they refuse. */

let api: APIRequestContext;
let home: DriveNode;
let starred: DriveNode;
let recent: DriveNode;
let trashed: DriveNode;

test.beforeAll(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	home = await createFolder(api, personal, runTag("w4-views"));
	starred = await createDocument(api, home.name, runTag("w4-starred"), "Writer Document");
	recent = await createDocument(api, home.name, runTag("w4-recent"), "Writer Document");
	trashed = await createDocument(api, home.name, runTag("w4-trashed"), "Writer Document");
	await star(api, starred.name);
	await visit(api, recent.name);
	await patchNode(api, trashed.name, { state: "Trashed" });
});

test.afterAll(async () => {
	await purge(api, home.name);
	await api.dispose();
});

test("Starred lists the starred node", async ({ page }) => {
	await page.goto("/files/starred");
	await expect(page.getByText(starred.title, { exact: true })).toBeVisible();
	await expect(page.getByText(recent.title, { exact: true })).toHaveCount(0);
});

test("Recent lists a visited node", async ({ page }) => {
	await page.goto("/files/recent");
	await expect(page.getByText(recent.title, { exact: true })).toBeVisible();
});

test("Trash lists the trashed node under My files", async ({ page }) => {
	await page.goto("/files/trash");
	await expect(page.getByText(trashed.title, { exact: true })).toBeVisible();
});

test("Shared with me renders its own empty or listed state", async ({ page }) => {
	await page.goto("/files/shared-with-me");
	await expect(page).toHaveTitle("Shared with me");
	await expect(page.getByRole("searchbox", { name: "Search files" })).toBeVisible();
});

test("a saved view drops sort and group keys it cannot honor", async ({ page }) => {
	await page.goto("/files/starred?sort=modified&dir=desc&group=type");
	await expect(page).toHaveURL(/\/files\/starred$/);
});

test("saved views hide New because they have no destination", async ({ page }) => {
	await page.goto("/files/starred");
	await expect(page.getByText(starred.title, { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "New", exact: true })).toHaveCount(0);

	await page.goto(`/files/f/${home.name}`);
	await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();
});

test("the trash bulk bar offers only the ticket 007 placeholders", async ({ page }) => {
	await page.goto("/files/trash");
	const row = page.getByText(trashed.title, { exact: true });
	await expect(row).toBeVisible();
	await row.click({ modifiers: ["ControlOrMeta"] });

	await expect(page.getByRole("button", { name: "Restore" })).toBeDisabled();
	await expect(page.getByRole("button", { name: "Delete forever" })).toBeDisabled();
	await expect(page.getByRole("button", { name: "Move to trash" })).toHaveCount(0);
});
