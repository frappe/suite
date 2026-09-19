import { createApp } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "frappe-ui";
import { SFURequestError, SFUResponseError } from "../../utils/SFUClient";
import { useCaptions } from "../useCaptions";

vi.mock("frappe-ui", () => ({
	toast: { error: vi.fn() },
}));

function createSfuClient({ connected = true, e2ee = false } = {}) {
	return {
		isConnected: vi.fn(() => connected),
		isE2EERequired: vi.fn(() => e2ee),
		sendRequest: vi.fn().mockResolvedValue(undefined),
		on: vi.fn(),
		off: vi.fn(),
	};
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

const mountedApps: ReturnType<typeof createApp>[] = [];

function mountCaptions(
	sfuClient: ReturnType<typeof createSfuClient>,
	initiallyEnabled = false,
) {
	let captions!: ReturnType<typeof useCaptions>;
	const app = createApp({
		setup() {
			captions = useCaptions({ sfuClient: sfuClient as never });
			return () => null;
		},
	});
	app.mount(document.createElement("div"));
	mountedApps.push(app);
	captions.isCaptionsEnabled.value = initiallyEnabled;
	return captions;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
	for (const app of mountedApps.splice(0)) app.unmount();
	vi.restoreAllMocks();
});

describe("restoreCaptionSubscription", () => {
	it("restores an enabled caption subscription", async () => {
		const sfuClient = createSfuClient();
		const captions = mountCaptions(sfuClient, true);

		const restored = await captions.restoreCaptionSubscription();

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
		const captions = mountCaptions(sfuClient, enabled);
		sfuClient.sendRequest.mockClear();

		const restored = await captions.restoreCaptionSubscription();

		expect(sfuClient.sendRequest).not.toHaveBeenCalled();
		expect(restored).toBe(false);
	});

	it("reports a failed restoration", async () => {
		const sfuClient = createSfuClient();
		sfuClient.sendRequest.mockRejectedValue(new Error("request failed"));
		vi.spyOn(console, "error").mockImplementation(() => {});
		const captions = mountCaptions(sfuClient, true);

		const restored = await captions.restoreCaptionSubscription();

		expect(restored).toBe(false);
		expect(captions.isCaptionsEnabled.value).toBe(false);
	});

	it("preserves the local preference when the result is ambiguous", async () => {
		const sfuClient = createSfuClient();
		sfuClient.sendRequest.mockRejectedValue(
			new SFURequestError("TIMEOUT", "request timed out"),
		);
		vi.spyOn(console, "error").mockImplementation(() => {});
		const captions = mountCaptions(sfuClient, true);

		const shouldRemainEnabled = await captions.restoreCaptionSubscription();

		expect(shouldRemainEnabled).toBe(true);
		expect(captions.isCaptionsEnabled.value).toBe(true);
	});

	it("does not apply a stale restore after E2EE disables captions", async () => {
		const pendingRestore = deferred();
		const sfuClient = createSfuClient();
		sfuClient.sendRequest
			.mockReturnValueOnce(pendingRestore.promise)
			.mockResolvedValueOnce(undefined);
		const captions = mountCaptions(sfuClient, true);

		const restore = captions.restoreCaptionSubscription();
		captions.disableCaptionsForE2EE();
		pendingRestore.resolve();
		await restore;

		expect(captions.isAvailable.value).toBe(false);
		expect(captions.isCaptionsEnabled.value).toBe(false);
	});
});

describe("useCaptions", () => {
	it("maintains bounded caption lines from valid STT segments", () => {
		const sfuClient = createSfuClient();
		const captions = mountCaptions(sfuClient);
		const handleSegment = sfuClient.on.mock.calls.find(
			([event]) => event === "stt:segment",
		)?.[1] as (payload: unknown) => void;
		const segment = (
			participantId: string,
			text: string,
			isFinal = false,
		) =>
			handleSegment({
				segment: { participantId, text, isFinal, timestamp: "2026-09-19T00:00:00Z" },
			});

		handleSegment({ segment: { participantId: "speaker-1", text: 42 } });
		expect(captions.captionLines.value).toEqual([]);

		segment("speaker-1", "draft");
		segment("speaker-2", "other draft");
		segment("speaker-1", "replacement");
		expect(
			captions.captionLines.value.map(({ participantId, text }) => [
				participantId,
				text,
			]),
		).toEqual([
			["speaker-1", "replacement"],
			["speaker-2", "other draft"],
		]);
		segment("speaker-1", "final", true);
		segment("speaker-2", "", true);
		expect(captions.captionLines.value).toEqual([
			expect.objectContaining({
				participantId: "speaker-1",
				text: "final",
				isFinal: true,
			}),
		]);

		for (let index = 0; index <= 50; index++) {
			segment(`speaker-${index + 10}`, `line-${index}`, true);
		}
		expect(captions.captionLines.value).toHaveLength(50);
		expect(captions.captionLines.value[0]?.text).toBe("line-1");
		expect(captions.captionLines.value.at(-1)?.text).toBe("line-50");
	});

	it("handles a toggle arriving as the previous request completes", async () => {
		const firstRequest = deferred();
		const sfuClient = createSfuClient();
		sfuClient.sendRequest
			.mockReturnValueOnce(firstRequest.promise)
			.mockResolvedValueOnce(undefined);
		const captions = mountCaptions(sfuClient);

		const enabling = captions.toggleCaptions();
		const boundaryToggle = firstRequest.promise.then(() =>
			captions.toggleCaptions(),
		);
		firstRequest.resolve();
		await Promise.all([enabling, boundaryToggle]);

		expect(sfuClient.sendRequest.mock.calls).toEqual([
			["stt:toggle", { enabled: true }],
			["stt:toggle", { enabled: false }],
		]);
		expect(captions.isCaptionsEnabled.value).toBe(false);
	});

	it.each([
		["enabling", false],
		["disabling", true],
	] as const)(
		"keeps captions visibly enabled when %s ends ambiguously",
		async (_operation, initiallyEnabled) => {
			const sfuClient = createSfuClient();
			sfuClient.sendRequest.mockRejectedValue(
				new SFURequestError("TIMEOUT", "ambiguous request"),
			);
			vi.spyOn(console, "error").mockImplementation(() => {});
			const captions = mountCaptions(sfuClient, initiallyEnabled);

			await captions.toggleCaptions();

			expect(captions.isCaptionsEnabled.value).toBe(true);
			expect(toast.error).not.toHaveBeenCalled();
		},
	);

	it("shows one error for a confirmed failure", async () => {
		const sfuClient = createSfuClient();
		sfuClient.sendRequest.mockRejectedValue(
			new SFUResponseError("captions unavailable", "STT_UNAVAILABLE"),
		);
		const captions = mountCaptions(sfuClient);

		await captions.toggleCaptions();

		expect(captions.isCaptionsEnabled.value).toBe(false);
		expect(toast.error).toHaveBeenCalledOnce();
		expect(toast.error).toHaveBeenCalledWith("Failed to enable captions");
	});

	it("handles and deduplicates E2EE cleanup rejection", async () => {
		const error = new SFURequestError("DISCONNECTED", "connection lost");
		const sfuClient = createSfuClient();
		sfuClient.sendRequest.mockRejectedValue(error);
		vi.spyOn(console, "error").mockImplementation(() => {});
		const captions = mountCaptions(sfuClient, true);

		document.dispatchEvent(new CustomEvent("meet:e2ee-host-enabled"));
		captions.disableCaptionsForE2EE();
		await Promise.resolve();

		expect(sfuClient.sendRequest).toHaveBeenCalledOnce();
		expect(captions.isAvailable.value).toBe(false);
		expect(captions.isCaptionsEnabled.value).toBe(false);
		expect(console.error).toHaveBeenCalledWith(
			"Failed to clean up captions for E2EE:",
			error,
		);
	});
});
