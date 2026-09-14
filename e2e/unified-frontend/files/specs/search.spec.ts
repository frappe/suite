import { expect, test, type APIRequestContext } from "@playwright/test";

import { adminApi, createDocument, createFolder, purge, roots, runTag, type DriveNode } from "../../helpers/drive";

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
	await page.goto("/files");
	await page.getByRole("searchbox", { name: "Search files" }).fill(`${term}-report`);

	await expect(page).toHaveURL(new RegExp(`q=${term}-report`));
	await expect(page.getByText(`${term}-report`, { exact: true })).toHaveCount(2);
	await expect(page.getByText(`${term}-nested`, { exact: false }).first()).toBeVisible();
	await expect(page.getByText("Administrator", { exact: false }).first()).toBeVisible();
});

test("search asks for the breadcrumb expansion", async ({ page }) => {
	const requests: string[] = [];
	page.on("request", (request) => {
		if (/\/views\/search/.test(request.url())) requests.push(request.url());
	});
	await page.goto(`/files?q=${term}-report`);
	await expect(page.getByText(`${term}-report`, { exact: true }).first()).toBeVisible();

	expect(requests.length).toBeGreaterThan(0);
	expect(requests.every((url) => /expand=access(%2C|,)breadcrumbs/.test(url))).toBe(true);
});

test("clearing the term restores the listing at the current route", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?q=${term}-report`);
	await expect(page.getByText(`${term}-report`, { exact: true })).toHaveCount(2);

	await page.getByRole("searchbox", { name: "Search files" }).fill("");
	await expect(page).not.toHaveURL(/q=/);
	await expect(page.getByText(`${term}-nested`, { exact: true })).toBeVisible();
});

test("search hides New because it has no destination", async ({ page }) => {
	await page.goto(`/files/f/${home.name}`);
	await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();

	await page.getByRole("searchbox", { name: "Search files" }).fill(`${term}-report`);
	await expect(page).toHaveURL(/q=/);
	await expect(page.getByRole("button", { name: "New", exact: true })).toHaveCount(0);
});
