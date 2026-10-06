import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { frappeData } from "../../shared/frappe";
import { writerEditor } from "./writer";

/** Where a document's collab log stands, from `suite.drive.e2e_api.state`. */
export interface CollabState {
	checkpoint_rev: number;
	head_rev: number;
	tail_rows: number;
}

async function hook<T>(api: APIRequestContext, name: string, node: string): Promise<T> {
	return frappeData<T>(
		await api.post(`/api/method/suite.drive.e2e_api.${name}`, { form: { node } }),
	);
}

/** Turn collaboration on for the site and give `node` a collab log. Call before the document opens. */
export const enableCollab = (api: APIRequestContext, node: string) =>
	hook<CollabState>(api, "enable_collab", node);

export const compactNow = (api: APIRequestContext, node: string) =>
	hook<CollabState>(api, "compact_now", node);

export const collabState = (api: APIRequestContext, node: string) =>
	hook<CollabState>(api, "state", node);

/** The text of each top-level block, as the server would serve it. */
export const serverText = (api: APIRequestContext, node: string) =>
	hook<string[]>(api, "server_text", node);

/** The text of each top-level block in the editor. */
export function editorBlocks(page: Page): Promise<string[]> {
	return writerEditor(page).evaluate((editor) =>
		[...editor.children].map((block) => block.textContent ?? ""),
	);
}

export async function expectSaved(page: Page): Promise<void> {
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

/** Type at the end of the document, in a paragraph of its own. */
export async function typeParagraph(page: Page, text: string): Promise<void> {
	await writerEditor(page).click();
	await page.keyboard.press("ControlOrMeta+End");
	await page.keyboard.press("Enter");
	await page.keyboard.type(text);
}

/** Wait until every page shows the same blocks as the server, and those blocks hold every text. */
export async function expectConverged(
	api: APIRequestContext,
	node: string,
	pages: Page[],
	texts: string[],
	timeout?: number,
): Promise<string[]> {
	let blocks: string[] = [];
	await expect
		.poll(async () => {
			const server = await serverText(api, node);
			const shown = await Promise.all(pages.map(editorBlocks));
			blocks = server;
			return {
				matchesServer: shown.every((page) => JSON.stringify(page) === JSON.stringify(server)),
				missing: texts.filter((text) => !server.join("\n").includes(text)),
			};
		}, { timeout })
		.toEqual({ matchesServer: true, missing: [] });
	return blocks;
}

/** Store the document's current bytes as a named version, through Drive's versions route; answers its seq. */
export async function takeVersion(
	request: APIRequestContext,
	node: string,
	label: string,
): Promise<string> {
	const response = await request.post(
		`/api/suite/drive/nodes/${encodeURIComponent(node)}/versions`,
		{ data: { kind: "named", label } },
	);
	expect(response.ok(), await response.text()).toBe(true);
	return ((await response.json()) as { data: { seq: string } }).data.seq;
}

/** Paste a 16 px PNG at the cursor, as a picture copied from another app would be. */
export async function pastePicture(page: Page): Promise<void> {
	await writerEditor(page).evaluate((editor) => {
		const png =
			"iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEhrVMKphVMOohlENQ1UDAOWw/wF6FG3VAAAAAElFTkSuQmCC";
		const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
		const data = new DataTransfer();
		data.items.add(new File([bytes], "dot.png", { type: "image/png" }));
		editor.dispatchEvent(
			new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
		);
	});
}

/** Whether each picture the editor shows has loaded. */
export function picturesLoaded(page: Page): Promise<boolean[]> {
	return writerEditor(page)
		.locator("img[src]")
		.evaluateAll((images) =>
			(images as HTMLImageElement[]).map((image) => image.complete && image.naturalWidth > 0),
		);
}
