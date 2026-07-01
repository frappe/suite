import { inject, onMounted, onUnmounted, type Ref, ref } from "vue";
import type { SFUMeetingManager } from "../utils/SFUMeetingManager";
import type { CurrentUser } from "./useCurrentUser";
import type { MediaState } from "./useMediaState";

export function useAudioStream(
	participantId: string,
	deps: {
		mediaState: MediaState;
		currentUser: CurrentUser;
	},
) {
	const stream = ref<MediaStream | null>(null);
	const { mediaState, currentUser } = deps;
	const sfuManagerRef = inject<Ref<SFUMeetingManager | null>>("sfuManager");

	const getStream = () => {
		try {
			const sfuManager = sfuManagerRef?.value;

			if (participantId === currentUser.currentUser.value?.user_id) {
				const audioTrack = mediaState.localStream?.getAudioTracks()[0];
				if (audioTrack) {
					stream.value = new MediaStream([audioTrack]);
				}
			} else if (sfuManager?.consumerManager) {
				const audioConsumer =
					sfuManager.consumerManager.getAudioConsumer(participantId);
				if (audioConsumer?.track) {
					stream.value = new MediaStream([audioConsumer.track]);
				}
			}
		} catch (error) {
			console.error("Error getting audio stream:", error);
		}
	};

	onMounted(() => {
		getStream();
		const interval = setInterval(getStream, 1000);
		onUnmounted(() => clearInterval(interval));
	});

	return { stream };
}
