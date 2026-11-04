import { type APIRequestContext, expect, test } from "@playwright/test";

import {
	adminApi,
	createDocument,
	createFolder,
	grantRole,
	patchNode,
	purge,
	roots,
	runTag,
	star,
	visit,
	type DriveNode,
} from "../../helpers/drive";
import { PERSON, ensurePerson, personContext } from "../../helpers/person";

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
	await page.goto("/drive/starred");
	await expect(page.getByText(starred.title, { exact: true })).toBeVisible();
	await expect(page.getByText(recent.title, { exact: true })).toHaveCount(0);
});

test("Recent lists a visited node", async ({ page }) => {
	await page.goto("/drive/recent");
	await expect(page.getByText(recent.title, { exact: true })).toBeVisible();
});

test("Trash lists the trashed node under My files", async ({ page }) => {
	await page.goto("/drive/trash");
	await expect(page.getByText(trashed.title, { exact: true })).toBeVisible();
});

test("a reader of a shared folder sees it in Shared with me and opens it read-only", async ({ browser, baseURL }) => {
	const shared = await createFolder(api, home.name, runTag("w4-shared"));
	const inside = await createDocument(api, shared.name, runTag("w4-inside"), "Writer Document");
	ensurePerson();
	await grantRole(api, shared.name, PERSON, 10);
	const context = await personContext(browser, baseURL!);
	const page = await context.newPage();

	await page.goto("/drive/shared-with-me");
	await page.getByText(shared.title, { exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/drive/f/${shared.name}`));
	const row = page.getByText(inside.title, { exact: true });
	await expect(row).toBeVisible();
	await expect(page.getByRole("button", { name: "New", exact: true })).toHaveCount(0);

	await row.click({ modifiers: ["ControlOrMeta"] });
	await expect(page.getByRole("button", { name: "Move", exact: true })).toBeDisabled();
	await expect(page.getByRole("button", { name: "Move to trash" })).toBeDisabled();
	await context.close();
});

test("a saved view drops sort and group keys it cannot honor", async ({ page }) => {
	await page.goto("/drive/starred?sort=modified&dir=desc&group=type");
	await expect(page).toHaveURL(/\/drive\/starred$/);
});

test("saved views hide New because they have no destination", async ({ page }) => {
	await page.goto("/drive/starred");
	await expect(page.getByText(starred.title, { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "New", exact: true })).toHaveCount(0);

	await page.goto(`/drive/f/${home.name}`);
	await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();
});

test("the trash bulk bar offers Restore and Delete forever only", async ({ page }) => {
	await page.goto("/drive/trash");
	const row = page.getByText(trashed.title, { exact: true });
	await expect(row).toBeVisible();
	await row.click({ modifiers: ["ControlOrMeta"] });

	await expect(page.getByRole("button", { name: "Restore" })).toBeEnabled();
	await expect(page.getByRole("button", { name: "Delete forever" })).toBeEnabled();
	await expect(page.getByRole("button", { name: "Move to trash" })).toHaveCount(0);
});
