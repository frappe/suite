import { request, type APIRequestContext, type Locator, type Page, expect, test } from "@playwright/test";

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
import { PERSON, PERSON_NAME, ensurePerson, personContext } from "../../helpers/person";
import { MOBILE_VIEWPORT } from "../../helpers/shell";

/** Stage 9: the Drive share dialog (unified spec §7), opened from a /d/ surface. */

test.describe.configure({ mode: "serial" });
// Exercise end-of-day conversion in a timezone with a non-hour UTC offset.
test.use({ timezoneId: "Asia/Kolkata" });

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
	ensurePerson();
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
	return (await response.json()).data as Grant;
}

async function openShare(page: Page, node: string) {
	await page.goto(`/d/${node}`);
	await page.getByRole("button", { name: "Share", exact: true }).click();
	return shareDialog(page);
}

async function shareDialog(page: Page) {
	const dialog = page.getByRole("dialog", { name: "Share", exact: true });
	await expect(whoHasAccess(dialog).getByRole("heading", { name: "Who has access" })).toBeVisible();
	return dialog;
}

const whoHasAccess = (dialog: Locator) => dialog.getByRole("region", { name: "Who has access" });
const rowFor = (dialog: Locator, text: string | RegExp) =>
	whoHasAccess(dialog).getByRole("listitem").filter({ hasText: text });
const accessButton = (row: Locator) => row.getByRole("button", { name: /^Access for / });
const peopleField = (dialog: Locator) => dialog.getByRole("combobox", { name: "Add people, groups or emails" });

/** Picks PERSON in the people field. The pick waits in "People to add" until Share is pressed. */
async function pickPerson(page: Page, dialog: Locator) {
	await peopleField(dialog).fill(PERSON.split("@")[0]);
	await page.getByRole("option", { name: new RegExp(PERSON_NAME) }).click();
	// The options stay open for more picks; Escape closes them, not the dialog.
	await peopleField(dialog).press("Escape");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole("list", { name: "People to add" }).getByRole("listitem")).toContainText([PERSON_NAME]);
}

/** Adds everyone picked, without the notification email. */
async function sharePicked(dialog: Locator) {
	await dialog.getByRole("checkbox", { name: "Notify by email" }).uncheck();
	await dialog.getByRole("button", { name: "Share", exact: true }).click();
	await expect(dialog.getByRole("list", { name: "People to add" })).toBeHidden();
}

/** Opens a row's access menu and sets an expiry day through the inline editor. */
async function setExpiry(page: Page, row: Locator, day: string) {
	await accessButton(row).click();
	await page.getByRole("menuitem", { name: "Set expiry" }).click();
	const field = row.getByPlaceholder("Expiry date");
	await field.fill(day);
	await field.press("Tab");
	await row.getByRole("button", { name: "Save" }).click();
}

test("a local grant: pick a person, give Edit, and the server holds it", async ({ page }) => {
	const dialog = await openShare(page, file.name);

	await pickPerson(page, dialog);
	await dialog.getByRole("combobox", { name: "Access for people you add" }).click();
	await page.getByRole("option", { name: "Edit", exact: true }).click();
	// A pick is not a grant until Share is pressed.
	expect((await grants(file.name)).some((grant) => grant.principal === PERSON)).toBe(false);
	await sharePicked(dialog);

	const rows = whoHasAccess(dialog).getByRole("listitem");
	// The owner comes first, with nothing to change.
	await expect(rows.first()).toContainText("Owner");
	await expect(rows.first().getByRole("button")).toHaveCount(0);
	await expect(accessButton(rowFor(dialog, PERSON))).toHaveAccessibleName(/: Edit$/);
	await expect(peopleField(dialog)).toHaveValue("");
	expect((await grants(file.name)).find((grant) => grant.principal === PERSON)?.role).toBe(40);
});

test("a person's access ends on a chosen day, and a role change keeps it", async ({ page }) => {
	await putGrant(file.name, PERSON, { role: 10 });
	const dialog = await openShare(page, file.name);

	const row = rowFor(dialog, PERSON);
	await setExpiry(page, row, "2031-01-15");
	await expect(row.getByText(/Until/)).toBeVisible();

	await accessButton(row).click();
	await page.getByRole("menuitem", { name: "Role" }).click();
	await page.getByRole("menuitem", { name: "Comment", exact: true }).click();
	await expect(accessButton(row)).toHaveAccessibleName(/: Comment$/);
	const stored = (await grants(file.name)).find((grant) => grant.principal === PERSON)!;
	expect(stored).toMatchObject({ role: 20, expires_on: "2031-01-15T18:29:59Z" });
});

test("removing a person's grant takes them off the list and the server", async ({ page }) => {
	await putGrant(file.name, PERSON, { role: 10 });
	const dialog = await openShare(page, file.name);

	await accessButton(rowFor(dialog, PERSON)).click();
	await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
	await expect(rowFor(dialog, PERSON)).toHaveCount(0);
	expect((await grants(file.name)).some((grant) => grant.principal === PERSON)).toBe(false);
});

test("an inherited grant shows its source; Deny access here, then Allow again", async ({ page }) => {
	await putGrant(home.name, PERSON, { role: 20 });
	const dialog = await openShare(page, file.name);

	const inherited = rowFor(dialog, PERSON).filter({ hasText: `via ${home.title}` });
	await expect(accessButton(inherited)).toHaveAccessibleName(/: Comment$/);
	await accessButton(inherited).click();
	await page.getByRole("menuitem", { name: "Deny access here" }).click();

	const denied = rowFor(dialog, PERSON_NAME).filter({ hasText: "Denied here" });
	await expect(denied).toBeVisible();
	expect((await grants(file.name)).find((grant) => grant.principal === PERSON)?.role).toBe(0);

	await accessButton(denied).click();
	await page.getByRole("menuitem", { name: "Allow again" }).click();
	await expect(rowFor(dialog, "Denied here")).toHaveCount(0);
	expect((await grants(file.name)).some((grant) => grant.principal === PERSON)).toBe(false);
});

test("a password link keeps its password when its expiry changes", async ({ page }) => {
	const link = await putGrant(file.name, "$LINK", { role: 10, password: "correct horse" });
	expect(link.has_password).toBe(true);
	const dialog = await openShare(page, file.name);

	const row = rowFor(dialog, "Anyone with this link");
	await expect(row.getByText(/Password set/)).toBeVisible();
	await setExpiry(page, row, "2031-01-15");

	await expect(row.getByText(/Until/)).toBeVisible();
	const stored = (await grants(file.name)).find((grant) => grant.name === link.name)!;
	expect(stored.expires_on).toBe("2031-01-15T18:29:59Z");
	expect(stored.has_password).toBe(true);
	await expect(row.getByText(/Password set/)).toBeVisible();
});

test("an outsider gets a link of their own", async ({ page }) => {
	const outsider = `${runTag("outsider")}@example.com`;
	const dialog = await openShare(page, file.name);

	await peopleField(dialog).fill(outsider);
	await page.getByRole("option", { name: `Send a link to ${outsider}` }).click();

	await expect(rowFor(dialog, `Sent to ${outsider}`)).toBeVisible();
	const sent = (await grants(file.name)).filter((grant) => grant.sent_to === outsider);
	expect(sent).toHaveLength(1);
	expect(sent[0]!.principal).toMatch(/^\$LINK:/);
});

test("Everyone on the web lets a guest read the item", async ({ page, baseURL }) => {
	const dialog = await openShare(page, file.name);

	const toggle = dialog.getByRole("switch", { name: "Everyone on the web" });
	await expect(toggle).not.toBeChecked();
	await toggle.click();

	await expect(rowFor(dialog, "Anyone on the internet can view")).toBeVisible();
	await expect(toggle).toBeChecked();
	expect((await grants(file.name)).find((grant) => grant.principal === "$PUBLIC")?.role).toBe(10);
	const guest = await request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
	const read = await guest.get(`${DRIVE}/nodes/${file.name}`);
	expect(read.status()).toBe(200);
	await guest.dispose();
});

test("a document surface places Share; a new share link is created from the dialog", async ({ page }) => {
	const deck = await createDocument(api, home.name, runTag("uf9-deck"), "Presentation");
	const dialog = await openShare(page, deck.name);

	await dialog.getByRole("button", { name: "Sharing options" }).click();
	await page.getByRole("menuitem", { name: "Create share link" }).click();
	const create = page.getByRole("dialog", { name: "Create share link" });
	await create.getByRole("button", { name: "Create link" }).click();
	await expect(create.getByRole("status")).toHaveText("Your share link is ready.");
	const links = (await grants(deck.name)).filter((grant) => grant.principal.startsWith("$LINK:"));
	expect(links).toHaveLength(1);
	expect(links[0]!.role).toBe(10);
	await create.getByRole("button", { name: "Done" }).click();
	await expect(create).toBeHidden();

	await expect(accessButton(rowFor(dialog, "Anyone with this link"))).toHaveAccessibleName(/: View$/);
	// The footer copies the item's own address.
	await expect(dialog.getByRole("button", { name: "Copy link" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("a folder row in Files opens the same dialog, and the grant lands on the folder", async ({ page }) => {
	const folder = await createFolder(api, home.name, "team-folder");
	await page.goto(`/drive/f/${home.name}?view=list`);
	await page.getByRole("button", { name: `Actions for ${folder.title}` }).click();
	await page.getByRole("menuitem", { name: "Share" }).click();

	const dialog = await shareDialog(page);
	await expect(dialog.getByText(folder.title, { exact: true })).toBeVisible();
	await pickPerson(page, dialog);
	await sharePicked(dialog);

	await accessButton(rowFor(dialog, PERSON)).click();
	await expect(page.getByRole("menuitem", { name: "Remove here and inside" })).toBeVisible();
	await page.keyboard.press("Escape");
	expect((await grants(folder.name)).find((grant) => grant.principal === PERSON)?.role).toBe(10);
});

test("a manager who lowers their own access is asked first, and the row loses Share", async ({ browser, baseURL }) => {
	const folder = await createFolder(api, home.name, "handover");
	await putGrant(home.name, PERSON, { role: 10 });
	await putGrant(folder.name, PERSON, { role: 50 });
	const context = await personContext(browser, baseURL!);
	const page = await context.newPage();

	await page.goto(`/drive/f/${home.name}?view=list`);
	await page.getByRole("button", { name: `Actions for ${folder.title}` }).click();
	await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
	await page.getByRole("menuitem", { name: "Share" }).click();

	const dialog = await shareDialog(page);
	const row = rowFor(dialog, PERSON).filter({ hasNotText: "via " });
	await expect(accessButton(row)).toHaveAccessibleName(/: Manage$/);
	await accessButton(row).click();
	await page.getByRole("menuitem", { name: "Role" }).click();
	await page.getByRole("menuitem", { name: "View", exact: true }).click();
	const ask = page.getByRole("dialog", { name: "Change your own access?" });
	await expect(ask.getByText("You will no longer be able to share this item.")).toBeVisible();
	await ask.getByRole("button", { name: "Change" }).click();

	// A non-manager sees no list, only why.
	await expect(dialog.getByText(/You can no longer share this item/)).toBeVisible();
	await expect(whoHasAccess(dialog)).toHaveCount(0);
	expect((await grants(folder.name)).find((grant) => grant.principal === PERSON)?.role).toBe(10);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();

	// The listing is read again, so the row offers only what View allows.
	await page.getByRole("button", { name: `Actions for ${folder.title}` }).click();
	await expect(page.getByRole("menuitem", { name: "Open", exact: true })).toBeVisible();
	await expect(page.getByRole("menuitem", { name: "Share" })).toHaveCount(0);
	await expect(page.getByRole("menuitem", { name: "Rename" })).toHaveCount(0);
	await context.close();
});

test.describe("on a phone", () => {
	test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true, isMobile: true });

	test("the share dialog opens as a bottom sheet with the same list", async ({ page }) => {
		const sheet = await openShare(page, file.name);
		await expect(sheet.getByRole("switch", { name: "Everyone on the web" })).toBeVisible();
		await expect(sheet.getByRole("button", { name: "Done" })).toBeVisible();
		const box = (await sheet.boundingBox())!;
		expect(box.y + box.height).toBeGreaterThanOrEqual(MOBILE_VIEWPORT.height - 2);
	});
});
