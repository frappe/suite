import { inject, onMounted, onUnmounted, type Ref, ref, watch } from "vue";
import type { SFUMeetingManager } from "../utils/SFUMeetingManager";
import type { NetworkQuality } from "../utils/media/MediaHealthMonitor";

export type { NetworkQuality };

export function useNetworkQuality(
	sfuManagerRef = inject<Ref<SFUMeetingManager | null>>("sfuManager"),
) {
	const networkQuality = ref<NetworkQuality>("good");
	const downlinkQuality = ref<NetworkQuality>("good");
	const isTransportFailed = ref(false);
	let stopWatching: (() => void) | null = null;
	let stopMonitoring: (() => void) | null = null;
	let managerGeneration = 0;
	const reset = () => {
		networkQuality.value = "good";
		downlinkQuality.value = "good";
		isTransportFailed.value = false;
	};
	const stopCurrentMonitoring = () => {
		const stop = stopMonitoring;
		stopMonitoring = null;
		try {
			stop?.();
		} catch (error) {
			console.warn("Failed to stop media health monitoring", error);
		}
	};

	onMounted(() => {
		if (!sfuManagerRef) return;
		stopWatching = watch(
			sfuManagerRef,
			(manager) => {
				const generation = ++managerGeneration;
				stopCurrentMonitoring();
				reset();
				stopMonitoring =
					manager?.startMediaHealthMonitoring((state) => {
						if (
							generation !== managerGeneration ||
							sfuManagerRef.value !== manager
						) return;
						networkQuality.value = state.networkQuality;
						downlinkQuality.value = state.downlinkQuality;
						isTransportFailed.value = state.isTransportFailed;
					}) ?? null;
			},
			{ immediate: true },
		);
	});

	onUnmounted(() => {
		managerGeneration += 1;
		stopWatching?.();
		stopWatching = null;
		stopCurrentMonitoring();
		reset();
	});

	return { networkQuality, downlinkQuality, isTransportFailed };
}
