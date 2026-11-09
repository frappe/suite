import { type APIRequestContext, expect, test } from "@playwright/test";

import {
	adminApi,
	children,
	createDocument,
	createFolder,
	createLink,
	purge,
	roots,
	runTag,
	uploadFile,
	type DriveNode,
} from "../../helpers/drive";

/** Tickets 006 and 009: New actions, node-kind routing and the document host. */

test.describe.configure({ mode: "serial" });

let api: APIRequestContext;
let home: DriveNode;

test.beforeEach(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	home = await createFolder(api, personal, runTag("w4-new"));
});

test.afterEach(async () => {
	await purge(api, home.name);
	await api.dispose();
});

async function useNewMenu(page: import("@playwright/test").Page, item: string) {
	await page.getByRole("button", { name: "New", exact: true }).click();
	await page.getByRole("menuitem", { name: item, exact: true }).click();
}

test("New Folder creates a folder in the open destination", async ({ page }) => {
	await page.goto(`/drive/f/${home.name}?view=list`);
	await page.getByRole("button", { name: "New", exact: true }).click();
	await page.locator('[data-slot="group"]', { hasText: "Create" }).getByRole("menuitem", { name: "Folder", exact: true }).click();

	const dialog = page.getByRole("dialog", { name: "New folder" });
	await dialog.getByRole("textbox").fill("made-in-the-browser");
	await dialog.getByRole("button", { name: "Create" }).click();

	await expect(page.getByText("made-in-the-browser", { exact: true })).toBeVisible();
	expect((await children(api, home.name)).rows.map((row) => row.title)).toContain("made-in-the-browser");
});

// A new document takes the default title and opens at once, with no name dialog.
test("New Writer document creates the node and lands on /d/", async ({ page }) => {
	await page.goto(`/drive/f/${home.name}?view=list`);
	await useNewMenu(page, "Document");

	await expect(page).toHaveURL(/\/d\/[a-z0-9]+\/untitled-document/);
	await expect(page.getByRole("dialog", { name: "New document" })).toHaveCount(0);
	const created = (await children(api, home.name)).rows.find((row) => row.title === "Untitled document");
	expect(created?.content_doctype).toBe("Writer Document");
	expect(created?.content_docname).toBeTruthy();
});

// The menu label stays "Spreadsheet" and the registry sends the "Sheet"
// content doctype. Both were checked after commit d54f91803.
test("New Spreadsheet creates a Sheet and lands on /d/", async ({ page }) => {
	await page.goto(`/drive/f/${home.name}?view=list`);
	await useNewMenu(page, "Spreadsheet");

	await expect(page).toHaveURL(/\/d\/[a-z0-9]+\/untitled-spreadsheet/);
	const created = (await children(api, home.name)).rows.find((row) => row.title === "Untitled spreadsheet");
	expect(created?.content_doctype).toBe("Sheet");
});

test("New Presentation creates the node and lands on /d/", async ({ page }) => {
	await page.goto(`/drive/f/${home.name}?view=list`);
	await useNewMenu(page, "Presentation");

	await expect(page).toHaveURL(/\/d\/[a-z0-9]+\/untitled-presentation/);
	const created = (await children(api, home.name)).rows.find((row) => row.title === "Untitled presentation");
	expect(created?.content_doctype).toBe("Presentation");
});

test("New ends with Upload files and Upload folder, so only Create says Folder", async ({ page }) => {
	await page.goto(`/drive/f/${home.name}?view=list`);
	await page.getByRole("button", { name: "New", exact: true }).click();
	const menu = page.getByRole("menu", { name: "New" });
	await expect(menu.getByRole("menuitem", { name: "Upload files" })).toBeVisible();
	// The items name the verb, so the Upload heading is not shown.
	await expect(menu.getByText("Upload", { exact: true })).toBeHidden();
	const labels = (await menu.getByRole("menuitem").allInnerTexts()).map((label) => label.trim());
	expect(labels[0]).toBe("Folder");
	expect(labels.filter((label) => label === "Folder")).toHaveLength(1);
	expect(labels.slice(-2)).toEqual(["Upload files", "Upload folder"]);
});

test("each registered document type opens its own surface", async ({ page }) => {
	const writer = await createDocument(api, home.name, "open-writer", "Writer Document");
	const sheet = await createDocument(api, home.name, "open-sheet", "Sheet");
	const deck = await createDocument(api, home.name, "open-deck", "Presentation");

	await page.goto(`/d/${writer.name}`);
	await expect(page).toHaveURL(new RegExp(`/d/${writer.name}/open-writer`));
	await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 20_000 });

	await page.goto(`/d/${sheet.name}`);
	await expect(page).toHaveURL(new RegExp(`/d/${sheet.name}/open-sheet`));
	await expect(page.getByText("No preview")).toHaveCount(0);
	await expect(page.locator("canvas, table, [data-sheet]").first()).toBeVisible({ timeout: 20_000 });

	await page.goto(`/d/${deck.name}`);
	await expect(page).toHaveURL(new RegExp(`/d/${deck.name}/open-deck`));
	await expect(page.getByText("No preview")).toHaveCount(0);
});

test("an unsupported file keeps the /d/ route and offers Download", async ({ page }) => {
	const file = await uploadFile(api, home.name, "archive.bin", Buffer.from("PKw4-not-previewable"));

	await page.goto(`/d/${file.name}`);
	await expect(page.getByRole("heading", { name: "No preview" })).toBeVisible();
	await expect(page.getByRole("link", { name: "Download" }).first()).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`/d/${file.name}`));
});

test("a link row confirms its origin before opening a tab", async ({ page }) => {
	await createLink(api, home.name, "outside-link", "https://frappe.io/about");
	await page.goto(`/drive/f/${home.name}?view=list`);
	await page.getByText("outside-link", { exact: true }).click();

	const dialog = page.getByRole("dialog", { name: "Open external link?" });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText("https://frappe.io")).toBeVisible();
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(page).toHaveURL(new RegExp(`/drive/f/${home.name}`));
});

// On /d/ the legacy Sheets editor drops its own Share and ShareDialog
// (`embedded`), so the one Drive share control is the only one (ticket 008).
test("a Sheets document carries one share control, the Drive one", async ({ page }) => {
	const sheet = await createDocument(api, home.name, "header-sheet", "Sheet");
	await page.goto(`/d/${sheet.name}`);
	await expect(page.getByRole("menuitem", { name: "File" })).toBeVisible({ timeout: 20_000 });
	await expect(page.getByRole("button", { name: /Share/ })).toHaveCount(1);
	await page.getByRole("button", { name: /Share/ }).click();
	const dialog = page.getByRole("dialog", { name: "Share", exact: true });
	await expect(dialog.getByText(sheet.title, { exact: true })).toBeVisible();
	await expect(dialog.getByRole("region", { name: "Who has access" })).toBeVisible();
});
