import { toast } from "frappe-ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	startParams: [] as Array<{ meeting_id: string; request_id: string }>,
	startCount: 0,
	startResults: [] as Array<Record<string, unknown>>,
	stopped: false,
}));

vi.mock("frappe-ui", () => ({
	toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
	useCall: (options: { url: string }) => ({
		loading: false,
		submit: vi.fn(async (params: { meeting_id: string; request_id?: string }) => {
			if (options.url.endsWith(".start")) {
				mocks.startParams.push(params as { meeting_id: string; request_id: string });
				mocks.startCount += 1;
				if (mocks.startResults.length) return mocks.startResults.shift();
				return {
					name: "recording",
					status: mocks.startCount === 1 ? "Pending" : "Recording",
					state_revision: mocks.startCount,
				};
			}
			if (options.url.endsWith(".stop")) {
				mocks.stopped = true;
				return { name: "recording", status: "Stopping", state_revision: 3 };
			}
			if (options.url.endsWith(".get_preflight")) return { eligible: true };
			if (options.url.endsWith(".get_state") && mocks.startCount > 1)
				return {
					name: "recording",
					status: mocks.stopped ? "Stopping" : "Recording",
					state_revision: mocks.stopped ? 3 : 2,
				};
			return null;
		}),
	}),
}));

vi.mock("../../socket", () => ({ useSocket: () => null }));

import { useRecording } from "../useRecording";

describe("useRecording", () => {
	beforeEach(() => {
		mocks.startParams.length = 0;
		mocks.startCount = 0;
		mocks.startResults.length = 0;
		mocks.stopped = false;
		vi.clearAllMocks();
	});

	it("reuses the request id while a start remains pending", async () => {
		const recording = useRecording("room");

		await recording.start();
		expect(recording.state.value?.status).toBe("Pending");
		expect(recording.isStarting.value).toBe(true);
		expect(recording.isLive.value).toBe(false);
		await recording.start();

		expect(recording.state.value?.status).toBe("Recording");
		expect(recording.isLive.value).toBe(true);
		expect(recording.isStarting.value).toBe(false);
		expect(mocks.startParams).toHaveLength(2);
		expect(mocks.startParams[0]?.request_id).toBe(
			mocks.startParams[1]?.request_id,
		);
	});

	it("moves the local state to stopping", async () => {
		const recording = useRecording("room");
		await recording.start();
		await recording.start();
		await recording.stop();
		expect(recording.state.value?.status).toBe("Stopping");
	});

	it("does not store or announce an explicit capacity rejection as started", async () => {
		mocks.startResults.push({ status: "Rejected" });
		const recording = useRecording("room");

		await recording.start();

		expect(recording.state.value).toBeNull();
		expect(toast.success).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith("Recording capacity is unavailable");
	});
});
