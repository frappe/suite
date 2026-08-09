import { toast } from "frappe-ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "vue";

const mocks = vi.hoisted(() => ({
	startParams: [] as Array<{ meeting_id: string; request_id: string }>,
	startCount: 0,
	startResults: [] as Array<Record<string, unknown>>,
	getStateCount: 0,
	getStateCompleted: 0,
	getStateResults: [] as Array<
		| Record<string, unknown>
		| null
		| Promise<Record<string, unknown> | null>
	>,
	socketHandler: null as ((event: {
		meeting_id: string;
		recording: Record<string, unknown> | null;
	}) => void) | null,
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
			if (options.url.endsWith(".get_state")) {
				mocks.getStateCount += 1;
				if (mocks.getStateResults.length) {
					const result = await mocks.getStateResults.shift();
					mocks.getStateCompleted += 1;
					return result;
				}
				if (mocks.startCount > 1) return {
					name: "recording",
					status: mocks.stopped ? "Stopping" : "Recording",
					state_revision: mocks.stopped ? 3 : 2,
				};
			}
			return null;
		}),
	}),
}));

vi.mock("../../socket", () => ({
	useSocket: () => ({
		on: vi.fn((_event: string, handler: typeof mocks.socketHandler) => {
			mocks.socketHandler = handler;
		}),
		off: vi.fn(),
	}),
}));

import { useRecording } from "../useRecording";

describe("useRecording", () => {
	beforeEach(() => {
		mocks.startParams.length = 0;
		mocks.startCount = 0;
		mocks.startResults.length = 0;
		mocks.getStateCount = 0;
		mocks.getStateCompleted = 0;
		mocks.getStateResults.length = 0;
		mocks.socketHandler = null;
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
		expect(recording.isLive.value).toBe(false);
	});

	it("does not let a stale state load overwrite a newer command revision", async () => {
		let resolveStale!: (value: Record<string, unknown>) => void;
		const stale = new Promise<Record<string, unknown>>((resolve) => {
			resolveStale = resolve;
		});
		mocks.getStateResults.push(stale, {
			name: "recording",
			status: "Stopping",
			state_revision: 3,
		});
		const recording = useRecording("room");
		await recording.start();

		const starting = recording.start();
		await vi.waitFor(() => expect(mocks.getStateCount).toBe(1));
		await recording.stop();
		resolveStale({
			name: "recording",
			status: "Recording",
			state_revision: 2,
		});
		await starting;

		expect(recording.state.value?.status).toBe("Stopping");
		expect(recording.state.value?.state_revision).toBe(3);
	});

	it("does not resurrect state after a realtime null transition", async () => {
		let resolveStale!: (value: Record<string, unknown>) => void;
		mocks.getStateResults.push(new Promise<Record<string, unknown>>((resolve) => {
			resolveStale = resolve;
		}));
		let recording!: ReturnType<typeof useRecording>;
		const app = createApp({
			setup() {
				recording = useRecording("room");
				return () => null;
			},
		});
		app.mount(document.createElement("div"));
		await vi.waitFor(() => expect(mocks.getStateCount).toBe(1));

		mocks.socketHandler?.({ meeting_id: "room", recording: null });
		resolveStale({
			name: "recording",
			status: "Recording",
			state_revision: 1,
		});
		await vi.waitFor(() => expect(mocks.getStateCompleted).toBe(1));

		expect(recording.state.value).toBeNull();
		app.unmount();
	});

	it("syncs active recording state supplied by a guest join", () => {
		const recording = useRecording("room");

		recording.syncState({
			name: "recording",
			status: "Recording",
			state_revision: 1,
		});

		expect(recording.state.value?.status).toBe("Recording");
		expect(recording.isLive.value).toBe(true);
		expect(toast.info).toHaveBeenCalledWith("This meeting is being recorded");
	});

	it("tracks global recording availability", () => {
		const recording = useRecording("room");

		expect(recording.globalEnabled.value).toBe(false);
		recording.setGlobalEnabled(true);
		expect(recording.globalEnabled.value).toBe(true);
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
