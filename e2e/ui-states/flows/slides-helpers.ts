import { expect, type APIRequestContext, type Page, type Route } from "@playwright/test";
import { createDocument, discardNode, type DriveNode } from "../../drive-backed-apps/helpers/drive";
import type { BaseScene } from "../scene";

/** The seeded Northwind deck, "Q3 review and Q4 priorities": five slides with text, cards and a callout. */
const SEEDED_PRESENTATION = "30clgs28gn";

interface SeededSlide {
	background: string | null;
	elements: string;
	transition: string | null;
	transition_duration: number | null;
}

interface SeededPresentation {
	slides: SeededSlide[];
	theme: string;
}

/** A new presentation in the person's root, purged when the scene closes. Empty, or with the seeded deck's five slides. */
export async function createDeck(scene: BaseScene, title: string, copySeeded = true): Promise<DriveNode> {
	const node = await createDocument(scene.api, scene.name(title), "Presentation");
	scene.defer(() => discardNode(scene.api, node.name));
	if (copySeeded) await copySeededSlides(scene.api, node);
	return node;
}

async function copySeededSlides(api: APIRequestContext, node: DriveNode): Promise<void> {
	const response = await api.get(`/api/resource/Presentation/${SEEDED_PRESENTATION}`);
	// SAFETY: Frappe's resource API answers `{ data: doc }`; the fields read here are Presentation's own.
	const { data } = (await response.json()) as { data: SeededPresentation };
	const slides = data.slides.map(({ background, elements, transition, transition_duration }) => ({
		background,
		elements,
		transition,
		transition_duration,
	}));
	const write = await api.put(`/api/resource/Presentation/${node.content_docname}`, {
		data: { slides, theme: data.theme },
	});
	if (!write.ok()) throw new Error(`Copying the seeded slides failed: ${write.status()}`);
}

/** Waits for the editor: the title in the header, the skeleton gone, the slide list counting slides. */
export async function expectEditor(page: Page, slideCount = 5): Promise<void> {
	await expect(page.getByRole("textbox", { name: "Presentation title" })).toBeVisible({ timeout: 20_000 });
	await expect(page.getByRole("status", { name: "Opening presentation" })).toBeHidden({ timeout: 20_000 });
	await expect(page.getByText(`1 of ${slideCount}`, { exact: true })).toBeVisible();
}

/**
 * A request gate on one page: requests matching `pattern` wait while it is
 * shut, fail with a server error while failing, and pass once opened. The
 * scene's own `hold` only routes the scene's page; these states live on a
 * second page.
 */
export interface Gate {
	fail(): Promise<void>;
	open(): Promise<void>;
}

export async function gate(page: Page, pattern: RegExp): Promise<Gate> {
	const held: Route[] = [];
	let mode: "hold" | "fail" | "pass" = "hold";
	const reject = (route: Route) =>
		route
			.fulfill({
				status: 500,
				contentType: "application/json",
				body: JSON.stringify({ exc_type: "ServerError", message: "Something went wrong" }),
			})
			.catch(() => undefined);
	await page.route(pattern, async (route) => {
		if (mode === "pass") await route.continue();
		else if (mode === "fail") await reject(route);
		else held.push(route);
	});
	return {
		async fail() {
			mode = "fail";
			await Promise.all(held.splice(0).map(reject));
		},
		async open() {
			mode = "pass";
			await Promise.all(held.splice(0).map((route) => route.continue().catch(() => undefined)));
		},
	};
}

/** Answers every save from `page` with a server error, so the deck stays unsaved. */
export async function failSaves(page: Page): Promise<void> {
	await page.route(/save_slides/, (route) =>
		route.fulfill({
			status: 417,
			contentType: "application/json",
			body: JSON.stringify({ exc_type: "ServerError", message: "Something went wrong" }),
		}),
	);
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
