import { type APIRequestContext, type Frame, type Page, expect, test } from "@playwright/test";

import { adminApi, createFolder, purge, roots, runTag, uploadFile, type DriveNode } from "../../helpers/drive";
import { patchAccount } from "../../helpers/shell";

/**
 * Stage 6 (spec sections 2.1, 2.2, 3.5 and 14, tickets 014, 018 and 020): the
 * unified shell and the Drive area, always on, from a cold load.
 */

const MAIL_ACCOUNT = {
	is_jmap_configured: true,
	roles: { system_manager: true, suite_admin: true },
	capabilities: { jmap: true, systemManager: true },
};
// A share-link fragment, as a copied link carries it. The router takes it into
// the link store and drops it before any redirect (spec §10.1), so no later
// address carries the token.
const LINK = "#link=AbCdEfGhIjKlMnOpQrStUv";

let api: APIRequestContext;
let folder: DriveNode;
let file: DriveNode;

test.beforeAll(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	folder = await createFolder(api, personal, `UF6 Areas Folder ${runTag("")}`.trim());
	file = await uploadFile(api, folder.name, "uf6-areas-notes.txt", Buffer.from("areas notes"), "text/plain");
});

test.afterAll(async () => {
	await purge(api, folder.name);
	await api.dispose();
});

const rail = (page: Page) => page.getByRole("navigation", { name: "Areas" });
const driveArea = (page: Page) => page.getByRole("group", { name: "Locations" });

async function railLabels(page: Page): Promise<string[]> {
	// An empty rail list has no size, so wait for the shell's avatar instead.
	await expect(rail(page)).toBeAttached();
	await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
	// The Mail label carries its unread count, so read each label's first word.
	return rail(page)
		.getByRole("link")
		.evaluateAll((links) => links.map((link) => link.getAttribute("aria-label")?.split(",")[0] ?? ""));
}

async function openAccountMenu(page: Page) {
	await page.getByRole("button", { name: "Account" }).click();
	await expect(page.getByRole("menuitem", { name: "Log out" })).toBeVisible();
}

async function settingsTabs(page: Page) {
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const settings = page.getByRole("dialog", { name: "Settings" });
	await expect(settings.getByRole("tab", { name: "Profile" })).toBeVisible();
	return settings;
}

/**
 * Every URL the page shows while it runs `open`, history updates included.
 * A target page may rewrite its own URL later, so a redirect is checked here.
 */
async function urlsDuring(page: Page, open: () => Promise<unknown>): Promise<string[]> {
	const urls: string[] = [];
	const record = (frame: Frame) => {
		if (frame === page.mainFrame()) urls.push(frame.url());
	};
	page.on("framenavigated", record);
	try {
		await open();
	} finally {
		page.off("framenavigated", record);
	}
	return urls;
}

test.beforeEach(async ({ page }) => {
	await patchAccount(page, MAIL_ACCOUNT);
});

test("/ and the PWA start land on Home", async ({ page }) => {
	for (const path of ["/", "/suite/start"]) {
		await page.goto(path);
		await expect(page).toHaveURL(/\/home$/);
	}
});

test("the rail lists every area, Drive as the second", async ({ page }) => {
	await page.goto("/drive");
	expect(await railLabels(page)).toEqual(["Home", "Drive", "Mail", "Calendar", "Meet", "People"]);
	await expect(rail(page).getByRole("link", { name: "Drive" })).toHaveAttribute("aria-current", "page");
	await expect(driveArea(page)).toBeVisible();
});

test("the folder route opens a folder and sends a file id to /d/", async ({ page }) => {
	await page.goto(`/drive/f/${folder.name}`);
	await expect(page).toHaveURL(new RegExp(`/drive/f/${folder.name}/`));
	await expect(page.getByText(file.title, { exact: true })).toBeVisible();

	const urls = await urlsDuring(page, async () => {
		await page.goto(`/drive/f/${file.name}?view=list${LINK}`);
		await expect(page).toHaveURL(new RegExp(`/d/${file.name}(/[^?#]*)?\\?view=list`));
	});
	expect(urls.some((url) => url.endsWith(`/d/${file.name}?view=list`))).toBe(true);
	await page.goBack();
	await expect(page).not.toHaveURL(new RegExp(`/drive/f/${file.name}`));
	// Back reloads the folder page. Let it finish before the test ends.
	await expect(page.getByText(file.title, { exact: true })).toBeVisible();
});

test("an old Drive path with a redirect row lands on its new page, and one without finds no page", async ({ page }) => {
	// The redirect table sends `/drive/favourites` to `/drive/starred` (spec §14.3).
	await page.goto("/drive/favourites");
	await expect(page).toHaveURL(/\/drive\/starred$/);

	// `/drive/signup` has no row and no page in the area's table.
	await page.goto("/drive/signup");
	await expect(driveArea(page)).toHaveCount(0);
	await expect(page.getByText(/not found/i).first()).toBeVisible();
});

test("the account menu has no Apps submenu and Settings shows the Drive group", async ({ page }) => {
	await page.goto("/home");
	await openAccountMenu(page);
	await expect(page.getByRole("menuitem", { name: "Apps" })).toHaveCount(0);
	await page.keyboard.press("Escape");

	const settings = await settingsTabs(page);
	await expect(settings.getByRole("tab", { name: "Statistics" })).toBeVisible();
});
