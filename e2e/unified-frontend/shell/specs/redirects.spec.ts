import { type APIRequestContext, type Browser, type Page } from "@playwright/test";

import { adminApi, createDocument, createFolder, purge, roots, runTag, type DriveNode } from "../../helpers/drive";
import { expect, requireSiteFilesFlip, serverURL, test } from "../../helpers/flips";

/**
 * Stage 12 (spec §14.3): old page URLs land on the flip-2 routes while
 * `suite_flip_files` is on, and stay where they are while it is off.
 *
 * A full page load goes to the bench web server, which runs the redirect
 * table in `before_request`. An in-app navigation goes through the client
 * guard, which reads the same table. The expected addresses come from the
 * spec's table, not from the code.
 */

let api: APIRequestContext;
let folder: DriveNode;
let doc: DriveNode;

test.beforeAll(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	const personal = (await roots(api)).personal.node;
	folder = await createFolder(api, personal, runTag("uf12-redirects"));
	doc = await createDocument(api, folder.name, "Redirect brief", "Writer Document");
});

test.afterAll(async () => {
	await purge(api, folder.name);
	await api.dispose();
});

/** Navigates inside the running app, the way a click on an old link does. */
async function openInApp(page: Page, path: string): Promise<void> {
	await page.evaluate((target) => {
		const app = (document.querySelector("#app") as unknown as { __vue_app__: { config: { globalProperties: { $router: { push(to: string): Promise<unknown> } } } } }).__vue_app__;
		void app.config.globalProperties.$router.push(target);
	}, path);
}

/**
 * Opens a page signed in with a session of its own. Every other journey shares the
 * global Administrator session, and a page the server renders in that session
 * would change its CSRF token under them.
 */
async function signedInPage(browser: Browser): Promise<Page> {
	const context = await browser.newContext();
	const response = await context.request.post(serverURL("/api/method/login"), {
		form: { usr: "Administrator", pwd: process.env.E2E_ADMIN_PASSWORD ?? "admin" },
	});
	expect(response.ok()).toBe(true);
	return context.newPage();
}

/**
 * Loads `path` from the bench web server and answers the path and query the
 * server finally answered with 200. Only the redirects matter here, so the
 * page's assets are not fetched.
 */
async function landing(page: Page, path: string): Promise<string> {
	await page.route(/\/assets\//, (route) => route.abort());
	const response = await page.goto(serverURL(path), { waitUntil: "commit" });
	expect(response?.status(), path).toBe(200);
	const url = new URL(response!.url());
	return url.pathname + url.search;
}

test.describe("with the files flip on", () => {
	test.beforeEach(() => requireSiteFilesFlip(true));

	test("an old link clicked in the app lands on the new page", async ({ page }) => {
		await page.goto("/home");
		await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();

		await openInApp(page, "/drive/recents");
		await expect(page).toHaveURL(/\/drive\/recent$/);

		await openInApp(page, "/drive/favourites");
		await expect(page).toHaveURL(/\/drive\/starred$/);

		await openInApp(page, `/drive/d/${folder.name}/old-slug?view=grid`);
		await expect(page).toHaveURL(new RegExp(`/drive/f/${folder.name}(/[^?]*)?\\?view=grid$`));

		await openInApp(page, "/writer?sort=title");
		await expect(page).toHaveURL(/\/drive\/recent\?type=writer&sort=title$/);

		await openInApp(page, "/suite");
		await expect(page).toHaveURL(/\/home$/);
	});

	test("an old link the server must read loads the page from the server", async ({ page }) => {
		for (const old of [`/drive/g/${doc.name}`, "/sheets/new"]) {
			// Only the request matters, so no page waits for its `load` event.
			await page.goto("/home", { waitUntil: "domcontentloaded" });
			await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
			const load = page.waitForRequest((request) => request.isNavigationRequest() && new URL(request.url()).pathname === old);
			// The full page load can end the evaluate's context before it returns.
			await openInApp(page, old).catch(() => undefined);
			await load;
		}
	});

	test("a full page load of an old address lands on the new page", async ({ browser }) => {
		const page = await signedInPage(browser);
		for (const [old, expected] of [
			["/drive/recents", "/drive/recent"],
			["/sheets?x=1", "/drive/recent?type=sheets&x=1"],
			["/sheets/new", "/home"],
			["/slides/presentation/new", "/home"],
			[`/drive/w/${doc.name}/old-slug`, `/d/${doc.name}`],
			[`/drive/g/${doc.name}`, `/d/${doc.name}`],
			[`/drive/g/${folder.name}`, `/drive/f/${folder.name}`],
		] as const) {
			expect(await landing(page, old), old).toBe(expected);
		}
		await page.context().close();
	});

	test("an old address with no node stays where it is", async ({ browser }) => {
		const page = await signedInPage(browser);
		expect(await landing(page, "/drive/g/no-such-node")).toBe("/drive/g/no-such-node");
		await page.context().close();
	});
});

test.describe("with the files flip off", () => {
	test.use({ flips: { suite_flip_shell: false, suite_flip_files: false } });
	test.beforeEach(() => requireSiteFilesFlip(false));

	test("an old link clicked in the app stays on the old page", async ({ page }) => {
		await page.goto("/home");
		await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();

		await openInApp(page, "/drive/recents");
		await expect(page).toHaveURL(/\/drive\/recents$/);

		await openInApp(page, "/suite");
		await expect(page).toHaveURL(/\/suite$/);
	});

	test("a full page load of an old address stays where it is", async ({ browser }) => {
		const page = await signedInPage(browser);
		for (const old of ["/drive/recents", "/sheets/new", `/drive/w/${doc.name}`]) {
			expect(await landing(page, old), old).toBe(old);
		}
		await page.context().close();
	});
});
