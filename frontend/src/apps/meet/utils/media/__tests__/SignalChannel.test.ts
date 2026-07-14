import { beforeEach, describe, expect, it, vi } from "vitest";

const socket = {
	connected: true,
	disconnect: vi.fn(),
	emit: vi.fn(),
	id: "socket-1",
	io: {
		off: vi.fn(),
		on: vi.fn(),
		opts: {},
	},
	off: vi.fn(),
	on: vi.fn(),
	once: vi.fn((event: string, handler: () => void) => {
		if (event === "connect") handler();
	}),
};

vi.mock("socket.io-client", () => ({
	io: vi.fn(() => socket),
}));

import { SocketIOSignalChannel } from "../SignalChannel";

describe("SocketIOSignalChannel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		socket.connected = true;
	});

	it("routes Socket.IO Manager reconnect lifecycle events to the manager", async () => {
		const channel = new SocketIOSignalChannel();
		await channel.connect({
			origin: "https://sfu.example.test",
			path: "/socket.io",
			auth: { token: "test" },
		});
		const handler = vi.fn();

		channel.on("reconnect", handler);

		expect(socket.io.on).toHaveBeenCalledWith("reconnect", handler);
		expect(socket.on).not.toHaveBeenCalledWith("reconnect", handler);
	});

	it("removes Manager reconnect listeners from the manager", async () => {
		const channel = new SocketIOSignalChannel();
		await channel.connect({
			origin: "https://sfu.example.test",
			path: "/socket.io",
			auth: { token: "test" },
		});
		const handler = vi.fn();

		channel.off("reconnect_attempt", handler);

		expect(socket.io.off).toHaveBeenCalledWith("reconnect_attempt", handler);
		expect(socket.off).not.toHaveBeenCalledWith("reconnect_attempt", handler);
	});

	it("keeps application signaling events on the namespace socket", async () => {
		const channel = new SocketIOSignalChannel();
		await channel.connect({
			origin: "https://sfu.example.test",
			path: "/socket.io",
			auth: { token: "test" },
		});
		const handler = vi.fn();

		channel.on("producer_created", handler);

		expect(socket.on).toHaveBeenCalledWith("producer_created", handler);
		expect(socket.io.on).not.toHaveBeenCalledWith("producer_created", handler);
	});
});
