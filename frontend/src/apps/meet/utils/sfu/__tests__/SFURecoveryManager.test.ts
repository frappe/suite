import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransportIceRestartResult } from "../../media/TransportManager";
import { SFURecoveryManager } from "../SFURecoveryManager";

type MockTransportManager = {
	restartAllTransportIce: ReturnType<typeof vi.fn>;
	setEventHandlers: ReturnType<typeof vi.fn>;
};

type MockSfuClient = {
	isConnected: ReturnType<typeof vi.fn>;
};

function createManager(
	opts: {
		connected?: boolean;
		restartResult?: TransportIceRestartResult;
		onRecovered?: ReturnType<typeof vi.fn>;
		onFailed?: ReturnType<typeof vi.fn>;
		onStarted?: ReturnType<typeof vi.fn>;
	} = {},
) {
	const sfuClient: MockSfuClient = {
		isConnected: vi.fn().mockReturnValue(opts.connected ?? true),
	};
	const transportManager: MockTransportManager = {
			restartAllTransportIce: vi
				.fn()
				.mockResolvedValue(
					opts.restartResult ?? { send: "restarted", recv: "restarted" },
				),
		setEventHandlers: vi.fn(),
	};
	const manager = new SFURecoveryManager({
		sfuClient: sfuClient as never,
		transportManager: transportManager as never,
		meetingId: () => "meeting-1",
		onRecovered: opts.onRecovered,
		onFailed: opts.onFailed,
		onStarted: opts.onStarted,
	});
	return { manager, sfuClient, transportManager };
}

describe("SFURecoveryManager", () => {
	it("reports the recovery reason before restarting ICE", async () => {
		const onStarted = vi.fn();
		const { manager } = createManager({ onStarted });

		await manager.recoverTransportIce("transport_send_failed");

		expect(onStarted).toHaveBeenCalledWith("transport_send_failed");
	});

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

	describe("recoverTransportIce", () => {
		it("separates recovered, failed, and skipped states", async () => {
			const recovered = createManager();
			await expect(recovered.manager.recoverTransportIce("test")).resolves.toBe(
				"recovered",
			);

			const failed = createManager({
				restartResult: { send: "failed", recv: "restarted" },
			});
			await expect(failed.manager.recoverTransportIce("test")).resolves.toBe(
				"failed",
			);

			const skipped = createManager({ connected: false });
			await expect(skipped.manager.recoverTransportIce("test")).resolves.toBe(
				"skipped",
			);
		});

		it("shares the active recovery so concurrent callers observe the same outcome", async () => {
			const { manager, transportManager } = createManager({
				restartResult: { send: "failed", recv: "restarted" },
			});

			const first = manager.recoverTransportIce("first");
			await expect(manager.recoverTransportIce("second")).resolves.toBe(
				"failed",
			);
			await first;
			expect(transportManager.restartAllTransportIce).toHaveBeenCalledTimes(1);
		});

		it("runs the failed callback for transport-triggered recovery failures", async () => {
			const onFailed = vi.fn();
			const { manager } = createManager({
				restartResult: { send: "restarted", recv: "failed" },
				onFailed,
			});

			manager.handleTransportConnectionStateChange("recv", "failed");

			await vi.advanceTimersByTimeAsync(0);
			expect(onFailed).toHaveBeenCalledTimes(1);
		});

		it("runs one failed callback when multiple transport failures share a recovery", async () => {
			const onFailed = vi.fn();
			const { manager } = createManager({
				restartResult: { send: "failed", recv: "failed" },
				onFailed,
			});

			manager.handleTransportConnectionStateChange("send", "failed");
			manager.handleTransportConnectionStateChange("recv", "failed");

			await vi.advanceTimersByTimeAsync(0);
			expect(onFailed).toHaveBeenCalledTimes(1);
		});

		it("fails recovery when one active direction cannot restart", async () => {
			const onFailed = vi.fn();
			const { manager } = createManager({
				restartResult: { send: "failed", recv: "restarted" },
				onFailed,
			});

			await expect(manager.recoverTransportIce("test")).resolves.toBe("failed");
			expect(onFailed).toHaveBeenCalledWith("test", {
				send: "failed",
				recv: "restarted",
			});
		});

		it("does not run failed-direction recovery when post-recovery sync throws", async () => {
			const onRecovered = vi.fn().mockRejectedValue(new Error("sync failed"));
			const onFailed = vi.fn();
			const { manager } = createManager({ onRecovered, onFailed });

			await expect(manager.recoverTransportIce("test")).resolves.toBe("failed");

			expect(onFailed).not.toHaveBeenCalled();
		});

		it("clears recovery state after an ICE restart failure", async () => {
			const { manager } = createManager({
				restartResult: { send: "failed", recv: "failed" },
			});

			await manager.recoverTransportIce("test");

			expect(manager.isRecovering).toBe(false);
		});

		it("cancels an in-flight recovery when reset", async () => {
			let resolveRestart: (result: TransportIceRestartResult) => void;
			const restart = new Promise<TransportIceRestartResult>((resolve) => {
				resolveRestart = resolve;
			});
			const onRecovered = vi.fn();
			const { manager, transportManager } = createManager({ onRecovered });
			transportManager.restartAllTransportIce.mockReturnValue(restart);

			const recovery = manager.recoverTransportIce("test");
			manager.reset();
			resolveRestart!({ send: "restarted", recv: "restarted" });

			await expect(recovery).resolves.toBe("skipped");
			expect(onRecovered).not.toHaveBeenCalled();
		});
	});
});
