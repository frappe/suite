import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

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

/** A push of the sheet's edits to its live room (the content layer). */
const PUSH = /^POST .*\/content\/[^/]+\/updates/;

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
	// SAFETY: this successful Suite endpoint returns its owned threads/principal projection; subsequent assertions check the expected test fixture.
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

	// An edit still waiting to be sent goes into the version first.
	await page
		.locator("canvas")
		.first()
		.click({ position: { x: 80, y: 40 } });
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
	const order = seen.requests.filter(
		(line) => PUSH.test(line) || (line.includes(`/nodes/${sheet.name}/versions`) && line.startsWith("POST")),
	);
	expect(order[0]).toMatch(PUSH);
	expect(order.at(-1)).toContain("/versions");

	// The room keeps the state a restore replaces as a version of its own.
	const before = versions.getByRole("listitem").filter({ hasText: "Before restoring “Journey version”" });
	await expect(before).toHaveCount(0);
	await versions
		.getByRole("listitem")
		.filter({ hasText: "Journey version" })
		.getByRole("button", { name: "More version actions" })
		.click();
	await page.getByRole("menuitem", { name: "Restore this version" }).click();
	await page.getByRole("dialog", { name: "Restore this version?" }).getByRole("button", { name: "Restore" }).click();
	await expect(page.getByText("Version restored")).toBeVisible();
	await expect(before).toHaveCount(1);
	// The first row is the current version; the newest saved version comes next.
	await expect(versions.getByRole("listitem").nth(1)).toContainText("Before restoring “Journey version”");
	await expect(page.getByRole("textbox", { name: "Spreadsheet title" })).toHaveValue("Renamed sheet");

	// Share opens the Drive share dialog for a manager (stage 9).
	await expect(page.getByRole("button", { name: "Share" })).toBeEnabled();
	expect(seen.requests.filter((line) => line.includes("suite.drive.api"))).toEqual([]);
	expect(
		seen.requests.some((line) => line.includes(`POST`) && line.includes(`/api/suite/drive/nodes/${sheet.name}/visit`)),
	).toBe(true);
	expect(seen.errors).toEqual([]);
});

test("losing edit access freezes the sheet, stops sending its edits and offers them as a download", async ({
	page,
}) => {
	const seen = watchPage(page);
	await openSheet(page);

	// Trash the sheet before the edit is sent: this route keeps the room's push
	// from landing, as Drive's refusal of a trashed node would.
	await page.route(/\/content\/[^/]+\/updates/, (route) =>
		route.request().method() === "POST" ? route.abort("failed") : route.continue(),
	);
	await page
		.locator("canvas")
		.first()
		.click({ position: { x: 80, y: 40 } });
	await page.keyboard.type("4242");
	await page.keyboard.press("Enter");
	await page.keyboard.type("5150");
	await patchNode(api, sheet.name, { state: "Trashed" });
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));

	await expect(page.getByText("Trashed", { exact: true })).toBeVisible();
	// A trashed document shows Trashed in place of View only; the frozen toolbar shows the lock.
	await expect(page.getByText("View only", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Bold" })).toBeDisabled();
	// The room's strip says so, and the edit it could not send is not saved.
	await expect(page.getByRole("status").filter({ hasText: "You can no longer edit this spreadsheet." })).toBeVisible();
	await expect(page.getByText("Not saved", { exact: true })).toBeVisible();
	await page.waitForTimeout(3_000);

	// What did not reach the server, the text still in the cell editor too, is
	// offered as a download. SheetJS writes the .xlsx uncompressed, so the
	// values read straight from its bytes.
	const download = page.waitForEvent("download");
	await page.locator(".sheets-header").getByRole("button", { name: "Download my changes" }).click();
	const file = await download;
	expect(file.suggestedFilename()).toBe("Sheets journey (recovered).xlsx");
	const saved = readFileSync(await file.path()).toString("latin1");
	expect(saved).toContain("4242");
	expect(saved).toContain("5150");
	expect(seen.requests.filter((line) => line.includes("suite.drive.api"))).toEqual([]);
});

// An IME, the Windows symbol picker or a phone keyboard insert text with no
// keydown. The grid used to drop it, or the first character (`₹250` → `250`).
test("text typed without a keydown starts the edit, and grid keys still work", async ({ page, context }) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	const seen = watchPage(page);
	await openSheet(page);
	const nameBox = page.getByRole("textbox", { name: "Name box" });
	const formulaBar = page.getByRole("textbox", { name: "Cell value or formula" });
	const goTo = async (cell: string) => {
		await nameBox.fill(cell);
		await nameBox.press("Enter");
	};

	await page
		.locator("canvas")
		.first()
		.click({ position: { x: 80, y: 40 } });
	await page.keyboard.insertText("₹250");
	await page.keyboard.press("Enter");
	await goTo("A1");
	await expect(formulaBar).toHaveValue("250");
	await expect(page.getByRole("button", { name: "Number format: Currency · INR" })).toBeVisible();

	// An IME composition (Hindi): nothing is committed until it ends.
	await goTo("A2");
	const cdp = await context.newCDPSession(page);
	await cdp.send("Input.imeSetComposition", { text: "नम", selectionStart: 2, selectionEnd: 2 });
	await cdp.send("Input.imeSetComposition", { text: "नमस्", selectionStart: 4, selectionEnd: 4 });
	await cdp.send("Input.insertText", { text: "नमस्ते" });
	await page.keyboard.press("Enter");
	await goTo("A2");
	await expect(formulaBar).toHaveValue("नमस्ते");

	// Keys still reach the grid and the app's shortcuts.
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("Control+c");
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("Control+v");
	await expect(formulaBar).toHaveValue("250");
	await page.keyboard.press("Control+b");
	await expect(page.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
	await page.keyboard.press("Delete");
	await expect(formulaBar).toHaveValue("");
	await page.keyboard.press("Control+z");
	// Undo points the formula bar at A1 (it holds 250 too), so look at B1 itself.
	await goTo("B1");
	await expect(formulaBar).toHaveValue("250");
	await page.keyboard.press("F2");
	await page.keyboard.type("0");
	await page.keyboard.press("Escape");
	await expect(formulaBar).toHaveValue("250");
	expect(seen.errors).toEqual([]);
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
	// The answer is the grant row itself.
	// SAFETY: this successful Suite endpoint returns its owned threads/principal projection; subsequent assertions check the expected test fixture.
	const body = (await response.json()) as { data?: { principal: string }; message?: { principal: string } };
	const code = (body.data ?? body.message)!.principal.replace("$LINK:", "");

	const visitor = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
	const login = await visitor.request.post("/api/method/login", {
		form: { usr: LINK_ONLY.email, pwd: LINK_ONLY.password },
	});
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

	const saved = page.waitForResponse((answer) => PUSH.test(`${answer.request().method()} ${answer.url()}`));
	await page
		.locator("canvas")
		.first()
		.click({ position: { x: 80, y: 40 } });
	await page.keyboard.type("6060");
	await page.keyboard.press("Enter");
	const answer = await saved;
	expect(answer.status()).toBe(200);
	expect(await answer.request().headerValue("x-drive-links")).toBe(code);
	expect(seen.requests.filter((line) => line.includes("suite.drive.api"))).toEqual([]);
	expect(seen.errors).toEqual([]);
	await visitor.close();
});

test("a sheet whose room can't open keeps the rail", async ({ page }) => {
	await page.route(/\/content\/[^/]+\/sessions$/, (route) => route.fulfill({ status: 500 }));
	await page.goto(`/d/${sheet.name}`);

	await expect(page.getByText("Couldn't open this sheet")).toBeVisible({ timeout: 20_000 });
	await expect(page.getByRole("navigation", { name: "Areas" })).toBeVisible();
});

test("the document actions fit on one row of a 320 px screen", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 640 });
	await openSheet(page);
	const bar = page.locator(".sheets-header");
	const edge = (await bar.boundingBox())!;
	for (const name of ["Menu", "Comments", "Versions", "Share"]) {
		const box = (await bar.getByRole("button", { name, exact: true }).boundingBox())!;
		expect(box, name).not.toBeNull();
		expect(box.x, name).toBeGreaterThanOrEqual(edge.x);
		expect(box.x + box.width, name).toBeLessThanOrEqual(edge.x + edge.width);
	}
	expect(await bar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("the name box keeps one width, so the formula bar never moves", async ({ page }) => {
	await openSheet(page);
	const nameBox = page.getByRole("textbox", { name: "Name box" });
	const formulaBar = page.getByRole("textbox", {
		name: "Cell value or formula",
	});
	const left = async () => (await formulaBar.boundingBox())!.x;
	const width = async () => (await nameBox.boundingBox())!.width;
	const fits = () => nameBox.evaluate((box: HTMLInputElement) => box.scrollWidth <= box.clientWidth);

	const start = { left: await left(), width: await width() };
	for (const reference of ["C5", "D48:J48", "A50:Z50", "50:50", "1:1", "B:Z", "A1"]) {
		await nameBox.fill(reference);
		await nameBox.press("Enter");
		await expect(nameBox).toHaveValue(reference);
		expect(await width(), reference).toBe(start.width);
		expect(await left(), reference).toBe(start.left);
	}

	// A typical range fits in full; a longer one ends in an ellipsis.
	await nameBox.evaluate((box: HTMLInputElement) => (box.value = "AA100:AB200"));
	expect(await fits()).toBe(true);
	await nameBox.evaluate((box: HTMLInputElement) => (box.value = "AAA100000:ABC200000"));
	expect(await fits()).toBe(false);
	expect(await nameBox.evaluate((box) => getComputedStyle(box).textOverflow)).toBe("ellipsis");

	// Focused, the box shows the whole reference over the formula bar, which stays put.
	await nameBox.fill("AAA100000:ABC200000");
	expect(await fits()).toBe(true);
	expect(await left()).toBe(start.left);
	await nameBox.press("Escape");
	await expect(nameBox).toHaveValue("A1");
	expect(await width()).toBe(start.width);

	// A phone keeps one, narrower width too.
	await page.setViewportSize({ width: 360, height: 640 });
	// The phone shell mounts the editor again.
	await expect(formulaBar).toBeVisible({ timeout: 20_000 });
	await expect(page.locator(".sn-canvas-loading")).toHaveCount(0, {
		timeout: 20_000,
	});
	const phone = { left: await left(), width: await width() };
	expect(phone.width).toBeLessThan(start.width);
	for (const reference of ["D48:J48", "C5"]) {
		await nameBox.fill(reference);
		await nameBox.press("Enter");
		expect(await width(), reference).toBe(phone.width);
		expect(await left(), reference).toBe(phone.left);
	}
});

test("font size steps with − and +, takes a typed size and lists common sizes, one undo each", async ({ page }) => {
	await openSheet(page);
	const size = page.getByRole("spinbutton", { name: "Font size" });
	const undo = page.getByRole("button", { name: "Undo", exact: true });
	await expect(size).toHaveValue("13");

	await page.getByRole("button", { name: "Increase font size" }).click();
	await expect(size).toHaveValue("14");
	await undo.click();
	await expect(size).toHaveValue("13");

	// Enter applies the size and blurs the field; that is still one step.
	await size.fill("20");
	await size.press("Enter");
	await expect(size).toHaveValue("20");
	await undo.click();
	await expect(size).toHaveValue("13");

	await size.click();
	await page.getByRole("button", { name: "24", exact: true }).click();
	await expect(size).toHaveValue("24");
	await expect(page.locator(".sn-font-sizes")).toHaveCount(0);
	await undo.click();
	await expect(size).toHaveValue("13");
});

test("every control in both toolbar rows is 28 px tall", async ({ page }) => {
	await openSheet(page);
	const heights = await page
		.locator(
			".sheets-header button:visible, .sn-toolbar button:visible, .sn-toolbar input:visible:not(.sn-formula-input), .sn-formula-wrap",
		)
		.evaluateAll((els) =>
			els
				.map(
					(el) =>
						`${el.getAttribute("aria-label") ?? el.textContent?.trim()}=${Math.round(el.getBoundingClientRect().height)}`,
				)
				.filter((s) => !s.endsWith("=28")),
		);
	expect(heights).toEqual([]);
});
