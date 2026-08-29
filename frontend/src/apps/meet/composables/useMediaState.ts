import { defineStore } from "pinia";
import { ref } from "vue";

interface ScreenShareBase {
	participantId: string;
	consumerId: string;
	startedAt: number;
}

export interface RemoteScreenShare extends ScreenShareBase {
	source: "remote";
	producerId: string;
}

export interface LocalScreenShare extends ScreenShareBase {
	source: "local";
}

export type DisplayScreenShare = RemoteScreenShare | LocalScreenShare;

export function findActiveScreenShare(
	shares: RemoteScreenShare[],
	participantId: string,
	producerId: string,
	consumerId?: string,
): RemoteScreenShare | null {
	const current = shares.find((share) => share.participantId === participantId);
	return current?.producerId === producerId &&
		(!consumerId || current.consumerId === consumerId)
		? current
		: null;
}

export function replaceActiveScreenShare(
	shares: RemoteScreenShare[],
	next: RemoteScreenShare,
): { shares: RemoteScreenShare[]; replaced: RemoteScreenShare[] } {
	const replaced = shares.filter(
		(share) =>
			share.participantId === next.participantId &&
			share.consumerId !== next.consumerId,
	);
	return {
		shares: [
			...shares.filter((share) => share.participantId !== next.participantId),
			next,
		],
		replaced,
	};
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
	activeScreenShareConsumers: RemoteScreenShare[];
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
	const activeScreenShareConsumers = ref<RemoteScreenShare[]>([]);
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
		activeScreenShareConsumers,
		screenShareStreams,
		localVideo,
		setMedia,
		$reset,
	};
});
