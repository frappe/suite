import {
	computed,
	inject,
	onMounted,
	onUnmounted,
	type Ref,
	ref,
	watch,
} from "vue";
import type { SFUMeetingManager } from "../utils/SFUMeetingManager";
import type {
	MediaHealthState,
	NetworkQuality,
} from "../utils/media/MediaHealthMonitor";

export type { NetworkQuality };

export function useNetworkQuality(
	sfuManagerRef = inject<Ref<SFUMeetingManager | null>>("sfuManager"),
) {
	const initialHealth = (): MediaHealthState => ({
		networkQuality: "unknown",
		downlinkQuality: "unknown",
		isTransportFailed: false,
		status: "checking",
		issue: null,
	});
	const health = ref<MediaHealthState>(initialHealth());
	let stopWatching: (() => void) | null = null;
	let stopMonitoring: (() => void) | null = null;
	let managerGeneration = 0;
	const reset = () => {
		health.value = initialHealth();
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
						)
							return;
						health.value = { ...state };
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

	return {
		health,
		networkQuality: computed(() => health.value.networkQuality),
		downlinkQuality: computed(() => health.value.downlinkQuality),
		isTransportFailed: computed(() => health.value.isTransportFailed),
		status: computed(() => health.value.status),
		issue: computed(() => health.value.issue),
	};
}
