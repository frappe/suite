import { expect, test, type APIRequestContext } from "@playwright/test";

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
	await page.getByRole("menuitem", { name: item }).click();
}

test("New Folder creates a folder in the open destination", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list`);
	await useNewMenu(page, "Folder");

	const dialog = page.getByRole("dialog", { name: "New folder" });
	await dialog.getByRole("textbox").fill("made-in-the-browser");
	await dialog.getByRole("button", { name: "Create" }).click();

	await expect(page.getByText("made-in-the-browser", { exact: true })).toBeVisible();
	expect((await children(api, home.name)).rows.map((row) => row.title)).toContain("made-in-the-browser");
});

test("New Writer document creates the node and lands on /d/", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list`);
	await useNewMenu(page, "Document");

	const dialog = page.getByRole("dialog");
	await dialog.getByRole("textbox").fill("browser-writer");
	await dialog.getByRole("button", { name: "Create" }).click();

	await expect(page).toHaveURL(/\/d\/[a-z0-9]+\/browser-writer/);
	const created = (await children(api, home.name)).rows.find((row) => row.title === "browser-writer");
	expect(created?.content_doctype).toBe("Writer Document");
	expect(created?.content_docname).toBeTruthy();
});

// The menu label stays "Spreadsheet" and the registry sends the "Sheet"
// content doctype. Both were checked after commit d54f91803.
test("New Spreadsheet creates a Sheet and lands on /d/", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list`);
	await useNewMenu(page, "Spreadsheet");

	const dialog = page.getByRole("dialog");
	await dialog.getByRole("textbox").fill("browser-sheet");
	await dialog.getByRole("button", { name: "Create" }).click();

	await expect(page).toHaveURL(/\/d\/[a-z0-9]+\/browser-sheet/);
	const created = (await children(api, home.name)).rows.find((row) => row.title === "browser-sheet");
	expect(created?.content_doctype).toBe("Sheet");
});

test("New Presentation creates the node and lands on /d/", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list`);
	await useNewMenu(page, "Presentation");

	const dialog = page.getByRole("dialog");
	await dialog.getByRole("textbox").fill("browser-deck");
	await dialog.getByRole("button", { name: "Create" }).click();

	await expect(page).toHaveURL(/\/d\/[a-z0-9]+\/browser-deck/);
	const created = (await children(api, home.name)).rows.find((row) => row.title === "browser-deck");
	expect(created?.content_doctype).toBe("Presentation");
});

test("Upload files stays disabled until ticket 007", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list`);
	await page.getByRole("button", { name: "New", exact: true }).click();
	const upload = page.getByRole("menuitem", { name: "Upload files" });
	await expect(upload).toBeVisible();
	await expect(upload).toBeDisabled();
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
	await page.goto(`/files/f/${home.name}?view=list`);
	await page.getByText("outside-link", { exact: true }).click();

	const dialog = page.getByRole("dialog", { name: "Open external link?" });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText("https://frappe.io")).toBeVisible();
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(page).toHaveURL(new RegExp(`/files/f/${home.name}`));
});

// BUG: the Sheets surface mounts the legacy editor, which keeps its own header
// with a Share button, a ShareDialog and an avatar stack
// (apps/sheets/components/SheetEditor/index.vue:134,152-162,848). Ticket 008
// owns the one Drive share dialog, so this second control is a duplicate and it
// opens a dialog the new Files surface refuses to open.
test.fixme("a Sheets document carries no second share control", async ({ page }) => {
	const sheet = await createDocument(api, home.name, "header-sheet", "Sheet");
	await page.goto(`/d/${sheet.name}`);
	await expect(page.getByRole("button", { name: "File" })).toBeVisible({ timeout: 20_000 });
	await expect(page.getByRole("button", { name: /Share/ })).toHaveCount(0);
});
