import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { frappeData } from "../../../shared/frappe";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

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

/** Stage 11: the Slides document on `/d/<id>`, through Drive and Slides routes only. */

test.describe.configure({ mode: "serial" });

let api: APIRequestContext;
let home: DriveNode;
let deck: DriveNode;

test.beforeEach(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	home = await createFolder(api, personal, runTag("w11-slides"));
	deck = await createDocument(api, home.name, "Slides journey", "Presentation");
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

async function openDeck(page: Page, node = deck.name) {
	await page.goto(`/d/${node}`);
	const title = page.getByRole("textbox", { name: "Presentation title" });
	await expect(title).toBeVisible({ timeout: 20_000 });
	await expect(page.getByRole("status", { name: "Opening presentation" })).toHaveCount(0, { timeout: 20_000 });
	return title;
}

/** Picks an item from the presentation's ⋯ menu. A side panel's item opens or closes it. */
async function pickFromMenu(page: Page, item: "Comments" | "Versions" | "Export as PDF") {
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: item, exact: true }).click();
}

/** A push of the room's work. */
function isPush(url: string) {
	return new URL(url).pathname.endsWith("/updates");
}

/** Add a rectangle to the open slide, as a person does: press R, then draw it on the slide. */
async function addRectangle(page: Page) {
	await page.locator("body").click({ position: { x: 600, y: 400 } });
	await page.keyboard.press("r");
	await page.mouse.move(500, 300);
	await page.mouse.down();
	await page.mouse.move(580, 350, { steps: 4 });
	await page.mouse.move(650, 400, { steps: 4 });
	await page.mouse.up();
}

test("renames, exports and comments without a legacy Drive call", async ({ page }) => {
	await page.addInitScript(() => {
		window.print = () => {
			window.printedPages = document.querySelectorAll(".slides-container .slide-page").length;
			window.dispatchEvent(new Event("afterprint"));
		};
	});
	const seen = watchPage(page);
	const title = await openDeck(page);

	await title.fill("Renamed deck");
	await title.press("Enter");
	await expect.poll(async () => (await getNode(api, deck.name)).title).toBe("Renamed deck");

	// Export prints one page per slide, then takes the print view away again.
	await pickFromMenu(page, "Export as PDF");
	await expect.poll(() => page.evaluate(() => window.printedPages)).toBe(1);
	await expect(page.locator(".slides-container")).toHaveCount(0);

	await pickFromMenu(page, "Comments");
	const comments = page.getByRole("complementary", { name: "Comments" });
	await comments.getByRole("button", { name: "Add a comment" }).click();
	await comments.getByLabel("Add a comment", { exact: true }).fill("Tighten the opening slide");
	await comments.getByRole("button", { name: "Comment", exact: true }).click();
	await expect(comments.getByText("Tighten the opening slide")).toBeVisible();

	await pickFromMenu(page, "Versions");
	await expect(page.getByRole("complementary", { name: "Versions" })).toBeVisible();
	await expect(comments).toHaveCount(0);

	// Share opens the Drive share dialog for a manager (stage 9).
	await expect(page.getByRole("button", { name: "Share" })).toBeEnabled();
	expect(seen.requests.filter((line) => line.includes("suite.drive.api"))).toEqual([]);
	expect(
		seen.requests.some((line) => line.startsWith("POST") && line.includes(`${DRIVE}/nodes/${deck.name}/visit`)),
	).toBe(true);
	expect(seen.errors).toEqual([]);
});

test("losing edit access freezes the deck, sends no write and offers the changes", async ({ page }) => {
	const seen = watchPage(page);
	await openDeck(page);
	// Every push fails, so the edit below stays unsent
	await page.route(/\/content\/[^/]+\/updates/, (route) => {
		if (route.request().method() === "POST") {
			return route.abort("failed");
		}

		return route.continue();
	});

	const pushed = page.waitForRequest((request) => request.method() === "POST" && isPush(request.url()));
	await addRectangle(page);
	await pushed;
	await patchNode(api, deck.name, { state: "Trashed" });
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));

	// A trashed item is read-only; its Trashed badge takes the place of View only.
	await expect(page.getByText("Trashed", { exact: true })).toBeVisible();
	// The edit is still unsent, so the toast says it is kept, not only that the deck is view only
	await expect(page.getByText("Editing access changed. Your unsaved changes are kept on this device.")).toBeVisible();
	const frozenAt = seen.requests.length;
	await page.waitForTimeout(3_000);
	// The room may still send its unsent work once, within a short bound; this test's route aborts it
	const writes = seen.requests
		.slice(frozenAt)
		.filter((line) => line.startsWith("POST") && line.includes("suite.slides"));
	expect(writes).toEqual([]);

	const download = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download my changes" }).first().click();
	const file = await download;
	expect(file.suggestedFilename()).toBe("Slides journey (recovered).json");
	expect(JSON.parse(readFileSync((await file.path())!, "utf8")).slides[0].elements).toEqual(
		expect.arrayContaining([expect.objectContaining({ shapeType: "rectangle" })]),
	);
	// The live room keeps the one copy on this device. The toast saves the slides on screen, so
	// that copy stays, and Recovery copies offers it with the rectangle
	const recovery = await page.context().newPage();
	await recovery.goto("/drive/recovery");
	const copy = recovery.getByRole("row").filter({ hasText: "Slides journey" });
	await expect(copy).toHaveCount(1);
	const kept = recovery.waitForEvent("download");
	await copy.getByRole("button", { name: /^Actions for the copy from / }).click();
	await recovery.getByRole("menuitem", { name: "Download" }).click();
	expect(JSON.parse(readFileSync((await (await kept).path())!, "utf8")).slides[0].elements).toEqual(
		expect.arrayContaining([expect.objectContaining({ shapeType: "rectangle" })]),
	);
	await recovery.close();

	// A trashed deck takes no new comments.
	await pickFromMenu(page, "Comments");
	await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();
	const comments = page.getByRole("complementary", { name: "Comments" });
	await expect(comments.getByRole("button", { name: "Add a comment" })).toHaveCount(0);
	await expect(comments.getByLabel("Add a comment", { exact: true })).toHaveCount(0);
	expect(seen.requests.filter((line) => line.includes("suite.drive.api"))).toEqual([]);
	expect(seen.errors).toEqual([]);
});

/** A signed-in person with no grant of their own. The spec makes them on first use. */
const LINK_ONLY = { email: "slides-link-e2e@example.com", password: "Slides-Link-e2e-7731" };

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

/** Share a node by link and answer the code the link carries. */
async function shareByLink(node: string, role: number): Promise<string> {
	const response = await api.put(`${DRIVE}/nodes/${node}/grants/$LINK`, { data: { role } });
	expect(response.ok()).toBe(true);
	const grant = await frappeData<{ principal: string }>(response);
	return grant.principal.replace("$LINK:", "");
}

/**
 * Make `node`'s deck an old-style one, held in its rows alone, as every deck from before
 * collaboration is. A new deck starts with a live log, and the server refuses row writes to it.
 * Existing composites are old-style decks, so the composite test starts from one. This removes
 * the log through the content layer's own purge, as the backend's `old_deck` fixture does.
 */
function dropLiveLog(node: string): void {
	const bench = process.env.BENCH_PATH ?? "/home/faris/benches/suite-bench";
	const site = process.env.BENCH_SITE ?? "slides.localhost";
	execFileSync(
		`${bench}/env/bin/python`,
		[
			"-c",
			`
import sys
import frappe
from suite.content import log
frappe.init(site=${JSON.stringify(site)})
frappe.connect()
if not frappe.conf.allow_tests:
    raise RuntimeError("the old-style deck fixture requires a test site")
doc_id = log.mark_purged("slides", sys.argv[1])
if not doc_id:
    raise RuntimeError("the deck has no live log to drop")
log.delete_purged("slides", doc_id)
frappe.destroy()
`,
			node,
		],
		{ cwd: `${bench}/sites` },
	);
}

/** A browser signed in as the link-only person, holding these links. */
async function linkOnlyPage(browser: Browser, baseURL: string, links: Record<string, string>) {
	await ensureLinkOnlyUser();
	const visitor = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
	const login = await visitor.request.post("/api/method/login", {
		form: { usr: LINK_ONLY.email, pwd: LINK_ONLY.password },
	});
	expect(login.ok()).toBe(true);
	await visitor.addInitScript((held) => {
		const entries = Object.fromEntries(
			Object.entries(held).map(([code, target]) => [code, { target, lastUsed: Date.now() }]),
		);
		localStorage.setItem("suite:drive-links", JSON.stringify({ links: entries, tags: [] }));
	}, links);
	return { visitor, page: await visitor.newPage() };
}

// A guest takes the same path, but the shell still blocks guests on `/d/`
// (ticket 011, stage 8). So this person is signed in and reaches the deck
// through the link alone.
test("a person who holds only an edit link opens and saves the deck", async ({ browser, baseURL }) => {
	const code = await shareByLink(deck.name, 40);
	const { visitor, page } = await linkOnlyPage(browser, baseURL!, { [code]: deck.name });
	const seen = watchPage(page);
	await openDeck(page);
	await expect(page.getByText("View only", { exact: true })).toHaveCount(0);

	const saved = page.waitForResponse((answer) => answer.request().method() === "POST" && isPush(answer.url()));
	await addRectangle(page);
	const answer = await saved;
	expect(answer.status()).toBe(200);
	expect(await answer.request().headerValue("x-drive-links")).toBe(code);
	await expect(page.locator('[data-save-state="clean"]')).toBeVisible();
	expect(seen.requests.filter((line) => line.includes("suite.drive.api"))).toEqual([]);
	expect(seen.errors).toEqual([]);
	await visitor.close();
});

test("a composite sends the link code of a deck that is shared on its own", async ({ browser, baseURL }) => {
	const part = await createDocument(api, home.name, "Linked part", "Presentation");
	const hidden = await createDocument(api, home.name, "Private part", "Presentation");
	dropLiveLog(deck.name);
	const updated = await api.put(`/api/resource/Presentation/${encodeURIComponent(deck.content_docname!)}`, {
		data: {
			is_composite: 1,
			reference_presentations: [{ presentation: part.content_docname }, { presentation: hidden.content_docname }],
		},
	});
	expect(updated.ok()).toBe(true);
	const deckCode = await shareByLink(deck.name, 10);
	const partCode = await shareByLink(part.name, 10);
	const { visitor, page } = await linkOnlyPage(browser, baseURL!, {
		[deckCode]: deck.name,
		[partCode]: part.name,
	});

	const manifest = page.waitForResponse((answer) => answer.url().includes("composite.composite_manifest"));
	const group = page.waitForResponse((answer) => answer.url().includes("composite.composite_group"));
	await openDeck(page);
	// A response the typed client refuses ends the load before the manifest is asked for.
	await expect(page.getByText(/^get_composite_presentation /), "the composite answer passes its contract").toHaveCount(
		0,
	);

	// The manifest carries every held code, and names only the decks they open.
	const listed = await manifest;
	expect(((await listed.request().headerValue("x-drive-links")) ?? "").split(",").sort()).toEqual(
		[deckCode, partCode].sort(),
	);
	const { references } = await frappeData<{ references: Array<{ node: string | null }> }>(listed);
	expect(references.map((row) => row.node)).toEqual([part.name, null]);

	const answer = await group;
	expect(answer.status()).toBe(200);
	const sent = (await answer.request().headerValue("x-drive-links")) ?? "";
	expect(sent.split(",").sort()).toEqual([deckCode, partCode].sort());
	// Only the deck shared on its own reads; the private one stays a blank slide, not a failed load
	const parts = await frappeData<{ references: Array<{ index: number; readable: boolean }> }>(answer);
	const read = parts.references
		.map(({ index, readable }) => [index, readable])
		.sort(([left], [right]) => Number(left) - Number(right));
	expect(read).toEqual([
		[1, true],
		[2, false],
	]);
	// Each new part holds one slide: the shared part's loads, and the private part's stays blank
	const failed = page.getByText("Couldn't load this slide. Reload to try again.");
	// The canvas is the one 960px slide; thumbnails carry the same element marks at their own size
	const canvas = page.locator(".w-\\[960px\\]");
	await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
	await expect(canvas).toBeVisible();
	await expect(failed).toHaveCount(0);

	await page.keyboard.press("ArrowDown");
	await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
	await expect(canvas.locator("[data-index]")).toHaveCount(0);
	await expect(failed).toHaveCount(0);
	await visitor.close();
});

test("restores a saved version and reloads the deck", async ({ page, browser }) => {
	await openDeck(page);
	await pickFromMenu(page, "Versions");
	const versions = page.getByRole("complementary", { name: "Versions" });
	await versions.getByRole("button", { name: "Save version" }).click();
	await versions.getByRole("textbox", { name: "Version name" }).fill("Empty deck");
	await versions.getByRole("textbox", { name: "Version name" }).press("Enter");
	await expect(versions.getByText("Empty deck")).toBeVisible();
	await versions.getByRole("button", { name: "Close panel" }).click();

	await addRectangle(page);
	await expect(page.locator('[data-save-state="clean"]')).toBeVisible();
	expect(await showsSavedRectangle(browser)).toBe(true);
	await expect(page.locator(SHAPE_RECT).first()).toBeVisible();

	await pickFromMenu(page, "Versions");
	await versions.getByRole("button", { name: /^Empty deck/ }).click();
	await page
		.getByRole("status")
		.filter({ hasText: "Viewing Empty deck" })
		.getByRole("button", { name: "Restore this version" })
		.click();
	await page.getByRole("dialog").getByRole("button", { name: "Restore", exact: true }).click();
	await expect(page.getByText("Version restored")).toBeVisible();

	expect(await showsSavedRectangle(browser)).toBe(false);
	// The editor shows the restored copy, not the rectangle it drew.
	await expect(page.locator(SHAPE_RECT)).toHaveCount(0);
	await expect(page.getByText("View only", { exact: true })).toHaveCount(0);
});

/** A rectangle shape on the canvas. Only shapes set a stroke width in px; icons draw rects too. */
const SHAPE_RECT = 'svg rect[stroke-width$="px"]';

/** Whether the server copy of the deck holds a rectangle, as a fresh page on another device opens it. */
async function showsSavedRectangle(browser: Browser): Promise<boolean> {
	const other = await browser.newContext();
	const page = await other.newPage();
	await openDeck(page);
	await expect(page.locator('[data-save-state="clean"]')).toBeVisible();
	const count = await page.locator(SHAPE_RECT).count();
	await other.close();
	return count > 0;
}

declare global {
	interface Window {
		printedPages?: number;
	}
}
