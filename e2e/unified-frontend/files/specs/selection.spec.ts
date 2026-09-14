import { expect, test, type APIRequestContext } from "@playwright/test";

import { adminApi, createFolder, getNode, purge, roots, runTag, type DriveNode } from "../../helpers/drive";

/** Ticket 006: selection, the two-action bulk bar and mixed batch outcomes. */

test.describe.configure({ mode: "serial" });

let api: APIRequestContext;
let home: DriveNode;
let destination: DriveNode;
let rows: DriveNode[];

test.beforeEach(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	home = await createFolder(api, personal, runTag("w4-select"));
	rows = [];
	for (const name of ["row-a", "row-b", "row-c", "row-d"]) {
		rows.push(await createFolder(api, home.name, name));
	}
	destination = await createFolder(api, home.name, "zz-destination");
});

test.afterEach(async () => {
	await purge(api, home.name);
	await api.dispose();
});

test("Space selects, Shift+Space extends the range and Escape clears", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list&sort=title&dir=asc`);
	const listRows = page.locator("[data-node]");
	await expect(listRows).toHaveCount(5);

	await listRows.first().focus();
	await page.keyboard.press(" ");
	await expect(page.getByText("1 selected")).toBeVisible();

	await listRows.nth(2).focus();
	await page.keyboard.press("Shift+ ");
	await expect(page.getByText("3 selected")).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(page.getByText("selected")).toHaveCount(0);
	await expect(page.getByRole("searchbox", { name: "Search files" })).toBeVisible();
});

test("Ctrl-click enters selection and the bulk bar carries two actions", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list&sort=title&dir=asc`);
	const listRows = page.locator("[data-node]");
	await expect(listRows).toHaveCount(5);

	await listRows.first().click({ modifiers: ["ControlOrMeta"] });
	await expect(page.getByText("1 selected")).toBeVisible();
	await listRows.nth(1).click({ modifiers: ["ControlOrMeta"] });
	await expect(page.getByText("2 selected")).toBeVisible();

	await expect(page.getByRole("button", { name: "Move", exact: true })).toBeEnabled();
	await expect(page.getByRole("button", { name: "Move to trash" })).toBeEnabled();
	await expect(page.getByRole("button", { name: "Rename" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
});

// frappe-ui's ListRow answers the click itself while the list is selectable,
// so FilesListing takes shift-clicks in the capture phase (fixed here).
test("Shift-click takes the loaded visible range", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list&sort=title&dir=asc`);
	const listRows = page.locator("[data-node]");
	await expect(listRows).toHaveCount(5);

	await listRows.first().click({ modifiers: ["ControlOrMeta"] });
	await expect(page.getByText("1 selected")).toBeVisible();
	await listRows.nth(3).click({ modifiers: ["Shift"] });
	await expect(page.getByText("4 selected")).toBeVisible();
});

test("Enter on a focused row opens it", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list&sort=title&dir=asc`);
	const listRows = page.locator("[data-node]");
	await expect(listRows).toHaveCount(5);
	await listRows.first().focus();
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(new RegExp(`/files/f/${rows[0]!.name}`));
});

test("changing the destination clears the selection", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list&sort=title&dir=asc`);
	await page.locator("[data-node]").first().click({ modifiers: ["ControlOrMeta"] });
	await expect(page.getByText("1 selected")).toBeVisible();

	await page.getByRole("navigation", { name: "File views" }).getByRole("link", { name: "Starred" }).click();
	await expect(page).toHaveURL(/\/files\/starred$/);
	await expect(page.getByText("selected")).toHaveCount(0);
});

test("a mixed bulk move reports both halves and keeps the failures selected", async ({ page }) => {
	// row-a already exists inside the destination, so moving it must conflict
	// while row-b moves cleanly.
	const clash = await createFolder(api, destination.name, "row-a");

	await page.goto(`/files/f/${home.name}?view=list&sort=title&dir=asc`);
	const listRows = page.locator("[data-node]");
	await expect(listRows).toHaveCount(5);
	await listRows.first().click({ modifiers: ["ControlOrMeta"] });
	await listRows.nth(1).click({ modifiers: ["ControlOrMeta"] });
	await expect(page.getByText("2 selected")).toBeVisible();

	await page.getByRole("button", { name: "Move", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Move to" });
	await dialog.getByRole("button", { name: home.title }).click();
	await dialog.getByRole("button", { name: destination.title }).click();
	await dialog.getByRole("button", { name: "Move", exact: true }).click();

	await expect(page.getByText("1 moved · 1 failed")).toBeVisible();
	await expect(page.getByText("1 selected")).toBeVisible();

	await page.getByRole("button", { name: "Details" }).click();
	await expect(page.getByRole("dialog", { name: "Items that failed" })).toBeVisible();
	await expect(page.getByText(rows[0]!.name, { exact: true })).toBeVisible();

	expect((await getNode(api, rows[1]!.name)).parent).toBe(destination.name);
	expect((await getNode(api, rows[0]!.name)).parent).toBe(home.name);
	expect(clash.name).toBeTruthy();
});

test("a clean bulk move to trash empties the selection", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list&sort=title&dir=asc`);
	const listRows = page.locator("[data-node]");
	await expect(listRows).toHaveCount(5);
	await listRows.first().click({ modifiers: ["ControlOrMeta"] });
	await listRows.nth(1).click({ modifiers: ["ControlOrMeta"] });

	await page.getByRole("button", { name: "Move to trash" }).click();
	await expect(page.getByText("2 moved to trash · 0 failed")).toBeVisible();
	await expect(page.getByText("selected")).toHaveCount(0);
	expect((await getNode(api, rows[0]!.name)).state).toBe("Trashed");
});

test("Select all loaded selects only the loaded rows", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list&sort=title&dir=asc`);
	await expect(page.locator("[data-node]")).toHaveCount(5);
	await page.getByRole("button", { name: "More file actions" }).click();
	await page.getByRole("menuitem", { name: "Select all loaded" }).click();
	await expect(page.getByText("5 selected")).toBeVisible();
});
