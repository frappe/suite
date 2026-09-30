import { type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { expect, requireSiteFilesFlip, test } from "../../helpers/flips";
import { DRIVE, adminApi, createDocument, createFolder, purge, roots, runTag, type DriveNode } from "../../helpers/drive";

/**
 * Stage 11 follow-up: guests sign their comments (spec §10.5, ticket 011).
 *
 * A guest opens each document through a comment link. The server picks the
 * `/d/` address from `suite_flip_files`, so run these with the key on.
 */

const SIGNED_OUT = { cookies: [], origins: [] };
const PHONE = { width: 390, height: 844 };
const RLO = "\u202E";

type Product = { label: string; doctype: string; title: string; post: string };

const PRODUCTS: Product[] = [
	{ label: "Writer", doctype: "Writer Document", title: "Guest names doc", post: "Add" },
	{ label: "Sheets", doctype: "Sheet", title: "Guest names sheet", post: "Comment" },
	{ label: "Slides", doctype: "Presentation", title: "Guest names deck", post: "Add" },
];


let api: APIRequestContext;
let home: DriveNode;
const docs = new Map<string, DriveNode>();

test.beforeAll(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	home = await createFolder(api, personal, runTag("uf11-guest-names"));
	for (const product of PRODUCTS) docs.set(product.label, await createDocument(api, home.name, product.title, product.doctype));
});

test.afterAll(async () => {
	await purge(api, home.name);
	await api.dispose();
});

/** Makes a comment link on a node and answers its token. */
async function commentLink(node: string): Promise<string> {
	const response = await api.put(`${DRIVE}/nodes/${node}/grants/${encodeURIComponent("$LINK")}`, { data: { role: 20 } });
	expect(response.ok(), await response.text()).toBe(true);
	const { data } = (await response.json()) as { data: { url: string } };
	return data.url.split("/").pop()!;
}

/** The authors the server stored on a node's comments. */
async function storedAuthors(node: string): Promise<Array<{ author: string; author_name: string | null }>> {
	const response = await api.get(`${DRIVE}/nodes/${node}/threads`);
	expect(response.ok()).toBe(true);
	const { data } = (await response.json()) as {
		data: { threads: Array<{ comments: Array<{ author: string; author_name: string | null }> }> };
	};
	return data.threads.flatMap((thread) => thread.comments.map(({ author, author_name }) => ({ author, author_name })));
}

async function openComments(page: Page): Promise<Locator> {
	// The product's own title bar holds the Comments button. The body may still load behind it.
	await page.getByRole("button", { name: "Comments" }).click({ timeout: 20_000 });
	const panel = page.getByRole("complementary", { name: "Comments" });
	await expect(panel.getByRole("textbox", { name: "New comment" })).toBeVisible();
	return panel;
}

test.describe("a guest with a comment link", () => {
	test.use({ storageState: SIGNED_OUT });
	test.beforeEach(() => requireSiteFilesFlip(true));

	for (const product of PRODUCTS) {
		test(`${product.label}: the guest signs a comment, and the name is there after a reload`, async ({ page }) => {
			const doc = docs.get(product.label)!;
			await page.goto(`/l/${await commentLink(doc.name)}`);
			await expect(page).toHaveURL(new RegExp(`/d/${doc.name}`));
			await expect(page.getByTestId("guest-frame")).toBeVisible();

			const panel = await openComments(page);
			const name = panel.getByRole("textbox", { name: "Your name" });
			const comment = panel.getByRole("textbox", { name: "New comment" });
			await expect(name).toHaveValue("");
			await expect(name).toHaveAttribute("maxlength", "140");

			// Focus goes from the name to the comment.
			await name.fill("  Ravi (Acme)  ");
			await page.keyboard.press("Tab");
			await expect(comment).toBeFocused();
			await comment.fill(`Signed note in ${product.label}`);
			await panel.getByRole("button", { name: product.post, exact: true }).click();

			await expect(panel.getByText(`Signed note in ${product.label}`)).toBeVisible();
			await expect(panel.locator('[data-part="name"]')).toHaveText("Ravi (Acme)");
			await expect(panel.locator('[data-part="marker"]')).toHaveText("· Guest");
			expect(await storedAuthors(doc.name)).toEqual([{ author: "Guest", author_name: "Ravi (Acme)" }]);

			await page.reload();
			const again = await openComments(page);
			await expect(again.getByRole("textbox", { name: "Your name" })).toHaveValue("Ravi (Acme)");
		});
	}

	for (const product of PRODUCTS) {
		test(`${product.label}: on a phone, a long name with a bidi override keeps the Guest marker in view`, async ({ page }) => {
			await page.setViewportSize(PHONE);
			const doc = await createDocument(api, home.name, `${product.title} on a phone`, product.doctype);
			await page.goto(`/l/${await commentLink(doc.name)}`);

			const panel = await openComments(page);
			await panel.getByRole("textbox", { name: "Your name" }).fill(`${RLO}${"W".repeat(139)}`);
			await panel.getByRole("textbox", { name: "New comment" }).fill("Long name");
			await panel.getByRole("button", { name: product.post, exact: true }).click();

			const name = panel.locator('[data-part="name"]');
			const marker = panel.locator('[data-part="marker"]');
			await expect(marker).toHaveText("· Guest");
			await expect(marker).toBeInViewport({ ratio: 1 });
			const [nameBox, markerBox, panelBox] = await Promise.all([name.boundingBox(), marker.boundingBox(), panel.boundingBox()]);
			// The override stays inside the name: the marker follows it and stays in the panel.
			expect(nameBox!.x + nameBox!.width).toBeLessThanOrEqual(markerBox!.x);
			expect(markerBox!.x + markerBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width);
		});
	}

	test("an empty name posts as plain Guest", async ({ page }) => {
		const product = PRODUCTS[0]!;
		const doc = await createDocument(api, home.name, "Unsigned note", product.doctype);
		await page.goto(`/l/${await commentLink(doc.name)}`);

		const panel = await openComments(page);
		await expect(panel.getByRole("textbox", { name: "Your name" })).toHaveValue("");
		await panel.getByRole("textbox", { name: "New comment" }).fill("Unsigned note");
		await panel.getByRole("button", { name: product.post, exact: true }).click();

		await expect(panel.getByText("Unsigned note", { exact: true })).toBeVisible();
		await expect(panel.getByText("Guest", { exact: true })).toBeVisible();
		expect(await storedAuthors(doc.name)).toEqual([{ author: "Guest", author_name: null }]);
	});
});

test.describe("a signed-in user", () => {
	for (const product of PRODUCTS) {
		test(`${product.label}: the comment composer has no name field`, async ({ page }) => {
			await page.goto(`/d/${docs.get(product.label)!.name}`);
			const panel = await openComments(page);
			await expect(panel.getByRole("textbox", { name: "Your name" })).toHaveCount(0);
		});
	}
});
