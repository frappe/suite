import { beforeEach, describe, expect, it, vi } from "vitest";
import { SFURequestError } from "../../utils/SFUClient";
import { restoreCaptionSubscription } from "../useCaptions";

function createSfuClient({ connected = true, e2ee = false } = {}) {
	return {
		isConnected: vi.fn(() => connected),
		isE2EERequired: vi.fn(() => e2ee),
		sendRequest: vi.fn().mockResolvedValue(undefined),
	};
}

describe("restoreCaptionSubscription", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("restores an enabled caption subscription", async () => {
		const sfuClient = createSfuClient();

		const restored = await restoreCaptionSubscription(sfuClient as never, true);

		expect(sfuClient.sendRequest).toHaveBeenCalledWith("stt:toggle", {
			enabled: true,
		});
		expect(restored).toBe(true);
	});

	it.each([
		["captions are disabled", false, true, false],
		["signaling is disconnected", true, false, false],
		["E2EE is required", true, true, true],
	])("does not restore when %s", async (_reason, enabled, connected, e2ee) => {
		const sfuClient = createSfuClient({ connected, e2ee });

		const restored = await restoreCaptionSubscription(
			sfuClient as never,
			enabled,
		);

		expect(sfuClient.sendRequest).not.toHaveBeenCalled();
		expect(restored).toBe(false);
	});

	it("reports a failed restoration", async () => {
		const error = new Error("request failed");
		const sfuClient = createSfuClient();
		sfuClient.sendRequest.mockRejectedValue(error);
		vi.spyOn(console, "error").mockImplementation(() => {});

		const restored = await restoreCaptionSubscription(sfuClient as never, true);

		expect(restored).toBe(false);
		expect(console.error).toHaveBeenCalledWith(
			"Failed to restore captions after reconnect:",
			error,
		);
	});

	it("preserves the local preference when the result is ambiguous", async () => {
		const sfuClient = createSfuClient();
		sfuClient.sendRequest.mockRejectedValue(
			new SFURequestError("TIMEOUT", "request timed out"),
		);
		vi.spyOn(console, "error").mockImplementation(() => {});

		const shouldRemainEnabled = await restoreCaptionSubscription(
			sfuClient as never,
			true,
		);

		expect(shouldRemainEnabled).toBe(true);
	});
});
