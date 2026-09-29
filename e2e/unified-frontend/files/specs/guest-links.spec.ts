import { execFileSync } from "node:child_process";

import { expect, request, test, type APIRequestContext } from "@playwright/test";

import { loginViaApi } from "../../../shared/auth";
import { DRIVE, adminApi, createDocument, createFolder, purge, roots, runTag, type DriveNode } from "../../helpers/drive";

/**
 * Stage 8: guest and link routes (spec §10, ticket 011).
 *
 * `/l/<token>` and the dead-link page are server routes. The Vite dev server
 * does not proxy `/l/`, so those cases talk to the bench web server itself:
 * `BENCH_WEB_URL`, default the dev site's port.
 */

const BENCH = process.env.BENCH_PATH ?? "/home/faris/benches/suite-bench";
const SITE = process.env.BENCH_SITE ?? "slides.localhost";
const SERVER = process.env.BENCH_WEB_URL ?? "http://127.0.0.1:8006";
const SIGNED_OUT = { cookies: [], origins: [] };
const PHONE = { width: 390, height: 844 };

const NOT_FOUND_COPY = "This link doesn't work. It may be mistyped, or its owner turned it off.";
const EXPIRED_COPY = "This link has expired. Ask the person who shared it for a new one.";

test.describe.configure({ mode: "serial" });

let api: APIRequestContext;
let home: DriveNode;
let folder: DriveNode;
let doc: DriveNode;

test.beforeAll(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	home = await createFolder(api, personal, runTag("uf8"));
	folder = await createFolder(api, home.name, "Shared plans");
	doc = await createDocument(api, home.name, "Guest brief", "Writer Document");
});

test.afterAll(async () => {
	await purge(api, home.name);
	await api.dispose();
});

/** Makes a share link on a node and answers its token. */
async function shareLink(node: string, body: Record<string, unknown> = { role: 10 }): Promise<string> {
	const response = await api.put(`${DRIVE}/nodes/${node}/grants/${encodeURIComponent("$LINK")}`, { data: body });
	expect(response.ok(), await response.text()).toBe(true);
	const { data } = (await response.json()) as { data: { url: string } };
	return data.url.split("/").pop()!;
}

/** A context on the bench web server, signed in or not. No redirect is followed. */
async function server(signedIn: boolean): Promise<APIRequestContext> {
	const context = await request.newContext({ baseURL: SERVER, extraHTTPHeaders: { Host: SITE } });
	if (signedIn) await loginViaApi(context);
	return context;
}

/** Moves a link's expiry into the past. The grant route refuses a past expiry. */
function expireLink(token: string): void {
	execFileSync(
		`${BENCH}/env/bin/python`,
		[
			"-c",
			`import frappe, sys
frappe.init(site=${JSON.stringify(SITE)})
frappe.connect()
frappe.db.set_value("Drive Grant", {"principal": "$LINK:" + sys.argv[1]}, "expires_on", "2020-01-01 00:00:00", update_modified=False)
frappe.db.commit()
frappe.destroy()`,
			token,
		],
		{ cwd: `${BENCH}/sites` },
	);
}

test.describe("the server resolves a share link", () => {
	test("/l/<token> answers 302 to the node with the token in the fragment only", async () => {
		const folderToken = await shareLink(folder.name);
		const docToken = await shareLink(doc.name);
		const guest = await server(false);

		for (const [path, node, token] of [
			[`/l/${folderToken}`, folder.name, folderToken],
			[`/drive/l/${folderToken}`, folder.name, folderToken],
			[`/l/${docToken}`, doc.name, docToken],
		] as const) {
			const response = await guest.get(path, { maxRedirects: 0 });
			expect(response.status()).toBe(302);
			const location = response.headers().location ?? "";
			// `suite_flip_files` off: `/drive/g/`. On: `/drive/f/` for a folder, `/d/` for a document.
			expect(location).toMatch(new RegExp(`^/(drive/g|drive/f|d)/${node}#link=${token}$`));
			expect(location.split("#")[0]).not.toContain(token);
		}
		await guest.dispose();
	});

	test("a dead link shows the 404 or 410 copy, and Go to Home only when signed in", async () => {
		const expired = await shareLink(doc.name, { role: 10 });
		expireLink(expired);
		const guest = await server(false);
		const member = await server(true);

		const missing = await guest.get(`/l/${"A".repeat(22)}`, { maxRedirects: 0 });
		const gone = await guest.get(`/l/${expired}`, { maxRedirects: 0 });
		const missingSignedIn = await member.get(`/l/${"A".repeat(22)}`, { maxRedirects: 0 });
		const [missingPage, gonePage, signedInPage] = await Promise.all([missing.text(), gone.text(), missingSignedIn.text()]);

		expect([missing.status(), gone.status(), missingSignedIn.status()]).toEqual([404, 410, 404]);
		expect(missing.headers()["cache-control"]).toContain("no-cache");
		expect(missingPage).toContain(NOT_FOUND_COPY);
		expect(gonePage).toContain(EXPIRED_COPY);
		for (const page of [missingPage, gonePage]) {
			expect(page).not.toContain("Go to Home");
			expect(page).not.toContain("Sign in");
			expect(page).not.toContain(doc.title);
		}
		expect(signedInPage).toContain("Go to Home");
		await Promise.all([guest.dispose(), member.dispose()]);
	});

	test("unlock answers 401 for a wrong password, then 429 with Retry-After", async () => {
		const token = await shareLink(folder.name, { role: 10, password: "open sesame" });
		const guest = await server(false);
		const statuses: number[] = [];
		let retryAfter = "";

		for (let attempt = 0; attempt < 5; attempt++) {
			const response = await guest.post(`${DRIVE}/links/${token}/unlock`, { data: { password: "guess" } });
			statuses.push(response.status());
			retryAfter = response.headers()["retry-after"] ?? "";
		}

		expect(statuses).toEqual([401, 401, 401, 401, 429]);
		expect(Number(retryAfter)).toBeGreaterThan(0);
		await guest.dispose();
	});
});

test.describe("a visitor without a session", () => {
	test.use({ storageState: SIGNED_OUT });

	test("a copied URL without the link shows the Sign-in screen and never says whether the item exists", async ({ page }) => {
		await page.goto(`/d/${doc.name}`);
		await expect(page.getByRole("heading", { name: "Sign in to open this" })).toBeVisible();
		await expect(page.getByText("If someone sent you a share link, open that link.")).toBeVisible();
		await expect(page.getByText(doc.title)).toHaveCount(0);
		const unknown = await page.locator('[aria-labelledby="guest-sign-in-title"]').innerText();

		await page.goto(`/d/${"x".repeat(10)}`);
		await expect(page.getByRole("heading", { name: "Sign in to open this" })).toBeVisible();
		expect(await page.locator('[aria-labelledby="guest-sign-in-title"]').innerText()).toBe(unknown);
		await expect(page).toHaveURL(new RegExp(`/d/${"x".repeat(10)}$`));

		await page.getByRole("button", { name: "Sign in" }).first().click();
		await expect(page).toHaveURL(/\/login\?redirect-to=%2Fd%2Fx{10}/);
	});

	test("the guest frame on a phone has one slim header and no bottom nav", async ({ page }) => {
		await page.setViewportSize(PHONE);
		await page.goto(`/d/${doc.name}`);
		await expect(page.getByTestId("guest-frame")).toBeVisible();
		await expect(page.locator('[data-slot="mobile-nav"]')).toHaveCount(0);
		await expect(page.locator("header")).toHaveCount(1);
	});

	// Waits on stage 6: the `/drive` area routes, the guest frame in `ShellLayout` rendering the node route,
	// and a Vite dev proxy for `/l/` so the server rule answers through BASE_URL.
	test.fixme("/l/<token> opens a shared folder at /drive/f/<id> and a document at /d/<id>, with no token in the URL", async ({ page }) => {
		const folderToken = await shareLink(folder.name);
		await page.goto(`/l/${folderToken}`);
		await expect(page).toHaveURL(new RegExp(`/drive/f/${folder.name}(/shared-plans)?$`));
		await expect(page.getByText("Shared plans").first()).toBeVisible();
		expect(page.url()).not.toContain(folderToken);

		const docToken = await shareLink(doc.name);
		await page.goto(`/l/${docToken}`);
		await expect(page).toHaveURL(new RegExp(`/d/${doc.name}(/guest-brief)?$`));
		expect(page.url()).not.toContain(docToken);
	});

	// Waits on stage 6: the guest frame in `ShellLayout` and the unlock state wired into `FilesPage`.
	test.fixme("unlock shows Wrong password, then disables the form and counts down after the lockout", async ({ page }) => {
		const token = await shareLink(folder.name, { role: 10, password: "open sesame" });
		await page.goto(`/l/${token}`);
		await expect(page.getByRole("heading", { name: "Password required" })).toBeVisible();
		await expect(page.getByText("Shared plans")).toHaveCount(0);

		const password = page.getByPlaceholder("Password");
		await password.fill("guess");
		await page.getByRole("button", { name: "Open" }).click();
		await expect(page.getByTestId("drive-unlock-message")).toHaveText("Wrong password");

		for (let attempt = 0; attempt < 4; attempt++) {
			await password.fill("guess");
			await page.getByRole("button", { name: "Open" }).click();
		}
		await expect(page.getByTestId("drive-unlock-message")).toHaveText(/^Try again in \d+:\d{2}$/);
		await expect(password).toBeDisabled();
	});
});

test.describe("a signed-in user", () => {
	// Waits on stage 6: the `/drive` area routes and the `#link=` reader in the router.
	test.fixme("/l/<token> opens the folder in the full shell and the URL keeps no token", async ({ page }) => {
		const token = await shareLink(folder.name);
		await page.goto(`/l/${token}`);
		await expect(page).toHaveURL(new RegExp(`/drive/f/${folder.name}`));
		expect(page.url()).not.toContain(token);
		await expect(page.getByText("Shared plans").first()).toBeVisible();
	});
});
