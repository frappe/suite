import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { createDocument, grantAccess, revokeAccess, ROLE, type DriveNode } from "./drive";

/** The Drive content doctype that Writer documents are stored as. */
const WRITER_DOCTYPE = "Writer Document";

export function uniqueWriterTitle(runId: string, scenario: string): string {
	return `E2E Writer ${scenario} ${runId} ${Date.now().toString(36)}`;
}

/** A Writer document in the caller's Personal root, through Drive's `node_create` union. */
export function createWriterDocument(
	request: APIRequestContext,
	title: string,
	parent?: string,
): Promise<DriveNode> {
	return createDocument(request, title, WRITER_DOCTYPE, parent);
}

/**
 * Grant `options.user` the highest role the flags name, or publish the
 * document for reading when no user is named. No flag at all removes the grant.
 */
export async function shareWriterDocument(
	request: APIRequestContext,
	node: string,
	options: { user?: string; read: boolean; write?: boolean; comment?: boolean },
): Promise<void> {
	const principal = options.user || "$PUBLIC";
	const role = options.write
		? ROLE.EDIT
		: options.comment
			? ROLE.COMMENT
			: options.read
				? ROLE.READ
				: ROLE.NONE;
	if (role === ROLE.NONE) await revokeAccess(request, node, principal);
	else await grantAccess(request, node, principal, role);
}

/** Open the document at `/d/<node>` and wait for its editor. */
export async function openWriterDocument(page: Page, node: string): Promise<void> {
	await page.goto(`/d/${node}`);
	await expect(writerEditor(page)).toBeVisible();
}

export function writerEditor(page: Page): Locator {
	return page.getByRole("textbox", { name: "Document editor" });
}

/** Click into the block that shows `text`, and wait until the editor has its caret there. */
export async function placeCaretIn(page: Page, text: string): Promise<void> {
	await writerEditor(page).getByText(text).click();
	// The editor reads a click's caret on the browser's next selection event, which can come after the next keys
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(document.querySelector(".ProseMirror") as { editor?: { state: { selection: { $from: { parent: { textContent: string } } } } } } | null)
						?.editor?.state.selection.$from.parent.textContent,
			),
		)
		.toBe(text);
}

/** The document title field in the header; renames on Enter, reverts on Escape. */
export function documentTitle(page: Page): Locator {
	return page.getByRole("textbox", { name: "Document title" });
}

export function documentMenuButton(page: Page): Locator {
	return page.getByRole("button", { name: "More document actions" });
}

/** Type `content` into the editor and save with the keyboard shortcut. */
export async function typeAndSave(page: Page, content: string): Promise<void> {
	const editor = writerEditor(page);
	await editor.click();
	await page.keyboard.type(content);
	await page.keyboard.press("ControlOrMeta+s");
	await expect(page.getByText("Saved document", { exact: true })).toBeVisible();
}
