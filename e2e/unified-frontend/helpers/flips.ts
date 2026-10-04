import { request, test as base, expect } from "@playwright/test";

import { loginViaApi } from "../../shared/auth";

/**
 * The two rollout flips as the SPA boot sends them (`suite/www/suite.py`).
 * The Vite dev server does not render that boot, so a journey sets the values
 * before the app loads, the way the served page does.
 */
export type Flips = { suite_flip_shell: boolean; suite_flip_files: boolean };

/**
 * Journeys run with both flips on by default: the state the areas ship in.
 * A spec that checks another state sets `test.use({ flips })`.
 */
export const test = base.extend<{ flips: Flips }>({
	flips: [{ suite_flip_shell: true, suite_flip_files: true }, { option: true }],
	context: async ({ context, flips }, use) => {
		await context.addInitScript((value) => Object.assign(window, value), flips);
		await use(context);
	},
});

/** The bench web server itself, not Vite: it renders the boot and runs the redirect table. */
const SERVER = process.env.BENCH_WEB_URL ?? "http://127.0.0.1:8006";
const SITE = process.env.BENCH_SITE ?? "slides.localhost";

let siteFlip: Promise<boolean> | undefined;

/**
 * `path` on the bench web server, as a browser opens it. The Vite dev server
 * serves old page paths as the SPA, so only this origin runs the server's
 * redirect table. Chromium resolves every `*.localhost` name to loopback.
 */
export function serverURL(path: string): string {
	const url = new URL(path, SERVER);
	url.hostname = SITE;
	return url.href;
}

/**
 * Whether the site runs with `suite_flip_files` on. The `flips` fixture only
 * sets what the client reads; the server reads the site config. The answer
 * comes from the boot the server renders for a signed-in page, not from the
 * redirects the journeys check, so a broken redirect hook cannot turn the
 * flip-on journeys into skips. The probe signs in with a session of its own.
 */
function siteFilesFlip(): Promise<boolean> {
	siteFlip ??= (async () => {
		const server = await request.newContext({ baseURL: SERVER, extraHTTPHeaders: { Host: SITE } });
		await loginViaApi(server);
		const page = await (await server.get("/home")).text();
		await server.dispose();
		const boot = /window\["suite_flip_files"\] = (true|false);/.exec(page);
		if (!boot) throw new Error("The server's /home boot carries no suite_flip_files flag.");
		return boot[1] === "true";
	})();
	return siteFlip;
}

/**
 * Skips the current test unless the site's real `suite_flip_files` is `on`.
 * A full run covers both states: once with the key at 1, once with it at 0.
 */
export async function requireSiteFilesFlip(on: boolean): Promise<void> {
	const state = (await siteFilesFlip()) ? "on" : "off";
	base.skip(
		(state === "on") !== on,
		`The server answers with the site's suite_flip_files ${state}; this case needs it ${on ? "on" : "off"}.`,
	);
}

export { expect };
