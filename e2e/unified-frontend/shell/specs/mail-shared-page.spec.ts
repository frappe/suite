import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Spec §9.5, stage 3: Mail leaves the shared page as it found it.
 *
 * The journey starts in the Drive area, opens Mail from the rail, goes back to
 * the Drive area, then forward to Mail again. Every check compares against
 * what the same page showed before Mail ever loaded.
 *
 * Needs a mail account for the signed-in user (Administrator has
 * `administrator@suite.test` on the local Stalwart server) and a reachable
 * socket.io server.
 */

type OpenSockets = { platform: number; site: number };

/**
 * Count the open socket.io connections, in two kinds.
 *
 * - `platform`: the shell's realtime socket. It connects over websocket first, so its URL
 *   has no Engine.IO `sid`. The shell keeps it open for the life of the page.
 * - `site`: sockets from `createSiteSocket`. They connect over polling and then upgrade,
 *   so their URL has a `sid`. The first one also opens the calendar alert socket, which
 *   stays open for the life of the page by design. Every other one belongs to an app.
 */
function trackSockets(page: Page): () => OpenSockets {
	const open = new Map<object, keyof OpenSockets>();
	page.on("websocket", (socket) => {
		const url = socket.url();
		if (!url.includes("/socket.io/")) return;
		open.set(socket, /[?&]sid=/.test(url) ? "site" : "platform");
		socket.on("close", () => open.delete(socket));
	});
	return () => {
		const kinds = [...open.values()];
		return {
			platform: kinds.filter((kind) => kind === "platform").length,
			site: kinds.filter((kind) => kind === "site").length,
		};
	};
}

/** The open sockets once their total has held still for two seconds. */
async function settledSockets(sockets: () => OpenSockets): Promise<OpenSockets> {
	const total = () => sockets().platform + sockets().site;
	let last = -1;
	let steady = 0;
	while (steady < 4) {
		const now = total();
		steady = now === last ? steady + 1 : 0;
		last = now;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return sockets();
}

/** In Mail: the shell's socket, the calendar alert socket and one Mail socket. */
const inMail: OpenSockets = { platform: 1, site: 2 };
/** After Mail: Mail's socket is closed. The calendar alert socket stays. */
const afterMail: OpenSockets = { platform: 1, site: 1 };

function documentOverflow(page: Page) {
	return page.evaluate(() => ({
		html: getComputedStyle(document.documentElement).overflow,
		body: getComputedStyle(document.body).overflow,
	}));
}

/** The z-index an element paints at: its own, or its nearest ancestor's that sets one. */
function stackLevel(element: Locator) {
	return element.evaluate((node) => {
		for (let el: Element | null = node; el && el !== document.body; el = el.parentElement) {
			const z = getComputedStyle(el).zIndex;
			if (z !== "auto") return z;
		}
		return "auto";
	});
}

/** Whether the element paints above everything else at its own centre. */
function isTopmost(element: Locator) {
	return element.evaluate((node) => {
		const box = node.getBoundingClientRect();
		const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
		return hit !== null && node.contains(hit);
	});
}

/** Open the rail's account menu, then Settings, and read how both stack. */
async function shellOverlayStacking(page: Page) {
	await page.getByRole("button", { name: "Account" }).click();
	const menu = page.getByRole("menu");
	await expect(menu).toBeVisible();
	const menuLevel = await stackLevel(menu);
	await page.getByRole("menuitem", { name: "Settings" }).click();

	const dialog = page.getByRole("dialog", { name: "Settings" });
	await expect(dialog).toBeVisible();
	const stacking = {
		menu: menuLevel,
		dialog: await stackLevel(dialog),
		dialogOnTop: await isTopmost(dialog),
	};
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	return stacking;
}

const shortcutsDialog = (page: Page) => page.getByRole("dialog", { name: "Keyboard Shortcuts" });

async function openDriveArea(page: Page) {
	await expect(page).toHaveURL(/\/files$/);
	await expect(page.getByRole("navigation", { name: "Areas" })).toBeVisible();
}

async function openMail(page: Page) {
	await expect(page).toHaveURL(/\/mail/);
	await expect(page.getByRole("link", { name: /Inbox/ })).toBeVisible();
}

test("Mail, then the Drive area, then Mail again leaves the page as it was", async ({ page }) => {
	const sockets = trackSockets(page);

	// The Drive area before Mail ever loads: the reference for every check.
	await page.goto("/files");
	await openDriveArea(page);
	expect(await settledSockets(sockets)).toEqual({ platform: 1, site: 0 });
	const overflowBefore = await documentOverflow(page);
	const stackingBefore = await shellOverlayStacking(page);
	expect(stackingBefore.dialogOnTop).toBe(true);

	// Mail, first visit.
	await page.getByRole("navigation", { name: "Areas" }).getByRole("link", { name: "Mail" }).click();
	await openMail(page);
	expect(await settledSockets(sockets)).toEqual(inMail);
	expect(await documentOverflow(page)).toEqual(overflowBefore);
	// `?` reaches Mail's listener here, so the check outside Mail below means something.
	await page.keyboard.press("?");
	await expect(shortcutsDialog(page)).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(shortcutsDialog(page)).toBeHidden();

	// Back to the Drive area: Mail's socket closes, and nothing Mail set stays behind.
	await page.goBack();
	await openDriveArea(page);
	await expect.poll(sockets, { timeout: 10_000 }).toEqual(afterMail);
	expect(await documentOverflow(page)).toEqual(overflowBefore);
	expect(await shellOverlayStacking(page)).toEqual(stackingBefore);
	await page.keyboard.press("?");
	// No Mail listener may answer: give one a moment to open its dialog.
	await page.waitForTimeout(500);
	await expect(shortcutsDialog(page)).toHaveCount(0);

	// Mail again: one Mail socket, not a second one beside the first.
	await page.goForward();
	await openMail(page);
	expect(await settledSockets(sockets)).toEqual(inMail);
	expect(await documentOverflow(page)).toEqual(overflowBefore);
});
