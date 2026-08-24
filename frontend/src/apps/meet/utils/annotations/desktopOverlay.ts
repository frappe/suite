export interface DesktopOverlayLaunchOptions {
	origin: string;
	socketPath: string;
	grant: string;
	producerId: string;
	captureWidth?: number;
	captureHeight?: number;
	displaySurface?: string;
}

const OVERLAY_SCHEME = "frappe-meet-overlay";

export function supportsDesktopAnnotationOverlay(
	platform = navigator.platform,
	userAgent = navigator.userAgent,
): boolean {
	return /Mac/i.test(platform) || /Mac OS X/i.test(userAgent);
}

export function buildDesktopOverlayLaunchUrl(
	options: DesktopOverlayLaunchOptions,
): string {
	const url = new URL(`${OVERLAY_SCHEME}://start`);
	url.searchParams.set("origin", options.origin);
	url.searchParams.set("socketPath", normalizeSocketPath(options.socketPath));
	url.searchParams.set("grant", options.grant);
	url.searchParams.set("producerId", options.producerId);
	if (isPositiveFinite(options.captureWidth)) {
		url.searchParams.set("captureWidth", String(Math.round(options.captureWidth)));
	}
	if (isPositiveFinite(options.captureHeight)) {
		url.searchParams.set(
			"captureHeight",
			String(Math.round(options.captureHeight)),
		);
	}
	if (options.displaySurface) {
		url.searchParams.set("displaySurface", options.displaySurface);
	}
	return url.toString();
}

export function openDesktopOverlay(url: string): void {
	const frame = document.createElement("iframe");
	frame.hidden = true;
	frame.setAttribute("aria-hidden", "true");
	frame.src = url;
	document.body.append(frame);
	window.setTimeout(() => frame.remove(), 2_000);
}

function normalizeSocketPath(value: string): string {
	const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
	return withLeadingSlash.endsWith("/")
		? withLeadingSlash
		: `${withLeadingSlash}/`;
}

function isPositiveFinite(value: number | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}
