import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

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

/**
 * Stage 10: uploads, restore and batch outcomes.
 *
 * The upload tracker, the pickers, the drop targets and the Trash actions are
 * built but not yet mounted in FilesPage.vue, which stages 6, 8 and 9 hold.
 * Those journeys are `test.fixme` until the wiring lands. Their bodies use
 * the selectors the new components expose.
 */

const NEEDS_FILES_PAGE = "Needs the stage 10 wiring in FilesPage.vue, held by stages 6, 8 and 9";
const NEEDS_RING_SOURCE = "Needs composition to provide AREA_PROGRESS_KEY from driveUploadProgress()";

test.describe.configure({ mode: "serial" });

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
	await page.goto(`/files/f/${folder.name}`);
	await expect(page.getByRole("heading", { name: folder.title })).toBeVisible();
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

test.fixme(
	"a batch upload asks about a taken title and keeps both",
	{ annotation: { type: "fixme", description: NEEDS_FILES_PAGE } },
	async ({ page }) => {
		await uploadFile(api, home.name, "report.pdf", Buffer.from("first"));
		await openFolder(page, home);
		const chooser = page.waitForEvent("filechooser");
		await page.getByRole("button", { name: "New" }).click();
		await page.getByRole("menuitem", { name: "Upload files" }).click();
		await (await chooser).setFiles([
			{ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("second") },
			{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("notes") },
		]);
		await expect(page.getByRole("dialog", { name: "A file with this name exists" })).toBeVisible();
		await page.getByRole("radio", { name: "Keep both" }).check();
		await page.getByRole("button", { name: "Continue" }).click();
		await expect(page.locator("[data-slot='upload-entry'][data-state='done']")).toHaveCount(2);
		const titles = (await children(api, home.name)).rows.map((row) => row.title).sort();
		expect(titles).toEqual(["notes.txt", "report (1).pdf", "report.pdf"]);
	},
);

test.fixme(
	"a reload mid-upload leaves an interrupted entry that Resume finishes",
	{ annotation: { type: "fixme", description: NEEDS_FILES_PAGE } },
	async ({ page }) => {
		// Throttle the chunk route, reload after the first
		// chunk, then Resume and pick the same file again.
		await openFolder(page, home);
		const big = Buffer.alloc(17 * 1024 * 1024, 7);
		let chunks = 0;
		await page.route("**/api/suite/drive/uploads/*/chunk*", async (route) => {
			chunks += 1;
			if (chunks === 2) return; // Hold the second chunk until the reload.
			await route.continue();
		});
		const chooser = page.waitForEvent("filechooser");
		await page.getByRole("button", { name: "New" }).click();
		await page.getByRole("menuitem", { name: "Upload files" }).click();
		await (await chooser).setFiles({ name: "big.bin", mimeType: "application/octet-stream", buffer: big });
		await expect.poll(() => chunks).toBe(2);
		await page.unroute("**/api/suite/drive/uploads/*/chunk*");
		await page.reload();
		await expect(page.locator("[data-slot='upload-entry'][data-state='interrupted']")).toBeVisible();
		const again = page.waitForEvent("filechooser");
		await page.getByRole("button", { name: "Resume" }).click();
		await (await again).setFiles({ name: "big.bin", mimeType: "application/octet-stream", buffer: big });
		await expect(page.locator("[data-slot='upload-entry'][data-state='done']")).toBeVisible();
	},
);

test.fixme(
	"a folder upload from New creates the tree",
	{ annotation: { type: "fixme", description: NEEDS_FILES_PAGE } },
	async ({ page }) => {
		// Playwright sets a directory on the webkitdirectory input.
		await openFolder(page, home);
		await page.getByRole("button", { name: "New" }).click();
		await page.getByRole("menuitem", { name: "Upload folder" }).click();
		await page.locator("[data-slot='upload-folder-input']").setInputFiles("fixtures/upload-folder");
		await expect(page.getByText("Creating folders…")).toBeHidden();
		await expect(page.getByRole("link", { name: "upload-folder" })).toBeVisible();
	},
);

test.fixme(
	"a dropped folder uploads as a folder",
	{ annotation: { type: "fixme", description: NEEDS_FILES_PAGE } },
	async ({ page }) => {
		// A synthetic drop cannot carry a directory entry, so
		// this journey needs a CDP drag with a real directory.
		await openFolder(page, home);
	},
);

test.fixme(
	"a batch larger than the free space offers to upload what fits",
	{ annotation: { type: "fixme", description: NEEDS_FILES_PAGE } },
	async ({ page }) => {
		// Set a quota on the root, then pick files larger than it.
		await openFolder(page, home);
		await expect(page.getByText("Upload what fits")).toBeVisible();
	},
);

test.fixme(
	"a restore whose folder is gone asks for a destination in the same root",
	{ annotation: { type: "fixme", description: NEEDS_FILES_PAGE } },
	async ({ page }) => {
		const gone = await createFolder(api, home.name, "gone");
		const orphan = await uploadFile(api, gone.name, "orphan.txt", Buffer.from("x"));
		await patchNode(api, orphan.name, { state: "Trashed" });
		await patchNode(api, gone.name, { state: "Trashed" });
		await purge(api, gone.name);
		await page.goto("/files/trash");
		await page.getByRole("checkbox", { name: "Select orphan.txt" }).check();
		await page.getByRole("button", { name: "Restore" }).click();
		await expect(page.getByRole("dialog", { name: "Restore to" })).toBeVisible();
		await page.getByRole("button", { name: home.title }).click();
		await page.getByRole("button", { name: "Restore", exact: true }).last().click();
		await expect(page.getByText("1 restored")).toBeVisible();
		expect((await getNode(api, orphan.name)).parent).toBe(home.name);
	},
);

test.fixme(
	"Delete forever on a mixed batch reports what failed",
	{ annotation: { type: "fixme", description: NEEDS_FILES_PAGE } },
	async ({ page }) => {
		await page.goto("/files/trash");
		await expect(page.getByText("deleted forever")).toBeVisible();
	},
);

test.fixme(
	"Empty trash deletes everything in the root's Trash",
	{ annotation: { type: "fixme", description: NEEDS_FILES_PAGE } },
	async ({ page }) => {
		await page.goto("/files/trash");
		await page.getByRole("button", { name: "Empty trash" }).click();
		await page.getByRole("button", { name: "Empty trash" }).last().click();
		await expect(page.getByText("deleted forever")).toBeVisible();
	},
);

test.fixme(
	"the upload ring shows on the Files rail item in another area",
	{ annotation: { type: "fixme", description: `${NEEDS_RING_SOURCE}. ${NEEDS_FILES_PAGE}` } },
	async ({ page }) => {
		await page.goto("/home");
		await expect(page.locator("[data-slot='area-progress-ring']")).toBeVisible();
	},
);
