import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { setup } from "xstate";
import { fillFolder, folderPath } from "../content";
import { defineFlow } from "../flow";
import { DRIVE, grantAccess, ROLE } from "../../drive-backed-apps/helpers/drive";
import { loginViaApi } from "../../shared/auth";
import type { Scene } from "../scene";

type Event =
	| { type: "OPEN_FILE_LINK" }
	| { type: "OPEN_DOCUMENT_LINK" }
	| { type: "OPEN_COMMENTS" }
	| { type: "OPEN_UPLOAD_LINK" }
	| { type: "OPEN_NEW" }
	| { type: "OPEN_LOCKED_LINK" }
	| { type: "WRONG_PASSWORD" }
	| { type: "KEEP_GUESSING" }
	| { type: "RIGHT_PASSWORD" }
	| { type: "OPEN_EXPIRED_LINK" }
	| { type: "OPEN_UNKNOWN_LINK" }
	| { type: "OPEN_WITHOUT_LINK" }
	| { type: "LINK_REMOVED" }
	| { type: "OPEN_AS_MEMBER" }
	| { type: "OPEN_ROW_MENU" };

/**
 * What a visitor sees through a share link. In the code this is the guest
 * frame (`shell/GuestSurface.vue`: `refused`, `showSignIn`), `FilesPage.vue`'s
 * `locked` and refused watcher, `UnlockScreen.vue` over `unlockForm.ts`
 * (`pending`, `error`, `lockedUntil`), `linkAccess.ts` for what a link-only
 * caller may do, and the server's dead-link page for `/l/<token>`.
 */
const machine = setup({ types: { events: {} as Event } }).createMachine({
	id: "guest",
	initial: "folderAsGuest",
	states: {
		folderAsGuest: {
			meta: { description: "A View link on a folder, signed out: the guest frame with one slim header and Sign in, no sidebar, no search." },
			on: {
				OPEN_FILE_LINK: "fileAsGuest",
				OPEN_DOCUMENT_LINK: "documentAsGuest",
				OPEN_UPLOAD_LINK: "uploadLinkAsGuest",
				OPEN_LOCKED_LINK: "locked",
				OPEN_EXPIRED_LINK: "expiredLink",
				OPEN_UNKNOWN_LINK: "notFound",
				OPEN_WITHOUT_LINK: "signInRequired",
				LINK_REMOVED: "linkRemoved",
				OPEN_AS_MEMBER: "linkOnlyMember",
			},
		},
		fileAsGuest: {
			meta: { description: "A View link on a PDF: the file's page in the guest frame, but the preview shows the server's 404, since the frame's plain URL carries no link code." },
		},
		documentAsGuest: {
			meta: { description: "A Comment link on an empty Writer document, signed out: the guest header over the document bar, which says View only although the link allows comments." },
			on: { OPEN_COMMENTS: "guestNamePrompt" },
		},
		guestNamePrompt: {
			meta: { description: "Comments opened as a guest: an optional Your name field (placeholder Guest) above the composer; a returning browser would see its last name here." },
		},
		uploadLinkAsGuest: {
			meta: { description: "An Upload link on a folder: the listing with New in the header." },
			on: { OPEN_NEW: "uploadNewMenu" },
		},
		uploadNewMenu: {
			meta: { description: "New through an Upload link: Folder, Link, Upload files and Upload folder, no document kinds, since the guest could not edit what they made." },
		},
		locked: {
			meta: { description: "A password link: Password required, with no title, owner or kind of the item." },
			on: { WRONG_PASSWORD: "wrongPassword", RIGHT_PASSWORD: "unlocked" },
		},
		wrongPassword: {
			meta: { description: "A wrong password: Wrong password on the reserved line, the field cleared." },
			on: { KEEP_GUESSING: "lockedOut", RIGHT_PASSWORD: "unlocked" },
		},
		lockedOut: {
			meta: { description: "The fifth wrong password: the form is disabled and counts down from the server's Retry-After." },
		},
		unlocked: {
			meta: { description: "The right password: the folder opens in place, at the same URL." },
		},
		expiredLink: {
			meta: { description: "A link past its expiry: the server's Link unavailable page, with no way in and nothing about the item." },
		},
		notFound: {
			meta: { description: "A token nobody issued: the same page with the mistyped-or-turned-off copy." },
		},
		signInRequired: {
			meta: { description: "The folder's URL without its link: Sign in to open this, never saying whether the item exists." },
		},
		linkRemoved: {
			meta: { description: "The owner removes the link while the guest has the folder open; the next load shows the same Sign-in screen." },
		},
		linkOnlyMember: {
			meta: { description: "A signed-in member with no grant of their own opens the link: the full shell, the folder reached only through the link." },
			on: { OPEN_ROW_MENU: "memberRowMenu" },
		},
		memberRowMenu: {
			meta: { description: "A row menu through the link: no Star, since a link-only item cannot sit in Starred." },
		},
	},
});

interface Links {
	folder: string;
	file: string;
	document: string;
	upload: string;
	locked: string;
	expired: string;
	/** The read link's grant id, to remove it. */
	folderGrant: string;
	/** When the expired link stops working, in epoch ms. */
	expiresAt: number;
}

/**
 * The visitor's contexts, kept for the run so their HTTP cache spares the server
 * a full asset load per visit. A response landing after `clearCookies` puts a
 * session back, so only a context that never signs in is surely signed out.
 */
interface VisitorContexts {
	browser: Browser;
	signedOut: BrowserContext;
	signedIn: BrowserContext;
}

const PASSWORD = "relaunch-2026";
const UNKNOWN = `/l/${"A".repeat(22)}`;
const EXPIRES_IN_MS = 4_000;

const seeded = new WeakMap<Scene, Links>();
let visitorContexts: VisitorContexts | null = null;
let openVisitorPage: Page | null = null;

function links(scene: Scene): Links {
	const found = seeded.get(scene);
	if (!found) throw new Error("guest: the scene has no links");
	return found;
}

function visitorPage(): Page {
	if (!openVisitorPage) throw new Error("guest: no visitor page");
	return openVisitorPage;
}

/** Makes a share link on `node` and answers its `/l/<token>` path and grant id. */
async function shareLink(
	scene: Scene,
	node: string,
	role: number,
	options: { password?: string; expires_on?: string } = {},
): Promise<{ url: string; grant: string }> {
	const written = await grantAccess(scene.api, node, "$LINK", role, options);
	if (!written.url || !written.name) throw new Error("guest: the link has no URL");
	return { url: new URL(written.url, scene.baseURL).pathname, grant: written.name };
}

/** A fresh page for the visitor, signed out or as the peer, with no cookies or stored links from the last visit. */
async function visit(scene: Scene, path: string, signedIn = false): Promise<Page> {
	const browser = scene.context.browser();
	if (!browser) throw new Error("guest: the scene has no browser");
	if (visitorContexts?.browser !== browser) {
		const options = { baseURL: scene.baseURL, viewport: { width: 1440, height: 900 }, colorScheme: "light" } as const;
		visitorContexts = {
			browser,
			signedOut: await browser.newContext(options),
			signedIn: await browser.newContext(options),
		};
	}
	const context = signedIn ? visitorContexts.signedIn : visitorContexts.signedOut;
	const previous = openVisitorPage;
	if (previous?.url().startsWith(scene.baseURL)) {
		await previous.evaluate(() => {
			localStorage.clear();
			sessionStorage.clear();
		});
	}
	await previous?.close();
	await context.clearCookies();
	if (signedIn) await loginViaApi(context.request, scene.people.peer);
	const page = await context.newPage();
	openVisitorPage = page;
	await page.goto(path);
	return page;
}

/** Submits one password. A wrong one leaves the form, which clears the field once it has the answer. */
async function submitPassword(page: Page, password: string, wrong = true): Promise<void> {
	await page.getByPlaceholder("Password").fill(password);
	await Promise.all([
		page.waitForResponse((response) => response.url().includes(`${DRIVE}/links/unlock`)),
		page.getByRole("button", { name: "Open" }).click(),
	]);
	if (wrong) await expect(page.getByPlaceholder("Password")).toHaveValue("");
}

export const guest = defineFlow<Event>({
	id: "guest",
	title: "Guest access",
	folderTitle: "Press kit",
	source: "frontend/src/apps/drive/files/features/linkAccess.ts",
	machine,
	async enter(scene) {
		const content = await fillFolder(scene.api, scene.folder.name);
		const node = scene.folder.name;
		// First, so no other write can use up its few seconds before the server checks them.
		const expiresAt = Date.now() + EXPIRES_IN_MS;
		const expires_on = new Date(expiresAt).toISOString().replace(/\.\d+Z$/, "Z");
		const expired = (await shareLink(scene, node, ROLE.READ, { expires_on })).url;
		const folder = await shareLink(scene, node, ROLE.READ);
		seeded.set(scene, {
			folder: folder.url,
			folderGrant: folder.grant,
			file: (await shareLink(scene, content.brief.name, ROLE.READ)).url,
			document: (await shareLink(scene, content.document.name, ROLE.COMMENT)).url,
			upload: (await shareLink(scene, node, ROLE.UPLOAD)).url,
			locked: (await shareLink(scene, node, ROLE.READ, { password: PASSWORD })).url,
			expired,
			expiresAt,
		});
		const page = await visit(scene, folder.url);
		await expect(page.getByTestId("guest-frame")).toBeVisible();
		await expect(page.getByRole("button", { name: "Actions for Launch brief" })).toBeVisible();
	},
	frame() {
		return openVisitorPage?.locator("body") ?? null;
	},
	events: {
		async OPEN_FILE_LINK(scene) {
			const page = await visit(scene, links(scene).file);
			await expect(page).toHaveURL(/\/d\//);
			await expect(page.getByRole("button", { name: "Sign in" }).first()).toBeVisible();
			// The preview frame loads the file by its plain URL; give its answer time to paint.
			await expect(page.locator("iframe").first()).toBeAttached();
			await page.waitForTimeout(1_500);
		},
		async OPEN_DOCUMENT_LINK(scene) {
			const page = await visit(scene, links(scene).document);
			await expect(page.getByTestId("guest-frame")).toBeVisible();
			await expect(page.getByRole("button", { name: "More document actions" })).toBeVisible();
		},
		async OPEN_COMMENTS(scene) {
			const page = visitorPage();
			await page.getByRole("button", { name: "More document actions" }).click();
			await page.getByRole("menuitem", { name: "Comments" }).click();
			await expect(page.getByLabel("Your name")).toBeVisible();
			// The closed menu hands focus back to its trigger, whose tooltip would cover the header.
			await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
			await page.mouse.move(560, 480);
			await expect(page.getByRole("tooltip")).toHaveCount(0);
		},
		async OPEN_UPLOAD_LINK(scene) {
			const page = await visit(scene, links(scene).upload);
			await expect(page.getByRole("button", { name: "Actions for Launch brief" })).toBeVisible();
			await expect(page.getByRole("button", { name: "New" }).first()).toBeVisible();
		},
		async OPEN_NEW(scene) {
			const page = visitorPage();
			await page.getByRole("button", { name: "New" }).first().click();
			await expect(page.getByRole("menuitem", { name: "Upload files" })).toBeVisible();
		},
		async OPEN_LOCKED_LINK(scene) {
			const page = await visit(scene, links(scene).locked);
			await expect(page.getByRole("heading", { name: "Password required" })).toBeVisible();
			await expect(page.getByText("Launch brief")).toHaveCount(0);
		},
		async WRONG_PASSWORD(scene) {
			const page = visitorPage();
			await submitPassword(page, "launch-2025");
			await expect(page.getByTestId("drive-unlock-message")).toHaveText("Wrong password");
		},
		async KEEP_GUESSING(scene) {
			const page = visitorPage();
			for (const guess of ["relaunch2026", "Relaunch-2026", "website-2026", "relaunch-26"]) {
				if (await page.getByPlaceholder("Password").isDisabled()) break;
				await submitPassword(page, guess);
			}
			await expect(page.getByTestId("drive-unlock-message")).toHaveText(/^Too many attempts\. Try again in \d+ (minute|second)s?\.$/);
			await expect(page.getByPlaceholder("Password")).toBeDisabled();
		},
		async RIGHT_PASSWORD(scene) {
			const page = visitorPage();
			await submitPassword(page, PASSWORD, false);
			await expect(page.getByRole("button", { name: "Actions for Launch brief" })).toBeVisible();
		},
		async OPEN_EXPIRED_LINK(scene) {
			const { expired, expiresAt } = links(scene);
			const left = expiresAt + 1_000 - Date.now();
			if (left > 0) await scene.page.waitForTimeout(left);
			const page = await visit(scene, expired);
			await expect(page.getByText("This link has expired.", { exact: false })).toBeVisible();
		},
		async OPEN_UNKNOWN_LINK(scene) {
			const page = await visit(scene, UNKNOWN);
			await expect(page.getByText("This link doesn't work.", { exact: false })).toBeVisible();
		},
		async OPEN_WITHOUT_LINK(scene) {
			const page = await visit(scene, folderPath(scene.folder));
			await expect(page.getByRole("heading", { name: "Sign in to open this" })).toBeVisible();
		},
		async LINK_REMOVED(scene) {
			const response = await scene.api.delete(`${DRIVE}/grants/${links(scene).folderGrant}`);
			expect(response.ok(), await response.text()).toBe(true);
			const page = visitorPage();
			await page.reload();
			await expect(page.getByRole("heading", { name: "Sign in to open this" })).toBeVisible();
		},
		async OPEN_AS_MEMBER(scene) {
			const page = await visit(scene, links(scene).folder, true);
			await expect(page.getByTestId("guest-frame")).toHaveCount(0);
			await expect(page.getByRole("button", { name: "Actions for Launch brief" })).toBeVisible();
		},
		async OPEN_ROW_MENU(scene) {
			const page = visitorPage();
			await page.getByRole("button", { name: "Actions for Launch brief" }).click();
			await expect(page.getByRole("menu")).toBeVisible();
			await expect(page.getByRole("menuitem", { name: "Star" })).toHaveCount(0);
		},
	},
});
