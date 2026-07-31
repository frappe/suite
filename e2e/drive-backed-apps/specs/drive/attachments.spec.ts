import type { APIRequestContext, Page } from "@playwright/test";

import { expect, test } from "../../fixtures/test";
import { frappeData } from "../../../shared/frappe";

/**
 * The Attachments section is a three-level tree of virtual nodes - doctype >
 * document > files - that only exists in the listing. The nodes look like
 * folders but aren't Drive entities, so navigating them takes its own path.
 *
 * Files attach to the caller's own User record: the one document a Suite User
 * is always allowed to write, and what the section shows in practice.
 */

const DOCTYPE = "User";

/** Attach a file to `docname`, returning its Drive id. */
async function attachFile(
	request: APIRequestContext,
	docname: string,
	label: string,
): Promise<string> {
	const uploaded = await request.post("/api/method/upload_file", {
		multipart: {
			doctype: DOCTYPE,
			docname,
			is_private: "1",
			file: {
				name: `${label}.txt`,
				mimeType: "text/plain",
				buffer: Buffer.from(`attachment for ${label}`),
			},
		},
	});
	return (await frappeData<{ name: string }>(uploaded)).name;
}

/** The breadcrumb trail in the navbar, outermost first. */
async function trail(page: Page): Promise<string[]> {
	const crumbs = page.getByTestId("breadcrumbs");
	await expect(crumbs).toBeVisible();
	await expect(page.getByTestId("breadcrumbs-loading")).toHaveCount(0);
	return (await crumbs.innerText())
		.split("/")
		.map((part: string) => part.trim())
		.filter(Boolean);
}

const row = (page: Page, name: string) =>
	page.getByTestId(`drive-entity-${name}`);

async function openRow(page: Page, name: string): Promise<void> {
	await expect(row(page, name)).toBeVisible();
	await row(page, name).click();
}

/** Emails carry regex metacharacters, so compare the path itself. */
async function expectPath(page: Page, path: string): Promise<void> {
	await expect.poll(() => new URL(page.url()).pathname).toBe(path);
}

const documentPath = (docname: string) =>
	`/drive/attachments/${DOCTYPE}/${docname}`;

/*
 * FIXME: the Attachments section comes up empty on a freshly installed site, so
 * every test below fails there - and the last one would pass for the wrong
 * reason. A file uploaded through `upload_file` stays in the framework's `Home`
 * folder instead of being adopted into the Drive tree; on a site that has been
 * through the migration patches it lands in the owner's Drive folder, which is
 * why this only shows up in CI. Unskip once a fresh install adopts them too.
 */

test.fixme("drilling from doctype to document to file, and back up the trail", async ({
	owner,
	run,
}) => {
	const page = owner.page;
	const docname = owner.user.email;
	const file = await attachFile(page.request, docname, `attach-${run.run_id}`);

	await page.goto("/drive/attachments");
	await expect.poll(() => trail(page)).toEqual(["Attachments"]);

	// The doctype node routes into its own bucket, not to /drive/d/User.
	await openRow(page, DOCTYPE);
	await expectPath(page, `/drive/attachments/${DOCTYPE}`);
	await expect.poll(() => trail(page)).toEqual(["Attachments", DOCTYPE]);

	await openRow(page, docname);
	await expectPath(page, documentPath(docname));
	await expect
		.poll(() => trail(page))
		.toEqual(["Attachments", DOCTYPE, docname]);
	await expect(row(page, file)).toBeVisible();

	// An ancestor crumb walks back out.
	await page.locator("#navbar").getByRole("link", { name: DOCTYPE }).click();
	await expectPath(page, `/drive/attachments/${DOCTYPE}`);
	await expect(row(page, docname)).toBeVisible();

	await page
		.locator("#navbar")
		.getByRole("link", { name: "Attachments" })
		.click();
	await expectPath(page, "/drive/attachments");
	await expect(row(page, DOCTYPE)).toBeVisible();
});

test.fixme("a deep link lands on the document's attachments", async ({
	owner,
	run,
}) => {
	const page = owner.page;
	const docname = owner.user.email;
	const file = await attachFile(page.request, docname, `deep-${run.run_id}`);

	await page.goto(documentPath(docname));
	await expect(row(page, file)).toBeVisible();
	await expect
		.poll(() => trail(page))
		.toEqual(["Attachments", DOCTYPE, docname]);
});

test.fixme("virtual nodes offer no folder tree to expand", async ({ owner, run }) => {
	const page = owner.page;
	const docname = owner.user.email;
	await attachFile(page.request, docname, `expand-${run.run_id}`);

	await page.goto("/drive/attachments");
	await expect(row(page, DOCTYPE)).toBeVisible();
	// They have no Drive children to fetch, so they carry no expand control.
	await expect(page.getByTestId(`drive-expand-${DOCTYPE}`)).toHaveCount(0);

	await page.goto(`/drive/attachments/${DOCTYPE}`);
	await expect(row(page, docname)).toBeVisible();
	await expect(page.getByTestId(`drive-expand-${docname}`)).toHaveCount(0);
});

test.fixme("the attached file opens from the listing", async ({ owner, run }) => {
	const page = owner.page;
	const docname = owner.user.email;
	const file = await attachFile(page.request, docname, `open-${run.run_id}`);

	await page.goto(documentPath(docname));
	await openRow(page, file);
	// The preview route appends a slug of the file name.
	await expect
		.poll(() => new URL(page.url()).pathname.startsWith(`/drive/f/${file}`))
		.toBe(true);
});

test.fixme("another user's attachments stay out of the listing", async ({
	owner,
	collaborator,
	run,
}) => {
	const docname = owner.user.email;
	const file = await attachFile(
		owner.page.request,
		docname,
		`private-${run.run_id}`,
	);

	const page = collaborator.page;
	await page.goto(documentPath(docname));
	await expect(row(page, file)).toHaveCount(0);
});
