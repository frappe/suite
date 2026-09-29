import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

import {
	DRIVE,
	adminApi,
	createDocument,
	createFolder,
	purge,
	roots,
	runTag,
	uploadFile,
	type DriveNode,
} from "../../helpers/drive";
import { MOBILE_VIEWPORT } from "../../helpers/shell";

/** Stage 9: the Drive share dialog (unified spec §7), opened from a /d/ surface. */

test.describe.configure({ mode: "serial" });

// A System User that exists on the test site. Grants to it send no email: the
// bench runs no worker, and the address is not a real mailbox.
const PERSON = "backfill-owner@example.com";

interface Grant {
	name?: string;
	principal: string;
	role: number;
	expires_on: string | null;
	has_password: boolean;
	sent_to?: string | null;
	url?: string;
}

let api: APIRequestContext;
let home: DriveNode;
let file: DriveNode;

test.beforeEach(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	home = await createFolder(api, personal, runTag("uf9-share"));
	file = await uploadFile(api, home.name, "brief.txt", Buffer.from("share me"), "text/plain");
});

test.afterEach(async () => {
	await purge(api, home.name);
	await api.dispose();
});

async function grants(node: string): Promise<Grant[]> {
	const response = await api.get(`${DRIVE}/nodes/${node}/grants`);
	expect(response.ok(), await response.text()).toBe(true);
	return ((await response.json()).data as { grants: Grant[] }).grants;
}

async function putGrant(node: string, principal: string, body: Record<string, unknown>): Promise<Grant> {
	const response = await api.put(`${DRIVE}/nodes/${node}/grants/${encodeURIComponent(principal)}`, { data: body });
	expect(response.ok(), await response.text()).toBe(true);
	return ((await response.json()).data as { grant: Grant }).grant;
}

async function openShare(page: Page, node: string) {
	await page.goto(`/d/${node}`);
	await page.getByRole("button", { name: "Share", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: /^Share "/ });
	await expect(dialog.getByRole("heading", { name: "People" })).toBeVisible();
	return dialog;
}

test("a local grant: pick a person, give Edit, and the server holds it", async ({ page }) => {
	const dialog = await openShare(page, file.name);

	await dialog.getByRole("combobox", { name: "Role for people you add" }).click();
	await page.getByRole("option", { name: "Edit" }).click();
	await dialog.getByPlaceholder("Add people, groups or emails").fill("backfill-owner");
	await page.getByRole("option", { name: /Backfill Owner/ }).click();

	const row = dialog.getByRole("region", { name: "People" }).getByRole("listitem").filter({ hasText: "Backfill Owner" });
	await expect(row.getByRole("button")).toHaveText(/Edit/);
	await expect(dialog.getByPlaceholder("Add people, groups or emails")).toHaveValue("");
	expect((await grants(file.name)).find((grant) => grant.principal === PERSON)?.role).toBe(40);
});

test("an inherited grant: Deny access here, then Allow again", async ({ page }) => {
	await putGrant(home.name, PERSON, { role: 20 });
	const dialog = await openShare(page, file.name);

	await dialog.getByRole("button", { name: `From "${home.title}"` }).click();
	const inherited = dialog.getByRole("region", { name: `From ${home.title}` });
	await expect(inherited.getByText(PERSON)).toBeVisible();
	await inherited.getByRole("button", { name: "Deny access here" }).click();

	const people = dialog.getByRole("region", { name: "People" });
	await expect(people.getByText("Denied here")).toBeVisible();
	expect((await grants(file.name)).find((grant) => grant.principal === PERSON)?.role).toBe(0);

	await people.getByRole("button", { name: "Allow again" }).click();
	await expect(people.getByText("Denied here")).toBeHidden();
	expect((await grants(file.name)).some((grant) => grant.principal === PERSON)).toBe(false);
});

test("a password link keeps its password when its expiry changes", async ({ page }) => {
	const link = await putGrant(file.name, "$LINK", { role: 10, password: "correct horse" });
	expect(link.has_password).toBe(true);
	const dialog = await openShare(page, file.name);

	const links = dialog.getByRole("region", { name: "Share links" });
	await expect(links.getByRole("img", { name: "Password set" })).toBeVisible();
	await links.getByRole("button", { name: "Link options" }).click();
	await page.getByRole("menuitem", { name: "Set expiry" }).click();
	const day = links.getByPlaceholder("Expiry date");
	await day.fill("2031-01-15");
	await day.press("Tab");
	await links.getByRole("button", { name: "Save" }).click();

	await expect(links.getByText(/Expires/)).toBeVisible();
	const stored = (await grants(file.name)).find((grant) => grant.name === link.name)!;
	expect(stored.expires_on).toBe("2031-01-15 23:59:59");
	expect(stored.has_password).toBe(true);
	await expect(links.getByRole("img", { name: "Password set" })).toBeVisible();
});

test("an outsider gets a link of their own", async ({ page }) => {
	const outsider = `${runTag("outsider")}@example.com`;
	const dialog = await openShare(page, file.name);

	await dialog.getByPlaceholder("Add people, groups or emails").fill(outsider);
	await page.getByRole("option", { name: `Send a link to ${outsider}` }).click();

	const links = dialog.getByRole("region", { name: "Share links" });
	await expect(links.getByText(`sent to ${outsider}`)).toBeVisible();
	const sent = (await grants(file.name)).filter((grant) => grant.sent_to === outsider);
	expect(sent).toHaveLength(1);
	expect(sent[0]!.principal).toMatch(/^\$LINK:/);
});

test("Public on the web lets a guest read the item", async ({ page, baseURL }) => {
	const dialog = await openShare(page, file.name);

	await dialog.getByRole("listitem").filter({ hasText: "Public on the web" }).getByRole("button").click();
	await page.getByRole("menuitem", { name: "On" }).click();

	await expect(dialog.getByText("Anyone on the internet can view")).toBeVisible();
	expect((await grants(file.name)).find((grant) => grant.principal === "$PUBLIC")?.role).toBe(10);
	const guest = await request.newContext({ baseURL });
	const read = await guest.get(`${DRIVE}/nodes/${file.name}`);
	expect(read.status()).toBe(200);
	await guest.dispose();
});

test("a document surface places Share, and it opens the same dialog", async ({ page }) => {
	const deck = await createDocument(api, home.name, runTag("uf9-deck"), "Presentation");
	const dialog = await openShare(page, deck.name);

	await expect(dialog.getByRole("heading", { name: "General access" })).toBeVisible();
	await dialog.getByRole("button", { name: "New link" }).click();
	await expect(dialog.getByRole("region", { name: "Share links" }).getByText("View link")).toBeVisible();
	expect((await grants(deck.name)).filter((grant) => grant.principal.startsWith("$LINK:"))).toHaveLength(1);
});

test.describe("on a phone", () => {
	test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true, isMobile: true });

	test("the share dialog opens as a bottom sheet with the same sections", async ({ page }) => {
		await page.goto(`/d/${file.name}`);
		await page.getByRole("button", { name: "Share", exact: true }).click();
		const sheet = page.getByRole("dialog", { name: /^Share "/ });
		await expect(sheet.getByRole("heading", { name: "People" })).toBeVisible();
		await expect(sheet.getByRole("heading", { name: "General access" })).toBeVisible();
		await expect(sheet.getByRole("heading", { name: "Share links" })).toBeVisible();
		const box = (await sheet.boundingBox())!;
		expect(box.y + box.height).toBeGreaterThanOrEqual(MOBILE_VIEWPORT.height - 2);
	});
});
