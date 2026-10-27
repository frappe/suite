import { execFileSync } from "node:child_process";

import { type APIRequestContext, expect, test } from "@playwright/test";

import {
	DRIVE,
	adminApi,
	children,
	createFolder,
	getNode,
	grantRole,
	patchNode,
	purge,
	roots,
	runTag,
	uploadFile,
	type DriveNode,
} from "../../helpers/drive";

import { PERSON, personContext } from "../../helpers/person";

/** A fresh test site has no migrated Organization root; provision the business-site fixture. */
function ensureOrganizationRoot(): void {
	const bench = process.env.BENCH_PATH ?? "/home/faris/benches/suite-bench";
	const site = process.env.BENCH_SITE ?? "slides.localhost";
	execFileSync(
		`${bench}/env/bin/python`,
		[
			"-c",
			`
import frappe
from suite.drive._core.roots import active_root_for, create_root
frappe.init(site=${JSON.stringify(site)})
frappe.connect()
if not frappe.conf.allow_tests:
    raise RuntimeError('Organization fixture requires a test site')
frappe.set_user('Administrator')
if not active_root_for(kind='Shared'):
    create_root(kind='Shared', title='Organization files')
frappe.db.commit()
frappe.destroy()
`,
		],
		{ cwd: `${bench}/sites` },
	);
}

let api: APIRequestContext;
let home: DriveNode;

test.beforeEach(async ({ baseURL }) => {
	if (!baseURL) throw new Error("Playwright baseURL is required");
	api = await adminApi(baseURL);
	home = await createFolder(api, (await roots(api)).personal.node, runTag("gap-journey"));
});

test.afterEach(async () => {
	await purge(api, home.name);
	await api.dispose();
});

test("Restore returns a file to its original folder with its bytes intact", async ({ page }) => {
	const bytes = Buffer.from("The original restore content\n");
	const file = await uploadFile(api, home.name, runTag("restore.txt"), bytes, "text/plain");
	await patchNode(api, file.name, { state: "Trashed" });

	await page.goto("/drive/trash?view=list");
	await page.getByText(file.title, { exact: true }).click({ modifiers: ["ControlOrMeta"] });
	await page.getByRole("button", { name: "Restore", exact: true }).click();
	await expect(page.getByText(`Restored “${file.title}”`, { exact: true })).toBeVisible();
	await expect(page.locator(`[data-node='${file.name}']`)).toHaveCount(0);
	await expect(page.getByRole("dialog", { name: "Restore to" })).toHaveCount(0);

	await page.goto(`/drive/f/${home.name}?view=list`);
	await expect(page.locator(`[data-node='${file.name}']`)).toContainText(file.title);
	const stored = await getNode(api, file.name);
	expect(stored.state).toBe("Active");
	expect(stored.parent_node).toBe(home.name);
	const content = await api.get(`/api/suite/drive/nodes/${file.name}/content`);
	expect(content.ok()).toBe(true);
	expect(await content.body()).toEqual(bytes);
	expect((await children(api, home.name)).rows.map((row) => row.name)).toEqual([file.name]);
});

test("dropping a file on a folder row uploads into that folder, not the open folder", async ({ page }) => {
	const destination = await createFolder(api, home.name, "Drop destination");
	await page.goto(`/drive/f/${home.name}?view=list`);
	const row = page.locator(`[data-node='${destination.name}']`);
	await expect(row).toBeVisible();
	const transfer = await page.evaluateHandle(() => {
		const data = new DataTransfer();
		data.items.add(
			new File(["Dropped file content\n"], "dropped.txt", {
				type: "text/plain",
			}),
		);
		return data;
	});
	try {
		await row.dispatchEvent("dragover", { dataTransfer: transfer });
		await row.dispatchEvent("drop", { dataTransfer: transfer });
	} finally {
		await transfer.dispose();
	}
	await expect(page.locator("[data-slot='upload-entry'][data-state='done']")).toHaveCount(1);
	const uploaded = (await children(api, destination.name)).rows;
	expect(uploaded.map((node) => [node.title, node.parent_node])).toEqual([["dropped.txt", destination.name]]);
	expect((await children(api, home.name)).rows.map((node) => node.name)).toEqual([destination.name]);
	const [file] = uploaded;
	if (!file) throw new Error("The drop created no file");
	const content = await api.get(`/api/suite/drive/nodes/${file.name}/content`);
	expect(content.ok()).toBe(true);
	expect(await content.text()).toBe("Dropped file content\n");
	await row.getByText(destination.title, { exact: true }).click();
	await expect(page.getByText("dropped.txt", { exact: true })).toBeVisible();
});

test("a file moves from My files to Organization files and back through the picker", async ({ page }) => {
	ensureOrganizationRoot();
	const organization = (await roots(api)).organization;
	if (!organization) throw new Error("The business-site fixture has no Organization root");
	const shared = await createFolder(api, organization.node, runTag("gap-organization"));
	const file = await uploadFile(api, home.name, "cross-root.txt", Buffer.from("Cross-root bytes\n"), "text/plain");
	try {
		await page.goto(`/drive/f/${home.name}?view=list`);
		await page.getByRole("button", { name: `Actions for ${file.title}` }).click();
		await page.getByRole("menuitem", { name: "Move", exact: true }).click();
		const dialog = page.getByRole("dialog", {
			name: "Move to",
			exact: true,
		});
		await dialog.getByRole("radio", { name: "Organization files" }).click();
		await dialog.getByRole("button", { name: shared.title, exact: true }).click();
		await dialog.getByRole("button", { name: "Move here", exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(page.locator(`[data-node='${file.name}']`)).toHaveCount(0);
		expect((await getNode(api, file.name)).parent_node).toBe(shared.name);
		await page.goto(`/drive/f/${shared.name}?view=list`);
		await expect(page.locator(`[data-node='${file.name}']`)).toContainText(file.title);

		await page.getByRole("button", { name: `Actions for ${file.title}` }).click();
		await page.getByRole("menuitem", { name: "Move", exact: true }).click();
		await dialog.getByRole("radio", { name: "My files" }).click();
		await dialog.getByRole("button", { name: home.title, exact: true }).click();
		await dialog.getByRole("button", { name: "Move here", exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(page.locator(`[data-node='${file.name}']`)).toHaveCount(0);
		expect((await children(api, shared.name)).rows).toEqual([]);
		await page.goto(`/drive/f/${home.name}?view=list`);
		await expect(page.locator(`[data-node='${file.name}']`)).toContainText(file.title);
		expect((await getNode(api, file.name)).parent_node).toBe(home.name);
		const content = await api.get(`/api/suite/drive/nodes/${file.name}/content`);
		expect(content.ok()).toBe(true);
		expect(await content.text()).toBe("Cross-root bytes\n");
	} finally {
		await purge(api, shared.name);
	}
});

test("a share link still opens after logout while private folders require sign-in", async ({ browser, baseURL }) => {
	const shared = await createFolder(api, home.name, "Linked folder");
	const inside = await uploadFile(api, shared.name, "guest-visible.txt", Buffer.from("Guest bytes\n"), "text/plain");
	const response = await api.put(`${DRIVE}/nodes/${shared.name}/grants/${encodeURIComponent("$LINK")}`, {
		data: { role: 10 },
	});
	expect(response.ok(), await response.text()).toBe(true);
	const { data }: { data: { url: string } } = await response.json();
	const token = data.url.split("/").pop();
	if (!token) throw new Error("The share response has no token");
	if (!baseURL) throw new Error("Playwright baseURL is required");
	const context = await personContext(browser, baseURL);
	const page = await context.newPage();
	try {
		await page.goto(`/l/${token}`);
		await expect(page.getByText(inside.title, { exact: true })).toBeVisible();
		await expect(page.getByTestId("guest-frame")).toHaveCount(0);
		await page.getByRole("button", { name: "Account", exact: true }).click();
		await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
		await expect
			.poll(async () => (await context.cookies()).find((cookie) => cookie.name === "user_id")?.value)
			.toBe("Guest");

		await page.goto(`/l/${token}`);
		await expect(page.getByTestId("guest-frame")).toBeVisible();
		await expect(page.getByText(inside.title, { exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "New", exact: true })).toHaveCount(0);
		expect(page.url()).not.toContain(token);
		await page.reload();
		await expect(page.getByText(inside.title, { exact: true })).toBeVisible();

		await page.goto(`/drive/f/${home.name}`);
		await expect(page.getByRole("heading", { name: "Sign in to open this" })).toBeVisible();
		await expect(page.getByText(home.title, { exact: true })).toHaveCount(0);
	} finally {
		await context.close();
	}
});

test("another user's rename refreshes an open shared folder without navigation", async ({ page, browser, baseURL }) => {
	if (!baseURL) throw new Error("Playwright baseURL is required");
	const context = await personContext(browser, baseURL);
	await grantRole(api, home.name, PERSON, 10);
	const file = await uploadFile(
		api,
		home.name,
		"before-remote-rename.txt",
		Buffer.from("Live bytes\n"),
		"text/plain",
	);
	const observer = await context.newPage();
	try {
		const connected = observer
			.waitForEvent("websocket", {
				predicate: (socket) => socket.url().includes("/socket.io/"),
			})
			.then(async (socket) => {
				await socket.waitForEvent("framereceived", {
					predicate: (frame) => String(frame.payload).startsWith("40/"),
				});
				return socket;
			});
		await observer.goto(`/drive/f/${home.name}?view=list`);
		const socket = await connected;
		await expect(observer.getByText(file.title, { exact: true })).toBeVisible();
		const originalURL = observer.url();
		let navigations = 0;
		observer.on("framenavigated", (frame) => {
			if (frame === observer.mainFrame()) navigations++;
		});
		await page.goto(`/drive/f/${home.name}?view=list`);
		await page.getByRole("button", { name: `Actions for ${file.title}` }).click();
		await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
		const dialog = page.getByRole("dialog");
		const name = dialog.getByRole("textbox");
		await name.click();
		await name.fill("after-remote-rename.txt");
		await expect(name).toHaveValue("after-remote-rename.txt");
		const changed = socket.waitForEvent("framereceived", {
			predicate: (frame) => String(frame.payload).includes('"drive:changed"'),
		});
		await dialog.getByRole("button", { name: "Rename", exact: true }).click();
		await expect(dialog).toBeHidden();
		await changed;
		await expect(observer.locator(`[data-node='${file.name}']`)).toContainText("after-remote-rename.txt");
		await expect(observer.getByText(file.title, { exact: true })).toHaveCount(0);
		expect(observer.url()).toBe(originalURL);
		expect(navigations).toBe(0);
		expect((await getNode(api, file.name)).title).toBe("after-remote-rename.txt");
	} finally {
		await context.close();
	}
});
