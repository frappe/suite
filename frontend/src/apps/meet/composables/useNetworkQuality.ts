import { inject, onMounted, onUnmounted, type Ref, ref } from "vue";
import type { SFUMeetingManager } from "../utils/SFUMeetingManager";
import {
	MediaHealthMonitor,
	type NetworkQuality,
} from "../utils/media/MediaHealthMonitor";

export type { NetworkQuality };

export function useNetworkQuality(
	sfuManagerRef = inject<Ref<SFUMeetingManager | null>>("sfuManager"),
) {
	const networkQuality = ref<NetworkQuality>("good");
	const downlinkQuality = ref<NetworkQuality>("good");
	const isTransportFailed = ref(false);
	const monitor = new MediaHealthMonitor(() => sfuManagerRef?.value ?? null);
	let unsubscribe: (() => void) | null = null;

	onMounted(() => {
		unsubscribe = monitor.subscribe((state) => {
			networkQuality.value = state.networkQuality;
			downlinkQuality.value = state.downlinkQuality;
			isTransportFailed.value = state.isTransportFailed;
		});
		monitor.start();
	});

	onUnmounted(() => {
		unsubscribe?.();
		unsubscribe = null;
		monitor.stop();
	});

	return { networkQuality, downlinkQuality, isTransportFailed };
}
