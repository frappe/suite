import { describe, expect, it, vi } from "vitest";
import { canonicalChallenge, RecorderRendererBridge, type RecorderConfig } from "./rendererBridge";

const challenge = {
	version: 1 as const,
	jti: "jti-vector",
	socket_id: "socket-vector",
	nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	issued_at: 1700000000,
	expires_at: 1700000010,
};

describe("RecorderRendererBridge", () => {
	it("canonicalizes and signs a server-compatible P1363 proof", async () => {
		expect(new TextDecoder().decode(canonicalChallenge(challenge))).toBe(
			"meet-recording-proof-v1\njti-vector\nsocket-vector\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n1700000000\n1700000010",
		);
		const bridge = new RecorderRendererBridge();
		const publicJwk = await bridge.initialize({ postMessage: vi.fn() });
		const signature = await bridge.sign(challenge);
		const bytes = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
		const publicKey = await crypto.subtle.importKey("jwk", publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);

		expect(bytes).toHaveLength(64);
		expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, bytes, canonicalChallenge(challenge))).toBe(true);
	});

	it("accepts internal configuration only once", async () => {
		const listeners: EventListener[] = [];
		const source = {
			addEventListener: vi.fn((_name: string, listener: EventListener) => listeners.push(listener)),
			removeEventListener: vi.fn((_name: string, listener: EventListener) => listeners.splice(listeners.indexOf(listener), 1)),
		};
		const config: RecorderConfig = { job: "job", grant: "grant", meetingId: "room", sfuOrigin: "https://sfu.test", frappeOrigin: "https://frappe.test", socketPath: "/socket.io", startedAt: 1 };
		const bridge = new RecorderRendererBridge();
		const pending = bridge.waitForConfig(source);
		listeners[0](new MessageEvent("message", { data: { type: "suite-recorder:configure", config: { ...config, startedAt: "now" } }, origin: window.location.origin, source: window }));
		expect(source.removeEventListener).not.toHaveBeenCalled();
		listeners[0](new MessageEvent("message", { data: { type: "suite-recorder:configure", config }, origin: window.location.origin, source: window }));

		expect(await pending).toEqual(config);
		expect(source.removeEventListener).toHaveBeenCalledOnce();
		expect(listeners).toHaveLength(0);
	});
});
