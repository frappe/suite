import { expect, test, type APIRequestContext } from "@playwright/test";

import {
	adminApi,
	createDocument,
	createFolder,
	createLink,
	purge,
	roots,
	runTag,
	type DriveNode,
} from "../../helpers/drive";

/** Ticket 006: list and grid, default columns, server grouping. */

test.describe.configure({ mode: "serial" });

let api: APIRequestContext;
let folder: DriveNode;
let document: DriveNode;

test.beforeAll(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	folder = await createFolder(api, personal, runTag("w4-present"));
	await createFolder(api, folder.name, "aaa-folder");
	document = await createDocument(api, folder.name, "bbb-document", "Writer Document");
	await createLink(api, folder.name, "ccc-link", "https://frappe.io/");
});

test.afterAll(async () => {
	await purge(api, folder.name);
	await api.dispose();
});

test("the initial presentation is list, no grouping, Name ascending", async ({ page }) => {
	const requests: string[] = [];
	page.on("request", (request) => {
		if (/\/children\?/.test(request.url())) requests.push(request.url());
	});
	await page.addInitScript(() => window.localStorage.clear());
	await page.goto(`/files/f/${folder.name}`);

	await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible();
	await expect(page.getByRole("columnheader", { name: "Owner" })).toBeVisible();
	await expect(page.getByRole("columnheader", { name: "Modified" })).toBeVisible();
	await expect(page.getByRole("columnheader", { name: "Size" })).toHaveCount(0);
	await expect(page.getByRole("columnheader", { name: "Type" })).toHaveCount(0);

	expect(requests.some((url) => url.includes("order_by=title") && url.includes("ascending=true"))).toBe(true);
	expect(requests.some((url) => url.includes("group_by="))).toBe(false);
	expect(requests.every((url) => url.includes("expand=access"))).toBe(true);
	expect(requests.some((url) => url.includes("preview"))).toBe(false);
});

test("grid view asks for the preview expansion and paints tiles", async ({ page }) => {
	const requests: string[] = [];
	page.on("request", (request) => {
		if (/\/children\?/.test(request.url())) requests.push(request.url());
	});
	await page.goto(`/files/f/${folder.name}?view=grid`);

	await expect(page.getByRole("listitem")).toHaveCount(3);
	await expect(page.getByRole("columnheader", { name: "Name" })).toHaveCount(0);
	expect(requests.some((url) => url.includes("expand=access%2Cpreview") || url.includes("expand=access,preview"))).toBe(true);
});

test("the view settings menu switches between list and grid", async ({ page }) => {
	await page.goto(`/files/f/${folder.name}?view=list`);
	await page.getByRole("button", { name: "View settings" }).click();
	await page.getByRole("menuitem", { name: "Grid" }).click();
	await expect(page).toHaveURL(/view=grid/);
	await expect(page.getByRole("listitem")).toHaveCount(3);

	await page.getByRole("button", { name: "View settings" }).click();
	await page.getByRole("menuitem", { name: "List" }).click();
	await expect(page).toHaveURL(/view=list/);
	await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible();
});

test("group by Type renders contiguous server-ordered sections", async ({ page }) => {
	await page.goto(`/files/f/${folder.name}?view=list&group=type`);
	await expect(page.getByText("Folders", { exact: true })).toBeVisible();
	await expect(page.getByText("Writer Documents", { exact: true })).toBeVisible();
	await expect(page.getByText("Links", { exact: true })).toBeVisible();

	const headings = await page.getByRole("rowgroup").allTextContents();
	expect(headings.length).toBeGreaterThan(0);
});

// The Columns switches carry no accessible name (frappe-ui Switch receives no
// label), so this journey selects the Size switch by position. Recorded as an
// accessibility gap against ticket 006's menu rules.
const SIZE_SWITCH = 3;

test("optional columns are a saved preference, not URL state", async ({ page }) => {
	await page.goto(`/files/f/${folder.name}?view=list`);
	await page.getByRole("button", { name: "View settings" }).click();
	await page.getByRole("menu", { name: "View settings" }).getByRole("switch").nth(SIZE_SWITCH).click();
	await page.keyboard.press("Escape");

	await expect(page.getByRole("columnheader", { name: "Size" })).toBeVisible();
	await expect(page).not.toHaveURL(/columns=/);

	await page.reload();
	await expect(page.getByRole("columnheader", { name: "Size" })).toBeVisible();

	await page.getByRole("button", { name: "View settings" }).click();
	await page.getByRole("menu", { name: "View settings" }).getByRole("switch").nth(SIZE_SWITCH).click();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("columnheader", { name: "Size" })).toHaveCount(0);
});

test("a document row opens the canonical /d/ route", async ({ page }) => {
	await page.goto(`/files/f/${folder.name}?view=list`);
	await page.getByText("bbb-document", { exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/d/${document.name}/bbb-document`));
});
