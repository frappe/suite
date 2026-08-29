import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useMeetingHandlers } from "./useMeetingHandlers";

describe("useMeetingHandlers", () => {
	it("cleans up the failed manager before returning to preview", async () => {
		const cleanup = vi.fn().mockResolvedValue(undefined);
		const sfuManager = ref({ cleanup });
		const connectionState = {
			connectionError: "Recovery exhausted",
			isInPreview: false,
		};
		const handlers = useMeetingHandlers({
			connectionState,
			sfuConnection: { sfuManager },
		} as never);

		await handlers.resetToPreview();

		expect(cleanup).toHaveBeenCalledOnce();
		expect(sfuManager.value).toBeNull();
		expect(connectionState.connectionError).toBeNull();
		expect(connectionState.isInPreview).toBe(true);
	});

	it("carries preview switch intent into the join", async () => {
		const joinMeetingRoom = vi.fn().mockResolvedValue(undefined);
		const handlers = useMeetingHandlers({
			sfuConnection: { joinMeetingRoom },
		} as never);

		await handlers.joinMeetingFromPreview(true);

		expect(joinMeetingRoom).toHaveBeenCalledWith({ switchHere: true });
	});

	it.each([
		["handleMuteParticipant", "mute_participant"],
		["handleKickParticipant", "kick_participant"],
		["handleLowerHand", "lower_hand"],
	] as const)("routes %s through the meeting facade", async (handler, action) => {
		const sendHostControl = vi.fn();
		const handlers = useMeetingHandlers({
			sfuConnection: { sfuManager: ref({ sendHostControl }) },
		} as never);

		await handlers[handler]("participant-1");

		expect(sendHostControl).toHaveBeenCalledWith(action, "participant-1");
	});
});
