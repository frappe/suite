import { expect, test, type APIRequestContext } from "@playwright/test";

import {
	adminApi,
	children,
	createFolder,
	getNode,
	listView,
	purge,
	roots,
	runTag,
	type DriveNode,
} from "../../helpers/drive";

/** Ticket 006: single-row mutations keep the server authoritative. */

test.describe.configure({ mode: "serial" });

let api: APIRequestContext;
let home: DriveNode;
let target: DriveNode;
let sibling: DriveNode;
let destination: DriveNode;

test.beforeEach(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	home = await createFolder(api, personal, runTag("w4-mutate"));
	target = await createFolder(api, home.name, "target-folder");
	sibling = await createFolder(api, home.name, "sibling-folder");
	destination = await createFolder(api, home.name, "destination-folder");
});

test.afterEach(async () => {
	await purge(api, home.name);
	await api.dispose();
});

async function openRowMenu(page: import("@playwright/test").Page, title: string) {
	await page.getByRole("button", { name: `Actions for ${title}` }).click();
}

test("a rename conflict keeps the dialog open with the server message", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list`);
	await openRowMenu(page, target.title);
	await page.getByRole("menuitem", { name: "Rename" }).click();

	const dialog = page.getByRole("dialog");
	await dialog.getByRole("textbox").fill(sibling.title);
	await dialog.getByRole("button", { name: "Rename" }).click();

	await expect(dialog).toBeVisible();
	await expect(dialog.getByText(/already|exists|conflict/i)).toBeVisible();
	await expect(dialog.getByRole("textbox")).toHaveValue(sibling.title);

	const stored = await getNode(api, target.name);
	expect(stored.title).toBe("target-folder");
});

test("a rename that succeeds updates the row and the server", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list`);
	await openRowMenu(page, target.title);
	await page.getByRole("menuitem", { name: "Rename" }).click();

	const dialog = page.getByRole("dialog");
	await dialog.getByRole("textbox").fill("renamed-folder");
	await dialog.getByRole("button", { name: "Rename" }).click();

	await expect(dialog).toBeHidden();
	await expect(page.getByText("renamed-folder", { exact: true })).toBeVisible();
	expect((await getNode(api, target.name)).title).toBe("renamed-folder");
});

test("Move uses the Drive folder picker and rewrites the parent", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list`);
	await openRowMenu(page, target.title);
	await page.getByRole("menuitem", { name: "Move", exact: true }).click();

	const dialog = page.getByRole("dialog", { name: "Move to" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: home.title }).click();
	await dialog.getByRole("button", { name: destination.title }).click();
	await dialog.getByRole("button", { name: "Move", exact: true }).click();

	await expect(dialog).toBeHidden();
	await expect.poll(async () => (await getNode(api, target.name)).parent).toBe(destination.name);
});

test("Star from the row menu reaches the Starred view", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list`);
	await openRowMenu(page, target.title);
	await page.getByRole("menuitem", { name: "Star", exact: true }).click();

	await expect
		.poll(async () => (await listView(api, "favourites")).rows.some((row) => row.name === target.name))
		.toBe(true);

	await page.goto("/files/starred");
	await expect(page.getByText(target.title, { exact: true })).toBeVisible();
});

// BUG: NodeShape in suite/drive/http/shapes.py carries no `favourite` field, so
// every listing row arrives without star state. The optimistic flag written by
// toggleStar() disappears on the next refetch: the row never paints its star and
// the menu never offers Unstar.
test.fixme("a starred row shows its star and offers Unstar", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list`);
	await openRowMenu(page, target.title);
	await page.getByRole("menuitem", { name: "Star", exact: true }).click();

	await expect
		.poll(async () => (await listView(api, "favourites")).rows.some((row) => row.name === target.name))
		.toBe(true);

	await page.reload();
	await openRowMenu(page, target.title);
	await expect(page.getByRole("menuitem", { name: "Unstar" })).toBeVisible();
	await page.getByRole("menuitem", { name: "Unstar" }).click();
	await expect
		.poll(async () => (await listView(api, "favourites")).rows.some((row) => row.name === target.name))
		.toBe(false);
});

test("Make a copy accepts the title the server returns", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list`);
	await openRowMenu(page, target.title);
	await page.getByRole("menuitem", { name: "Make a copy" }).click();

	const dialog = page.getByRole("dialog", { name: "Make a copy" });
	await dialog.getByRole("button", { name: home.title }).click();
	await dialog.getByRole("button", { name: "Copy", exact: true }).click();
	await expect(dialog).toBeHidden();

	await expect
		.poll(async () => (await children(api, home.name)).rows.map((row) => row.title))
		.toContain("target-folder (2)");
});

test("Move to trash removes the row from the folder listing", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list`);
	await openRowMenu(page, sibling.title);
	await page.getByRole("menuitem", { name: "Move to trash" }).click();

	await expect(page.getByText(sibling.title, { exact: true })).toHaveCount(0);
	expect((await getNode(api, sibling.name)).state).toBe("Trashed");
});

test("Share stays explicitly unavailable until ticket 008", async ({ page }) => {
	await page.goto(`/files/f/${home.name}?view=list`);
	await openRowMenu(page, target.title);
	await page.getByRole("menuitem", { name: "Share" }).click();
	await expect(page.getByText("Sharing is unavailable until ticket 008.")).toBeVisible();
});
