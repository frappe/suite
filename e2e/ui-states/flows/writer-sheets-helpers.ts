import { expect, type Locator, type Page } from "@playwright/test";
import { createDocument, grantAccess, trashAndPurge, type DriveNode } from "../../drive-backed-apps/helpers/drive";
import { demoUser, type DemoPerson } from "../demo";
import { perScene, type BaseScene } from "../scene";

/**
 * What the Writer and Sheets flows share: a document of the path's own in
 * the signed-in person's My files, removed when the path closes, and a second
 * person's page for the states someone else sees.
 */

export const WRITER_DOCTYPE = "Writer Document";
export const SHEET_DOCTYPE = "Sheet";

/** The banner every live document shows on this bench, five seconds after it opens. */
export const POLLING_BANNER = "Live updates are unavailable";

/** Creates a document titled `label` plus the path's stamp, and removes it when the scene closes. */
export async function createPathDocument(scene: BaseScene, label: string, doctype: string): Promise<DriveNode> {
	const node = await createDocument(scene.api, scene.name(label), doctype);
	scene.defer(() => trashAndPurge(scene.api, node.name));
	return node;
}

/** Gives `person` a role on `node` as the signed-in owner; the grant goes with the document. */
export async function grantTo(scene: BaseScene, node: string, person: DemoPerson, role: number): Promise<void> {
	await grantAccess(scene.api, node, demoUser(person).email, role);
}

const otherPages = perScene<Page>("a second person's page");

/** Opens `/d/<node>` as `person` in a second context, and remembers the page for `framedPage`. */
export async function openAs(scene: BaseScene, person: DemoPerson, node: string): Promise<Page> {
	const page = await scene.pageAs(demoUser(person));
	otherPages.set(scene, page);
	await page.goto(`/d/${node}`);
	return page;
}

/** The second person's page, for a state shown there. */
export function framedPage(scene: BaseScene): Locator {
	return otherPages.get(scene).locator("body");
}

/** Matches the Drive read that opens `/d/<node>`, so the host stays on its skeleton or fails. */
export function nodeRead(node: string): RegExp {
	return new RegExp(`/api/suite/drive/nodes/${node}\\?`);
}

/** Matches the collab read that opens a document's body, once the host has its session. */
export function bodyRead(node: string): RegExp {
	return new RegExp(`/api/suite/content/${node}/document`);
}

/** Matches a document's pushes and pulls. */
export function updates(node: string): RegExp {
	return new RegExp(`/api/suite/content/${node}/updates`);
}

/** The header's save state, as `DocumentHeader.vue` writes it on `data-save-state`. */
export function header(page: Page, saveState?: string): Locator {
	return page.locator(saveState ? `header[data-save-state="${saveState}"]` : "header[data-save-state]");
}

export async function expectPollingBanner(page: Page): Promise<void> {
	await expect(page.getByText(POLLING_BANNER).first()).toBeVisible({ timeout: 15_000 });
}
