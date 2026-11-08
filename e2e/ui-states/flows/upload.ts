import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, type FileChooser, type Locator, type Page, type Route } from "@playwright/test";
import { setup } from "xstate";
import { fillFolder, folderPath, type FolderContent } from "../content";
import { defineFlow } from "../flow";
import { chooseNew, row } from "../../drive-backed-apps/helpers/drive";
import type { Hold, Scene } from "../scene";

type Event =
	| { type: "DROP_ENTERS" }
	| { type: "DROP" }
	| { type: "PICK_ONE" }
	| { type: "PICK_FIVE" }
	| { type: "FINISHES" }
	| { type: "CHUNK_FAILS" }
	| { type: "RETRY" }
	| { type: "STORAGE_FULL" }
	| { type: "RETRY_ALL" }
	| { type: "RELOAD" }
	| { type: "OPEN_FROM_RAIL" }
	| { type: "RESUME" }
	| { type: "CLOSE_TRACKER" }
	| { type: "SAME_NAMES" }
	| { type: "SKIP_ALL" }
	| { type: "KEEP_BOTH_ALL" }
	| { type: "SAME_FOLDER" }
	| { type: "KEEP_BOTH_FOLDER" }
	| { type: "PICK_TOO_MANY" }
	| { type: "PICK_TOO_BIG" };

/**
 * Uploads from the pick or drop to done, failed, paused and resumed. Each
 * entry has an explicit `UploadState` in `queue.ts`; what the tracker and the
 * rail dot show also turns on the queue's `trackerOpen`, `seen`, `halted`,
 * `preparing` and `showDone` flags and on the dialogs in `prompts.ts`.
 */
const machine = setup({ types: { events: {} as Event } }).createMachine({
	id: "upload",
	initial: "idle",
	states: {
		idle: {
			meta: { description: "A folder with no uploads running: no tracker, no dot on the Drive rail item." },
			on: {
				DROP_ENTERS: "dropOverlay",
				PICK_ONE: "uploadingOne",
				PICK_FIVE: "uploadingMany",
				SAME_NAMES: "collisionDialog",
				SAME_FOLDER: "folderCollision",
				PICK_TOO_MANY: "quotaSomeFit",
				PICK_TOO_BIG: "quotaNoneFit",
			},
		},
		dropOverlay: {
			meta: { description: "Files dragged over the pane: a dashed outline and \"Drop to upload to\" the folder." },
			on: { DROP: "uploadingOne" },
		},
		uploadingOne: {
			meta: { description: "One file uploading: the tracker opens by itself with the bytes sent and a progress bar; the rail dot is orange." },
			on: {
				FINISHES: "done",
				CHUNK_FAILS: "failed",
				STORAGE_FULL: "held",
				RELOAD: "interruptedUnseen",
				CLOSE_TRACKER: "trackerClosed",
			},
		},
		uploadingMany: {
			meta: { description: "Five files: three upload side by side, two wait their turn." },
			on: { FINISHES: "done" },
		},
		done: {
			meta: { description: "Every file uploaded: green checks in the tracker. The indicator is `done` for 3 s, but the rail draws no dot for it." },
		},
		failed: {
			meta: { description: "A chunk failed while the tracker was open: the server's message in red and a Retry button. No red dot, as the user saw it happen." },
			on: { RETRY: "retrying", CLOSE_TRACKER: "failedHidden" },
		},
		failedHidden: {
			meta: { description: "The tracker closed over a failed upload it had shown: no tracker and no dot, so nothing on screen leads back to Retry." },
		},
		retrying: {
			meta: { description: "Retry continues from the bytes the server holds, not from zero." },
			on: { FINISHES: "done" },
		},
		held: {
			meta: { description: "The server answered 413: the queue stops, the entry is paused and the tracker says storage is full, with Retry all." },
			on: { RETRY_ALL: "retrying" },
		},
		trackerClosed: {
			meta: { description: "The tracker closed while a file uploads: only the orange dot on the Drive rail item shows the work." },
			on: { CHUNK_FAILS: "failedUnseen", OPEN_FROM_RAIL: "uploadingOne" },
		},
		failedUnseen: {
			meta: { description: "A chunk failed while the tracker was closed: the rail dot turns red and asks for attention." },
			on: { OPEN_FROM_RAIL: "failed" },
		},
		interruptedUnseen: {
			meta: { description: "The page reloaded mid-upload: the tracker stays closed and the red dot says an upload stopped." },
			on: { OPEN_FROM_RAIL: "interrupted" },
		},
		interrupted: {
			meta: { description: "The tracker opened from the rail (which also goes to My files): the stopped upload with where it stopped and Resume." },
			on: { RESUME: "resumed" },
		},
		resumed: {
			meta: { description: "Resume asked for the file again, matched it by name, size and time, and continues from the server's byte count." },
			on: { FINISHES: "done" },
		},
		collisionDialog: {
			meta: { description: "Two picked files share names with files here: the dialog offers Replace, Keep both, Rename and Skip, with Apply to all." },
			on: { SKIP_ALL: "skipped", KEEP_BOTH_ALL: "keptBoth" },
		},
		skipped: {
			meta: { description: "Skip with Apply to all: both files are listed as skipped and nothing uploads." },
		},
		keptBoth: {
			meta: { description: "Keep both with Apply to all: both files upload under free names." },
		},
		folderCollision: {
			meta: { description: "A picked folder has the name of a folder here. Folders do not merge, so the choice is Keep both or Skip." },
			on: { KEEP_BOTH_FOLDER: "preparingFolders" },
		},
		preparingFolders: {
			meta: { description: "The folder tree is being created before any file starts: \"Preparing upload\" and \"Creating folders…\"." },
			on: { FINISHES: "done" },
		},
		quotaSomeFit: {
			meta: { description: "Five files need more than the free space: the confirm says how many fit and offers Upload what fits." },
		},
		quotaNoneFit: {
			meta: { description: "One file larger than the free space: the confirm says none fit and only cancels." },
		},
	},
});

/** 24 MiB: the first 16 MiB chunk goes through, so a held second chunk shows real progress. */
const LARGE = 24 * 1024 * 1024;
const LATER_CHUNKS = /\/api\/suite\/drive\/uploads\/[^/]+\/chunk\?offset=[1-9]/;
const FOLDER_CREATE = /\/api\/suite\/drive\/nodes(\?|$)/;
const SIXTEEN_OF_24 = "16.0 MB of 24.0 MB";
const LARGE_NAMES = ["Launch video.mp4", "Press kit.zip", "Brand assets.zip", "Product shots.zip", "Homepage walkthrough.mov"];

const fixture = (name: string) => readFileSync(resolve(__dirname, "..", "fixtures", name));
const content = new WeakMap<Scene, FolderContent>();
const holds = new WeakMap<Scene, Hold>();
let scratch: string | null = null;

/** Files on disk, so a Resume pick has the same name, size and modified time as the first pick. */
function scratchDir(): string {
	if (scratch) return scratch;
	const dir = mkdtempSync(join(tmpdir(), "ui-states-upload-"));
	for (const name of LARGE_NAMES) writeFileSync(join(dir, name), Buffer.alloc(LARGE));
	mkdirSync(join(dir, "Design reviews"));
	writeFileSync(join(dir, "Design reviews", "Moodboard.txt"), "Warm greys, one accent.\n");
	scratch = dir;
	return dir;
}

function largeFiles(count: number): string[] {
	return LARGE_NAMES.slice(0, count).map((name) => join(scratchDir(), name));
}

function tracker(page: Page): Locator {
	return page.locator('[data-slot="upload-tracker"]');
}

function entries(page: Page, state: string): Locator {
	return tracker(page).locator(`[data-slot="upload-entry"][data-state="${state}"]`);
}

function railDot(page: Page): Locator {
	return page.locator('[data-slot="area-progress-dot"]').filter({ visible: true });
}

async function holdLaterChunks(scene: Scene): Promise<void> {
	holds.set(scene, await holdUnretried(scene.page, LATER_CHUNKS));
}

/**
 * `scene.hold()` without unrouting. `scene.hold()` unroutes on abort and
 * release, and Playwright then lets a held request through: an aborted chunk
 * or node read succeeds, and a chunk sent as the route goes away can stall.
 * This handler stays in place and answers every request itself.
 */
export async function holdUnretried(page: Page, url: RegExp): Promise<Hold> {
	const held: Route[] = [];
	let status: number | null = null;
	let passing = false;
	const fail = (route: Route) =>
		route.fulfill({
			status: status ?? 500,
			contentType: "application/json",
			body: JSON.stringify({ exc_type: "ServerError", message: "Something went wrong" }),
		});
	const handler = async (route: Route) => {
		if (passing) await route.continue();
		else if (status === null) held.push(route);
		else await fail(route);
	};
	await page.route(url, handler);
	return {
		async release() {
			passing = true;
			await Promise.all(held.splice(0).map((route) => route.continue()));
		},
		async abort(next = 500) {
			status = next;
			await Promise.all(held.splice(0).map((route) => fail(route).catch(() => undefined)));
		},
	};
}

async function pick(scene: Scene, files: Parameters<FileChooser["setFiles"]>[0]): Promise<void> {
	const [chooser] = await Promise.all([scene.page.waitForEvent("filechooser"), chooseNew(scene.page, "Files")]);
	await chooser.setFiles(files);
}

/** Usage that leaves `free` bytes in the root, so the advisory quota check asks first. */
async function leaveFree(scene: Scene, free: number): Promise<void> {
	await scene.page.route("**/api/suite/drive/roots/*/usage*", async (route) => {
		// The scene may close while a usage read is on its way.
		const response = await route.fetch().catch(() => null);
		if (!response) return;
		const body = (await response.json()) as { data?: { used_bytes: number; effective_quota: number } };
		if (body.data) body.data.effective_quota = body.data.used_bytes + free;
		await route.fulfill({ response, json: body }).catch(() => undefined);
	});
}

/** 16 MiB chunks can take a while on a busy bench. */
const TRANSFER = { timeout: 45_000 };

async function expectUploading(page: Page, count: number): Promise<void> {
	await expect(tracker(page).getByText(SIXTEEN_OF_24)).toHaveCount(count, TRANSFER);
}

/** Lets the held chunk go, then holds the next attempt again so the retry is seen mid-flight. */
async function rehold(scene: Scene): Promise<void> {
	await holds.get(scene)?.release();
	await holdLaterChunks(scene);
}

export const upload = defineFlow<Event>({
	id: "upload",
	title: "Uploads",
	folderTitle: "Website relaunch",
	source: "frontend/src/apps/drive/files/features/uploads/queue.ts",
	machine,
	async enter(scene) {
		content.set(scene, await fillFolder(scene.api, scene.folder.name));
		await scene.goto(folderPath(scene.folder));
		await expect(scene.page.getByRole("button", { name: /^Actions for / }).first()).toBeVisible();
	},
	events: {
		async DROP_ENTERS(scene) {
			const logo = content.get(scene)?.logo;
			if (!logo) throw new Error("upload: the scene has no content");
			const transfer = await scene.page.evaluateHandle(() => {
				const data = new DataTransfer();
				data.items.add(new File(["x"], "Launch video.mp4", { type: "video/mp4" }));
				return data;
			});
			await row(scene.page, logo.name).dispatchEvent("dragover", { dataTransfer: transfer });
			await expect(scene.page.locator('[data-slot="upload-drop-overlay"]')).toBeVisible();
		},
		async DROP(scene) {
			const logo = content.get(scene)?.logo;
			if (!logo) throw new Error("upload: the scene has no content");
			await holdLaterChunks(scene);
			const transfer = await scene.page.evaluateHandle((size) => {
				const data = new DataTransfer();
				data.items.add(new File([new Uint8Array(size)], "Launch video.mp4", { type: "video/mp4" }));
				return data;
			}, LARGE);
			await row(scene.page, logo.name).dispatchEvent("drop", { dataTransfer: transfer });
			await expectUploading(scene.page, 1);
		},
		async PICK_ONE(scene) {
			await holdLaterChunks(scene);
			await pick(scene, largeFiles(1));
			await expectUploading(scene.page, 1);
		},
		async PICK_FIVE(scene) {
			await holdLaterChunks(scene);
			await pick(scene, largeFiles(5));
			await expectUploading(scene.page, 3);
			await expect(entries(scene.page, "queued")).toHaveCount(2);
		},
		async FINISHES(scene) {
			await holds.get(scene)?.release();
			await expect(entries(scene.page, "done").first()).toBeVisible(TRANSFER);
			await expect(tracker(scene.page).locator('[data-slot="upload-entry"]:not([data-state="done"])')).toHaveCount(0, TRANSFER);
		},
		async CHUNK_FAILS(scene) {
			const open = await tracker(scene.page).isVisible();
			await holds.get(scene)?.abort(500);
			if (open) await expect(tracker(scene.page).getByRole("button", { name: "Retry", exact: true })).toBeVisible();
			else await expect(railDot(scene.page)).toHaveAttribute("data-attention", "true");
		},
		async RETRY(scene) {
			await rehold(scene);
			await tracker(scene.page).getByRole("button", { name: "Retry", exact: true }).click();
			await expectUploading(scene.page, 1);
		},
		async STORAGE_FULL(scene) {
			await holds.get(scene)?.abort(413);
			await expect(entries(scene.page, "held")).toHaveCount(1);
			await expect(tracker(scene.page).getByText("Storage is full", { exact: true })).toBeVisible();
		},
		async RETRY_ALL(scene) {
			await rehold(scene);
			await tracker(scene.page).getByRole("button", { name: "Retry all" }).first().click();
			await expectUploading(scene.page, 1);
		},
		async RELOAD(scene) {
			await scene.page.reload();
			await expect(railDot(scene.page)).toHaveAttribute("data-attention", "true");
			await expect(tracker(scene.page)).toBeHidden();
		},
		async OPEN_FROM_RAIL(scene) {
			await scene.page.locator("a, button").filter({ has: railDot(scene.page) }).first().click();
			await expect(tracker(scene.page)).toBeVisible();
		},
		async RESUME(scene) {
			const [chooser] = await Promise.all([
				scene.page.waitForEvent("filechooser"),
				tracker(scene.page).getByRole("button", { name: "Resume" }).click(),
			]);
			await chooser.setFiles(largeFiles(1));
			await expectUploading(scene.page, 1);
			await expect(entries(scene.page, "uploading")).toHaveCount(1);
		},
		async CLOSE_TRACKER(scene) {
			await tracker(scene.page).getByRole("button", { name: "Close uploads" }).click();
			await expect(tracker(scene.page)).toBeHidden();
		},
		async SAME_NAMES(scene) {
			await pick(scene, [
				{ name: "Quarter review.pdf", mimeType: "application/pdf", buffer: fixture("Quarter review.pdf") },
				{ name: "Logo.png", mimeType: "image/png", buffer: fixture("Logo.png") },
			]);
			await expect(scene.page.getByRole("dialog", { name: "A file with this name exists" })).toBeVisible();
		},
		async SKIP_ALL(scene) {
			const dialog = scene.page.getByRole("dialog", { name: "A file with this name exists" });
			await dialog.getByText("Apply to all").click();
			await dialog.getByRole("button", { name: "Skip", exact: true }).click();
			await expect(entries(scene.page, "skipped")).toHaveCount(2);
		},
		async KEEP_BOTH_ALL(scene) {
			const dialog = scene.page.getByRole("dialog", { name: "A file with this name exists" });
			await dialog.getByText("Apply to all").click();
			await dialog.getByRole("button", { name: "Continue" }).click();
			await expect(entries(scene.page, "done")).toHaveCount(2, TRANSFER);
		},
		async SAME_FOLDER(scene) {
			await scene.page.getByRole("button", { name: "New", exact: true }).click();
			const [chooser] = await Promise.all([
				scene.page.waitForEvent("filechooser"),
				scene.page.getByRole("menuitem", { name: "Folder", exact: true }).last().click(),
			]);
			await chooser.setFiles(join(scratchDir(), "Design reviews"));
			await expect(scene.page.getByRole("dialog").getByText("A folder with this name exists")).toBeVisible();
		},
		async KEEP_BOTH_FOLDER(scene) {
			holds.set(scene, await scene.hold(FOLDER_CREATE));
			await scene.page.getByRole("dialog").getByRole("button", { name: "Keep both" }).click();
			await expect(tracker(scene.page).getByText("Creating folders…")).toBeVisible();
		},
		async PICK_TOO_MANY(scene) {
			await leaveFree(scene, 50 * 1024 * 1024);
			await pick(scene, largeFiles(5));
			await expect(scene.page.getByRole("dialog").getByText("2 of 5 files fit")).toBeVisible();
		},
		async PICK_TOO_BIG(scene) {
			await leaveFree(scene, 1024 * 1024);
			await pick(scene, largeFiles(1));
			await expect(scene.page.getByRole("dialog").getByText("none of them fit")).toBeVisible();
		},
	},
});
