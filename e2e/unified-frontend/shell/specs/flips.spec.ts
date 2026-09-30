import { type APIRequestContext, type Frame, type Page } from "@playwright/test";

import { expect, test } from "../../helpers/flips";

import { adminApi, createFolder, purge, roots, runTag, uploadFile, type DriveNode } from "../../helpers/drive";
import { MOBILE_VIEWPORT, patchAccount } from "../../helpers/shell";

/**
 * Stage 6 (spec sections 2.1, 2.2, 3.5 and 14, tickets 014, 018 and 020): the
 * two flip keys. Each describe sets the boot the way the served page does.
 * Every page is a cold load, because the client reads the flags from boot only.
 */

const MAIL_ACCOUNT = {
	is_jmap_configured: true,
	roles: { system_manager: true },
	capabilities: { jmap: true, systemManager: true },
};
const OLD_APPS = ["Drive", "Slides", "Writer", "Sheets"];
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
	folder = await createFolder(api, personal, `UF6 Flip Folder ${runTag("")}`.trim());
	file = await uploadFile(api, folder.name, "uf6-flip-notes.txt", Buffer.from("flip notes"), "text/plain");
});

test.afterAll(async () => {
	await purge(api, folder.name);
	await api.dispose();
});

const rail = (page: Page) => page.getByRole("navigation", { name: "Areas" });
const driveArea = (page: Page) => page.getByRole("navigation", { name: "File locations" });
const homeDriveGroup = (page: Page) => page.getByRole("navigation", { name: "Drive", exact: true });

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

/** The old Drive pages: outside the shell, with no Drive area panel. */
async function expectOldDrivePage(page: Page, path: RegExp) {
	await expect(page).toHaveURL(path);
	await expect(page.locator("#app")).not.toBeEmpty();
	await expect(rail(page)).toHaveCount(0);
	await expect(driveArea(page)).toHaveCount(0);
}

test.describe("both flips off", () => {
	test.use({ flips: { suite_flip_shell: false, suite_flip_files: false } });

	test.beforeEach(async ({ page }) => {
		await patchAccount(page, MAIL_ACCOUNT);
	});

	test("/ and the PWA start land on Mail through the last-app fallback", async ({ page }) => {
		for (const path of ["/", "/suite/start"]) {
			await page.goto(path);
			await expect(page).toHaveURL(/\/mail(\/|$)/);
		}
	});

	test("Mail, Calendar and Meet stay outside the shell", async ({ page }) => {
		for (const path of ["/mail", "/calendar", "/meet"]) {
			await page.goto(path);
			await expect(page).toHaveURL(new RegExp(path));
			await expect(page.locator("#app")).not.toBeEmpty();
			await expect(rail(page)).toHaveCount(0);
		}
	});

	test("/home and /d/ answer in the shell with an empty rail", async ({ page }) => {
		await page.goto("/home");
		await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
		expect(await railLabels(page)).toEqual([]);

		await page.goto(`/d/${file.name}`);
		await expect(page).toHaveURL(new RegExp(`/d/${file.name}`));
		expect(await railLabels(page)).toEqual([]);
	});

	test("/drive mounts the old Drive pages", async ({ page }) => {
		await page.goto("/drive");
		await expectOldDrivePage(page, /\/drive$/);
	});

	test("the old /drive/f/ route opens a folder id as a folder and keeps a file id", async ({ page }) => {
		const urls = await urlsDuring(page, async () => {
			await page.goto(`/drive/f/${folder.name}?view=list${LINK}`);
			await expectOldDrivePage(page, new RegExp(`/drive/d/${folder.name}(/[^/?#]+)?`));
		});
		// The old folder page then adds its slug and drops the rest, as it always has.
		expect(urls.some((url) => url.endsWith(`/drive/d/${folder.name}?view=list`))).toBe(true);

		await page.goto(`/drive/f/${file.name}${LINK}`);
		await expectOldDrivePage(page, new RegExp(`/drive/f/${file.name}(/[^/#]+)?$`));
	});

	test("/home shows no Drive group", async ({ page }) => {
		await page.goto("/home");
		await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
		await expect(homeDriveGroup(page)).toHaveCount(0);
	});

	test("the account menu has no Apps submenu and Settings has no Drive group", async ({ page }) => {
		await page.goto("/home");
		await openAccountMenu(page);
		await expect(page.getByRole("menuitem", { name: "Apps" })).toHaveCount(0);
		await page.keyboard.press("Escape");

		const settings = await settingsTabs(page);
		await expect(settings.getByRole("tab", { name: "Credentials" })).toBeVisible();
		await expect(settings.getByRole("tab", { name: "Statistics" })).toHaveCount(0);
	});
});

test.describe("the shell flip on, the files flip off", () => {
	test.use({ flips: { suite_flip_shell: true, suite_flip_files: false } });

	test.beforeEach(async ({ page }) => {
		await patchAccount(page, MAIL_ACCOUNT);
	});

	test("the rail lists Mail, Calendar and Meet, and /home has no active item", async ({ page }) => {
		await page.goto("/calendar");
		expect(await railLabels(page)).toEqual(["Mail", "Calendar", "Meet"]);
		await expect(rail(page).getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");

		await page.goto("/home");
		expect(await railLabels(page)).toEqual(["Mail", "Calendar", "Meet"]);
		await expect(rail(page).locator("[aria-current='page']")).toHaveCount(0);
	});

	test("/home shows no Drive group", async ({ page }) => {
		await page.goto("/home");
		expect(await railLabels(page)).toEqual(["Mail", "Calendar", "Meet"]);
		await expect(homeDriveGroup(page)).toHaveCount(0);
	});

	test("/drive still mounts the old Drive pages", async ({ page }) => {
		await page.goto("/drive");
		await expectOldDrivePage(page, /\/drive$/);
	});

	test("the avatar menu's Apps submenu opens each old page", async ({ page }) => {
		await page.goto("/home");
		await openAccountMenu(page);
		await page.getByRole("menuitem", { name: "Apps" }).hover();
		for (const app of OLD_APPS) await expect(page.getByRole("menuitem", { name: app, exact: true })).toBeVisible();

		await page.getByRole("menuitem", { name: "Sheets", exact: true }).click();
		await expect(page).toHaveURL(/\/sheets$/);
		await expect(rail(page)).toHaveCount(0);
	});

	test("the phone account sheet drills in to the same Apps rows", async ({ page }) => {
		await page.setViewportSize(MOBILE_VIEWPORT);
		await page.goto("/home");
		await page.locator("[data-slot='mobile-nav-item']").filter({ hasText: "Account" }).click();
		const sheet = page.getByRole("dialog", { name: "Account" });
		const before = await sheet.boundingBox();
		const appsRow = sheet.getByRole("button", { name: "Apps" });
		await appsRow.click();

		const apps = sheet.getByRole("navigation", { name: "Apps" });
		for (const app of OLD_APPS) await expect(apps.getByRole("button", { name: app, exact: true })).toBeVisible();
		// Both views share one grid cell, so the sheet keeps its height.
		expect((await sheet.boundingBox())?.height).toBe(before?.height);

		// Focus follows the view: into the Apps view, then back to the Apps row.
		const back = sheet.getByRole("button", { name: "Back" });
		await expect(back).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(apps).toBeHidden();
		await expect(appsRow).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(back).toBeFocused();

		await apps.getByRole("button", { name: "Drive", exact: true }).click();
		await expect(sheet).toHaveCount(0);
		await expectOldDrivePage(page, /\/drive$/);
	});
});

test.describe("the shell flip off, the files flip on", () => {
	test.use({ flips: { suite_flip_shell: false, suite_flip_files: true } });

	test.beforeEach(async ({ page }) => {
		await patchAccount(page, MAIL_ACCOUNT);
	});

	test("/ and the PWA start land on Home", async ({ page }) => {
		for (const path of ["/", "/suite/start"]) {
			await page.goto(path);
			await expect(page).toHaveURL(/\/home$/);
		}
	});

	test("the rail lists Home and Drive, and /drive mounts the Drive area", async ({ page }) => {
		await page.goto("/drive");
		expect(await railLabels(page)).toEqual(["Home", "Drive"]);
		await expect(rail(page).getByRole("link", { name: "Drive" })).toHaveAttribute("aria-current", "page");
		await expect(driveArea(page)).toBeVisible();
	});

	test("Mail, Calendar and Meet stay outside the shell", async ({ page }) => {
		for (const path of ["/mail", "/calendar", "/meet"]) {
			await page.goto(path);
			await expect(page).toHaveURL(new RegExp(path));
			await expect(page.locator("#app")).not.toBeEmpty();
			await expect(rail(page)).toHaveCount(0);
		}
	});

	test("the folder route sends a file id to /d/ without its link", async ({ page }) => {
		const urls = await urlsDuring(page, async () => {
			await page.goto(`/drive/f/${file.name}${LINK}`);
			await expect(page).toHaveURL(new RegExp(`/d/${file.name}/[^#]*$`));
		});
		expect(urls.some((url) => url.endsWith(`/d/${file.name}`))).toBe(true);
	});

	test("/home shows the Drive group, the menu has no Apps submenu, and Settings shows the Drive group", async ({ page }) => {
		await page.goto("/home");
		await expect(homeDriveGroup(page).getByRole("link", { name: "Starred" })).toBeVisible();

		await openAccountMenu(page);
		await expect(page.getByRole("menuitem", { name: "Apps" })).toHaveCount(0);
		await page.keyboard.press("Escape");

		const settings = await settingsTabs(page);
		await expect(settings.getByRole("tab", { name: "Statistics" })).toBeVisible();
	});
});

test.describe("both flips on", () => {
	test.use({ flips: { suite_flip_shell: true, suite_flip_files: true } });

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
		expect(await railLabels(page)).toEqual(["Home", "Drive", "Mail", "Calendar", "Meet"]);
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

	test("/home shows the Drive group", async ({ page }) => {
		await page.goto("/home");
		await expect(homeDriveGroup(page).getByRole("link", { name: "Starred" })).toBeVisible();
	});

	test("an old Drive path finds no page in the area's table", async ({ page }) => {
		await page.goto("/drive/favourites");
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
});
