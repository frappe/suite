import { type APIRequestContext, type Page } from "@playwright/test";

import { expect, test } from "../../helpers/flips";

import {
	DRIVE,
	adminApi,
	children,
	createDocument,
	createFolder,
	purge,
	roots,
	runTag,
	uploadFile,
	visit,
	type DriveNode,
} from "../../helpers/drive";

/** Stage 11, Drive lane: templates, the Recent type filter, Download and no legacy calls on /d/. */

test.describe.configure({ mode: "serial" });

let api: APIRequestContext;
let home: DriveNode;

test.beforeEach(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	home = await createFolder(api, personal, runTag("uf11"));
});

test.afterEach(async () => {
	await purge(api, home.name);
	await api.dispose();
});

/** Every request path that reaches a legacy `suite.drive.api.*` method. */
function watchLegacyDriveCalls(page: Page): string[] {
	const calls: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("suite.drive.api.")) calls.push(new URL(request.url()).pathname);
	});
	return calls;
}

test("From template copies a template and lands on its /d/ route", async ({ page }) => {
	const templateTitle = runTag("tpl-sheet");
	const response = await api.post(`${DRIVE}/nodes`, {
		data: { parent: home.name, title: templateTitle, kind: "document", content_doctype: "Sheet", is_template: true },
	});
	expect(response.ok(), await response.text()).toBe(true);

	await page.goto(`/drive/f/${home.name}?view=list`);
	await page.getByRole("button", { name: "New", exact: true }).click();
	const entries = page.getByRole("menuitem");
	await expect(entries.last()).toHaveText(/From template/);
	await entries.last().click();

	const dialog = page.getByRole("dialog", { name: "New from template" });
	await dialog.getByRole("radio", { name: "Spreadsheet" }).click();
	await dialog.getByRole("option", { name: templateTitle }).click();
	await dialog.getByRole("textbox").fill("from-template-copy");
	await dialog.getByRole("button", { name: "Create" }).click();

	await expect(page).toHaveURL(/\/d\/[a-z0-9]+\/from-template-copy/);
	const copy = (await children(api, home.name)).rows.find((row) => row.title === "from-template-copy");
	expect(copy?.content_doctype).toBe("Sheet");
	expect(page.url()).toContain(`/d/${copy?.name}`);
});

test("Recent filters by document type and the filter clears", async ({ page }) => {
	const writer = await createDocument(api, home.name, runTag("recent-writer"), "Writer Document");
	const sheet = await createDocument(api, home.name, runTag("recent-sheet"), "Sheet");
	await visit(api, writer.name);
	await visit(api, sheet.name);

	await page.goto("/drive/recent?type=sheets&view=list");
	// Button names itself from its label; the x icon and the tooltip say it clears.
	const filter = page.getByRole("button", { name: "Type: Spreadsheet" });
	await expect(filter).toBeVisible();
	await expect(page.getByText(sheet.title, { exact: true })).toBeVisible();
	await expect(page.getByText(writer.title, { exact: true })).toHaveCount(0);

	await filter.click();
	await expect(page).not.toHaveURL(/type=/);
	await expect(filter).toHaveCount(0);
	await expect(page.getByText(sheet.title, { exact: true })).toBeVisible();
	await expect(page.getByText(writer.title, { exact: true })).toBeVisible();
});

test("an unknown Recent type drops out of the URL", async ({ page }) => {
	await page.goto("/drive/recent?type=nope&view=list");
	await expect(page).not.toHaveURL(/type=/);
	await expect(page.getByRole("button", { name: /^Type: / })).toHaveCount(0);
});

test("Download on a file preview links to the node content", async ({ page }) => {
	const file = await uploadFile(api, home.name, "archive.bin", Buffer.from("uf11-not-previewable"));
	await page.goto(`/d/${file.name}`);
	await expect(page.getByRole("heading", { name: "No preview" })).toBeVisible();
	const download = page.getByRole("link", { name: "Download" }).first();
	await expect(download).toHaveAttribute("href", new RegExp(`${DRIVE}/nodes/${file.name}/content`));
});

test("Writer, Sheets and file /d/ routes make no legacy Drive call", async ({ page }) => {
	const calls = watchLegacyDriveCalls(page);
	const writer = await createDocument(api, home.name, "legacy-free-writer", "Writer Document");
	const sheet = await createDocument(api, home.name, "legacy-free-sheet", "Sheet");
	const file = await uploadFile(api, home.name, "legacy-free.bin", Buffer.from("uf11"));

	await page.goto(`/d/${writer.name}`);
	await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 20_000 });
	await page.goto(`/d/${sheet.name}`);
	await expect(page.locator("canvas, table, [data-sheet]").first()).toBeVisible({ timeout: 20_000 });
	await page.goto(`/d/${file.name}`);
	await expect(page.getByRole("heading", { name: "No preview" })).toBeVisible();
	await page.waitForLoadState("networkidle");

	expect(calls).toEqual([]);
});

test("a Slides /d/ route makes no legacy Drive call", async ({ page }) => {
	const calls = watchLegacyDriveCalls(page);
	const deck = await createDocument(api, home.name, "legacy-free-deck", "Presentation");
	await page.goto(`/d/${deck.name}`);
	await expect(page).toHaveURL(new RegExp(`/d/${deck.name}/legacy-free-deck`));
	await page.waitForLoadState("networkidle");
	expect(calls).toEqual([]);
});
