import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type Ref, ref } from "vue";
import type { SFUMeetingManager } from "../../utils/SFUMeetingManager";
import type { MediaHealthState } from "../../utils/media/MediaHealthMonitor";
import { useNetworkQuality } from "../useNetworkQuality";

describe("useNetworkQuality", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("mirrors manager-owned health state and stops it on unmount", () => {
		const stopMonitoring = vi.fn();
		const startMediaHealthMonitoring = vi.fn(
			(listener: (state: MediaHealthState) => void) => {
				listener({
					networkQuality: "critical",
					downlinkQuality: "poor",
					isTransportFailed: true,
				});
				return stopMonitoring;
			},
		);
		const manager = ref({
			startMediaHealthMonitoring,
		}) as unknown as Ref<SFUMeetingManager | null>;
		let quality: ReturnType<typeof useNetworkQuality> | undefined;
		const app = createApp({
			setup() {
				quality = useNetworkQuality(manager);
				return () => null;
			},
		});
		app.mount(document.createElement("div"));

		expect(quality?.networkQuality.value).toBe("critical");
		expect(quality?.downlinkQuality.value).toBe("poor");
		expect(quality?.isTransportFailed.value).toBe(true);
		expect(startMediaHealthMonitoring).toHaveBeenCalledOnce();

		app.unmount();
		expect(stopMonitoring).toHaveBeenCalledOnce();
	});

	it("stops the old monitor and resets state when the manager is removed", async () => {
		let listener!: (state: MediaHealthState) => void;
		const stopMonitoring = vi.fn();
		const manager = ref({
			startMediaHealthMonitoring: vi.fn((nextListener) => {
				listener = nextListener;
				return stopMonitoring;
			}),
		}) as unknown as Ref<SFUMeetingManager | null>;
		let quality!: ReturnType<typeof useNetworkQuality>;
		const app = createApp({
			setup() {
				quality = useNetworkQuality(manager);
				return () => null;
			},
		});
		app.mount(document.createElement("div"));
		listener({
			networkQuality: "critical",
			downlinkQuality: "poor",
			isTransportFailed: true,
		});

		manager.value = null;
		await nextTick();

		expect(stopMonitoring).toHaveBeenCalledOnce();
		expect(quality.networkQuality.value).toBe("good");
		expect(quality.downlinkQuality.value).toBe("good");
		expect(quality.isTransportFailed.value).toBe(false);
		app.unmount();
	});

	it("ignores the old listener and starts monitoring a replacement manager", async () => {
		let oldListener!: (state: MediaHealthState) => void;
		let nextListener!: (state: MediaHealthState) => void;
		const stopOld = vi.fn();
		const stopNext = vi.fn();
		const first = {
			startMediaHealthMonitoring: vi.fn((listener) => {
				oldListener = listener;
				return stopOld;
			}),
		};
		const second = {
			startMediaHealthMonitoring: vi.fn((listener) => {
				nextListener = listener;
				return stopNext;
			}),
		};
		const manager = ref(first) as unknown as Ref<SFUMeetingManager | null>;
		let quality!: ReturnType<typeof useNetworkQuality>;
		const app = createApp({
			setup() {
				quality = useNetworkQuality(manager);
				return () => null;
			},
		});
		app.mount(document.createElement("div"));

		manager.value = second as never;
		await nextTick();
		oldListener({
			networkQuality: "critical",
			downlinkQuality: "critical",
			isTransportFailed: true,
		});
		nextListener({
			networkQuality: "poor",
			downlinkQuality: "good",
			isTransportFailed: false,
		});

		expect(stopOld).toHaveBeenCalledOnce();
		expect(second.startMediaHealthMonitoring).toHaveBeenCalledOnce();
		expect(quality.networkQuality.value).toBe("poor");
		expect(quality.downlinkQuality.value).toBe("good");
		expect(quality.isTransportFailed.value).toBe(false);
		app.unmount();
		expect(stopNext).toHaveBeenCalledOnce();
	});
});
