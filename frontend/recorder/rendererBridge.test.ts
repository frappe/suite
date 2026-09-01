import { describe, expect, it, vi } from "vitest";
import {
	CaptureCommandSupersededError,
	canonicalChallenge,
	parseCaptureStartedMessage,
	parsePrepareCaptureMessage,
	type RecorderConfig,
	RecorderRendererBridge,
} from "./rendererBridge";

const challenge = {
	protocol_version: 1 as const,
	jti: "jti-vector",
	socket_id: "socket-vector",
	nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	issued_at: 1700000000,
	expires_at: 1700000010,
};

describe("RecorderRendererBridge", () => {
	it("strictly parses capture commands", () => {
		 expect(
			parsePrepareCaptureMessage({
				type: "suite-recorder:prepare-capture",
				protocol_version: 1,
				job: "job",
				epoch: 0,
			}),
		).toEqual({
			type: "suite-recorder:prepare-capture",
			protocol_version: 1,
			job: "job",
			epoch: 0,
		});
		expect(
			parseCaptureStartedMessage({
				type: "suite-recorder:capture-started",
				protocol_version: 1,
				job: "job",
				epoch: 0,
				capture_started_at: "2026-08-30T12:00:00.000Z",
			}),
		).toEqual({
			type: "suite-recorder:capture-started",
			protocol_version: 1,
			job: "job",
			epoch: 0,
			capture_started_at: "2026-08-30T12:00:00.000Z",
		});
		for (const invalid of [
			{ epoch: -1 },
			{ epoch: Number.MAX_SAFE_INTEGER + 1 },
			{ epoch: 0, extra: true },
		])
			expect(
				parsePrepareCaptureMessage({
					type: "suite-recorder:prepare-capture",
					protocol_version: 1,
					job: "job",
					...invalid,
				}),
			).toBeNull();
		expect(
			parseCaptureStartedMessage({
				type: "suite-recorder:capture-started",
				protocol_version: 1,
				job: "job",
				epoch: 0,
				capture_started_at: "2026-08-30T12:00:00Z",
			}),
		).toBeNull();
		expect(
			parseCaptureStartedMessage({
				type: "suite-recorder:capture-started",
				protocol_version: 1,
				job: "job",
				epoch: 0,
				capture_started_at: "9999-99-99T99:99:99.999Z",
			}),
		).toBeNull();
	});

	it("canonicalizes and signs a server-compatible P1363 proof", async () => {
		expect(new TextDecoder().decode(canonicalChallenge(challenge))).toBe(
			"meet-recording-proof-v1\njti-vector\nsocket-vector\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n1700000000\n1700000010",
		);
		const postMessage = vi.fn();
		const bridge = new RecorderRendererBridge();
		const publicJwk = await bridge.initialize({ postMessage });
		expect(postMessage).toHaveBeenCalledWith(
			{
				type: "suite-recorder:public-key-ready",
				protocol_version: 1,
				occurred_at: expect.stringMatching(
					/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
				),
				publicKey: publicJwk,
			},
			window.location.origin,
		);
		expect(Object.keys(publicJwk).sort()).toEqual(["crv", "kty", "x", "y"]);
		const signature = await bridge.sign(challenge);
		const bytes = Uint8Array.from(
			atob(signature.replace(/-/g, "+").replace(/_/g, "/")),
			(char) => char.charCodeAt(0),
		);
		const publicKey = await crypto.subtle.importKey(
			"jwk",
			publicJwk,
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["verify"],
		);

		expect(bytes).toHaveLength(64);
		expect(
			await crypto.subtle.verify(
				{ name: "ECDSA", hash: "SHA-256" },
				publicKey,
				bytes,
				canonicalChallenge(challenge),
			),
		).toBe(true);
	});

	it("accepts internal configuration only once", async () => {
		const listeners: EventListener[] = [];
		const source = {
			addEventListener: vi.fn((_name: string, listener: EventListener) =>
				listeners.push(listener),
			),
			removeEventListener: vi.fn((_name: string, listener: EventListener) =>
				listeners.splice(listeners.indexOf(listener), 1),
			),
		};
		const config: RecorderConfig = {
			job: "job",
			grant: "grant",
			meetingId: "room",
			sfuOrigin: "https://sfu.test",
			frappeOrigin: "https://frappe.test",
			socketPath: "/socket.io",
			acceptedAt: "2026-08-30T12:00:00.000Z",
		};
		const bridge = new RecorderRendererBridge();
		const pending = bridge.waitForConfig(source);
		listeners[0](
			new MessageEvent("message", {
				data: {
					type: "suite-recorder:configure",
					protocol_version: 1,
					config: { ...config, acceptedAt: "now" },
				},
				origin: window.location.origin,
				source: window,
			}),
		);
		expect(source.removeEventListener).not.toHaveBeenCalled();
		for (const data of [
			{ type: "suite-recorder:configure", config },
			{ type: "suite-recorder:configure", protocol_version: 2, config },
			{
				type: "suite-recorder:configure",
				protocol_version: 1,
				config,
				extra: true,
			},
			{
				type: "suite-recorder:configure",
				protocol_version: 1,
				config: { ...config, extra: true },
			},
		])
			listeners[0](
				new MessageEvent("message", {
					data,
					origin: window.location.origin,
					source: window,
				}),
			);
		expect(source.removeEventListener).not.toHaveBeenCalled();
		listeners[0](
			new MessageEvent("message", {
				data: { type: "suite-recorder:configure", protocol_version: 1, config },
				origin: window.location.origin,
				source: window,
			}),
		);

		expect(await pending).toEqual(config);
		expect(source.removeEventListener).toHaveBeenCalledOnce();
		expect(listeners).toHaveLength(0);
	});

	it("emits exact versioned lifecycle messages with finite bounded reasons", async () => {
		const postMessage = vi
			.spyOn(window, "postMessage")
			.mockImplementation(() => undefined);
		const listeners: EventListener[] = [];
		const source = {
			addEventListener: (_name: string, listener: EventListener) =>
				listeners.push(listener),
			removeEventListener: () => undefined,
		};
		const config: RecorderConfig = {
			job: "job",
			grant: "grant",
			meetingId: "room",
			sfuOrigin: "https://sfu.test",
			frappeOrigin: "https://frappe.test",
			socketPath: "/socket.io",
			acceptedAt: "2026-08-30T12:00:00.000Z",
		};
		const bridge = new RecorderRendererBridge();
		const pending = bridge.waitForConfig(source);
		listeners[0](
			new MessageEvent("message", {
				data: { type: "suite-recorder:configure", protocol_version: 1, config },
				origin: window.location.origin,
				source: window,
			}),
		);
		await pending;
		postMessage.mockClear();

		bridge.reportCaptureReady();
		bridge.reportInterruption("media_attachment_failed", "x".repeat(300));

		expect(postMessage.mock.calls.map(([message]) => message)).toEqual([
			{
				type: "suite-recorder:capture-ready",
				protocol_version: 1,
				occurred_at: expect.any(String),
				job: "job",
			},
			{
				type: "suite-recorder:interruption",
				protocol_version: 1,
				occurred_at: expect.any(String),
				job: "job",
				reason_code: "media_attachment_failed",
				diagnostic: "x".repeat(256),
			},
		]);
		postMessage.mockRestore();
	});

	it("acknowledges capture commands only after controller acceptance", async () => {
		const postMessage = vi
			.spyOn(window, "postMessage")
			.mockImplementation(() => undefined);
		const listeners: EventListener[] = [];
		const source = {
			addEventListener: (_name: string, listener: EventListener) =>
				listeners.push(listener),
			removeEventListener: (_name: string, listener: EventListener) =>
				listeners.splice(listeners.indexOf(listener), 1),
		};
		const bridge = new RecorderRendererBridge();
		const configured = bridge.waitForConfig(source);
		listeners[0](
			new MessageEvent("message", {
				data: {
					type: "suite-recorder:configure",
					protocol_version: 1,
					config: {
						job: "job",
						grant: "grant",
						meetingId: "room",
						sfuOrigin: "https://sfu.test",
						frappeOrigin: "https://frappe.test",
						socketPath: "/socket.io",
						acceptedAt: "2026-08-30T12:00:00.000Z",
					},
				},
				origin: window.location.origin,
				source: window,
			}),
		);
		await configured;
		let release!: () => void;
		const prepareCapture = vi.fn(
			() => new Promise<void>((resolve) => (release = resolve)),
		);
		const captureStarted = vi.fn(async () => undefined);
		const failCaptureCommand = vi.fn();
		const unbind = bridge.bindCaptureCommands(
			{ prepareCapture, captureStarted, failCaptureCommand },
			source,
		);
		postMessage.mockClear();
		listeners[0](
			new MessageEvent("message", {
				data: {
					type: "suite-recorder:prepare-capture",
					protocol_version: 1,
					job: "job",
					epoch: 2,
				},
				origin: window.location.origin,
				source: window,
			}),
		);
		expect(postMessage).not.toHaveBeenCalled();
		release();
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
		expect(postMessage.mock.calls[0]?.[0]).toEqual({
			type: "suite-recorder:capture-prepared",
			protocol_version: 1,
			occurred_at: expect.any(String),
			job: "job",
			epoch: 2,
		});

		listeners[0](
			new MessageEvent("message", {
				data: {
					type: "suite-recorder:capture-started",
					protocol_version: 1,
					job: "job",
					epoch: 2,
					capture_started_at: "2026-08-30T12:00:02.000Z",
				},
				origin: window.location.origin,
				source: window,
			}),
		);
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
		expect(postMessage.mock.calls[1]?.[0]).toEqual({
			type: "suite-recorder:capture-started-accepted",
			protocol_version: 1,
			occurred_at: expect.any(String),
			job: "job",
			epoch: 2,
			capture_started_at: "2026-08-30T12:00:02.000Z",
		});
		unbind();
		expect(listeners).toHaveLength(0);
		postMessage.mockRestore();
	});

	it.each([
		{
			type: "suite-recorder:prepare-capture",
			protocol_version: 1,
			job: "other-job",
			epoch: 0,
		},
		{
			type: "suite-recorder:prepare-capture",
			protocol_version: 1,
			job: "job",
			epoch: -1,
		},
	])("fails closed locally and unbinds invalid commands", async (command) => {
		const listeners: EventListener[] = [];
		const source = {
			addEventListener: (_name: string, listener: EventListener) =>
				listeners.push(listener),
			removeEventListener: (_name: string, listener: EventListener) =>
				listeners.splice(listeners.indexOf(listener), 1),
		};
		const bridge = new RecorderRendererBridge();
		const configured = bridge.waitForConfig(source);
		listeners[0](
			new MessageEvent("message", {
				data: {
					type: "suite-recorder:configure",
					protocol_version: 1,
					config: {
						job: "job",
						grant: "grant",
						meetingId: "room",
						sfuOrigin: "https://sfu.test",
						frappeOrigin: "https://frappe.test",
						socketPath: "/socket.io",
						acceptedAt: "2026-08-30T12:00:00.000Z",
					},
				},
				origin: window.location.origin,
				source: window,
			}),
		);
		await configured;
		const failCaptureCommand = vi.fn();
		bridge.bindCaptureCommands(
			{
				prepareCapture: vi.fn(async () => undefined),
				captureStarted: vi.fn(async () => undefined),
				failCaptureCommand,
			},
			source,
		);
		listeners[0](
			new MessageEvent("message", {
				data: command,
				origin: window.location.origin,
				source: window,
			}),
		);
		expect(failCaptureCommand).toHaveBeenCalledWith(
			"Invalid recorder capture command",
		);
		expect(listeners).toHaveLength(0);
	});

	it.each([
		["fails closed", new Error("rejected"), true],
		["ignores superseded", new CaptureCommandSupersededError(), false],
	] as const)("%s when the controller rejects a command", async (_label, rejection, failsClosed) => {
		const listeners: EventListener[] = [];
		const source = {
			addEventListener: (_name: string, listener: EventListener) =>
				listeners.push(listener),
			removeEventListener: (_name: string, listener: EventListener) =>
				listeners.splice(listeners.indexOf(listener), 1),
		};
		const bridge = new RecorderRendererBridge();
		const configured = bridge.waitForConfig(source);
		listeners[0](
			new MessageEvent("message", {
				data: {
					type: "suite-recorder:configure",
					protocol_version: 1,
					config: {
						job: "job",
						grant: "grant",
						meetingId: "room",
						sfuOrigin: "https://sfu.test",
						frappeOrigin: "https://frappe.test",
						socketPath: "/socket.io",
						acceptedAt: "2026-08-30T12:00:00.000Z",
					},
				},
				origin: window.location.origin,
				source: window,
			}),
		);
		await configured;
		const failCaptureCommand = vi.fn();
		bridge.bindCaptureCommands(
			{
				prepareCapture: vi.fn(async () => {
					throw rejection;
				}),
				captureStarted: vi.fn(async () => undefined),
				failCaptureCommand,
			},
			source,
		);
		listeners[0](
			new MessageEvent("message", {
				data: {
					type: "suite-recorder:prepare-capture",
					protocol_version: 1,
					job: "job",
					epoch: 0,
				},
				origin: window.location.origin,
				source: window,
			}),
		);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		if (failsClosed)
			expect(failCaptureCommand).toHaveBeenCalledWith("rejected");
		else expect(failCaptureCommand).not.toHaveBeenCalled();
		expect(listeners).toHaveLength(failsClosed ? 0 : 1);
	});
});
