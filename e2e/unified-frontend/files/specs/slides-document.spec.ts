import { readFileSync } from "node:fs";

import { type APIRequestContext, type Browser, type Page } from "@playwright/test";

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
	await expect(page.getByText("Opening presentation…")).toHaveCount(0, { timeout: 20_000 });
	return title;
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
			(window as unknown as { printedPages: number }).printedPages = document.querySelectorAll(
				".slides-container .slide-page",
			).length;
			window.dispatchEvent(new Event("afterprint"));
		};
	});
	const seen = watchPage(page);
	const title = await openDeck(page);

	await title.fill("Renamed deck");
	await title.press("Enter");
	await expect.poll(async () => (await getNode(api, deck.name)).title).toBe("Renamed deck");

	// Export prints one page per slide, then takes the print view away again.
	await page.getByRole("button", { name: "Export", exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => (window as unknown as { printedPages?: number }).printedPages))
		.toBe(1);
	await expect(page.locator(".slides-container")).toHaveCount(0);

	await page.getByRole("button", { name: "Comments" }).click();
	const comments = page.getByRole("complementary", { name: "Comments" });
	await comments.getByRole("textbox", { name: "New comment" }).fill("Tighten the opening slide");
	await comments.getByRole("button", { name: "Add", exact: true }).click();
	await expect(comments.getByText("Tighten the opening slide")).toBeVisible();

	await page.getByRole("button", { name: "Versions" }).click();
	await expect(page.getByRole("complementary", { name: "Versions" })).toBeVisible();
	await expect(comments).toHaveCount(0);

	await expect(page.getByRole("button", { name: "Share" })).toBeDisabled();
	expect(seen.requests.filter((line) => line.includes("suite.drive.api"))).toEqual([]);
	expect(
		seen.requests.some((line) => line.startsWith("POST") && line.includes(`${DRIVE}/nodes/${deck.name}/visit`)),
	).toBe(true);
	expect(seen.errors).toEqual([]);
});

test("losing edit access freezes the deck, sends no write and offers the changes", async ({ page }) => {
	const seen = watchPage(page);
	await openDeck(page);
	// Every save fails, so the edit below stays unsaved.
	await page.route("**/suite.slides.api.slides.save_slides", (route) => route.abort());

	await addRectangle(page);
	await expect(page.getByText("Not saved", { exact: true })).toBeVisible();
	await patchNode(api, deck.name, { state: "Trashed" });
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));

	await expect(page.getByText("Trashed", { exact: true })).toBeVisible();
	await expect(page.getByText("View only", { exact: true })).toBeVisible();
	const frozenAt = seen.requests.length;
	await page.waitForTimeout(3_000);
	expect(seen.requests.slice(frozenAt).filter((line) => line.includes("save_slides"))).toEqual([]);

	const recovery = () =>
		page.evaluate((node) => localStorage.getItem(`suite:slides-recovery:${node}`), deck.name);
	expect(await recovery()).toContain("rectangle");

	const download = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download my changes" }).first().click();
	const file = await download;
	expect(file.suggestedFilename()).toBe("Slides journey (recovered).json");
	expect(JSON.parse(readFileSync((await file.path())!, "utf8")).slides[0].elements).toEqual(
		expect.arrayContaining([expect.objectContaining({ shapeType: "rectangle" })]),
	);
	expect(await recovery()).toBeNull();

	// A trashed deck takes no new comments.
	await page.getByRole("button", { name: "Comments" }).click();
	await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();
	await expect(page.getByRole("textbox", { name: "New comment" })).toHaveCount(0);
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
	const body = (await response.json()) as {
		data?: { grant: { principal: string } };
		message?: { grant: { principal: string } };
	};
	return (body.data ?? body.message)!.grant.principal.replace("$LINK:", "");
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

	const saved = page.waitForResponse((answer) => answer.url().includes("suite.slides.api.slides.save_slides"));
	await addRectangle(page);
	const answer = await saved;
	expect(answer.status()).toBe(200);
	expect(await answer.request().headerValue("x-drive-links")).toBe(code);
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	expect(seen.requests.filter((line) => line.includes("suite.drive.api"))).toEqual([]);
	expect(seen.errors).toEqual([]);
	await visitor.close();
});

test("a composite sends the link code of a deck that is shared on its own", async ({ browser, baseURL }) => {
	const part = await createDocument(api, home.name, "Linked part", "Presentation");
	const hidden = await createDocument(api, home.name, "Private part", "Presentation");
	const updated = await api.put(`/api/resource/Presentation/${encodeURIComponent(deck.content_docname!)}`, {
		data: {
			is_composite: 1,
			reference_presentations: [
				{ presentation: part.content_docname },
				{ presentation: hidden.content_docname },
			],
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

	// The manifest carries every held code, and names only the decks they open.
	const listed = await manifest;
	expect(((await listed.request().headerValue("x-drive-links")) ?? "").split(",").sort()).toEqual(
		[deckCode, partCode].sort(),
	);
	const references = ((await listed.json()) as { message: { references: Array<{ node: string | null }> } })
		.message.references;
	expect(references.map((row) => row.node)).toEqual([part.name, null]);

	const answer = await group;
	expect(answer.status()).toBe(200);
	const sent = (await answer.request().headerValue("x-drive-links")) ?? "";
	expect(sent.split(",").sort()).toEqual([deckCode, partCode].sort());
	await expect(page.getByRole("button", { name: "1 · ready" })).toBeVisible();
	await expect(page.getByRole("button", { name: "2 · unreadable" })).toBeVisible();
	await visitor.close();
});

test("restores a saved version and reloads the deck", async ({ page }) => {
	await openDeck(page);
	await page.getByRole("button", { name: "Versions" }).click();
	const versions = page.getByRole("complementary", { name: "Versions" });
	await versions.getByRole("button", { name: "Save version" }).click();
	await page.getByRole("dialog").getByRole("textbox").fill("Empty deck");
	await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
	await expect(versions.getByText("Empty deck")).toBeVisible();
	await versions.getByRole("button", { name: "Close versions" }).click();

	await addRectangle(page);
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	await expect.poll(() => rectangles(api, deck.content_docname!)).toBe(1);
	await expect(page.locator(SHAPE_RECT).first()).toBeVisible();

	await page.getByRole("button", { name: "Versions" }).click();
	await versions.getByRole("listitem").filter({ hasText: "Empty deck" }).getByRole("button", { name: "Restore" }).click();
	await page.getByRole("dialog").getByRole("button", { name: "Restore", exact: true }).click();
	await expect(page.getByText("Version restored")).toBeVisible();

	await expect.poll(() => rectangles(api, deck.content_docname!)).toBe(0);
	// The editor shows the restored copy, not the rectangle it drew.
	await expect(page.locator(SHAPE_RECT)).toHaveCount(0);
	await expect(page.getByText("View only", { exact: true })).toHaveCount(0);
});

/** A rectangle shape on the canvas. Only shapes set a stroke width in px; icons draw rects too. */
const SHAPE_RECT = 'svg rect[stroke-width$="px"]';

/** How many rectangles the server copy of a presentation holds. */
async function rectangles(client: APIRequestContext, docname: string): Promise<number> {
	const response = await client.get(`/api/resource/Presentation/${encodeURIComponent(docname)}`);
	const doc = ((await response.json()) as { data: { slides: Array<{ elements: string }> } }).data;
	return doc.slides.flatMap((slide) => JSON.parse(slide.elements || "[]") as Array<{ shapeType?: string }>)
		.filter((element) => element.shapeType === "rectangle").length;
}
