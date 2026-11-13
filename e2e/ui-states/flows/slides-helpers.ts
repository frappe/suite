import { expect, type Page } from "@playwright/test";
import { copyNode, createDocument, discardNode, view, type DriveNode } from "../../drive-backed-apps/helpers/drive";
import { callMethod, type BaseScene } from "../scene";

/** The seeded Northwind deck: five slides with text, cards and a callout. */
const SEEDED_TITLE = "Q3 review and Q4 priorities";
const PRESENTATION = "suite.slides.doctype.presentation.presentation";

/** A copy of the seeded deck in the person's root, made as Drive's Make a copy makes one, and purged when the scene closes. */
export async function copySeededDeck(scene: BaseScene, title: string): Promise<DriveNode> {
	const source = await seededDeck(scene);
	const node = await copyNode(scene.api, source.name, scene.name(title));
	scene.defer(() => discardNode(scene.api, node.name));
	return node;
}

/** A new, empty presentation in the person's root, purged when the scene closes. */
export async function createDeck(scene: BaseScene, title: string): Promise<DriveNode> {
	const node = await createDocument(scene.api, scene.name(title), "Presentation");
	scene.defer(() => discardNode(scene.api, node.name));
	return node;
}

/**
 * The seeded deck, found by its title, once it is collaborative. A demo site
 * seeded before Slides collaboration keeps it on its old rows until someone
 * opens it, and a copy made before that would wait for its own conversion.
 */
async function seededDeck(scene: BaseScene): Promise<DriveNode> {
	const [deck] = (await view(scene.api, "search", { term: SEEDED_TITLE, content_doctype: "Presentation" })).filter(
		(row) => row.title === SEEDED_TITLE,
	);
	if (!deck?.content_docname) throw new Error(`The demo site has no presentation called ${SEEDED_TITLE}`);
	const docname = deck.content_docname;
	const isConverted = async () =>
		!!(await callMethod<{ is_converted?: boolean }>(scene.api, `${PRESENTATION}.get_public_presentation`, { name: docname })).is_converted;
	if (await isConverted()) return deck;
	// Opening the deck, as the editor does, asks for its conversion.
	const user = await callMethod<string>(scene.api, "frappe.auth.get_logged_user");
	const opened = await scene.api.get(`/api/suite/content/${deck.name}/document`, { headers: { "X-Expected-User": user } });
	if (!opened.ok()) throw new Error(`Opening ${SEEDED_TITLE} failed: ${opened.status()}`);
	await expect.poll(isConverted, { timeout: 120_000, intervals: [2_000] }).toBe(true);
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
