import { describe, expect, it, vi } from "vitest";
import { SFUMeetingManager } from "../SFUMeetingManager";

describe("SFUMeetingManager recovery fallback", () => {
	it("resets receive media when send rebuild fails", async () => {
		const manager = new SFUMeetingManager({
			isConnected: vi.fn(() => true),
		} as never);
		vi.spyOn(manager.transportManager, "restartAllTransportIce").mockResolvedValue({
			send: "failed",
			recv: "failed",
		});
		vi.spyOn(manager.mediaManager, "rebuildSendSide").mockRejectedValue(
			new Error("send rebuild failed"),
		);
		const resetReceiveSide = vi
			.spyOn(manager.connectionManager, "resetReceiveSide")
			.mockResolvedValue();

		await expect(
			manager.recoveryManager.recoverTransportIce("transport_send_failed"),
		).resolves.toBe("failed");

		expect(resetReceiveSide).toHaveBeenCalledOnce();
	});
});
