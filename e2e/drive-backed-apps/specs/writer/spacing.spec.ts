import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures/test";
import {
	createWriterDocument,
	openWriterDocument,
	uniqueWriterTitle,
	writerEditor,
} from "../../helpers/writer";

// Google Docs applies line spacing as a multiple of the font's natural line
// height (~1.2em), not of the font size — the editor stores CSS but the popover
// speaks Docs units, so "2" on a 15px paragraph is 2 * 1.2 * 15 = 36px.
const NATURAL_LINE_HEIGHT = 1.2;

// The popover's three number inputs, in DOM order: line spacing, above, below.
// Scoped to the popover because the toolbar's font-size stepper (ManageFont) is
// a spinbutton as well, and it comes first in the DOM.
function spacingInputs(page: Page) {
	return page
		.locator('[data-slot="content"]')
		.filter({ has: page.getByText("Paragraph spacing") })
		.getByRole("spinbutton");
}

async function openSpacingPopover(page: Page) {
	await page.getByRole("button", { name: "Custom spacing" }).click();
	await expect(spacingInputs(page)).toHaveCount(3);
}

function firstParagraph(page: Page) {
	return writerEditor(page).locator("p").first();
}

function computed(locator: ReturnType<Page["locator"]>, property: string) {
	return locator.evaluate(
		(node, prop) => getComputedStyle(node).getPropertyValue(prop),
		property,
	);
}

// Chrome snaps used line-heights to 1/64px, so compare numerically.
async function computedPx(
	locator: ReturnType<Page["locator"]>,
	property: string,
): Promise<number> {
	return Number.parseFloat(await computed(locator, property));
}

// The toolbar Button that MenuItems.vue renders for a component item carries no
// tooltip, so SpacingDialog renders its own trigger. Wrapping the slot in a
// Tooltip instead breaks the popover — PopoverTrigger can't wire as-child
// through it — so assert both halves together.
test("the Custom Spacing button has a tooltip and still opens the popover", async ({
	owner,
	run,
}) => {
	const { page } = owner;
	const file = await createWriterDocument(
		page.request,
		uniqueWriterTitle(run.run_id, "spacing-tooltip"),
	);
	await openWriterDocument(page, file.name);

	const button = page.getByRole("button", { name: "Custom spacing" });
	await button.hover();
	// reka's role="tooltip" node is an sr-only, aria-hidden span, so assert on the
	// visible bubble the popper renders instead.
	await expect(
		page.locator("[data-reka-popper-content-wrapper]", { hasText: "Custom spacing" }),
	).toBeVisible();

	await button.click();
	await expect(spacingInputs(page)).toHaveCount(3);
});

test("line spacing uses Google Docs multiples and leaves paragraph spacing alone", async ({
	owner,
	run,
}) => {
	const { page } = owner;
	const file = await createWriterDocument(
		page.request,
		uniqueWriterTitle(run.run_id, "spacing"),
	);
	await openWriterDocument(page, file.name);

	const editor = writerEditor(page);
	await editor.click();
	await page.keyboard.type("First paragraph");
	await page.keyboard.press("Enter");
	await page.keyboard.type("Second paragraph");

	// Selection stays on the second paragraph, which is what the popover edits.
	const paragraph = editor.locator("p").nth(1);
	// Read the rendered font size rather than assuming the 15px default.
	const fontSize = await computedPx(paragraph, "font-size");
	const expectedLineHeight = (spacing: number) =>
		spacing * NATURAL_LINE_HEIGHT * fontSize;
	await openSpacingPopover(page);

	await spacingInputs(page).first().fill("2");
	await expect
		.poll(() => computedPx(paragraph, "line-height"))
		.toBeCloseTo(expectedLineHeight(2), 1);

	await spacingInputs(page).nth(2).fill("20");
	await expect.poll(() => computedPx(paragraph, "margin-bottom")).toBe(20);

	// Regression: changing the line spacing used to rewrite the margin
	// attributes too, dropping the spacing that was just set.
	await spacingInputs(page).first().fill("1.15");
	await expect
		.poll(() => computedPx(paragraph, "line-height"))
		.toBeCloseTo(expectedLineHeight(1.15), 1);
	await expect.poll(() => computedPx(paragraph, "margin-bottom")).toBe(20);
});

// printDoc() renders into a hidden iframe and then prints it. Keep that iframe
// around and inert so the test can measure what the print sheet would show.
async function keepPrintFrame(page: Page) {
	await page.addInitScript(() => {
		const create = document.createElement.bind(document);
		document.createElement = ((tag: string, ...rest: unknown[]) => {
			const el = create(tag, ...(rest as []));
			if (String(tag).toLowerCase() === "iframe") {
				el.addEventListener("load", () => {
					const frame = el as HTMLIFrameElement;
					const win = frame.contentWindow;
					if (!win) return;
					win.print = () => {};
					win.document.execCommand = () => false;
				});
			}
			return el;
		}) as typeof document.createElement;

		const removeChild = Node.prototype.removeChild;
		Node.prototype.removeChild = function <T extends Node>(child: T): T {
			if ((child as unknown as HTMLElement).id === "el-tiptap-iframe") return child;
			return removeChild.call(this, child) as T;
		};
	});
}

test("printing keeps the paragraph spacing shown in the editor", async ({
	owner,
	run,
}) => {
	const { page } = owner;
	await keepPrintFrame(page);
	const file = await createWriterDocument(
		page.request,
		uniqueWriterTitle(run.run_id, "print-spacing"),
	);
	await openWriterDocument(page, file.name);

	const editor = writerEditor(page);
	await editor.click();
	await page.keyboard.type("First paragraph");
	await page.keyboard.press("Enter");
	await page.keyboard.type("Second paragraph");

	const editorSpacing = {
		lineHeight: await computed(firstParagraph(page), "line-height"),
		marginTop: await computed(editor.locator("p").nth(1), "margin-top"),
		marginBottom: await computed(firstParagraph(page), "margin-bottom"),
	};
	// The editor gives paragraphs no margins of their own; only the settings do.
	expect(editorSpacing.marginTop).toBe("0px");
	expect(editorSpacing.marginBottom).toBe("0px");

	await page.keyboard.press("ControlOrMeta+p");

	// The print document used to miss the editor's prose classes and custom
	// properties, so every paragraph picked up a ~1.14em margin instead.
	const printed = page.frameLocator("#el-tiptap-iframe").locator(".ProseMirror p");
	// The print iframe is deliberately 0x0, so wait on attachment, not visibility.
	await printed.first().waitFor({ state: "attached" });
	expect(await computed(printed.first(), "line-height")).toBe(
		editorSpacing.lineHeight,
	);
	expect(await computed(printed.first(), "margin-bottom")).toBe(
		editorSpacing.marginBottom,
	);
	expect(await computed(printed.nth(1), "margin-top")).toBe(
		editorSpacing.marginTop,
	);
});
