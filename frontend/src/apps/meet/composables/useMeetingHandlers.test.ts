import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useMeetingHandlers } from "./useMeetingHandlers";

vi.mock("frappe-ui", () => ({
	frappeRequest: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn() },
}));

import { frappeRequest, toast } from "frappe-ui";

describe("useMeetingHandlers", () => {
	beforeEach(() => vi.clearAllMocks());

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

	it("records a guest ban before sending the distinct SFU ban action", async () => {
		vi.mocked(frappeRequest).mockResolvedValue({ status: "banned" });
		const sendHostControl = vi.fn();
		const handlers = useMeetingHandlers({
			meetingId: "room-1",
			sfuConnection: { sfuManager: ref({ sendHostControl }) },
		} as never);

		await handlers.handleKickParticipant("guest_1", true);

		expect(frappeRequest).toHaveBeenCalledWith({
			url: "suite.meet.api.meeting.ban_guest",
			params: { meeting_id: "room-1", guest_id: "guest_1" },
		});
		expect(sendHostControl).toHaveBeenCalledWith("ban_participant", "guest_1");
	});

	it("does not record a backend ban without an SFU manager", async () => {
		const handlers = useMeetingHandlers({
			meetingId: "room-1",
			sfuConnection: { sfuManager: ref(null) },
		} as never);

		await handlers.handleKickParticipant("guest_1", true);

		expect(frappeRequest).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith(
			expect.stringContaining("Reconnect"),
		);
	});

	it("surfaces an acknowledged ban failure after backend revocation", async () => {
		vi.mocked(frappeRequest).mockResolvedValue({ status: "banned" });
		const sendHostControl = vi.fn().mockRejectedValue(new Error("SFU rejected"));
		const handlers = useMeetingHandlers({
			meetingId: "room-1",
			sfuConnection: { sfuManager: ref({ sendHostControl }) },
		} as never);

		await handlers.handleKickParticipant("guest_1", true);

		expect(toast.error).toHaveBeenCalledWith(
			expect.stringContaining("Use Remove to retry"),
		);
	});

	it("keeps authenticated participant removal remove-only", async () => {
		const sendHostControl = vi.fn();
		const handlers = useMeetingHandlers({
			meetingId: "room-1",
			sfuConnection: { sfuManager: ref({ sendHostControl }) },
		} as never);

		await handlers.handleKickParticipant("member@example.com", true);

		expect(frappeRequest).not.toHaveBeenCalled();
		expect(sendHostControl).toHaveBeenCalledWith(
			"kick_participant",
			"member@example.com",
		);
	});
});
