import { expect, type Page } from "@playwright/test";
import { copyNode, createDocument, trashAndPurge, view, type DriveNode } from "../../drive-backed-apps/helpers/drive";
import { callMethod } from "../../shared/frappe";
import type { BaseScene } from "../scene";

/** The seeded Northwind deck: five slides with text, cards and a callout. */
const SEEDED_TITLE = "Q3 review and Q4 priorities";
const PRESENTATION = "suite.slides.doctype.presentation.presentation";

/** A copy of the seeded deck in the person's root, made as Drive's Make a copy makes one, and purged when the scene closes. */
export async function copySeededDeck(scene: BaseScene, title: string): Promise<DriveNode> {
	const source = await seededDeck(scene);
	const node = await copyNode(scene.api, source.name, scene.name(title));
	scene.defer(() => trashAndPurge(scene.api, node.name));
	return node;
}

/** A new, empty presentation in the person's root, purged when the scene closes. */
export async function createDeck(scene: BaseScene, title: string): Promise<DriveNode> {
	const node = await createDocument(scene.api, scene.name(title), "Presentation");
	scene.defer(() => trashAndPurge(scene.api, node.name));
	return node;
}

/**
 * The seeded deck, found by its title. It must be collaborative already: a
 * copy of a deck still on its old rows would wait for its own conversion.
 */
async function seededDeck(scene: BaseScene): Promise<DriveNode> {
	const [deck] = (await view(scene.api, "search", { term: SEEDED_TITLE, content_doctype: "Presentation" })).filter(
		(row) => row.title === SEEDED_TITLE,
	);
	if (!deck?.content_docname) throw new Error(`The demo site has no presentation called ${SEEDED_TITLE}`);
	const { is_converted } = await callMethod<{ is_converted?: boolean }>(scene.api, `${PRESENTATION}.get_public_presentation`, {
		name: deck.content_docname,
	});
	if (!is_converted) {
		throw new Error(
			`The demo site was seeded before Slides collaboration, so "${SEEDED_TITLE}" is not collaborative yet. ` +
				"Open it once in the Slides editor, which converts it, or seed the demo site again.",
		);
	}
	return deck;
}

/** Waits for the editor: the title in the header, the skeleton gone, the slide list counting slides. */
export async function expectEditor(page: Page, slideCount = 5): Promise<void> {
	await expect(page.getByRole("textbox", { name: "Presentation title" })).toBeVisible({ timeout: 20_000 });
	await expect(page.getByRole("status", { name: "Opening presentation" })).toBeHidden({ timeout: 20_000 });
	await expect(page.getByText(`1 of ${slideCount}`, { exact: true })).toBeVisible();
}

/**
 * Slides' service worker answers the deck read from its own cache, out of
 * Playwright's reach. A page whose context sets this flag before the first
 * load never registers it, so the deck read can be held.
 */
export async function withoutServiceWorker(page: Page): Promise<void> {
	await page.context().addInitScript(() => {
		Object.assign(window, { disable_slides_service_worker: true });
	});
}
