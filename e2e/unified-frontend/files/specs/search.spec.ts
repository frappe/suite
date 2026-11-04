import { type APIRequestContext, expect, test } from "@playwright/test";

import { adminApi, children, createDocument, createFolder, purge, roots, runTag, type DriveNode } from "../../helpers/drive";

/** Ticket 006: tree-wide search with a path beneath every result. */

test.describe.configure({ mode: "serial" });

let api: APIRequestContext;
let home: DriveNode;
let nested: DriveNode;
let term: string;

test.beforeAll(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	term = runTag("w4search");
	home = await createFolder(api, personal, `${term}-home`);
	nested = await createFolder(api, home.name, `${term}-nested`);
	await createDocument(api, home.name, `${term}-report`, "Writer Document");
	await createDocument(api, nested.name, `${term}-report`, "Writer Document");
});

test.afterAll(async () => {
	await purge(api, home.name);
	await api.dispose();
});

test("the search field finds nodes across the tree and shows their path", async ({ page }) => {
	await page.goto("/drive?view=list");
	await page.getByRole("searchbox", { name: "Search all files" }).fill(`${term}-report`);

	await expect(page).toHaveURL(new RegExp(`q=${term}-report`));
	await expect(page.getByText(`${term}-report`, { exact: true })).toHaveCount(2);
	// The path starts at the caller's root, named by its place.
	await expect(page.getByText(`My files / ${term}-home`, { exact: true })).toBeVisible();
	await expect(page.getByText(`My files / ${term}-home / ${term}-nested`, { exact: true })).toBeVisible();
});

test("clearing the term restores the listing at the current route", async ({ page }) => {
	await page.goto(`/drive/f/${home.name}?q=${term}-report`);
	await expect(page.getByText(`${term}-report`, { exact: true })).toHaveCount(2);

	await page.getByRole("searchbox", { name: "Search all files" }).fill("");
	await expect(page).not.toHaveURL(/q=/);
	await expect(page.getByText(`${term}-nested`, { exact: true })).toBeVisible();
});

test("New stays during a search and adds to the folder the search started from", async ({ page }) => {
	await page.goto(`/drive/f/${home.name}`);
	await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();

	await page.getByRole("searchbox", { name: "Search all files" }).fill(`${term}-report`);
	await expect(page).toHaveURL(/q=/);
	await page.getByRole("button", { name: "New", exact: true }).click();
	await page.getByRole("menuitem", { name: "Folder", exact: true }).first().click();
	const dialog = page.getByRole("dialog", { name: "New folder" });
	await dialog.getByRole("textbox").fill(`${term}-made-while-searching`);
	await dialog.getByRole("button", { name: "Create" }).click();
	await expect(dialog).toBeHidden();

	await expect
		.poll(async () => (await children(api, home.name)).rows.map((row) => row.title))
		.toContain(`${term}-made-while-searching`);
});
