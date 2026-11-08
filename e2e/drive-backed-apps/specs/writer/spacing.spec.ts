import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures/test";
import { createWriterDocument, openWriterDocument, uniqueWriterTitle, writerEditor } from "../../helpers/writer";

function firstParagraph(page: Page) {
	return writerEditor(page).locator("p").first();
}

function computed(locator: ReturnType<Page["locator"]>, property: string) {
	return locator.evaluate((node, prop) => getComputedStyle(node).getPropertyValue(prop), property);
}

// printDoc() renders into a hidden iframe and then prints it. Keep that iframe
// around and inert so the test can measure what the print sheet would show.
async function keepPrintFrame(page: Page) {
	await page.addInitScript(() => {
		const create = document.createElement.bind(document);
		// SAFETY: this wrapper forwards tag/options unchanged and returns the native element; the overloads depend only on tag.
		document.createElement = ((tag: string, options?: ElementCreationOptions) => {
			const el = create(tag, options);
			if (String(tag).toLowerCase() === "iframe") {
				el.addEventListener("load", () => {
					if (!(el instanceof HTMLIFrameElement)) return;
					const frame = el;
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
			if ((child instanceof HTMLElement ? child.id : undefined) === "el-tiptap-iframe") return child;
			removeChild.call(this, child);
			return child;
		};
	});
}

test("printing keeps the paragraph spacing shown in the editor", async ({ owner, run }) => {
	const { page } = owner;
	await keepPrintFrame(page);
	const file = await createWriterDocument(page.request, uniqueWriterTitle(run.run_id, "print-spacing"));
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
	expect(await computed(printed.first(), "line-height")).toBe(editorSpacing.lineHeight);
	expect(await computed(printed.first(), "margin-bottom")).toBe(editorSpacing.marginBottom);
	expect(await computed(printed.nth(1), "margin-top")).toBe(editorSpacing.marginTop);
});
