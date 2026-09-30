import { readFileSync } from "node:fs";

import { type APIRequestContext, type Page } from "@playwright/test";

import { expect, test } from "../../helpers/flips";

import {
	adminApi,
	createDocument,
	createFolder,
	DRIVE,
	getNode,
	patchNode,
	purge,
	roots,
	runTag,
	type DriveNode,
} from "../../helpers/drive";

/** Stage 11: the Sheets document on `/d/<id>`, through Drive and Suite routes only. */

test.describe.configure({ mode: "serial" });

let api: APIRequestContext;
let home: DriveNode;
let sheet: DriveNode;

test.beforeEach(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	home = await createFolder(api, personal, runTag("w11-sheets"));
	sheet = await createDocument(api, home.name, "Sheets journey", "Sheet");
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

async function openSheet(page: Page) {
	await page.goto(`/d/${sheet.name}`);
	const title = page.getByRole("textbox", { name: "Spreadsheet title" });
	await expect(title).toBeVisible({ timeout: 20_000 });
	await expect(page.locator(".sn-canvas-loading")).toHaveCount(0, { timeout: 20_000 });
	return title;
}

type Thread = { anchor: string; comments: Array<{ content: string }> };

async function threads(): Promise<Thread[]> {
	const response = await api.get(`${DRIVE}/nodes/${sheet.name}/threads`);
	expect(response.ok()).toBe(true);
	const body = (await response.json()) as { data?: { threads: Thread[] }; message?: { threads: Thread[] } };
	return (body.data ?? body.message)!.threads;
}

test("renames, comments and opens versions without a legacy Drive call", async ({ page }) => {
	const seen = watchPage(page);
	const title = await openSheet(page);

	await title.fill("Renamed sheet");
	await title.press("Enter");
	await expect.poll(async () => (await getNode(api, sheet.name)).title).toBe("Renamed sheet");

	await page.getByRole("button", { name: "Comments" }).click();
	const comments = page.getByRole("complementary", { name: "Comments" });
	await comments.getByRole("textbox", { name: "New comment" }).fill("Check the A1 total");
	await comments.getByRole("button", { name: "Comment", exact: true }).click();
	await expect(comments.getByText("Check the A1 total")).toBeVisible();
	await expect(comments.getByRole("button", { name: "Sheet1 · A1" })).toBeVisible();
	expect(await threads()).toMatchObject([
		{ anchor: "sheets:cell:A1!Sheet1", comments: [{ content: "Check the A1 total" }] },
	]);

	// An edit still waiting for its autosave goes into the version first.
	await page.locator("canvas").first().click({ position: { x: 80, y: 40 } });
	await page.keyboard.type("777");
	await page.keyboard.press("Enter");
	await page.getByRole("button", { name: "Versions" }).click();
	const versions = page.getByRole("complementary", { name: "Versions" });
	await expect(versions.getByRole("heading", { name: "Versions" })).toBeVisible();
	await expect(comments).toHaveCount(0);
	await versions.getByRole("button", { name: "Save version" }).click();
	const prompt = page.getByRole("dialog", { name: "Save a version" });
	await prompt.getByRole("textbox").fill("Journey version");
	await prompt.getByRole("button", { name: "Save" }).click();
	await expect(versions.getByText("Journey version")).toBeVisible();
	const order = seen.requests.filter((line) => line.includes("save_sheet") || line.includes(`/nodes/${sheet.name}/versions`) && line.startsWith("POST"));
	expect(order[0]).toContain("save_sheet");
	expect(order.at(-1)).toContain("/versions");

	await versions.getByRole("listitem").filter({ hasText: "Journey version" }).getByRole("button", { name: "Restore" }).click();
	await page.getByRole("dialog", { name: "Restore this version?" }).getByRole("button", { name: "Restore" }).click();
	await expect(page.getByText("Version restored")).toBeVisible();
	// Restore keeps the state it replaced as a new automatic version first.
	await expect(versions.getByText("Automatic version")).toBeVisible();
	await expect(page.getByRole("textbox", { name: "Spreadsheet title" })).toHaveValue("Renamed sheet");

	// Share opens the Drive share dialog for a manager (stage 9).
	await expect(page.getByRole("button", { name: "Share" })).toBeEnabled();
	expect(seen.requests.filter((line) => line.includes("suite.drive.api"))).toEqual([]);
	expect(seen.requests.some((line) => line.includes(`POST`) && line.includes(`/api/suite/drive/nodes/${sheet.name}/visit`))).toBe(true);
	expect(seen.errors).toEqual([]);
});

test("losing edit access freezes the sheet, cancels the pending save and offers the changes", async ({ page }) => {
	const seen = watchPage(page);
	await openSheet(page);

	await page.locator("canvas").first().click({ position: { x: 80, y: 40 } });
	await page.keyboard.type("4242");
	await page.keyboard.press("Enter");
	// Text still in the cell editor is part of the recovery copy too.
	await page.keyboard.type("5150");
	// The autosave waits two seconds. Trash the sheet before it fires.
	await patchNode(api, sheet.name, { state: "Trashed" });
	const trashedAt = seen.requests.length;
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));

	await expect(page.getByText("Trashed", { exact: true })).toBeVisible();
	await expect(page.getByText("View only", { exact: true })).toBeVisible();
	await page.waitForTimeout(3_000);

	const saves = seen.requests.slice(trashedAt).filter((line) => line.includes("suite.sheets.api.save_sheet"));
	expect(saves).toEqual([]);
	const recovery = () =>
		page.evaluate((node) => localStorage.getItem(`suite:sheets-recovery:${node}`), sheet.name);
	expect(await recovery()).toContain("4242");
	expect(await recovery()).toContain("5150");

	const download = page.waitForEvent("download");
	await page.locator(".sn-topbar").getByRole("button", { name: "Download my changes" }).click();
	const file = await download;
	expect(file.suggestedFilename()).toBe("Sheets journey (recovered).xlsx");
	// An .xlsx file is a zip archive. Its cells are checked in `recovery.test.ts`.
	expect(readFileSync((await file.path())!).subarray(0, 2).toString()).toBe("PK");
	await expect(page.locator(".sn-topbar").getByRole("button", { name: "Download my changes" })).toHaveCount(0);
	expect(await recovery()).toBeNull();
	expect(seen.requests.filter((line) => line.includes("suite.drive.api"))).toEqual([]);
});

/** A signed-in person with no grant of their own. The spec makes them on first use. */
const LINK_ONLY = { email: "sheets-link-e2e@example.com", password: "Sheets-Link-e2e-7731" };

async function ensureLinkOnlyUser(): Promise<void> {
	const path = `/api/resource/User/${encodeURIComponent(LINK_ONLY.email)}`;
	if ((await api.get(path)).status() === 404) {
		const created = await api.post("/api/resource/User", {
			data: { email: LINK_ONLY.email, first_name: "Link only", send_welcome_email: 0 },
		});
		expect(created.ok()).toBe(true);
	}
	const updated = await api.put(path, { data: { new_password: LINK_ONLY.password } });
	expect(updated.ok()).toBe(true);
}

// A guest takes the same path, but the shell still shows "Guest access is not
// ready" on `/d/` for a guest (ticket 011). So this person is signed in and
// reaches the sheet through the link alone.
test("a person who holds only an edit link opens and saves the sheet", async ({ browser, baseURL }) => {
	await ensureLinkOnlyUser();
	const response = await api.put(`${DRIVE}/nodes/${sheet.name}/grants/$LINK`, { data: { role: 40 } });
	expect(response.ok()).toBe(true);
	const body = (await response.json()) as { data?: { grant: { principal: string } }; message?: { grant: { principal: string } } };
	const code = (body.data ?? body.message)!.grant.principal.replace("$LINK:", "");

	const visitor = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
	const login = await visitor.request.post("/api/method/login", { form: { usr: LINK_ONLY.email, pwd: LINK_ONLY.password } });
	expect(login.ok()).toBe(true);
	await visitor.addInitScript(
		([node, link]) => {
			const links = { [link]: { target: node, lastUsed: Date.now() } };
			localStorage.setItem("suite:drive-links", JSON.stringify({ links, tags: [] }));
		},
		[sheet.name, code] as const,
	);
	const page = await visitor.newPage();
	const seen = watchPage(page);
	await openSheet(page);
	await expect(page.getByText("View only", { exact: true })).toHaveCount(0);

	const saved = page.waitForResponse((answer) => answer.url().includes("suite.sheets.api.save_sheet"));
	await page.locator("canvas").first().click({ position: { x: 80, y: 40 } });
	await page.keyboard.type("6060");
	await page.keyboard.press("Enter");
	const answer = await saved;
	expect(answer.status()).toBe(200);
	expect(await answer.request().headerValue("x-drive-links")).toBe(code);
	expect(seen.requests.filter((line) => line.includes("suite.drive.api"))).toEqual([]);
	expect(seen.errors).toEqual([]);
	await visitor.close();
});

test("the document actions fit on one row of a 320 px screen", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 640 });
	await openSheet(page);
	const bar = page.locator(".sn-topbar");
	const edge = (await bar.boundingBox())!;
	for (const name of ["More actions", "Comments", "Versions", "Share"]) {
		const box = (await bar.getByRole("button", { name, exact: true }).boundingBox())!;
		expect(box, name).not.toBeNull();
		expect(box.x, name).toBeGreaterThanOrEqual(edge.x);
		expect(box.x + box.width, name).toBeLessThanOrEqual(edge.x + edge.width);
	}
	expect(await bar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
