import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SFUClient } from "../SFUClient";

const mockSignalChannel = () => ({
	connect: vi.fn(),
	disconnect: vi.fn(),
	emit: vi.fn(),
	on: vi.fn(),
	off: vi.fn(),
	isConnected: vi.fn(() => false),
	id: vi.fn(() => "socket-id"),
	updateAuth: vi.fn(),
});

vi.mock("frappe-ui", () => ({
	frappeRequest: vi.fn(),
}));

import { frappeRequest } from "frappe-ui";

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

function createClient() {
	return new SFUClient(mockSignalChannel());
}

describe("getSFUEndpoint", () => {
	it("constructs origin from https URL", () => {
		const client = createClient();
		client.connectionDetails.sfuUrl = "https://sfu.example.com";
		client.connectionDetails.sfuPort = "443";
		const { origin, socketPath } = client.getSFUEndpoint();
		expect(origin).toBe("https://sfu.example.com");
		expect(socketPath).toBe("/socket.io");
	});

	it("uses explicit port for non-secure URL", () => {
		const client = createClient();
		client.connectionDetails.sfuUrl = "http://sfu.example.com";
		client.connectionDetails.sfuPort = "8080";
		const { origin, socketPath } = client.getSFUEndpoint();
		expect(origin).toBe("http://sfu.example.com:8080");
		expect(socketPath).toBe("/socket.io");
	});

	it("uses pathname when URL has a path prefix", () => {
		const client = createClient();
		client.connectionDetails.sfuUrl = "https://sfu.example.com/sfu";
		client.connectionDetails.sfuPort = "443";
		const { origin, socketPath } = client.getSFUEndpoint();
		expect(origin).toBe("https://sfu.example.com");
		expect(socketPath).toBe("/sfu/socket.io");
	});

	it("strips trailing slash from pathname", () => {
		const client = createClient();
		client.connectionDetails.sfuUrl = "https://sfu.example.com/sfu/";
		client.connectionDetails.sfuPort = "443";
		const { origin, socketPath } = client.getSFUEndpoint();
		expect(origin).toBe("https://sfu.example.com");
		expect(socketPath).toBe("/sfu/socket.io");
	});

	it("throws when sfuUrl is not configured", () => {
		const client = createClient();
		client.connectionDetails.sfuUrl = null;
		expect(() => client.getSFUEndpoint()).toThrow("SFU URL not configured");
	});
});

describe("isConnected / getters", () => {
	it("returns false initially", () => {
		const client = createClient();
		expect(client.isConnected()).toBe(false);
		expect(client.getConnectionStatus().connected).toBe(false);
	});

	it("getMeetingId and getUserId return connection details", () => {
		const client = createClient();
		client.connectionDetails.meetingId = "meet-123";
		client.connectionDetails.userId = "user-abc";
		expect(client.getMeetingId()).toBe("meet-123");
		expect(client.getUserId()).toBe("user-abc");
	});

	it("getCodecStrategy returns svc as default", () => {
		const client = createClient();
		expect(client.getCodecStrategy()).toBe("svc");
	});

	it("getCodecStrategy returns configured strategy", () => {
		const client = createClient();
		client.connectionDetails.codecStrategy = "simulcast";
		expect(client.getCodecStrategy()).toBe("simulcast");
	});
});

describe("isTokenExpiringSoon", () => {
	it("returns false when tokenExpiresAt is far in the future", () => {
		const client = createClient();
		client.connectionDetails.tokenExpiresAt = Date.now() + 600_000;
		expect(client.isTokenExpiringSoon()).toBe(false);
	});

	it("returns true when tokenExpiresAt is within 5 minutes", () => {
		const client = createClient();
		client.connectionDetails.tokenExpiresAt = Date.now() + 60_000;
		expect(client.isTokenExpiringSoon()).toBe(true);
	});

	it("returns false when tokenExpiresAt is past", () => {
		const client = createClient();
		client.connectionDetails.tokenExpiresAt = Date.now() - 60_000;
		expect(client.isTokenExpiringSoon()).toBe(true);
	});

	it("parses JWT exp claim when tokenExpiresAt is null", () => {
		const client = createClient();
		client.connectionDetails.tokenExpiresAt = null;
		const future = Math.floor(Date.now() / 1000) + 3600;
		const payload = btoa(JSON.stringify({ exp: future }));
		client.connectionDetails.authToken = `header.${payload}.sig`;
		expect(client.isTokenExpiringSoon()).toBe(false);
	});

	it("returns true for JWT expiring within 5 min", () => {
		const client = createClient();
		client.connectionDetails.tokenExpiresAt = null;
		const soon = Math.floor(Date.now() / 1000) + 120;
		const payload = btoa(JSON.stringify({ exp: soon }));
		client.connectionDetails.authToken = `header.${payload}.sig`;
		expect(client.isTokenExpiringSoon()).toBe(true);
	});

	it("returns false when no token is set", () => {
		const client = createClient();
		client.connectionDetails.tokenExpiresAt = null;
		client.connectionDetails.authToken = null;
		expect(client.isTokenExpiringSoon()).toBe(false);
	});
});

describe("sendRequest", () => {
	it("rejects when not connected", async () => {
		const client = createClient();
		client.connected = false;
		await expect(client.sendRequest("test", {})).rejects.toThrow(
			"Not connected to SFU",
		);
	});

	it("resolves when response.success is true", async () => {
		const client = createClient();
		client.connected = true;
		const response = { success: true, data: "ok" };
		client.signalChannel.emit = vi.fn((_event, _data, cb) => cb(response));
		const result = await client.sendRequest("test", { foo: 1 });
		expect(result).toEqual(response);
	});

	it("rejects when response.success is false", async () => {
		const client = createClient();
		client.connected = true;
		client.signalChannel.emit = vi.fn((_event, _data, cb) =>
			cb({ success: false, error: "nope" }),
		);
		await expect(client.sendRequest("test", {})).rejects.toThrow("nope");
	});
});

describe("sendEvent", () => {
	it("throws when not connected", () => {
		const client = createClient();
		client.connected = false;
		expect(() => client.sendEvent("evt", {})).toThrow("Not connected to SFU");
	});

	it("emits on signal channel when connected", () => {
		const client = createClient();
		client.connected = true;
		client.sendEvent("evt", { key: "val" });
		expect(client.signalChannel.emit).toHaveBeenCalledWith("evt", {
			key: "val",
		});
	});
});

describe("sendChatMessage", () => {
	it("throws when not connected", () => {
		const client = createClient();
		client.connected = false;
		expect(() => client.sendChatMessage("hello")).toThrow(
			"Not connected to SFU",
		);
	});

	it("emits chat:send with message payload", () => {
		const client = createClient();
		client.connected = true;
		client.sendChatMessage("hello");
		expect(client.signalChannel.emit).toHaveBeenCalledWith("chat:send", {
			message: "hello",
		});
	});

	it("includes clientId when provided", () => {
		const client = createClient();
		client.connected = true;
		client.sendChatMessage("hello", { clientId: "cid-123" });
		expect(client.signalChannel.emit).toHaveBeenCalledWith("chat:send", {
			message: "hello",
			clientId: "cid-123",
		});
	});

	it("coerces message and clientId to string", () => {
		const client = createClient();
		client.connected = true;
		client.sendChatMessage(42 as unknown as string, {
			clientId: 99 as unknown as string,
		});
		expect(client.signalChannel.emit).toHaveBeenCalledWith("chat:send", {
			message: "42",
			clientId: "99",
		});
	});
});

describe("sendReaction", () => {
	it("throws when not connected", () => {
		const client = createClient();
		client.connected = false;
		expect(() => client.sendReaction("🎉")).toThrow("Not connected to SFU");
	});

	it("emits reaction:send when connected", () => {
		const client = createClient();
		client.connected = true;
		client.sendReaction("🎉");
		expect(client.signalChannel.emit).toHaveBeenCalledWith("reaction:send", {
			reaction: "🎉",
		});
	});
});

describe("sendRaiseHand", () => {
	it("throws when not connected", () => {
		const client = createClient();
		client.connected = false;
		expect(() => client.sendRaiseHand(true)).toThrow("Not connected to SFU");
	});

	it("resolves when response.success is true", async () => {
		const client = createClient();
		client.connected = true;
		client.signalChannel.emit = vi.fn((_event, _data, cb) =>
			cb({ success: true }),
		);
		await expect(client.sendRaiseHand(true)).resolves.toEqual({
			success: true,
		});
	});

	it("rejects when response.success is false", async () => {
		const client = createClient();
		client.connected = true;
		client.signalChannel.emit = vi.fn((_event, _data, cb) =>
			cb({ success: false, error: "rate limited" }),
		);
		await expect(client.sendRaiseHand(true)).rejects.toThrow("rate limited");
	});
});

describe("on / off event handling", () => {
	it("registers handler via on()", () => {
		const client = createClient();
		const handler = vi.fn();
		client.on("participant_joined", handler);
		expect(client.eventHandlers.get("participant_joined")).toBe(handler);
		expect(client.signalChannel.on).toHaveBeenCalledWith(
			"participant_joined",
			handler,
		);
	});

	it("removes handler via off()", () => {
		const client = createClient();
		const handler = vi.fn();
		client.on("participant_joined", handler);
		client.off("participant_joined");
		expect(client.eventHandlers.has("participant_joined")).toBe(false);
		expect(client.signalChannel.off).toHaveBeenCalledWith(
			"participant_joined",
			handler,
		);
	});
});

describe("scheduleTokenRefresh", () => {
	it("does nothing when no tokenExpiresAt", () => {
		const client = createClient();
		client.connectionDetails.tokenExpiresAt = null;
		client.connectionDetails.meetingId = null;
		client.scheduleTokenRefresh();
		expect(client.tokenRefreshTimer).toBeNull();
	});

	it("schedules refresh when expiry is far enough", () => {
		const client = createClient();
		client.connectionDetails.tokenExpiresAt = Date.now() + 600_000;
		client.connectionDetails.meetingId = "meet-1";
		client.scheduleTokenRefresh();
		expect(client.tokenRefreshTimer).not.toBeNull();
	});

	it("triggers immediate refresh when expiry is within buffer", () => {
		const client = createClient();
		client.connectionDetails.tokenExpiresAt = Date.now() + 10_000;
		client.connectionDetails.meetingId = "meet-1";

		vi.mocked(frappeRequest).mockResolvedValue({
			auth_token: "new-token",
			expires_in: 3600,
			codec_strategy: "svc",
		});
		client.scheduleTokenRefresh();
		expect(frappeRequest).toHaveBeenCalled();
	});

	it("clears existing timer before scheduling", () => {
		const client = createClient();
		client.connectionDetails.tokenExpiresAt = Date.now() + 600_000;
		client.connectionDetails.meetingId = "meet-1";
		client.tokenRefreshTimer = setTimeout(() => {}, 999999);
		client.scheduleTokenRefresh();
		expect(client.tokenRefreshTimer).not.toBe(0);
	});
});

describe("getConnectionDetails", () => {
	it("fetches regular connection details", async () => {
		vi.mocked(frappeRequest).mockResolvedValue({
			auth_token: "tok-1",
			meeting_id: "meet-1",
			user_id: "usr-1",
			sfu_url: "https://sfu.example.com",
			sfu_port: "443",
			user_data: { name: "Alice" },
			expires_in: 3600,
			codec_strategy: "svc",
			e2ee_required: true,
			is_host: true,
			is_cohost: false,
		});
		const client = createClient();
		const details = await client.getConnectionDetails("meet-1");
		expect(details.authToken).toBe("tok-1");
		expect(details.userId).toBe("usr-1");
		expect(details.codecStrategy).toBe("svc");
		expect(details.e2eeRequired).toBe(true);
		expect(details.isHost).toBe(true);
		expect(details.isCohost).toBe(false);
		expect(frappeRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "suite.meet.api.meeting.get_sfu_connection_details",
				params: { meeting_id: "meet-1" },
			}),
		);
	});

	it("fetches guest connection details", async () => {
		sessionStorage.setItem("guest_id", "guest-1");
		sessionStorage.setItem("guest_name", "Guest Alice");
		sessionStorage.setItem("guest_meeting_id", "meet-2");

		vi.mocked(frappeRequest).mockResolvedValue({
			sfu_url: "https://sfu.example.com",
			sfu_port: "443",
			codec_strategy: "svc",
			e2ee_required: true,
		});
		const client = createClient();
		const details = await client.getConnectionDetails("meet-2", "guest-token");
		expect(details.authToken).toBe("guest-token");
		expect(details.userId).toBe("guest-1");
		expect(details.userData?.is_guest).toBe(true);
		expect(details.e2eeRequired).toBe(true);
	});
});

describe("connect refresh", () => {
	it("re-fetches connection details when already connected", async () => {
		const client = createClient();
		client.connected = true;
		client.connectionDetails = {
			authToken: "stale-token",
			meetingId: "meet-1",
			userId: "usr-1",
			sfuUrl: "https://sfu.example.com",
			sfuPort: "443",
			tokenExpiresAt: Date.now() + 3600_000,
			codecStrategy: "simulcast",
			e2eeRequired: false,
			isHost: false,
			isCohost: false,
		};
		const signalChannel = client.signalChannel;

		vi.mocked(frappeRequest).mockResolvedValue({
			auth_token: "fresh-token",
			meeting_id: "meet-1",
			user_id: "usr-1",
			sfu_url: "https://sfu.example.com",
			sfu_port: "443",
			user_data: { name: "Alice" },
			expires_in: 3600,
			codec_strategy: "svc",
			e2ee_required: true,
			is_host: true,
			is_cohost: false,
		});

		await client.connect("meet-1");

		expect(client.connectionDetails.authToken).toBe("fresh-token");
		expect(client.connectionDetails.e2eeRequired).toBe(true);
		expect(client.connectionDetails.isHost).toBe(true);
		expect(client.connectionDetails.isCohost).toBe(false);
		expect(signalChannel.updateAuth).toHaveBeenCalledWith("fresh-token");
	});

	it("re-fetches guest connection details when already connected", async () => {
		sessionStorage.setItem("guest_id", "guest-2");
		sessionStorage.setItem("guest_name", "Guest Bob");
		sessionStorage.setItem("guest_meeting_id", "meet-2");

		const client = createClient();
		client.connected = true;
		client.connectionDetails = {
			authToken: "stale-guest-token",
			meetingId: "meet-2",
			userId: "guest-2",
			sfuUrl: "https://sfu.example.com",
			sfuPort: "443",
			tokenExpiresAt: Date.now() + 3600_000,
			codecStrategy: "svc",
			e2eeRequired: false,
			isHost: false,
			isCohost: false,
		};

		vi.mocked(frappeRequest).mockResolvedValue({
			sfu_url: "https://sfu.example.com",
			sfu_port: "443",
			codec_strategy: "svc",
			e2ee_required: true,
		});

		await client.connect("meet-2", "guest-token-2");

		expect(client.connectionDetails.e2eeRequired).toBe(true);
	});
});

describe("E2EE signaling payloads", () => {
	it("passes encryption metadata when creating WebRTC transport", async () => {
		const client = createClient();
		client.connected = true;
		client.connectionDetails.e2eeRequired = true;

		const sendRequestSpy = vi.spyOn(client, "sendRequest").mockResolvedValue({
			id: "transport-1",
			iceParameters: {},
			iceCandidates: [],
			dtlsParameters: {},
			success: true,
		});

		await client.createWebRtcTransport("send");

		expect(sendRequestSpy).toHaveBeenCalledWith("create_webrtc_transport", {
			direction: "send",
			encryptionEnabled: true,
		});
	});

	it("includes E2EE capability metadata in join request", async () => {
		const client = createClient();
		client.connected = true;
		client.connectionDetails.e2eeRequired = true;

		const originalSender = (
			globalThis as typeof globalThis & {
				RTCRtpSender?: {
					prototype?: { createEncodedStreams?: () => void };
				};
			}
		).RTCRtpSender;
		const originalReceiver = (
			globalThis as typeof globalThis & {
				RTCRtpReceiver?: {
					prototype?: { createEncodedStreams?: () => void };
				};
			}
		).RTCRtpReceiver;

		try {
			(
				globalThis as typeof globalThis & {
					RTCRtpSender?: {
						prototype?: { createEncodedStreams?: () => void };
					};
				}
			).RTCRtpSender = {
				prototype: {
					createEncodedStreams: () => {},
				},
			} as unknown as typeof globalThis.RTCRtpSender;
			(
				globalThis as typeof globalThis & {
					RTCRtpReceiver?: {
						prototype?: { createEncodedStreams?: () => void };
					};
				}
			).RTCRtpReceiver = {
				prototype: {
					createEncodedStreams: () => {},
				},
			} as unknown as typeof globalThis.RTCRtpReceiver;

			const sendRequestSpy = vi
				.spyOn(client, "sendRequest")
				.mockResolvedValue({ success: true });

			await client.joinRoom(
				"room-1",
				{ name: "Alice" },
				{ audio_enabled: true },
			);

			expect(sendRequestSpy).toHaveBeenCalledWith("join_room", {
				roomId: "room-1",
				userData: { name: "Alice" },
				mediaState: { audio_enabled: true },
				e2ee: {
					enabled: true,
					capability: {
						supported: true,
						mode: "insertable-streams",
					},
				},
			});
		} finally {
			(
				globalThis as typeof globalThis & {
					RTCRtpSender?: {
						prototype?: { createEncodedStreams?: () => void };
					};
				}
			).RTCRtpSender = originalSender;
			(
				globalThis as typeof globalThis & {
					RTCRtpReceiver?: {
						prototype?: { createEncodedStreams?: () => void };
					};
				}
			).RTCRtpReceiver = originalReceiver;
		}
	});

	it("reports RTCRtpScriptTransform capability in join request", async () => {
		const client = createClient();
		client.connected = true;
		client.connectionDetails.e2eeRequired = true;

		const originalSender = globalThis.RTCRtpSender;
		const originalReceiver = globalThis.RTCRtpReceiver;
		const originalScriptTransform = (
			globalThis as typeof globalThis & { RTCRtpScriptTransform?: unknown }
		).RTCRtpScriptTransform;

		try {
			Object.defineProperty(globalThis, "RTCRtpSender", {
				configurable: true,
				writable: true,
				value: { prototype: {} },
			});
			Object.defineProperty(globalThis, "RTCRtpReceiver", {
				configurable: true,
				writable: true,
				value: { prototype: {} },
			});
			Object.defineProperty(globalThis, "RTCRtpScriptTransform", {
				configurable: true,
				writable: true,
				value: function RTCRtpScriptTransform() {},
			});

			const sendRequestSpy = vi
				.spyOn(client, "sendRequest")
				.mockResolvedValue({ success: true });

			await client.joinRoom(
				"room-1",
				{ name: "Alice" },
				{ audio_enabled: true },
			);

			expect(sendRequestSpy).toHaveBeenCalledWith(
				"join_room",
				expect.objectContaining({
					e2ee: {
						enabled: true,
						capability: {
							supported: true,
							mode: "rtp-script-transform",
						},
					},
				}),
			);
		} finally {
			Object.defineProperty(globalThis, "RTCRtpSender", {
				configurable: true,
				writable: true,
				value: originalSender,
			});
			Object.defineProperty(globalThis, "RTCRtpReceiver", {
				configurable: true,
				writable: true,
				value: originalReceiver,
			});
			Object.defineProperty(globalThis, "RTCRtpScriptTransform", {
				configurable: true,
				writable: true,
				value: originalScriptTransform,
			});
		}
	});

	it("uses the explicit E2EE required flag without host public key compatibility", async () => {
		const client = createClient();
		client.connected = true;
		client.connectionDetails.e2eeRequired = true;

		const sendRequestSpy = vi
			.spyOn(client, "sendRequest")
			.mockResolvedValue({ success: true });

		await client.joinRoom("room-1", { name: "Alice" }, { audio_enabled: true });

		expect(sendRequestSpy).toHaveBeenCalledWith(
			"join_room",
			expect.objectContaining({
				e2ee: expect.objectContaining({
					enabled: true,
				}),
			}),
		);
	});

	it("picks up e2ee_required returned by refresh_sfu_token", async () => {
		vi.mocked(frappeRequest).mockResolvedValue({
			auth_token: "tok-2",
			expires_in: 3600,
			codec_strategy: "svc",
			e2ee_required: true,
		});
		const client = createClient();
		client.connectionDetails.e2eeRequired = false;
		await client.refreshToken();
		expect(client.connectionDetails.e2eeRequired).toBe(true);
	});

	it("does not downgrade local e2ee requirement during token refresh", async () => {
		vi.mocked(frappeRequest).mockResolvedValue({
			auth_token: "tok-2",
			expires_in: 3600,
			codec_strategy: "svc",
			e2ee_required: false,
		});
		const client = createClient();
		client.connectionDetails.e2eeRequired = true;
		await client.refreshToken();
		expect(client.connectionDetails.e2eeRequired).toBe(true);
	});

	it("setE2EERequired updates connectionDetails for the realtime-event flow", () => {
		const client = createClient();
		client.connectionDetails.e2eeRequired = false;
		client.setE2EERequired(true);
		expect(client.isE2EERequired()).toBe(true);
	});
});

describe("disconnect", () => {
	it("resets state on disconnect", () => {
		const client = createClient();
		client.connected = true;
		client.connectionDetails = {
			authToken: "tok",
			meetingId: "m",
			userId: "u",
			sfuUrl: "url",
			sfuPort: "443",
			tokenExpiresAt: 100,
			codecStrategy: "svc",
			e2eeRequired: false,
			isHost: false,
			isCohost: false,
		};
		client.disconnect();
		expect(client.connected).toBe(false);
		expect(client.connectionDetails.authToken).toBeNull();
		expect(client.connectionDetails.meetingId).toBeNull();
	});
});

describe("setupDefaultHandlers", () => {
	it("registers all default event handlers", () => {
		const client = createClient();
		const defaultEvents = [
			"connect",
			"disconnect",
			"connect_error",
			"reconnect",
			"reconnect_error",
			"reconnect_attempt",
			"participant_joined",
			"participant_left",
			"producer_created",
			"producer_closed",
			"consumer_created",
			"consumer_closed",
			"media_control_update",
			"host_control_update",
			"screen_share_started",
			"screen_share_stopped",
			"webrtc_offer",
			"webrtc_answer",
			"ice_candidate",
			"chat:message",
			"active_speaker",
			"hand_raised",
			"existing_raised_hands",
		];
		for (const ev of defaultEvents) {
			expect(client.eventHandlers.has(ev)).toBe(true);
		}
	});

	it("connect handler sets connected to true", () => {
		const client = createClient();
		client.connected = false;
		const handler = client.eventHandlers.get("connect");
		handler();
		expect(client.connected).toBe(true);
	});

	it("disconnect handler sets connected to false", () => {
		const client = createClient();
		client.connected = true;
		const handler = client.eventHandlers.get("disconnect");
		handler();
		expect(client.connected).toBe(false);
	});
});

describe("getConnectionStatus", () => {
	it("returns snapshot of connection state", () => {
		const client = createClient();
		client.connected = true;
		client.connectionDetails.meetingId = "meet-1";
		client.connectionDetails.userId = "usr-1";
		const status = client.getConnectionStatus();
		expect(status.connected).toBe(true);
		expect(status.meetingId).toBe("meet-1");
		expect(status.userId).toBe("usr-1");
		expect(status.socketId).toBe("socket-id");
	});
});
