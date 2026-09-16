import { expect, test, type APIRequestContext } from "@playwright/test";

import { adminApi, createFolder, purge, roots, runTag, type DriveNode } from "../../helpers/drive";

/** Ticket 006: folder listing, breadcrumbs and the decorative slug. */

const PARENT_TITLE = "W4 Fôlder Journey";
const CHILD_TITLE = "W4 Child Folder";
const PARENT_SLUG = "w4-fôlder-journey";

let api: APIRequestContext;
let parent: DriveNode;
let child: DriveNode;
let personal: string;

test.beforeAll(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	personal = (await roots(api)).personal.node;
	parent = await createFolder(api, personal, `${PARENT_TITLE} ${runTag("")}`.trim());
	child = await createFolder(api, parent.name, CHILD_TITLE);
});

test.afterAll(async () => {
	await purge(api, parent.name);
	await api.dispose();
});

function slugOf(title: string): string {
	return title
		.normalize("NFKC")
		.toLocaleLowerCase()
		.replace(/[^\p{Letter}\p{Mark}\p{Number}]+/gu, "-")
		.replace(/^-+|-+$/g, "");
}

test("opening a folder row navigates to its canonical route", async ({ page }) => {
	await page.goto("/files");
	await page.getByText(parent.title, { exact: true }).click();

	await expect(page).toHaveURL(new RegExp(`/files/f/${parent.name}/${encodeURI(slugOf(parent.title))}`));
	await expect(page.getByText(CHILD_TITLE, { exact: true })).toBeVisible();
	expect(slugOf(parent.title)).toContain(PARENT_SLUG);
});

test("a missing slug is replaced without a new history entry", async ({ page }) => {
	await page.goto("/files");
	await page.goto(`/files/f/${parent.name}`);
	await expect(page).toHaveURL(new RegExp(`/files/f/${parent.name}/`));

	await page.goBack();
	await expect(page).toHaveURL(/\/files$/);
});

test("a stale slug is corrected to the current title", async ({ page }) => {
	await page.goto(`/files/f/${parent.name}/an-old-title`);
	await expect(page).toHaveURL(new RegExp(`/files/f/${parent.name}/${encodeURI(slugOf(parent.title))}$`));
});

test("breadcrumbs describe the open folder and navigate back", async ({ page }) => {
	await page.goto(`/files/f/${child.name}`);
	const crumbs = page.locator("header").first();
	await expect(crumbs.getByText("Administrator", { exact: true })).toBeVisible();
	await expect(crumbs.getByText(parent.title, { exact: true })).toBeVisible();
	await expect(crumbs.getByText(CHILD_TITLE, { exact: true })).toBeVisible();

	await crumbs.getByText(parent.title, { exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/files/f/${parent.name}/`));
});

test("folder navigation carries the presentation query forward", async ({ page }) => {
	await page.goto(`/files/f/${parent.name}?view=list&sort=modified&dir=desc`);
	await page.getByText(CHILD_TITLE, { exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/files/f/${child.name}`));
	await expect(page).toHaveURL(/sort=modified/);
	await expect(page).toHaveURL(/dir=desc/);
});
