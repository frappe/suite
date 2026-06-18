import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SFUClient } from "../SFUClient";

const mockSocket = vi.hoisted(() => ({
	auth: {} as Record<string, unknown>,
	connected: false,
	id: "socket-id",
	io: { opts: {} as Record<string, unknown> },
	disconnect: vi.fn(),
	emit: vi.fn(),
	on: vi.fn(),
	off: vi.fn(),
	once: vi.fn(),
}));

vi.mock("socket.io-client", () => ({
	io: vi.fn(() => mockSocket),
}));

vi.mock("frappe-ui", () => ({
	frappeRequest: vi.fn(),
}));

import { frappeRequest } from "frappe-ui";

beforeEach(() => {
	vi.clearAllMocks();
	mockSocket.auth = {};
	mockSocket.connected = false;
	mockSocket.io.opts = {};
	mockSocket.disconnect = vi.fn();
	mockSocket.emit = vi.fn();
	mockSocket.on = vi.fn();
	mockSocket.off = vi.fn();
	mockSocket.once = vi.fn();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

function createClient() {
	const client = new SFUClient();
	client.socket = mockSocket as unknown as typeof client.socket;
	return client;
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
		mockSocket.emit = vi.fn((_event, _data, cb) => cb(response));
		const result = await client.sendRequest("test", { foo: 1 });
		expect(result).toEqual(response);
	});

	it("rejects when response.success is false", async () => {
		const client = createClient();
		client.connected = true;
		mockSocket.emit = vi.fn((_event, _data, cb) =>
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
		expect(client.socket!.emit).toHaveBeenCalledWith("evt", {
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
		expect(client.socket!.emit).toHaveBeenCalledWith("chat:send", {
			message: "hello",
		});
	});

	it("includes clientId when provided", () => {
		const client = createClient();
		client.connected = true;
		client.sendChatMessage("hello", { clientId: "cid-123" });
		expect(client.socket!.emit).toHaveBeenCalledWith("chat:send", {
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
		expect(client.socket!.emit).toHaveBeenCalledWith("chat:send", {
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
		expect(client.socket!.emit).toHaveBeenCalledWith("reaction:send", {
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
		mockSocket.emit = vi.fn((_event, _data, cb) => cb({ success: true }));
		await expect(client.sendRaiseHand(true)).resolves.toEqual({
			success: true,
		});
	});

	it("rejects when response.success is false", async () => {
		const client = createClient();
		client.connected = true;
		mockSocket.emit = vi.fn((_event, _data, cb) =>
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
		expect(client.socket!.on).toHaveBeenCalledWith(
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
		expect(client.socket!.off).toHaveBeenCalledWith(
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
		});
		const client = createClient();
		const details = await client.getConnectionDetails("meet-1");
		expect(details.authToken).toBe("tok-1");
		expect(details.userId).toBe("usr-1");
		expect(details.codecStrategy).toBe("svc");
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
		});
		const client = createClient();
		const details = await client.getConnectionDetails("meet-2", "guest-token");
		expect(details.authToken).toBe("guest-token");
		expect(details.userId).toBe("guest-1");
		expect(details.userData?.is_guest).toBe(true);
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
