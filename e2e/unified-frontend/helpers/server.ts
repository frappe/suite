/** The bench web server itself, not Vite: it renders the boot and runs the redirect table. */
const SERVER = process.env.BENCH_WEB_URL ?? "http://127.0.0.1:8006";
const SITE = process.env.BENCH_SITE ?? "slides.localhost";

/**
 * `path` on the bench web server, as a browser opens it. The Vite dev server
 * serves old page paths as the SPA, so only this origin runs the server's
 * redirect table. An explicit BENCH_WEB_URL owns its hostname; only the default
 * loopback URL needs the site's hostname. Chromium resolves `*.localhost` to loopback.
 */
export function serverURL(path: string): string {
	const url = new URL(path, SERVER);
	if (!process.env.BENCH_WEB_URL) url.hostname = SITE;
	return url.href;
}
