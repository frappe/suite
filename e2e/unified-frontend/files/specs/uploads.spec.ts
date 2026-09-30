import { resolve } from "node:path";

import { type APIRequestContext, type Locator, type Page, type Route } from "@playwright/test";

import { expect, test } from "../../helpers/flips";

import {
	DRIVE,
	adminApi,
	children,
	createFolder,
	getNode,
	patchNode,
	purge,
	roots,
	runTag,
	uploadFile,
	type DriveNode,
} from "../../helpers/drive";

/** Stage 10: uploads, restore and batch outcomes (spec §6). Empty trash is in `empty-trash.spec.ts`. */

test.describe.configure({ mode: "serial" });

const CHUNK_ROUTE = `**${DRIVE}/uploads/*/chunk*`;

let api: APIRequestContext;
let home: DriveNode;

test.beforeEach(async ({ baseURL }) => {
	api = await adminApi(baseURL!);
	home = await createFolder(api, (await roots(api)).personal.node, runTag("uf10"));
});

test.afterEach(async () => {
	await purge(api, home.name);
	await api.dispose();
});

function watchLegacyDriveCalls(page: Page): string[] {
	const calls: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("suite.drive.api.")) calls.push(new URL(request.url()).pathname);
	});
	return calls;
}

async function openFolder(page: Page, folder: DriveNode) {
	await page.goto(`/drive/f/${folder.name}?view=list`);
	await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();
}

async function useNewMenu(page: Page, item: string) {
	await page.getByRole("button", { name: "New", exact: true }).click();
	await page.getByRole("menuitem", { name: item, exact: true }).click();
}

async function openTrash(page: Page) {
	await page.goto("/drive/trash?view=list");
}

async function select(page: Page, title: string) {
	await page.getByText(title, { exact: true }).click({ modifiers: ["ControlOrMeta"] });
}

async function nodeExists(node: string): Promise<boolean> {
	const response = await api.get(`${DRIVE}/nodes/${node}`);
	return response.ok();
}

const rail = (page: Page) => page.getByRole("navigation", { name: "Areas" });
const doneEntries = (page: Page) => page.locator("[data-slot='upload-entry'][data-state='done']");

/**
 * Drops a folder tree on `target` the way a browser does: dragover, then drop
 * with a `DataTransfer` whose item is a directory entry. A synthetic
 * `DataTransfer` cannot carry one, so the event gets a stand-in with the same
 * entry API (`webkitGetAsEntry`, `createReader`, `file`).
 */
async function dropFolder(target: Locator, tree: { name: string; files: Record<string, string> }) {
	await target.evaluate((element, input) => {
		type Entry = {
			name: string;
			isFile: boolean;
			isDirectory: boolean;
			file?: (resolve: (file: File) => void) => void;
			createReader?: () => { readEntries: (resolve: (entries: Entry[]) => void) => void };
		};
		const directory = (name: string, entries: Entry[]): Entry => ({
			name,
			isFile: false,
			isDirectory: true,
			createReader: () => {
				let read = false;
				return {
					readEntries: (resolve) => {
						resolve(read ? [] : entries);
						read = true;
					},
				};
			},
		});
		const file = (name: string, text: string): Entry => ({
			name,
			isFile: true,
			isDirectory: false,
			file: (resolve) => resolve(new File([text], name, { type: "text/plain", lastModified: 1 })),
		});
		// Paths such as `nested/inner.txt` become folders top-down.
		function build(name: string, files: Record<string, string>): Entry {
			const own: Entry[] = [];
			const below = new Map<string, Record<string, string>>();
			for (const [path, text] of Object.entries(files)) {
				const [head, ...rest] = path.split("/");
				if (!rest.length) own.push(file(head!, text));
				else below.set(head!, { ...(below.get(head!) ?? {}), [rest.join("/")]: text });
			}
			for (const [child, childFiles] of below) own.push(build(child, childFiles));
			return directory(name, own);
		}
		const root = build(input.name, input.files);
		const transfer = {
			types: ["Files"],
			items: [{ kind: "file", webkitGetAsEntry: () => root, getAsFile: () => null }],
			dropEffect: "none",
		};
		for (const type of ["dragover", "drop"]) {
			const event = new DragEvent(type, { bubbles: true, cancelable: true });
			Object.defineProperty(event, "dataTransfer", { value: transfer });
			element.dispatchEvent(event);
		}
	}, tree);
}

test("Upload new version replaces a file's bytes from its preview", async ({ page }) => {
	const legacy = watchLegacyDriveCalls(page);
	const file = await uploadFile(api, home.name, "notes.bin", Buffer.from("old bytes"));
	await page.goto(`/d/${file.name}`);
	await expect(page.getByRole("heading", { name: "No preview" })).toBeVisible();

	const chooser = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Upload new version" }).click();
	const replacement = Buffer.from("the new version, longer than the old one");
	await (await chooser).setFiles({ name: "anything.bin", mimeType: "application/octet-stream", buffer: replacement });

	await expect(page.getByText("This replaces notes.bin. The current file is not kept.")).toBeVisible();
	await page.getByRole("button", { name: "Replace" }).click();
	await expect(page.getByText("New version uploaded")).toBeVisible();

	const replaced = await getNode(api, file.name);
	expect(replaced.size).toBe(replacement.length);
	expect(replaced.title).toBe("notes.bin");
	expect((await children(api, home.name)).rows.map((row) => row.title)).toEqual(["notes.bin"]);
	await expect(page.getByRole("link", { name: "Download" }).first()).toHaveAttribute(
		"href",
		new RegExp(`${DRIVE}/nodes/${file.name}/content\\?v=1`),
	);
	expect(legacy).toEqual([]);
});

test("a batch upload asks about a taken title and keeps both", async ({ page }) => {
	const legacy = watchLegacyDriveCalls(page);
	await uploadFile(api, home.name, "report.pdf", Buffer.from("first"));
	await openFolder(page, home);

	const chooser = page.waitForEvent("filechooser");
	await useNewMenu(page, "Upload files");
	await (await chooser).setFiles([
		{ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("second") },
		{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("notes") },
	]);

	const dialog = page.getByRole("dialog", { name: "A file with this name exists" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("radio", { name: "Keep both" }).check();
	await dialog.getByRole("button", { name: "Continue" }).click();

	await expect(doneEntries(page)).toHaveCount(2);
	await expect(page.getByText("report (2).pdf", { exact: true }).first()).toBeVisible();
	const titles = (await children(api, home.name)).rows.map((row) => row.title).sort();
	expect(titles).toEqual(["notes.txt", "report (2).pdf", "report.pdf"]);
	expect(legacy).toEqual([]);
});

test("a reload mid-upload leaves an interrupted entry that Resume finishes", async ({ page }) => {
	await openFolder(page, home);
	const big = Buffer.alloc(17 * 1024 * 1024, 7);
	let chunks = 0;
	await page.route(CHUNK_ROUTE, async (route) => {
		chunks += 1;
		if (chunks === 2) return; // Hold the second chunk until the reload.
		await route.continue();
	});

	const chooser = page.waitForEvent("filechooser");
	await useNewMenu(page, "Upload files");
	await (await chooser).setFiles({ name: "big.bin", mimeType: "application/octet-stream", buffer: big });
	await expect.poll(() => chunks).toBe(2);
	await page.unroute(CHUNK_ROUTE);
	await page.reload();

	// The interrupted upload raises the red dot. The ring opens the tracker.
	const drive = rail(page).getByRole("link", { name: /^Drive/ });
	await expect(drive.locator("[data-slot='area-progress-attention']")).toBeVisible();
	await drive.click();
	await expect(page.locator("[data-slot='upload-entry'][data-state='interrupted']")).toBeVisible();

	const again = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Resume" }).click();
	await (await again).setFiles({ name: "big.bin", mimeType: "application/octet-stream", buffer: big });
	await expect(doneEntries(page)).toHaveCount(1, { timeout: 30_000 });

	const rows = (await children(api, home.name)).rows;
	expect(rows.map((row) => row.title)).toEqual(["big.bin"]);
	expect((await getNode(api, rows[0]!.name)).size).toBe(big.length);
});

test("a folder upload from New creates the tree", async ({ page }) => {
	await openFolder(page, home);

	const chooser = page.waitForEvent("filechooser");
	await useNewMenu(page, "Upload folder");
	await (await chooser).setFiles(resolve(__dirname, "fixtures/upload-folder"));

	await expect(doneEntries(page)).toHaveCount(2);
	await expect(page.getByText("upload-folder", { exact: true })).toBeVisible();
	const top = (await children(api, home.name)).rows;
	expect(top.map((row) => [row.title, row.kind])).toEqual([["upload-folder", "folder"]]);
	const inside = (await children(api, top[0]!.name)).rows.map((row) => row.title).sort();
	expect(inside).toEqual(["nested", "top.txt"]);
	const nested = (await children(api, top[0]!.name)).rows.find((row) => row.title === "nested")!;
	expect((await children(api, nested.name)).rows.map((row) => row.title)).toEqual(["inner.txt"]);
});

test("a dropped folder uploads as a folder into the row it lands on", async ({ page }) => {
	const target = await createFolder(api, home.name, "drop-here");
	await openFolder(page, home);

	await dropFolder(page.locator(`[data-node='${target.name}']`), {
		name: "dropped",
		files: { "a.txt": "a", "deeper/b.txt": "b" },
	});

	await expect(doneEntries(page)).toHaveCount(2);
	const inTarget = (await children(api, target.name)).rows;
	expect(inTarget.map((row) => [row.title, row.kind])).toEqual([["dropped", "folder"]]);
	const inside = (await children(api, inTarget[0]!.name)).rows.map((row) => row.title).sort();
	expect(inside).toEqual(["a.txt", "deeper"]);
	// The pane's own folder got nothing but the target.
	expect((await children(api, home.name)).rows.map((row) => row.title)).toEqual(["drop-here"]);
});

test("a batch larger than the free space offers to upload what fits", async ({ page }) => {
	// The quota check reads the root's usage. Leave 10 bytes free.
	await page.route(`**${DRIVE}/roots/*/usage*`, async (route: Route) => {
		const response = await route.fetch();
		const body = (await response.json()) as { data: { used_bytes: number; effective_quota: number } };
		body.data.effective_quota = body.data.used_bytes + 10;
		await route.fulfill({ response, json: body });
	});
	await openFolder(page, home);

	const chooser = page.waitForEvent("filechooser");
	await useNewMenu(page, "Upload files");
	await (await chooser).setFiles([
		{ name: "fits.txt", mimeType: "text/plain", buffer: Buffer.from("small") },
		{ name: "too-big.txt", mimeType: "text/plain", buffer: Buffer.alloc(100, 1) },
	]);

	const dialog = page.getByRole("dialog", { name: "Not enough space" });
	await expect(dialog.getByText("1 of 2 files fit.")).toBeVisible();
	await dialog.getByRole("button", { name: "Upload what fits" }).click();

	await expect(doneEntries(page)).toHaveCount(1);
	expect((await children(api, home.name)).rows.map((row) => row.title)).toEqual(["fits.txt"]);
});

test("a restore whose folder is gone asks for a destination in the same root", async ({ page }) => {
	const gone = await createFolder(api, home.name, "gone");
	const orphan = await uploadFile(api, gone.name, runTag("orphan"), Buffer.from("x"));
	await patchNode(api, orphan.name, { state: "Trashed" });
	await patchNode(api, gone.name, { state: "Trashed" });

	await openTrash(page);
	await select(page, orphan.title);
	await page.getByRole("button", { name: "Restore" }).click();

	const dialog = page.getByRole("dialog", { name: "Restore to" });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText("The folder this item was in is gone.", { exact: false })).toBeVisible();
	await dialog.getByRole("button", { name: home.title }).click();
	await dialog.getByRole("button", { name: "Restore", exact: true }).click();

	await expect(page.getByText("1 restored · 0 failed")).toBeVisible();
	await expect(page.getByText("selected")).toHaveCount(0);
	const restored = await getNode(api, orphan.name);
	expect(restored.parent).toBe(home.name);
	expect(restored.state).toBe("Active");
});

test("Delete forever on a mixed batch reports what failed and keeps it selected", async ({ page }) => {
	const first = await uploadFile(api, home.name, runTag("purge-a"), Buffer.from("a"));
	const second = await uploadFile(api, home.name, runTag("purge-b"), Buffer.from("b"));
	await patchNode(api, first.name, { state: "Trashed" });
	await patchNode(api, second.name, { state: "Trashed" });

	await openTrash(page);
	await select(page, first.title);
	await select(page, second.title);
	await expect(page.getByText("2 selected")).toBeVisible();
	// Someone else deletes one of them first, so it fails in the batch.
	await purge(api, second.name);

	await page.getByRole("button", { name: "Delete forever" }).click();
	await page.getByRole("dialog").getByRole("button", { name: "Delete forever" }).click();

	await expect(page.getByText("1 deleted forever · 1 failed")).toBeVisible();
	await expect(page.getByText("1 selected")).toBeVisible();
	await page.getByRole("button", { name: "Details" }).click();
	await expect(page.getByRole("dialog", { name: "Items that failed" }).getByText(second.name, { exact: true })).toBeVisible();
	expect(await nodeExists(first.name)).toBe(false);
});

test("the upload ring shows on the Drive rail item in another area", async ({ page }) => {
	await openFolder(page, home);
	let release: (() => void) | undefined;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(CHUNK_ROUTE, async (route) => {
		await held;
		await route.continue();
	});

	const chooser = page.waitForEvent("filechooser");
	await useNewMenu(page, "Upload files");
	await (await chooser).setFiles({ name: "slow.txt", mimeType: "text/plain", buffer: Buffer.from("slow bytes") });
	await expect(page.locator("[data-slot='upload-entry'][data-state='uploading']")).toBeVisible();

	await rail(page).getByRole("link", { name: "Home" }).click();
	await expect(page).toHaveURL(/\/home/);
	const drive = rail(page).getByRole("link", { name: /^Drive/ });
	await expect(drive.locator("[data-slot='area-progress-ring']")).toBeVisible();

	release!();
	await expect(drive.locator("[data-slot='area-progress-ring']")).toHaveAttribute("data-tone", "done");
	await page.unroute(CHUNK_ROUTE);
	expect((await children(api, home.name)).rows.map((row) => row.title)).toEqual(["slow.txt"]);
});
