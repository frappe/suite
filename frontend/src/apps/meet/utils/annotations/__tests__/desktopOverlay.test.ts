import { describe, expect, it } from "vitest";
import {
	buildDesktopOverlayLaunchUrl,
	supportsDesktopAnnotationOverlay,
} from "../desktopOverlay";

describe("desktop annotation overlay", () => {
	it("builds an encoded launch URL with capture metadata", () => {
		const result = new URL(
			buildDesktopOverlayLaunchUrl({
				origin: "https://meet.example.test",
				socketPath: "/sfu/socket.io",
				grant: "short.lived.grant",
				producerId: "producer-1",
				captureWidth: 1920.4,
				captureHeight: 1080,
				displaySurface: "monitor",
			}),
		);

		expect(result.protocol).toBe("frappe-meet-overlay:");
		expect(result.hostname).toBe("start");
		expect(Object.fromEntries(result.searchParams)).toEqual({
			origin: "https://meet.example.test",
			socketPath: "/sfu/socket.io/",
			grant: "short.lived.grant",
			producerId: "producer-1",
			captureWidth: "1920",
			captureHeight: "1080",
			displaySurface: "monitor",
		});
	});

	it("only enables automatic launch on macOS", () => {
		expect(supportsDesktopAnnotationOverlay("MacIntel", "Chrome")).toBe(true);
		expect(supportsDesktopAnnotationOverlay("Linux x86_64", "Chrome")).toBe(
			false,
		);
	});
});
