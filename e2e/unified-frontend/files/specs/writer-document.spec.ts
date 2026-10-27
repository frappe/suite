import { readFileSync } from "node:fs";

import { type APIRequestContext, type Page, expect, test } from "@playwright/test";

import {
	adminApi,
	createDocument,
	createFolder,
	getNode,
	patchNode,
	purge,
	roots,
	runTag,
	type DriveNode,
} from "../../helpers/drive";

/** Stage 11: the Writer document on `/d/<id>`, through Drive and Suite routes only. */

test.describe.configure({ mode: "serial" });

let api: APIRequestContext;
let home: DriveNode;
let doc: DriveNode;

test.beforeEach(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	home = await createFolder(api, personal, runTag("w11-writer"));
	doc = await createDocument(api, home.name, "Writer journey", "Writer Document");
});

test.afterEach(async () => {
	await purge(api, home.name);
	await api.dispose();
});

/** Every request the page sends, and every error it throws. */
function watchPage(page: Page) {
	const requests: string[] = [];
	const errors: string[] = [];
	page.on("request", (request) => requests.push(`${request.method()} ${request.url()}`));
	page.on("pageerror", (error) => errors.push(error.message));
	return { requests, errors };
}

async function openDocument(page: Page) {
	await page.goto(`/d/${doc.name}`);
	const editor = page.getByRole("textbox", { name: "Document editor" });
	await expect(editor).toBeVisible();
	return editor;
}

async function storedHtml(): Promise<string> {
	const response = await api.get(
		`/api/v2/document/Writer Document/${encodeURIComponent(doc.content_docname!)}`,
	);
	expect(response.ok()).toBe(true);
	return ((await response.json()) as { data: { html: string | null } }).data.html ?? "";
}

test("types, saves and renames a Writer document without a legacy Drive call", async ({ page }) => {
	const seen = watchPage(page);
	const editor = await openDocument(page);

	await editor.click();
	await page.keyboard.type("Written in the unified shell");
	await page.keyboard.press("ControlOrMeta+s");
	await expect.poll(storedHtml).toContain("Written in the unified shell");

	const title = page.getByRole("textbox", { name: "Document title" });
	await title.fill("Renamed journey");
	await title.press("Enter");
	await expect.poll(async () => (await getNode(api, doc.name)).title).toBe("Renamed journey");

	expect(seen.requests.filter((line) => line.includes("suite.drive.api"))).toEqual([]);
	expect(seen.requests.some((line) => line.includes(`/api/suite/drive/nodes/${doc.name}`))).toBe(true);
	expect(seen.errors).toEqual([]);
});

test("Paint styles arms the format painter without an error", async ({ page }) => {
	const seen = watchPage(page);
	const editor = await openDocument(page);

	await editor.click();
	await page.keyboard.type("Copy this style");
	await page.keyboard.press("ControlOrMeta+a");
	const paint = page.getByRole("button", { name: "Paint styles" });
	await expect(paint).toHaveAttribute("aria-pressed", "false");
	await paint.click();

	await expect(paint).toHaveAttribute("aria-pressed", "true");
	expect(seen.errors).toEqual([]);
});

test("losing edit access freezes the editor and cancels the pending save", async ({ page }) => {
	const seen = watchPage(page);
	const editor = await openDocument(page);

	await page.route(/\/content\/[^/]+\/updates/, (route) => {
		if (route.request().method() === "POST") {
			return route.abort("failed");
		}

		return route.continue();
	});
	await editor.click();
	await page.keyboard.type("Typed before the document was trashed");
	await patchNode(api, doc.name, { state: "Trashed" });
	const trashedAt = seen.requests.length;
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));

	await expect(page.getByText("Trashed", { exact: true })).toBeVisible();
	await expect(editor).toHaveAttribute("contenteditable", "false");
	await page.waitForTimeout(6_500);

	// The room still sends its unsent work once, within a short bound; this test's route aborts it
	// Drive's refusal on a trashed node is covered by test_content.py (test_a_trashed_node_refuses_a_write)
	const writes = seen.requests
		.slice(trashedAt)
		.filter((line) => /\/method\/(save_doc|save_html|new_version|update_settings)/.test(line));
	expect(writes).toEqual([]);

	// The recovery copy has a way out: an HTML file of the unsaved work.
	const download = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download my changes" }).first().click();
	const file = await download;
	expect(file.suggestedFilename()).toBe("Writer journey (recovered).html");
	const saved = await file.path();
	expect(readFileSync(saved, "utf8")).toContain("Typed before the document was trashed");

	// A trashed document takes no new comments.
	await page.getByRole("button", { name: "Comments" }).click();
	await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Add a comment" })).toHaveCount(0);
	expect(seen.errors).toEqual([]);
});

test("a toolbar-only change is saved before leaving the document", async ({ page }) => {
	const editor = await openDocument(page);
	await editor.click();
	await page.getByRole("button", { name: /bullet list/i }).click();

	let asked = "";
	page.once("dialog", async (dialog) => {
		asked = dialog.message();
		await dialog.dismiss();
	});
	await page.getByRole("navigation", { name: "Areas" }).getByRole("link", { name: "Drive" }).click();

	// The room saves the change on the way out, so there's nothing to recover and no reason to ask
	await expect(page).not.toHaveURL(new RegExp(`/d/${doc.name}`));
	expect(asked).toBe("");
	await expect.poll(storedHtml).toContain("<ul");
});

test("adding a comment keeps the panel open and shows the comment", async ({ page }) => {
	await openDocument(page);
	await page.getByRole("button", { name: "Comments" }).click();
	await page.getByRole("button", { name: "Add a comment" }).click();
	await page.getByLabel("Add a comment", { exact: true }).fill("Looks good to me");
	await page.getByRole("button", { name: "Comment", exact: true }).click();

	await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();
	await expect(page.getByText("Looks good to me")).toBeVisible();
});
