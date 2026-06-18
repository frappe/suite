import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SFURecoveryManager } from "../SFURecoveryManager";

type MockTransportManager = {
	restartAllTransportIce: ReturnType<typeof vi.fn>;
	setEventHandlers: ReturnType<typeof vi.fn>;
};

type MockSfuClient = {
	isConnected: ReturnType<typeof vi.fn>;
};

function createManager(
	opts: { connected?: boolean; restartResult?: boolean } = {},
) {
	const sfuClient: MockSfuClient = {
		isConnected: vi.fn().mockReturnValue(opts.connected ?? true),
	};
	const transportManager: MockTransportManager = {
		restartAllTransportIce: vi
			.fn()
			.mockResolvedValue(opts.restartResult ?? true),
		setEventHandlers: vi.fn(),
	};
	const manager = new SFURecoveryManager({
		sfuClient: sfuClient as never,
		transportManager: transportManager as never,
		meetingId: () => "meeting-1",
	});
	return { manager, sfuClient, transportManager };
}

describe("SFURecoveryManager", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("handleTransportConnectionStateChange", () => {
		it("triggers immediate ICE restart on failed", async () => {
			const { manager, transportManager } = createManager();
			manager.setupTransportEventHandlers();

			manager.handleTransportConnectionStateChange("send", "failed");

			await vi.advanceTimersByTimeAsync(0);
			expect(transportManager.restartAllTransportIce).toHaveBeenCalledTimes(1);
		});

		it("triggers immediate ICE restart on closed", async () => {
			const { manager, transportManager } = createManager();
			manager.setupTransportEventHandlers();

			manager.handleTransportConnectionStateChange("recv", "closed");

			await vi.advanceTimersByTimeAsync(0);
			expect(transportManager.restartAllTransportIce).toHaveBeenCalledTimes(1);
		});

		it("does not trigger immediately on disconnected", async () => {
			const { manager, transportManager } = createManager();
			manager.setupTransportEventHandlers();

			manager.handleTransportConnectionStateChange("send", "disconnected");

			await vi.advanceTimersByTimeAsync(0);
			expect(transportManager.restartAllTransportIce).not.toHaveBeenCalled();
		});

		it("triggers after 3 seconds of sustained disconnected state", async () => {
			const { manager, transportManager } = createManager();
			manager.setupTransportEventHandlers();

			manager.handleTransportConnectionStateChange("send", "disconnected");

			await vi.advanceTimersByTimeAsync(2999);
			expect(transportManager.restartAllTransportIce).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(100);
			expect(transportManager.restartAllTransportIce).toHaveBeenCalledTimes(1);
		});

		it("does not trigger if state recovers before 3s elapse", async () => {
			const { manager, transportManager } = createManager();
			manager.setupTransportEventHandlers();

			manager.handleTransportConnectionStateChange("send", "disconnected");

			await vi.advanceTimersByTimeAsync(2000);

			manager.handleTransportConnectionStateChange("send", "connected");

			await vi.advanceTimersByTimeAsync(5000);
			expect(transportManager.restartAllTransportIce).not.toHaveBeenCalled();
		});

		it("tracks disconnected state per-direction independently", async () => {
			const { manager, transportManager } = createManager();
			manager.setupTransportEventHandlers();

			manager.handleTransportConnectionStateChange("send", "disconnected");
			await vi.advanceTimersByTimeAsync(2500);
			manager.handleTransportConnectionStateChange("recv", "disconnected");

			await vi.advanceTimersByTimeAsync(600);
			expect(transportManager.restartAllTransportIce).toHaveBeenCalledTimes(1);
		});

		it("ignores states other than failed/closed/disconnected", async () => {
			const { manager, transportManager } = createManager();
			manager.setupTransportEventHandlers();

			manager.handleTransportConnectionStateChange("send", "connecting");
			manager.handleTransportConnectionStateChange("send", "connected");
			manager.handleTransportConnectionStateChange("send", "new");

			await vi.advanceTimersByTimeAsync(10000);
			expect(transportManager.restartAllTransportIce).not.toHaveBeenCalled();
		});
	});

	describe("reset", () => {
		it("clears pending disconnected state and stops watchdog", async () => {
			const { manager, transportManager } = createManager();
			manager.setupTransportEventHandlers();

			manager.handleTransportConnectionStateChange("send", "disconnected");

			manager.reset();

			await vi.advanceTimersByTimeAsync(10000);
			expect(transportManager.restartAllTransportIce).not.toHaveBeenCalled();
		});
	});

	describe("recovery cooldown", () => {
		it("respects 7s cooldown between consecutive recoveries", async () => {
			const { manager, transportManager } = createManager();
			manager.setupTransportEventHandlers();

			manager.handleTransportConnectionStateChange("send", "failed");
			await vi.advanceTimersByTimeAsync(0);
			expect(transportManager.restartAllTransportIce).toHaveBeenCalledTimes(1);

			manager.handleTransportConnectionStateChange("send", "failed");
			await vi.advanceTimersByTimeAsync(0);
			expect(transportManager.restartAllTransportIce).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(7000);
			manager.handleTransportConnectionStateChange("send", "failed");
			await vi.advanceTimersByTimeAsync(0);
			expect(transportManager.restartAllTransportIce).toHaveBeenCalledTimes(2);
		});
	});
});
