import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { APIRequestContext, Browser, BrowserContext, Locator, Page, Route } from "@playwright/test";
import { createFolder, type DriveNode, openRowMenu, purgeNode, trashNode } from "../drive-backed-apps/helpers/drive";
import { loginViaApi, type Credentials } from "../shared/auth";

export const VIEWPORT = { width: 1440, height: 900 };
/** Enough for frappe-ui transitions and the 180 ms skeleton delay to finish. */
const SETTLE_MS = 450;
export const WORKSPACE_FOLDER = "UI states";

/**
 * A request hold: traffic matching the pattern waits until the hold ends.
 * `abort` fails the held requests and every later match, since the transport
 * retries server errors, until `release` lets traffic through again.
 */
export interface Hold {
	release(): Promise<void>;
	abort(status: number): Promise<void>;
}

export interface People {
	/** Owns the content the flows create. */
	actor: Credentials;
	/** Receives shares; shares things back. */
	peer: Credentials;
	/** Never touched, so My files, Recent and Trash stay empty. */
	fresh: Credentials;
}

/**
 * One browser session in one capture path: signed in as the actor, with a
 * folder of its own under `UI states` in My files, so paths never see each
 * other's rows.
 */
export interface Scene {
	page: Page;
	context: BrowserContext;
	api: APIRequestContext;
	baseURL: string;
	people: People;
	/** The actor's Personal root. */
	root: string;
	/** This path's own folder, purged when the scene closes. Empty until the flow fills it. */
	folder: DriveNode;
	/** A name unique to this path. */
	name(label: string): string;
	goto(path: string): Promise<void>;
	/** Holds requests whose URL matches until released or aborted. */
	hold(url: string | RegExp): Promise<Hold>;
	/** The most recent `hold()` of this scene. Throws when there is none. */
	readonly lastHold: Hold;
	/** Waits for transitions and the skeleton delay. */
	settle(): Promise<void>;
	/** Signs in as another user in a second context, for shares and reactions. */
	as(user: Credentials): Promise<APIRequestContext>;
	/** A page signed in as another user, in a second context closed with the scene. */
	pageAs(user: Credentials): Promise<Page>;
	/** The open dialog with this accessible name. */
	dialog(name: string): Locator;
	/** The first text on the page matching a toast's message. */
	toast(text: string | RegExp): Locator;
	/** Picks `action` from the row menu of the item called `title`. */
	rowAction(title: string, action: string): Promise<void>;
	close(): Promise<void>;
}

/** A value a flow keeps per scene, set in `enter` or a step. `get` throws when it was never set. */
export function perScene<T>(label: string) {
	const values = new WeakMap<Scene, T>();
	return {
		set(scene: Scene, value: T): void {
			values.set(scene, value);
		},
		get(scene: Scene): T {
			const value = values.get(scene);
			if (value === undefined) throw new Error(`${label} was never set on this scene`);
			return value;
		},
	};
}

const statePath = resolve(__dirname, "../drive-backed-apps/.state/run.json");

function people(): People {
	// SAFETY: global setup wrote this file with the users it provisioned.
	const run = JSON.parse(readFileSync(statePath, "utf8")) as { users: Credentials[] };
	const [actor, peer, fresh] = run.users;
	if (!actor || !peer || !fresh) throw new Error("ui-states needs three provisioned users");
	return { actor, peer, fresh };
}

async function childrenOf(api: APIRequestContext, parent: string): Promise<DriveNode[]> {
	const response = await api.get(`/api/suite/drive/nodes/${parent}/children`);
	// SAFETY: the Drive API's children endpoint answers this envelope.
	const { data } = (await response.json()) as { data: { rows: DriveNode[] } };
	return data.rows;
}

/** The `UI states` folder under the actor's root, created by the first path that needs it. */
async function workspaceFolder(api: APIRequestContext, root: string): Promise<string> {
	const existing = (await childrenOf(api, root)).find((row) => row.title === WORKSPACE_FOLDER);
	return existing?.name ?? (await createFolder(api, WORKSPACE_FOLDER, root)).name;
}

async function personalRoot(api: APIRequestContext): Promise<string> {
	const roots = await api.get("/api/suite/drive/roots");
	// SAFETY: the Drive API's roots endpoint answers this envelope for a signed-in user.
	const { data } = (await roots.json()) as { data: { personal: { node: string } } };
	return data.personal.node;
}

/**
 * Creates a folder under `parent`, by default the user's root, after removing
 * any folder of that title. Users are new each run, so one already there is
 * left by an earlier walk of this path that a bench restart cut short.
 */
export async function recreateFolder(api: APIRequestContext, title: string, parent?: string): Promise<DriveNode> {
	const under = parent ?? (await personalRoot(api));
	for (const stale of (await childrenOf(api, under)).filter((row) => row.title === title)) {
		await trashNode(api, stale.name);
		await purgeNode(api, stale.name);
	}
	return createFolder(api, title, under);
}

export async function openScene(
	browser: Browser,
	baseURL: string,
	folderTitle: string,
): Promise<Scene> {
	const who = people();
	const contextOptions = { baseURL, viewport: VIEWPORT, colorScheme: "light" } as const;
	const context = await browser.newContext(contextOptions);
	const api = context.request;
	await loginViaApi(api, who.actor);
	const root = await personalRoot(api);
	const parent = await workspaceFolder(api, root);
	const stamp = Date.now().toString(36);
	const folder = await recreateFolder(api, folderTitle, parent);
	const page = await context.newPage();
	const others: BrowserContext[] = [];
	let latestHold: Hold | null = null;
	const signInElsewhere = async (user: Credentials): Promise<BrowserContext> => {
		const other = await browser.newContext(contextOptions);
		others.push(other);
		await loginViaApi(other.request, user);
		return other;
	};

	return {
		page,
		context,
		api,
		baseURL,
		people: who,
		root,
		folder,
		name: (label) => `${label} ${stamp}`,
		async goto(path) {
			await page.goto(path);
		},
		async hold(url) {
			// The handler stays routed for the scene's life: unrouting lets a held request through.
			const held: Route[] = [];
			let failing: number | null = null;
			let passing = false;
			const fail = (route: Route, status: number) =>
				route.fulfill({
					status,
					contentType: "application/json",
					// A 413 without Drive's own type reads as a proxy's body limit, and the chunk goes again at half the size.
					body: JSON.stringify({ exc_type: status === 413 ? "DriveOverQuota" : "ServerError", message: "Something went wrong" }),
				});
			await page.route(url, async (route) => {
				if (passing) await route.continue();
				else if (failing === null) held.push(route);
				else await fail(route, failing);
			});
			const hold: Hold = {
				async release() {
					passing = true;
					await Promise.all(held.splice(0).map((route) => route.continue().catch(() => undefined)));
				},
				async abort(status) {
					failing = status;
					await Promise.all(held.splice(0).map((route) => fail(route, status).catch(() => undefined)));
				},
			};
			latestHold = hold;
			return hold;
		},
		get lastHold() {
			if (!latestHold) throw new Error("The scene has no held request");
			return latestHold;
		},
		async settle() {
			await page.waitForTimeout(SETTLE_MS);
		},
		async as(user) {
			return (await signInElsewhere(user)).request;
		},
		async pageAs(user) {
			return (await signInElsewhere(user)).newPage();
		},
		dialog: (name) => page.getByRole("dialog", { name }),
		toast: (text) => page.getByText(text).first(),
		async rowAction(title, action) {
			const menu = await openRowMenu(page, title);
			await menu.getByRole("menuitem", { name: action, exact: true }).click();
		},
		async close() {
			try {
				await Promise.all(others.map((other) => other.close()));
				await trashNode(api, folder.name);
				await purgeNode(api, folder.name);
			} finally {
				await context.close();
			}
		},
	};
}
