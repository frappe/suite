import type { APIRequestContext, Browser, BrowserContext, Locator, Page, Route } from "@playwright/test";
import { readRun } from "../drive-backed-apps/global-setup";
import { createFolder, discardNode, type DriveNode, openRowMenu, purgeNode, trashNode } from "../drive-backed-apps/helpers/drive";
import { loginViaApi, type Credentials } from "../shared/auth";
import { acrossRestarts } from "./bench";
import { STATE_DIR } from "./global-setup";

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

/** One signed-in browser session in one capture path, on any Suite site. */
export interface BaseScene {
	page: Page;
	context: BrowserContext;
	/** The signed-in user's requests, sharing the page's cookies. */
	api: APIRequestContext;
	baseURL: string;
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
	/** Runs `cleanup` when the scene closes, last registered first. Use it to remove what a path created. */
	defer(cleanup: () => Promise<unknown>): void;
	/**
	 * Runs every deferred cleanup, each again after a bench restart, then
	 * closes every context. Throws the cleanups' failures once all have run.
	 */
	close(): Promise<void>;
}

/**
 * A Drive capture path: signed in as the provisioned actor, with a folder of
 * its own under `UI states` in My files, so paths never see each other's rows.
 */
export interface Scene extends BaseScene {
	people: People;
	/** The actor's Personal root. */
	root: string;
	/** This path's own folder, purged when the scene closes. Empty until the flow fills it. */
	folder: DriveNode;
	/** Picks `action` from the row menu of the item called `title`. */
	rowAction(title: string, action: string): Promise<void>;
}

/** A value a flow keeps per scene, set in `enter` or a step. `get` throws when it was never set. */
export function perScene<T>(label: string) {
	const values = new WeakMap<BaseScene, T>();
	return {
		set(scene: BaseScene, value: T): void {
			values.set(scene, value);
		},
		get(scene: BaseScene): T {
			const value = values.get(scene);
			if (value === undefined) throw new Error(`${label} was never set on this scene`);
			return value;
		},
	};
}

function people(): People {
	const [actor, peer, fresh] = readRun(STATE_DIR).users;
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

/** A page signed in as `user` on `baseURL`, with nothing created for it. */
export async function openBrowserScene(browser: Browser, baseURL: string, user?: Credentials): Promise<BaseScene> {
	const contextOptions = { baseURL, viewport: VIEWPORT, colorScheme: "light" } as const;
	const context = await browser.newContext(contextOptions);
	const api = context.request;
	await loginViaApi(api, user);
	const page = await context.newPage();
	const stamp = Date.now().toString(36);
	const others: BrowserContext[] = [];
	const cleanups: (() => Promise<unknown>)[] = [];
	let latestHold: Hold | null = null;
	const signInElsewhere = async (other: Credentials): Promise<BrowserContext> => {
		const second = await browser.newContext(contextOptions);
		others.push(second);
		await loginViaApi(second.request, other);
		return second;
	};

	return {
		page,
		context,
		api,
		baseURL,
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
		async as(other) {
			return (await signInElsewhere(other)).request;
		},
		async pageAs(other) {
			return (await signInElsewhere(other)).newPage();
		},
		dialog: (name) => page.getByRole("dialog", { name }),
		toast: (text) => page.getByText(text).first(),
		defer(cleanup) {
			cleanups.push(cleanup);
		},
		async close() {
			const failures: unknown[] = [];
			for (const cleanup of cleanups.reverse()) {
				await acrossRestarts(baseURL, cleanup).catch((error: unknown) => failures.push(error));
			}
			await Promise.allSettled([...others, context].map((open) => open.close()));
			if (failures.length) throw new AggregateError(failures, `Cleanup failed: ${failures.map(String).join("; ")}`);
		},
	};
}

/** The Drive scene: the provisioned actor, with this path's own folder under `UI states`. */
export async function openScene(browser: Browser, baseURL: string, folderTitle: string): Promise<Scene> {
	const who = people();
	const base = await openBrowserScene(browser, baseURL, who.actor);
	const root = await personalRoot(base.api);
	const parent = await workspaceFolder(base.api, root);
	const folder = await recreateFolder(base.api, folderTitle, parent);
	// Idempotent, so a cleanup a bench restart cut short between trash and purge can run again.
	base.defer(() => discardNode(base.api, folder.name));
	return Object.assign(base, {
		people: who,
		root,
		folder,
		async rowAction(title: string, action: string) {
			const menu = await openRowMenu(base.page, title);
			await menu.getByRole("menuitem", { name: action, exact: true }).click();
		},
	});
}
