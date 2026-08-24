import { defineStore } from "pinia";
import { ref } from "vue";

export interface ScreenShareConsumer {
	participantId: string;
	consumerId: string;
	producerId?: string;
	startedAt: number;
	local?: boolean;
}

export interface MediaState {
	isMicOn: boolean;
	isCameraOn: boolean;
	isScreenSharing: boolean;
	localStream: MediaStream | null;
	processedStream: MediaStream | null;
	cameraPermissionGranted: boolean;
	microphonePermissionGranted: boolean;
	screenShareStream: MediaStream | null;
	localScreenShareStartedAt: number;
	localScreenShareProducerId: string | null;
	activeScreenShareConsumers: ScreenShareConsumer[];
	screenShareStreams: Record<string, MediaStream>;
	localVideo: HTMLElement | null;
	setMedia: (mic: boolean, camera: boolean) => void;
	$reset: () => void;
}

export const useMediaState = defineStore("meet-media", () => {
	const isMicOn = ref(false);
	const isCameraOn = ref(false);
	const isScreenSharing = ref(false);
	const localStream = ref<MediaStream | null>(null);
	const processedStream = ref<MediaStream | null>(null);
	const cameraPermissionGranted = ref(false);
	const microphonePermissionGranted = ref(false);
	const screenShareStream = ref<MediaStream | null>(null);
	const localScreenShareStartedAt = ref(0);
	const localScreenShareProducerId = ref<string | null>(null);
	const activeScreenShareConsumers = ref<ScreenShareConsumer[]>([]);
	const screenShareStreams = ref<Record<string, MediaStream>>({});
	const localVideo = ref<HTMLElement | null>(null);

	function setMedia(mic: boolean, camera: boolean) {
		isMicOn.value = mic;
		isCameraOn.value = camera;
	}

	function $reset() {
		isMicOn.value = false;
		isCameraOn.value = false;
		isScreenSharing.value = false;
		localStream.value = null;
		processedStream.value = null;
		cameraPermissionGranted.value = false;
		microphonePermissionGranted.value = false;
		screenShareStream.value = null;
		localScreenShareStartedAt.value = 0;
		localScreenShareProducerId.value = null;
		activeScreenShareConsumers.value = [];
		screenShareStreams.value = {};
		localVideo.value = null;
	}

	return {
		isMicOn,
		isCameraOn,
		isScreenSharing,
		localStream,
		processedStream,
		cameraPermissionGranted,
		microphonePermissionGranted,
		screenShareStream,
		localScreenShareStartedAt,
		localScreenShareProducerId,
		activeScreenShareConsumers,
		screenShareStreams,
		localVideo,
		setMedia,
		$reset,
	};
});
