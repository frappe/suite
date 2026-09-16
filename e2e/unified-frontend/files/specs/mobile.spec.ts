import { expect, test, type APIRequestContext } from "@playwright/test";

import { adminApi, createFolder, purge, roots, runTag, type DriveNode } from "../../helpers/drive";
import { MOBILE_VIEWPORT } from "../../helpers/shell";

/** Ticket 006: mobile navigation, both sheet affordances, long-press selection. */

test.describe.configure({ mode: "serial" });
test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true, isMobile: true });

let api: APIRequestContext;
let home: DriveNode;

test.beforeAll(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	home = await createFolder(api, personal, runTag("w4-mobile"));
	await createFolder(api, home.name, "row-a");
	await createFolder(api, home.name, "row-b");
});

test.afterAll(async () => {
	await purge(api, home.name);
	await api.dispose();
});

async function longPress(locator: import("@playwright/test").Locator) {
	const box = await locator.boundingBox();
	if (!box) throw new Error("the row has no box");
	await locator.page().mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await locator.page().mouse.down();
	await locator.page().waitForTimeout(700);
	await locator.page().mouse.up();
}

test("the bottom-nav item and the header button open the same sheet", async ({ page }) => {
	await page.goto("/files");
	await page.locator("[data-slot='mobile-nav-item']").filter({ hasText: "More" }).click();
	const sheet = page.getByRole("dialog", { name: "Files" });
	await expect(sheet).toBeVisible();
	await sheet.getByRole("link", { name: "Recent" }).click();
	await expect(page).toHaveURL(/\/files\/recent$/);

	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
	await page.getByRole("button", { name: "Recent" }).click();
	await expect(page.getByRole("dialog", { name: "Files" })).toBeVisible();
});

// ShellLayout closes the sheet on every route change (fixed here).
test("the sheet closes after a destination is chosen", async ({ page }) => {
	await page.goto("/files");
	await page.locator("[data-slot='mobile-nav-item']").filter({ hasText: "More" }).click();
	const sheet = page.getByRole("dialog", { name: "Files" });
	await sheet.getByRole("link", { name: "Recent" }).click();
	await expect(page).toHaveURL(/\/files\/recent$/);
	await expect(sheet).toBeHidden();
});

test("the mobile header shows the destination and a back control inside a folder", async ({ page }) => {
	await page.goto("/files");
	await page.goto(`/files/f/${home.name}`);
	await expect(page.getByRole("button", { name: home.title })).toBeVisible();
	await expect(page.getByRole("button", { name: "New" })).toBeVisible();

	// The back control renders as a link because FilesPage passes `route` to
	// PageHeaderBackButton, whose own prop is `to`; the component still runs its
	// own history back on click.
	await page.getByRole("link", { name: "Back" }).click();
	await expect(page).toHaveURL(/\/files/);
	await expect(page.getByRole("button", { name: "My files" })).toBeVisible();
});

// The trailing click is swallowed after the press answers (fixed here).
test("a long press on a grid tile enters selection mode", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=grid`);
	const tile = page.getByRole("listitem").first();
	await expect(tile).toBeVisible();

	await longPress(tile);
	await expect(page.getByText("1 selected")).toBeVisible();

	await page.getByRole("button", { name: "Done" }).click();
	await expect(page.getByText("selected")).toHaveCount(0);
});

// List rows bind the same pointer handlers as grid tiles (fixed here).
test("a long press on a list row enters selection mode", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list`);
	const row = page.locator("[data-node]").first();
	await expect(row).toBeVisible();

	await longPress(row);
	await expect(page.getByText("1 selected")).toBeVisible();
});

test("the row menu Select enters selection mode on mobile", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list`);
	await page.getByRole("button", { name: "Actions for row-a" }).click();
	await page.getByRole("menuitem", { name: "Select" }).click();
	await expect(page.getByText("1 selected")).toBeVisible();

	await page.locator("[data-node]").nth(1).click();
	await expect(page.getByText("2 selected")).toBeVisible();
});

test("browser Back leaves selection mode instead of the folder", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list`);
	await page.getByRole("button", { name: "Actions for row-a" }).click();
	await page.getByRole("menuitem", { name: "Select" }).click();
	await expect(page.getByText("1 selected")).toBeVisible();

	await page.goBack();
	await expect(page.getByText("selected")).toHaveCount(0);
});
