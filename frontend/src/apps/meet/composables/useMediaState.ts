import { defineStore } from "pinia";

interface ScreenShareBase {
	participantId: string;
	consumerId: string;
	startedAt: number;
}

export interface RemoteScreenShare extends ScreenShareBase {
	source: "remote";
	producerId: string;
}

interface LocalScreenShare extends ScreenShareBase {
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

export const useMediaState = defineStore("meet-media", {
	state: () => ({
		isMicOn: false,
		isCameraOn: false,
		isScreenSharing: false,
		localStream: null as MediaStream | null,
		processedStream: null as MediaStream | null,
		cameraPermissionGranted: false,
		microphonePermissionGranted: false,
		screenShareStream: null as MediaStream | null,
		localScreenShareStartedAt: 0,
		activeScreenShareConsumers: [] as RemoteScreenShare[],
		screenShareStreams: {} as Record<string, MediaStream>,
		localVideo: null as HTMLElement | null,
	}),
	actions: {
		setMedia(mic: boolean, camera: boolean) {
			this.isMicOn = mic;
			this.isCameraOn = camera;
		},
	},
});

export type MediaState = ReturnType<typeof useMediaState>;
