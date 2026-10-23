import { expect, test } from "../../fixtures/test";
import {
	createWriterDocument,
	openWriterDocument,
	uniqueWriterTitle,
	writerEditor,
} from "../../helpers/writer";
import type { Page } from "@playwright/test";

// Tab buttons in the desktop ToC are the only draggable elements on the page.
function tocTabs(page: Page) {
	return page.locator('[draggable="true"]');
}

function tabPanel(page: Page, label: string) {
	return page.locator(`[data-tab-label="${label}"]`);
}

// Typing a first line and pressing Enter renames an "Untitled" tab to that line.
async function addTab(page: Page, text: string, first = false) {
	await page
		.getByRole("button", { name: first ? "Create tab" : "Add tab" })
		.click();
	await writerEditor(page).click();
	await page.keyboard.type(text);
	await page.keyboard.press("Enter");
	await expect(tocTabs(page).filter({ hasText: text })).toHaveCount(1);
}

// Regression for the mobile tab bar (ToCMobile):
//   1. a tab added while the bar is already mounted must appear in it, and
//   2. tapping a tab on mobile must actually switch the visible panel.
test("mobile tab bar reflects added tabs and switches the active panel", async ({
	owner,
	run,
}) => {
	const { page } = owner;
	await page.setViewportSize({ width: 1440, height: 900 });
	const file = await createWriterDocument(
		page.request,
		uniqueWriterTitle(run.run_id, "tabs-mobile"),
	);
	// Open the Table of Contents expanded so its tab controls are reachable
	// (the collapsed toggle is an icon-only button with no accessible name).
	await page.addInitScript(() => window.localStorage.setItem("showToc", "true"));
	await openWriterDocument(page, file.name);

	// First tab wraps the doc; the bar (ToCMobile) mounts here (CSS-hidden on
	// desktop). Adding the second tab afterwards is the live-update case.
	const panels = page.locator("[data-tab-id]");
	await page.getByRole("button", { name: "Create tab" }).click();
	await expect(panels).toHaveCount(1);
	await page.getByRole("button", { name: "Add tab" }).click();
	await expect(panels).toHaveCount(2);
	// createTab activates the new tab a tick later; let that settle before the layout changes.
	const ids = await panels.evaluateAll((els) =>
		els.map((el) => el.getAttribute("data-tab-id")),
	);
	await expect(page.locator(`[data-tab-id="${ids[1]}"]`)).toBeVisible();
	await expect(page.locator(`[data-tab-id="${ids[0]}"]`)).toBeHidden();

	// Switch to a phone viewport: the bar becomes visible. Only ToCMobile renders
	// frappe-ui TabButtons (data-slot="tab-button"), so these are its buttons.
	await page.setViewportSize({ width: 390, height: 844 });

	// Bug 1: the second tab (added after the bar mounted) shows up in the bar.
	const barButtons = page.locator('[data-slot="tab-button"]');
	await expect(barButtons).toHaveCount(2);

	// Exactly one tab panel is shown; the freshly-added (second) tab stays active.
	await expect(page.locator(`[data-tab-id="${ids[1]}"]`)).toBeVisible();
	await expect(page.locator(`[data-tab-id="${ids[0]}"]`)).toBeHidden();

	// Bug 2: tapping the first tab in the bar switches the visible panel.
	await barButtons.first().click();
	await expect(page.locator(`[data-tab-id="${ids[0]}"]`)).toBeVisible();
	await expect(page.locator(`[data-tab-id="${ids[1]}"]`)).toBeHidden();
});

// The tab menu is reachable by right-click, but also from an explicit "..."
// button on the active tab — the only affordance touch users and anyone who
// doesn't think to right-click will find.
test("the tab menu button renames the active tab", async ({ owner, run }) => {
	const { page } = owner;
	const file = await createWriterDocument(
		page.request,
		uniqueWriterTitle(run.run_id, "tabs-menu"),
	);
	await page.addInitScript(() => window.localStorage.setItem("showToc", "true"));
	await openWriterDocument(page, file.name);

	await addTab(page, "alpha", true);
	await addTab(page, "bravo");
	// The menu button only exists on the active tab, which is the one just added.
	const menuButton = page.getByRole("button", { name: "Tab options" });
	await expect(menuButton).toHaveCount(1);

	await menuButton.click();
	await page.getByRole("menuitem", { name: "Rename" }).click();

	const input = page.getByRole("textbox", { name: "Tab name" });
	await expect(input).toBeVisible();
	await input.fill("renamed");
	await input.press("Enter");

	await expect(input).toBeHidden();
	await expect(tocTabs(page)).toHaveText(["alpha", "renamed"]);
	// The panel keeps its content and follows the new label.
	await expect(tabPanel(page, "renamed")).toContainText("bravo");

	// Persisted in the stored document.
	await page.reload();
	await expect(writerEditor(page)).toBeVisible();
	await expect(tocTabs(page)).toHaveText(["alpha", "renamed"]);
});

// Reordering used to delete the tab node and re-insert a copy, which Yjs cannot
// merge as a move: the tab could end up duplicated, with its content split
// across both copies. Order now lives in an attribute and nodes never move.
test("reordering tabs preserves every tab's content", async ({ owner, run }) => {
	const { page } = owner;
	const duplicateWarnings: string[] = [];
	page.on("console", (message) => {
		if (message.text().includes("duplicate tab ids")) {
			duplicateWarnings.push(message.text());
		}
	});

	const file = await createWriterDocument(
		page.request,
		uniqueWriterTitle(run.run_id, "tabs-reorder"),
	);
	await page.addInitScript(() => window.localStorage.setItem("showToc", "true"));
	await openWriterDocument(page, file.name);

	await addTab(page, "alpha", true);
	await addTab(page, "bravo");
	await addTab(page, "charlie");
	await expect(tocTabs(page)).toHaveText(["alpha", "bravo", "charlie"]);

	// Drop above the midpoint of the first tab so charlie lands at the top.
	await tocTabs(page)
		.nth(2)
		.dragTo(tocTabs(page).nth(0), { targetPosition: { x: 10, y: 2 } });

	await expect(tocTabs(page)).toHaveText(["charlie", "alpha", "bravo"]);

	const panels = page.locator("[data-tab-id]");
	await expect(panels).toHaveCount(3);
	const ids = await panels.evaluateAll((els) =>
		els.map((el) => el.getAttribute("data-tab-id")),
	);
	expect(new Set(ids).size).toBe(3);

	for (const label of ["alpha", "bravo", "charlie"]) {
		await expect(tabPanel(page, label)).toContainText(label);
		await expect(tabPanel(page, label)).toHaveCount(1);
	}

	// The new order and the content survive a reload of the stored document.
	await page.reload();
	await expect(writerEditor(page)).toBeVisible();
	await expect(tocTabs(page)).toHaveText(["charlie", "alpha", "bravo"]);
	for (const label of ["alpha", "bravo", "charlie"]) {
		await expect(tabPanel(page, label)).toContainText(label);
	}
	await expect(page.locator("[data-tab-id]")).toHaveCount(3);

	expect(duplicateWarnings).toEqual([]);
});
