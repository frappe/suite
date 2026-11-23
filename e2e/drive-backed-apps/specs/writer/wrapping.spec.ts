import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../fixtures/test";
import { createWriterDocument, openWriterDocument, uniqueWriterTitle, writerEditor } from "../../helpers/writer";

const PARAGRAPH =
	"We do not deduct pay for taking leave. 45 annual leave will be provided " +
	"to you apart from the Public Holiday list that Frappe observes.";

const LINK =
	"https://example.com/a/very/long/path/that/has/no/place/to/break/" +
	"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

// Widths that put the wrap point in a different word each time. The editor
// column is capped at 48rem, so a viewport sweep leaves it unchanged on a wide
// screen. The width goes on the editor element instead.
const WIDTHS = [320, 400, 480, 560, 640];

function computed(locator: Locator, property: string) {
	return locator.evaluate((node, prop) => getComputedStyle(node).getPropertyValue(prop), property);
}

// A word the browser drew on two lines has one client rect per line.
function splitWords(paragraph: Locator): Promise<string[]> {
	return paragraph.evaluate((node) => {
		const split: string[] = [];
		const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
		let text = walker.nextNode();
		while (text) {
			for (const match of (text.textContent ?? "").matchAll(/\S+/g)) {
				const range = document.createRange();
				range.setStart(text, match.index);
				range.setEnd(text, match.index + match[0].length);
				if (range.getClientRects().length > 1) split.push(match[0]);
			}
			text = walker.nextNode();
		}
		return split;
	});
}

function setEditorWidth(editor: Locator, width: number): Promise<void> {
	return editor.evaluate((node, value) => {
		if (!(node instanceof HTMLElement)) throw new Error("Expected an editor element");
		node.style.width = `${value}px`;
	}, width);
}

async function typeParagraphs(page: Page, editor: Locator): Promise<void> {
	await editor.click();
	await page.keyboard.type(PARAGRAPH);
	await page.keyboard.press("Enter");
	await page.keyboard.type(LINK);
}

// frappe-ui's editor stylesheet sets `word-break: break-word` on .ProseMirror.
// That keyword is deprecated, it means `overflow-wrap: anywhere`, and it lets
// an engine cut a word at the end of a line although the whole word fits on
// the next one. The writer pins the standard pair instead.
test("the editor keeps a word whole and still wraps a long link", async ({ owner, run }) => {
	const { page } = owner;
	const file = await createWriterDocument(page.request, uniqueWriterTitle(run.run_id, "wrapping"));
	await openWriterDocument(page, file.name);

	const editor = writerEditor(page);
	await typeParagraphs(page, editor);

	await expect.poll(() => computed(editor, "word-break")).toBe("normal");
	await expect.poll(() => computed(editor, "overflow-wrap")).toBe("break-word");

	const paragraph = editor.locator("p").first();
	const link = editor.locator("p").nth(1);
	for (const width of WIDTHS) {
		await setEditorWidth(editor, width);
		await expect.poll(() => splitWords(paragraph)).toEqual([]);
		// The link has no place to break, so it may be cut — but it must stay
		// inside the page rather than push the column wider.
		await expect.poll(() => link.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(0);
	}
});
