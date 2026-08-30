import { dialog, toast } from "frappe-ui";
import { onUnmounted, type Ref, ref, watch } from "vue";
import { autoFramingPaused } from "../data/backgroundEffects";
import {
	cameraEnabled as prefCameraEnabled,
	micEnabled as prefMicEnabled,
	noiseCancellationEnabled as prefNoiseCancellationEnabled,
	selectedCameraId,
	selectedMicId,
	selectedSpeakerId,
	setCameraEnabled,
	setMicEnabled,
	setSelectedCameraId,
	setSelectedMicId,
	setSelectedSpeakerId,
} from "../data/mediaPreferences";
import type { DeviceType, deviceManager } from "../utils/media/DeviceManager";
import notificationContextManager from "../utils/notificationContext";
import { isMobileDevice } from "../utils/device";
import type { SFUClient } from "../utils/SFUClient";
import type { SFUMeetingManager } from "../utils/SFUMeetingManager";
import type { ConnectionState } from "./useConnectionState";
import type { CurrentUser } from "./useCurrentUser";
import type { MediaState } from "./useMediaState";
import type { RaiseHandStore } from "./useRaiseHandStore";
import type { BackgroundEffectOptions } from "./useBackgroundEffects";

const BLUETOOTH_DEVICE_LABEL_REGEX =
	/airpods|bluetooth|\bbt\b|wireless|jbl|bose|sony|beats|sennheiser|akg|jabra|anker|skullcandy|shure|bang\s*&\s*olufsen|b\s*&\s*o|marley|skullcandy|logitech\s*bt|plantronics|poly|razer\s*(?:bt|opus)|corsair|steelseries|hyperx|audeze|sennheiser|soundcore|tozo|earfun|earbuds|earbud/i;

const isBluetoothMicLabel = (label: string | undefined): boolean => {
	if (!label) return false;
	return BLUETOOTH_DEVICE_LABEL_REGEX.test(label.toLowerCase());
};

function getCameraVideoConstraints(): MediaTrackConstraints {
	if (isMobileDevice()) {
		return {
			width: { ideal: 640 },
			height: { ideal: 360 },
			frameRate: { ideal: 24, max: 24 },
		};
	}

	return {
		width: { ideal: 1280, min: 960 },
		height: { ideal: 720, min: 540 },
		frameRate: { ideal: 30, max: 30 },
	};
}

function getBackgroundEffectsFromStorage() {
	const blurEnabled = localStorage.getItem("backgroundEffects.blur") === "1";
	const imageEnabled = localStorage.getItem("backgroundEffects.image") === "1";
	const autoFramingEnabled =
		localStorage.getItem("backgroundEffects.autoFraming") === "1";
	const selectedImage =
		localStorage.getItem("backgroundEffects.imageName") || "";
	const blurIntensity = Number.parseInt(
		localStorage.getItem("backgroundEffects.blurIntensity") || "12",
		10,
	);
	const anyEnabled = blurEnabled || imageEnabled || autoFramingEnabled;

	return {
		blurEnabled,
		imageEnabled,
		selectedImage,
		blurIntensity,
		autoFramingEnabled,
		autoFramingPaused: autoFramingPaused.value,
		anyEnabled,
	};
}

interface BackgroundEffectsAPI {
	applyBackgroundEffects: (
		stream: MediaStream,
		options: BackgroundEffectOptions,
		signal?: AbortSignal,
	) => Promise<{
		stream: MediaStream;
		cleanup: () => void;
		updateOptions: (opts: BackgroundEffectOptions) => Promise<void>;
	}>;
	stopProcessing: () => void;
	dispose: () => Promise<void>;
	processedStream: Ref<MediaStream | null>;
}

interface NoiseCancellationAPI {
	applyNoiseCancellation: (
		stream: MediaStream,
	) => Promise<{ stream: MediaStream; cleanup: () => void }>;
	isProcessing: Ref<boolean>;
	error: Ref<string | null>;
}

type ToastAPI = Pick<typeof toast, "success" | "error" | "warning" | "create">;

interface MediaPreferencesAPI {
	micEnabled: Ref<boolean>;
	cameraEnabled: Ref<boolean>;
	selectedCameraId: Ref<string>;
	selectedMicId: Ref<string>;
	selectedSpeakerId: Ref<string>;
	pushToTalkEnabled: Ref<boolean>;
	noiseCancellationEnabled: Ref<boolean>;
	setMicEnabled: (v: boolean) => void;
	setCameraEnabled: (v: boolean) => void;
	setSelectedCameraId: (v: string) => void;
	setSelectedMicId: (v: string) => void;
	setSelectedSpeakerId: (v: string) => void;
}

interface MediaControlsDeps {
	mediaState: MediaState;
	connectionState: ConnectionState;
	raiseHandStore: RaiseHandStore;
	currentUser: CurrentUser;
	sfuClient: SFUClient;
	sfuManager: Ref<SFUMeetingManager | null>;
	deviceManager: typeof deviceManager;
	backgroundEffects: BackgroundEffectsAPI;
	noiseCancellation: NoiseCancellationAPI;
	toast: ToastAPI;
	mediaPreferences: MediaPreferencesAPI;
}

interface MediaControlsAPI {
	initializeCamera: () => Promise<void>;
	acquireUserMedia: (
		videoEnabled: boolean,
		audioEnabled: boolean,
		deviceOverrides?: MediaDeviceOverrides,
	) => Promise<{ stream: MediaStream; constraints: MediaStreamConstraints }>;
	toggleMicrophone: () => Promise<void>;
	toggleCamera: () => Promise<void>;
	toggleScreenShare: () => Promise<void>;
	switchInputDevice: (type: DeviceType, deviceId: string) => Promise<void>;
	applySpeakerDevice: () => Promise<void>;
	applyBackgroundEffectsToLocalStream: () => Promise<void>;
	republishMediaAfterE2EE: (detail?: E2EEMediaRepublishDetail) => Promise<void>;
	setLocalVideoRef: (el: HTMLVideoElement | null) => void;
	setRemoteVideoRef: (participantId: string, el: HTMLVideoElement) => void;
	setScreenShareVideoRef: (el: HTMLVideoElement) => void;
	processedStream: MediaStream | null;
}

type ScreenShareStopReason =
	| "user-click"
	| "track-ended"
	| "publish-failed"
	| "cleanup";

interface MediaDeviceOverrides {
	cameraDeviceId?: string;
	micDeviceId?: string;
}

interface CameraOperation {
	generation: number;
	signal: AbortSignal;
	ownedStreams: Set<MediaStream>;
}

export interface E2EEMediaRepublishDetail {
	needsCamera?: boolean;
	needsMicrophone?: boolean;
}

interface ReacquiredMediaOptions {
	acquiredStream: MediaStream;
	currentStream: MediaStream | null;
	requestedCamera: boolean;
	requestedMicrophone: boolean;
	cameraEnabled: boolean;
	microphoneEnabled: boolean;
	cameraTrackBeforeRequest: MediaStreamTrack | null;
	microphoneTrackBeforeRequest: MediaStreamTrack | null;
}

export function mergeReacquiredMedia({
	acquiredStream,
	currentStream,
	requestedCamera,
	requestedMicrophone,
	cameraEnabled,
	microphoneEnabled,
	cameraTrackBeforeRequest,
	microphoneTrackBeforeRequest,
}: ReacquiredMediaOptions): {
	stream: MediaStream;
	adoptedCamera: boolean;
	adoptedMicrophone: boolean;
} {
	const stream = currentStream ?? new MediaStream();
	const adoptedTracks = new Set<MediaStreamTrack>();
	const currentLiveTracks = new Set(
		stream.getTracks().filter((track) => track.readyState === "live"),
	);
	const stoppedTracks = new Set<MediaStreamTrack>();
	const stopTrack = (track: MediaStreamTrack) => {
		if (stoppedTracks.has(track)) return;
		stoppedTracks.add(track);
		track.stop();
	};
	const adoptKind = (
		kind: "audio" | "video",
		requested: boolean,
		enabled: boolean,
		trackBeforeRequest: MediaStreamTrack | null,
	) => {
		const acquiredTracks =
			kind === "video"
				? acquiredStream.getVideoTracks()
				: acquiredStream.getAudioTracks();
		const candidate = acquiredTracks.find(
			(track) => track.readyState === "live",
		);
		const existingTracks =
			kind === "video" ? stream.getVideoTracks() : stream.getAudioTracks();
		const currentLiveTrack = existingTracks.find(
			(track) => track.readyState === "live",
		);
		const newerTrackAppeared =
			!!currentLiveTrack && currentLiveTrack !== trackBeforeRequest;
		if (!requested || !enabled || !candidate || newerTrackAppeared) {
			for (const track of existingTracks) {
				if (track.readyState !== "live") {
					stream.removeTrack(track);
					stopTrack(track);
				}
			}
			return false;
		}

		for (const track of existingTracks) {
			stream.removeTrack(track);
			if (track !== candidate) stopTrack(track);
		}
		stream.addTrack(candidate);
		adoptedTracks.add(candidate);
		return true;
	};

	const adoptedCamera = adoptKind(
		"video",
		requestedCamera,
		cameraEnabled,
		cameraTrackBeforeRequest,
	);
	const adoptedMicrophone = adoptKind(
		"audio",
		requestedMicrophone,
		microphoneEnabled,
		microphoneTrackBeforeRequest,
	);
	for (const track of acquiredStream.getTracks()) {
		if (!adoptedTracks.has(track) && !currentLiveTracks.has(track))
			stopTrack(track);
	}

	return { stream, adoptedCamera, adoptedMicrophone };
}

interface ScreenShareStopExtra {
	message?: string;
}

export function useMediaControls(deps: MediaControlsDeps): MediaControlsAPI {
	const {
		mediaState,
		connectionState,
		raiseHandStore,
		currentUser,
		sfuClient,
		sfuManager,
		deviceManager,
		backgroundEffects,
		noiseCancellation,
	} = deps;

	const localVideo = ref<HTMLVideoElement | null>(null);
	const screenShareVideoElements = new Map<string, HTMLVideoElement>();
	const _unmutedByPushToTalk = ref(false);

	let backgroundSession: {
		stream: MediaStream;
		cleanup: () => void;
		updateOptions: (opts: BackgroundEffectOptions) => Promise<void>;
	} | null = null;
	let noiseCancellationSession: {
		stream: MediaStream;
		cleanup: () => void;
	} | null = null;
	let cameraTransitionQueue: Promise<unknown> = Promise.resolve();
	let microphoneTransitionQueue: Promise<unknown> = Promise.resolve();
	let cameraLifecycleGeneration = 0;
	const cameraLifecycleAbortController = new AbortController();
	const lifecycleStoppedTracks = new WeakSet<MediaStreamTrack>();
	const detachedCameraTracks = new Set<MediaStreamTrack>();
	let observedCameraTrack: MediaStreamTrack | null = null;
	let observedMicrophoneTrack: MediaStreamTrack | null = null;
	let cameraEndedListener: (() => void) | null = null;
	let microphoneEndedListener: (() => void) | null = null;

	const cameraLifecycleAbort = () =>
		new DOMException("Camera lifecycle has ended", "AbortError");
	const createCameraOperation = (): CameraOperation => ({
		generation: cameraLifecycleGeneration,
		signal: cameraLifecycleAbortController.signal,
		ownedStreams: new Set(),
	});
	const isCurrentCameraOperation = (operation: CameraOperation) =>
		!operation.signal.aborted &&
		operation.generation === cameraLifecycleGeneration;
	const isCameraLifecycleAbort = (
		error: unknown,
		operation?: CameraOperation,
	) => {
		const abortError = error as { name?: unknown; message?: unknown } | null;
		return (
			abortError?.name === "AbortError" &&
			((operation?.signal ?? cameraLifecycleAbortController.signal).aborted ||
				abortError.message === "Camera lifecycle has ended")
		);
	};
	const assertCurrentCameraGeneration = (generation: number) => {
		if (generation !== cameraLifecycleGeneration) throw cameraLifecycleAbort();
	};
	const stopLifecycleTrack = (track: MediaStreamTrack) => {
		if (lifecycleStoppedTracks.has(track)) return;
		lifecycleStoppedTracks.add(track);
		track.stop();
	};
	const stopLifecycleStream = (stream: MediaStream) => {
		for (const track of stream.getTracks()) stopLifecycleTrack(track);
	};
	const assertCurrentCameraOperation = (operation?: CameraOperation) => {
		if (operation && !isCurrentCameraOperation(operation)) {
			throw cameraLifecycleAbort();
		}
	};
	const ownCameraStream = (operation: CameraOperation, stream: MediaStream) => {
		operation.ownedStreams.add(stream);
		if (!isCurrentCameraOperation(operation)) {
			stopLifecycleStream(stream);
			throw cameraLifecycleAbort();
		}
	};
	const discardCameraOperationStreams = (operation: CameraOperation) => {
		for (const stream of operation.ownedStreams) {
			const tracks = stream.getTracks();
			for (const track of tracks) {
				mediaState.localStream?.removeTrack(track);
				stopLifecycleTrack(track);
			}
		}
		operation.ownedStreams.clear();
	};

	const enqueueCameraTransition = <T>(
		operation: () => Promise<T>,
	): Promise<T> => {
		const result = cameraTransitionQueue.then(async () => {
			try {
				return await operation();
			} finally {
				observeLocalTracks();
			}
		});
		cameraTransitionQueue = result.catch(() => undefined);
		return result;
	};
	const enqueueMicrophoneTransition = <T>(
		operation: () => Promise<T>,
	): Promise<T> => {
		const result = microphoneTransitionQueue.then(async () => {
			try {
				return await operation();
			} finally {
				observeLocalTracks();
			}
		});
		microphoneTransitionQueue = result.catch(() => undefined);
		return result;
	};

	const confirmScreenShareOverride = () =>
		new Promise<boolean>((resolve) => {
			dialog.confirm({
				title: "Start Screen Share Anyway?",
				message:
					"Someone is already sharing their screen. Starting yours may result in multiple active screen shares.",
				onConfirm: () => resolve(true),
				onCancel: () => resolve(false),
			});
		});

	const getScreenShareStopMetadata = (
		reason: ScreenShareStopReason,
		extra: ScreenShareStopExtra = {},
	) => {
		const screenTrack = mediaState.screenShareStream?.getVideoTracks?.()[0];
		return {
			reason,
			source: "screen-share" as const,
			details: {
				trackId: screenTrack?.id,
				trackReadyState: screenTrack?.readyState,
				trackSettings: screenTrack?.getSettings?.(),
				...extra,
			},
		};
	};

	const getEffectiveCameraTrack = (): MediaStreamTrack | null => {
		return (
			mediaState.processedStream
				?.getVideoTracks()
				.find((track) => track.readyState === "live") ??
			mediaState.localStream
				?.getVideoTracks()
				.find((track) => track.readyState === "live") ??
			null
		);
	};

	const reconcileCameraTrack = async (
		track: MediaStreamTrack | null,
		reason: string,
		createProducerIfMissing = true,
		operation?: CameraOperation,
	) => {
		assertCurrentCameraOperation(operation);
		if (track && track.readyState !== "live") {
			throw new Error(`Cannot reconcile ended camera track (${reason})`);
		}

		const manager = sfuManager.value;
		if (!manager) return;
		await manager.serializeSendMediaMutation(async () => {
			assertCurrentCameraOperation(operation);
			if (track && track.readyState !== "live") {
				throw new Error(`Cannot reconcile ended camera track (${reason})`);
			}
			const videoProducer = manager.getLocalProducerState("video");

			if (track) {
				if (videoProducer?.track?.id !== track.id) {
					if (videoProducer) {
						const previousTrack = videoProducer.track;
						assertCurrentCameraOperation(operation);
						await manager.replaceLocalProducerTrack("video", track);
						assertCurrentCameraOperation(operation);
						if (track.readyState !== "live") {
							if (
								previousTrack?.readyState === "live" &&
								previousTrack !== track
							) {
								assertCurrentCameraOperation(operation);
								await manager.replaceLocalProducerTrack(
									"video",
									previousTrack,
								);
							}
							throw new Error(
								`Camera track ended during reconciliation (${reason})`,
							);
						}
					} else if (createProducerIfMissing) {
						assertCurrentCameraOperation(operation);
						await manager.createLocalProducer("video", track);
						if (operation && !isCurrentCameraOperation(operation)) {
							manager.closeLocalProducer("video");
							throw cameraLifecycleAbort();
						}
						if (track.readyState !== "live") {
							manager.closeLocalProducer("video");
							throw new Error(
								`Camera track ended during reconciliation (${reason})`,
							);
						}
					}
				}

				if (localVideo.value) {
					assertCurrentCameraOperation(operation);
					setLocalVideoRef(localVideo.value);
				}
			} else {
				assertCurrentCameraOperation(operation);
				if (videoProducer) manager.closeLocalProducer("video");
			}
			assertCurrentCameraOperation(operation);
			manager.setLocalMediaTrack("video", track);
		});
		assertCurrentCameraOperation(operation);
	};

	const cleanupBackgroundSession = () => {
		try {
			backgroundSession?.cleanup();
		} finally {
			backgroundSession = null;
			if (mediaState.processedStream) {
				try {
					backgroundEffects.stopProcessing();
				} finally {
					mediaState.processedStream = null;
				}
			}
		}
	};

	const turnCameraOffAfterEffectsFailure = async (
		error: unknown,
		operation?: CameraOperation,
	) => {
		await reconcileCameraTrack(
			null,
			"background-publication-failed",
			false,
			operation,
		);
		assertCurrentCameraOperation(operation);
		cleanupBackgroundSession();
		for (const track of mediaState.localStream?.getVideoTracks() ?? []) {
			mediaState.localStream?.removeTrack(track);
			track.stop();
		}
		mediaState.isCameraOn = false;
		setCameraEnabled(false);
		toast.error("Failed to toggle camera");
		throw error;
	};

	const reconcileRawEffectsTrack = async (
		rawTrack: MediaStreamTrack,
		reason: string,
		createProducerIfMissing: boolean,
		recoverPublicationFailure: boolean,
		operation?: CameraOperation,
	) => {
		try {
			await reconcileCameraTrack(
				rawTrack,
				reason,
				createProducerIfMissing,
				operation,
			);
		} catch (error) {
			if (recoverPublicationFailure) {
				await turnCameraOffAfterEffectsFailure(error, operation);
			}
			throw error;
		}
	};

	const applyBackgroundEffects = async ({
		forceRestart = false,
		createProducerIfMissing = true,
		recoverPublicationFailure = false,
		operation,
	}: {
		forceRestart?: boolean;
		createProducerIfMissing?: boolean;
		recoverPublicationFailure?: boolean;
		operation?: CameraOperation;
	} = {}) => {
		assertCurrentCameraOperation(operation);
		const bgEffects = getBackgroundEffectsFromStorage();
		const wantsEffects = bgEffects.anyEnabled;
		const localStream = mediaState.localStream;
		const rawTrack = localStream
			?.getVideoTracks()
			.find((track) => track.readyState === "live");

		if (!localStream || !rawTrack) {
			if (wantsEffects) {
				shouldApplyBackgroundEffectsWhenVideoAvailable = true;
			}
			await reconcileCameraTrack(
				null,
				"background-without-camera",
				createProducerIfMissing,
				operation,
			);
			assertCurrentCameraOperation(operation);
			cleanupBackgroundSession();
			return;
		}

		shouldApplyBackgroundEffectsWhenVideoAvailable = false;
		if (!wantsEffects) {
			await reconcileRawEffectsTrack(
				rawTrack,
				"background-disabled",
				createProducerIfMissing,
				recoverPublicationFailure,
				operation,
			);
			assertCurrentCameraOperation(operation);
			cleanupBackgroundSession();
			return;
		}

		let transformationError: unknown = null;
		try {
			if (backgroundSession && !forceRestart) {
				await backgroundSession.updateOptions({
					blurIntensity: bgEffects.blurIntensity,
					backgroundBlurEnabled: bgEffects.blurEnabled,
					backgroundImageEnabled: bgEffects.imageEnabled,
					autoFramingEnabled: bgEffects.autoFramingEnabled,
					autoFramingPaused: bgEffects.autoFramingPaused,
					selectedBackgroundImage: bgEffects.selectedImage,
				});
				assertCurrentCameraOperation(operation);
			} else {
				if (backgroundSession) {
					await reconcileRawEffectsTrack(
						rawTrack,
						"background-restart",
						createProducerIfMissing,
						recoverPublicationFailure,
						operation,
					);
					assertCurrentCameraOperation(operation);
					cleanupBackgroundSession();
				}
				const result = await backgroundEffects.applyBackgroundEffects(
					localStream,
					{
						blurIntensity: bgEffects.blurIntensity,
						backgroundBlurEnabled: bgEffects.blurEnabled,
						backgroundImageEnabled: bgEffects.imageEnabled,
						autoFramingEnabled: bgEffects.autoFramingEnabled,
						autoFramingPaused: bgEffects.autoFramingPaused,
						selectedBackgroundImage: bgEffects.selectedImage,
					},
					operation?.signal,
				);
				if (operation && !isCurrentCameraOperation(operation)) {
					result.cleanup();
					throw cameraLifecycleAbort();
				}
				if (result.stream === localStream) {
					result.cleanup();
					backgroundSession = null;
					mediaState.processedStream = null;
				} else {
					backgroundSession = result;
					mediaState.processedStream = result.stream;
				}
			}
		} catch (error) {
			if (
				(operation && !isCurrentCameraOperation(operation)) ||
				isCameraLifecycleAbort(error, operation)
			) {
				throw cameraLifecycleAbort();
			}
			transformationError = error;
		}

		if (transformationError) {
			console.warn(
				"Failed to apply background effects to local stream:",
				transformationError,
			);
			await reconcileRawEffectsTrack(
				rawTrack,
				"background-error",
				createProducerIfMissing,
				recoverPublicationFailure,
				operation,
			);
			assertCurrentCameraOperation(operation);
			cleanupBackgroundSession();
			return;
		}

		const effectiveTrack = getEffectiveCameraTrack();
		if (!effectiveTrack || effectiveTrack === rawTrack) {
			await reconcileRawEffectsTrack(
				rawTrack,
				"background-fallback",
				createProducerIfMissing,
				recoverPublicationFailure,
				operation,
			);
			assertCurrentCameraOperation(operation);
			cleanupBackgroundSession();
			return;
		}

		try {
			await reconcileCameraTrack(
				effectiveTrack,
				"background-change",
				createProducerIfMissing,
				operation,
			);
		} catch (error) {
			if (
				(operation && !isCurrentCameraOperation(operation)) ||
				isCameraLifecycleAbort(error, operation)
			) {
				throw cameraLifecycleAbort();
			}
			try {
				await reconcileCameraTrack(
					rawTrack,
					"background-publication-rollback",
					createProducerIfMissing,
					operation,
				);
			} catch (fallbackError) {
				await turnCameraOffAfterEffectsFailure(fallbackError, operation);
			}
			cleanupBackgroundSession();
			if (!recoverPublicationFailure) throw error;
		}
	};

	const applyBackgroundEffectsToLocalStream = () =>
		enqueueCameraTransition(async () => {
			const operation = createCameraOperation();
			try {
				await applyBackgroundEffects({
					createProducerIfMissing: false,
					recoverPublicationFailure: true,
					operation,
				});
			} catch (error) {
				if (
					!isCurrentCameraOperation(operation) ||
					isCameraLifecycleAbort(error, operation)
				) {
					return;
				}
				throw error;
			}
		});

	const republishMediaAfterE2EE = (
		detail: E2EEMediaRepublishDetail = {},
	): Promise<void> =>
		enqueueCameraTransition(async () => {
			const operation = createCameraOperation();
			assertCurrentCameraOperation(operation);
			const requestedCamera =
				detail.needsCamera === true && mediaState.isCameraOn;
			const requestedMicrophone =
				detail.needsMicrophone === true && mediaState.isMicOn;
			if (!requestedCamera && !requestedMicrophone) return;
			const cameraTrackBeforeRequest =
				mediaState.localStream
					?.getVideoTracks()
					.find((track) => track.readyState === "live") ?? null;
			const microphoneTrackBeforeRequest =
				mediaState.localStream
					?.getAudioTracks()
					.find((track) => track.readyState === "live") ?? null;

			try {
				const { stream: acquiredStream } = await acquireUserMedia(
					requestedCamera,
					requestedMicrophone,
					{},
					operation,
				);
				ownCameraStream(operation, acquiredStream);
				assertCurrentCameraOperation(operation);
				const { stream, adoptedCamera, adoptedMicrophone } =
					mergeReacquiredMedia({
						acquiredStream,
						currentStream: mediaState.localStream,
						requestedCamera,
						requestedMicrophone,
						cameraEnabled: mediaState.isCameraOn,
						microphoneEnabled: mediaState.isMicOn,
						cameraTrackBeforeRequest,
						microphoneTrackBeforeRequest,
					});
				operation.ownedStreams.clear();
				const adoptedOperationTracks = acquiredStream
					.getTracks()
					.filter((track) => stream.getTracks().includes(track));
				if (adoptedOperationTracks.length > 0) {
					operation.ownedStreams.add(new MediaStream(adoptedOperationTracks));
				}
				assertCurrentCameraOperation(operation);
				mediaState.localStream = stream;
				if (adoptedCamera) {
					assertCurrentCameraOperation(operation);
					mediaState.cameraPermissionGranted = true;
					await applyBackgroundEffects({
						forceRestart: true,
						createProducerIfMissing: false,
						recoverPublicationFailure: true,
						operation,
					});
					assertCurrentCameraOperation(operation);
				}
				if (adoptedMicrophone) {
					assertCurrentCameraOperation(operation);
					mediaState.microphonePermissionGranted = true;
				}
				if (mediaState.localVideo) {
					assertCurrentCameraOperation(operation);
					setLocalVideoRef(mediaState.localVideo);
				}

				assertCurrentCameraOperation(operation);
				const manager = sfuManager.value;
				if (!manager || (!adoptedCamera && !adoptedMicrophone)) {
					operation.ownedStreams.clear();
					return;
				}
				const videoTrack = adoptedCamera ? getEffectiveCameraTrack() : null;
				const audioTrack = adoptedMicrophone
					? (mediaState.localStream
							?.getAudioTracks()
							.find((track) => track.readyState === "live") ?? null)
					: null;
				await manager.publishMedia(
					new MediaStream([
						...(videoTrack ? [videoTrack] : []),
						...(audioTrack ? [audioTrack] : []),
					]),
					{
						publishVideo: !!videoTrack,
						publishAudio: !!audioTrack,
					},
				);
				assertCurrentCameraOperation(operation);
				operation.ownedStreams.clear();
			} catch (error) {
				if (
					!isCurrentCameraOperation(operation) ||
					isCameraLifecycleAbort(error, operation)
				) {
					discardCameraOperationStreams(operation);
					return;
				}
				throw error;
			}
		});

	const switchSpeaker = async (deviceId: string) => {
		setSelectedSpeakerId(deviceId);
		await applySpeakerDevice();
	};

	const switchMic = async (deviceId: string) => {
		setSelectedMicId(deviceId);
		if (!mediaState.isMicOn || !mediaState.localStream) {
			return;
		}

		const { stream: audioOnlyStream } = await acquireUserMedia(false, true, {
			micDeviceId: deviceId,
		});
		const newAudioTrack = audioOnlyStream.getAudioTracks()[0];
		if (!newAudioTrack) {
			return;
		}

		const currentAudioTracks = mediaState.localStream.getAudioTracks();
		for (const track of currentAudioTracks) {
			mediaState.localStream.removeTrack(track);
			track.stop();
		}
		mediaState.localStream.addTrack(newAudioTrack);

		if (noiseCancellationSession) {
			noiseCancellationSession.cleanup();
			noiseCancellationSession = null;
		}

		const trackToPublish = await getProcessedAudioTrack(mediaState.localStream);
		if (!trackToPublish || trackToPublish.readyState !== "live") {
			return;
		}

		await sfuManager.value?.reconcileLocalProducerTrack(
			"audio",
			trackToPublish,
			{ resume: true },
		);
	};

	const switchCam = async (deviceId: string) => {
		const operation = createCameraOperation();
		assertCurrentCameraOperation(operation);
		if (!mediaState.isCameraOn || !mediaState.localStream) {
			assertCurrentCameraOperation(operation);
			setSelectedCameraId(deviceId);
			return;
		}

		const oldVideoTracks = mediaState.localStream.getVideoTracks();
		let videoOnlyStream: MediaStream;
		try {
			({ stream: videoOnlyStream } = await acquireUserMedia(
				true,
				false,
				{ cameraDeviceId: deviceId },
				operation,
			));
			ownCameraStream(operation, videoOnlyStream);
		} catch (error) {
			if (
				!isCurrentCameraOperation(operation) ||
				isCameraLifecycleAbort(error, operation)
			) {
				discardCameraOperationStreams(operation);
				return;
			}
			throw error;
		}
		const candidateTracks = videoOnlyStream.getVideoTracks();
		const newVideoTrack = candidateTracks.find(
			(track) => track.readyState === "live",
		);
		if (!newVideoTrack) {
			for (const track of candidateTracks) track.stop();
			return;
		}

		assertCurrentCameraOperation(operation);
		for (const track of oldVideoTracks) {
			detachedCameraTracks.add(track);
			mediaState.localStream.removeTrack(track);
		}
		mediaState.localStream.addTrack(newVideoTrack);

		try {
			await applyBackgroundEffects({ forceRestart: true, operation });
			assertCurrentCameraOperation(operation);

			for (const track of oldVideoTracks) {
				track.stop();
				detachedCameraTracks.delete(track);
			}
			assertCurrentCameraOperation(operation);
			setSelectedCameraId(deviceId);
			operation.ownedStreams.clear();
		} catch (error) {
			if (
				!isCurrentCameraOperation(operation) ||
				isCameraLifecycleAbort(error, operation)
			) {
				discardCameraOperationStreams(operation);
				return;
			}
			for (const track of oldVideoTracks) {
				if (track.readyState === "live") {
					mediaState.localStream.addTrack(track);
					detachedCameraTracks.delete(track);
				}
			}
			if (!mediaState.isCameraOn) {
				cleanupBackgroundSession();
				for (const track of [...candidateTracks, ...oldVideoTracks]) {
					mediaState.localStream.removeTrack(track);
					if (track.readyState === "live") track.stop();
				}
				throw error;
			}

			const fallbackTrack = oldVideoTracks.find(
				(track) => track.readyState === "live",
			);
			try {
				if (!fallbackTrack) throw error;
				await reconcileCameraTrack(
					fallbackTrack,
					"camera-switch-rollback",
					true,
					operation,
				);
				assertCurrentCameraOperation(operation);
				cleanupBackgroundSession();
				for (const track of candidateTracks) {
					mediaState.localStream.removeTrack(track);
					track.stop();
				}
				operation.ownedStreams.clear();
			} catch (fallbackError) {
				if (
					!isCurrentCameraOperation(operation) ||
					isCameraLifecycleAbort(fallbackError, operation)
				) {
					discardCameraOperationStreams(operation);
					return;
				}
				await reconcileCameraTrack(
					null,
					"camera-switch-rollback-failed",
					true,
					operation,
				);
				assertCurrentCameraOperation(operation);
				cleanupBackgroundSession();
				for (const track of candidateTracks) {
					mediaState.localStream.removeTrack(track);
					track.stop();
				}
				for (const track of oldVideoTracks) {
					mediaState.localStream.removeTrack(track);
					track.stop();
				}
				assertCurrentCameraOperation(operation);
				mediaState.isCameraOn = false;
				assertCurrentCameraOperation(operation);
				setCameraEnabled(false);
				assertCurrentCameraOperation(operation);
				toast.error("Failed to toggle camera");
				throw fallbackError;
			}
			console.warn("Failed to switch camera, restored raw video:", error);
		}

		assertCurrentCameraOperation(operation);
		if (localVideo.value) {
			delete localVideo.value.dataset.sourceStreamId;
			setLocalVideoRef(localVideo.value);
		}
	};

	const switchInputDevice = async (type: DeviceType, deviceId: string) => {
		try {
			if (type === "speaker") {
				await switchSpeaker(deviceId);
			} else if (type === "microphone") {
				await enqueueMicrophoneTransition(() => switchMic(deviceId));
			} else if (type === "camera") {
				await enqueueCameraTransition(() => switchCam(deviceId));
			}
		} catch (error) {
			if (isCameraLifecycleAbort(error)) return;
			throw error;
		}
	};

	let shouldApplyBackgroundEffectsWhenVideoAvailable = false;

	const getFreshMicTrack = async (operation?: CameraOperation) => {
		try {
			const { stream: freshStream } = await acquireUserMedia(
				false,
				true,
				{ micDeviceId: selectedMicId.value },
				operation,
			);
			assertCurrentCameraOperation(operation);
			const freshTrack = freshStream.getAudioTracks()[0];

			if (!freshTrack) {
				return null;
			}

			if (mediaState.localStream) {
				const oldAudioTracks = mediaState.localStream.getAudioTracks();
				for (const track of oldAudioTracks) {
					mediaState.localStream.removeTrack(track);
					track.stop();
				}
				mediaState.localStream.addTrack(freshTrack);
			}

			return freshTrack;
		} catch (error) {
			if (isCameraLifecycleAbort(error)) return null;
			console.error("[Audio] Failed to get fresh mic track:", error);
			return null;
		}
	};

	const getProcessedAudioTrack = async (
		stream: MediaStream,
		operation?: CameraOperation,
	) => {
		const originalTrack = stream.getAudioTracks()[0];
		if (!originalTrack) {
			return null;
		}

		if (!prefNoiseCancellationEnabled.value) {
			if (noiseCancellationSession) {
				noiseCancellationSession.cleanup();
				noiseCancellationSession = null;
			}

			if (originalTrack.readyState === "ended") {
				return await getFreshMicTrack(operation);
			}

			return originalTrack;
		}

		try {
			const audioStream = new MediaStream([originalTrack]);
			const result =
				await noiseCancellation.applyNoiseCancellation(audioStream);
			if (operation && !isCurrentCameraOperation(operation)) {
				result.cleanup();
				stopLifecycleStream(result.stream);
				throw cameraLifecycleAbort();
			}
			noiseCancellationSession = result;

			const processedTrack = result.stream.getAudioTracks()[0];
			if (processedTrack) {
				return processedTrack;
			}

			console.warn("[Noise Cancellation] No processed track returned");
			return originalTrack;
		} catch (error) {
			if (isCameraLifecycleAbort(error, operation)) throw error;
			console.error("[Noise Cancellation] Failed to apply:", error);
			return originalTrack;
		}
	};

	const getValidDeviceId = async (
		storedDeviceId: string | null,
		deviceType: DeviceType,
		cameraGeneration?: number,
		stagedSelections?: Map<DeviceType, string>,
	) => {
		if (!storedDeviceId) return null;

		try {
			await deviceManager.enumerateDevices();
			if (cameraGeneration !== undefined) {
				assertCurrentCameraGeneration(cameraGeneration);
			}

			if (deviceManager.isDeviceAvailable(storedDeviceId, deviceType)) {
				return storedDeviceId;
			}

			const defaultDevice = deviceManager.getDefaultDevice(deviceType);
			if (defaultDevice) {
				if (stagedSelections) {
					stagedSelections.set(deviceType, defaultDevice.deviceId);
				} else if (deviceType === "camera") {
					setSelectedCameraId(defaultDevice.deviceId);
				} else if (deviceType === "microphone") {
					setSelectedMicId(defaultDevice.deviceId);
				} else if (deviceType === "speaker") {
					setSelectedSpeakerId(defaultDevice.deviceId);
				}

				return defaultDevice.deviceId;
			}

			if (stagedSelections) {
				stagedSelections.set(deviceType, "");
			} else if (deviceType === "camera") {
				setSelectedCameraId("");
			} else if (deviceType === "microphone") {
				setSelectedMicId("");
			} else if (deviceType === "speaker") {
				setSelectedSpeakerId("");
			}
			return null;
		} catch (error) {
			if (isCameraLifecycleAbort(error)) throw error;
			console.warn(
				`Could not validate ${deviceType} device availability:`,
				error,
			);
			return storedDeviceId;
		}
	};

	const buildMediaConstraints = async (
		videoEnabled: boolean,
		audioEnabled: boolean,
		cameraGeneration: number,
		stagedSelections: Map<DeviceType, string>,
	) => {
		const constraints: MediaStreamConstraints = {};

		const audioConstraints = {
			channelCount: { ideal: 2 },
			echoCancellation: true,
			noiseSuppression: true,
			autoGainControl: true,
		};

		if (videoEnabled) {
			const videoConstraints = getCameraVideoConstraints();

			const validCameraId = await getValidDeviceId(
				selectedCameraId.value,
				"camera",
				cameraGeneration,
				stagedSelections,
			);
			if (validCameraId) {
				videoConstraints.deviceId = {
					exact: validCameraId,
				};
			}
			constraints.video = videoConstraints;
		}

		if (audioEnabled) {
			const validMicId = await getValidDeviceId(
				selectedMicId.value,
				"microphone",
				cameraGeneration,
				stagedSelections,
			);
			const selectedMic = validMicId
				? deviceManager.findDeviceById(validMicId, "microphone")
				: undefined;
			if (isBluetoothMicLabel(selectedMic?.label)) {
				audioConstraints.autoGainControl = false;
			}
			const mediaAudioConstraints: MediaTrackConstraints = {
				...audioConstraints,
			};

			if (validMicId) {
				mediaAudioConstraints.deviceId = {
					exact: validMicId,
				};
			}
			constraints.audio = mediaAudioConstraints;
		}

		return constraints;
	};

	const acquireUserMedia = async (
		videoEnabled: boolean,
		audioEnabled: boolean,
		deviceOverrides: MediaDeviceOverrides = {},
		operation: CameraOperation = createCameraOperation(),
	) => {
		const operationGeneration = operation.generation;
		const lifecycleSignal = operation.signal;
		const stagedSelections = new Map<DeviceType, string>();
		const constraints = await buildMediaConstraints(
			videoEnabled,
			audioEnabled,
			operationGeneration,
			stagedSelections,
		);
		assertCurrentCameraOperation(operation);

		if (videoEnabled && Object.hasOwn(deviceOverrides, "cameraDeviceId")) {
			const validCameraId = await getValidDeviceId(
				deviceOverrides.cameraDeviceId ?? null,
				"camera",
				operationGeneration,
				stagedSelections,
			);
			if (validCameraId && typeof constraints.video === "object") {
				constraints.video.deviceId = {
					exact: validCameraId,
				};
			} else if (typeof constraints.video === "object") {
				delete constraints.video.deviceId;
			}
		}

		if (audioEnabled && Object.hasOwn(deviceOverrides, "micDeviceId")) {
			const validMicId = await getValidDeviceId(
				deviceOverrides.micDeviceId ?? null,
				"microphone",
				operationGeneration,
				stagedSelections,
			);
			if (validMicId && typeof constraints.audio === "object") {
				constraints.audio.deviceId = {
					exact: validMicId,
				};
			} else if (typeof constraints.audio === "object") {
				delete constraints.audio.deviceId;
			}
		}

		const requestUserMedia = () => {
			assertCurrentCameraOperation(operation);
			const browserRequest = navigator.mediaDevices.getUserMedia(constraints);
			void browserRequest.then(
				(requestedStream) => {
					if (
						lifecycleSignal.aborted ||
						operationGeneration !== cameraLifecycleGeneration
					) {
						stopLifecycleStream(requestedStream);
					}
				},
				() => {},
			);

			return new Promise<MediaStream>((resolve, reject) => {
				const abort = () => reject(cameraLifecycleAbort());
				lifecycleSignal.addEventListener("abort", abort, { once: true });
				browserRequest.then(
					(requestedStream) => {
						lifecycleSignal.removeEventListener("abort", abort);
						if (
							lifecycleSignal.aborted ||
							operationGeneration !== cameraLifecycleGeneration
						) {
							stopLifecycleStream(requestedStream);
							reject(cameraLifecycleAbort());
							return;
						}
						resolve(requestedStream);
					},
					(error) => {
						lifecycleSignal.removeEventListener("abort", abort);
						if (
							lifecycleSignal.aborted ||
							operationGeneration !== cameraLifecycleGeneration
						) {
							reject(cameraLifecycleAbort());
							return;
						}
						reject(error);
					},
				);
			});
		};

		let stream: MediaStream | null = null;
		try {
			stream = await requestUserMedia();
		} catch (error) {
			if (isCameraLifecycleAbort(error)) throw error;
			const isMissingDeviceError = (candidate: unknown) => {
				const mediaError = candidate as Error & { constraint?: string };
				return (
					mediaError.name === "NotFoundError" ||
					(mediaError.name === "OverconstrainedError" &&
						mediaError.constraint === "deviceId")
				);
			};
			const audioConstraints =
				typeof constraints.audio === "object" ? constraints.audio : null;
			const videoConstraints =
				typeof constraints.video === "object" ? constraints.video : null;
			const audioDeviceId = audioConstraints?.deviceId;
			const videoDeviceId = videoConstraints?.deviceId;

			if (!isMissingDeviceError(error) || (!audioDeviceId && !videoDeviceId)) {
				throw error;
			}

			if (audioDeviceId && videoDeviceId) {
				delete audioConstraints.deviceId;
				try {
					stream = await requestUserMedia();
					stagedSelections.set("microphone", "");
				} catch (audioFallbackError) {
					if (isCameraLifecycleAbort(audioFallbackError)) {
						throw audioFallbackError;
					}
					if (!isMissingDeviceError(audioFallbackError)) {
						throw audioFallbackError;
					}
					audioConstraints.deviceId = audioDeviceId;
					delete videoConstraints.deviceId;
				}

				if (!stream) {
					try {
						stream = await requestUserMedia();
						stagedSelections.set("camera", "");
					} catch (videoFallbackError) {
						if (isCameraLifecycleAbort(videoFallbackError)) {
							throw videoFallbackError;
						}
						if (!isMissingDeviceError(videoFallbackError)) {
							throw videoFallbackError;
						}
						delete audioConstraints.deviceId;
						stagedSelections.set("microphone", "");
						stagedSelections.set("camera", "");
					}
				}
			} else if (audioDeviceId) {
				delete audioConstraints?.deviceId;
				stagedSelections.set("microphone", "");
			} else {
				delete videoConstraints?.deviceId;
				stagedSelections.set("camera", "");
			}

			if (!stream) stream = await requestUserMedia();
		}
		if (!stream) throw new Error("Media request completed without a stream");
		if (!isCurrentCameraOperation(operation)) {
			stopLifecycleStream(stream);
			throw cameraLifecycleAbort();
		}
		for (const [deviceType, deviceId] of stagedSelections) {
			assertCurrentCameraOperation(operation);
			if (deviceType === "camera") setSelectedCameraId(deviceId);
			else if (deviceType === "microphone") setSelectedMicId(deviceId);
			else if (deviceType === "speaker") setSelectedSpeakerId(deviceId);
		}
		return { stream, constraints };
	};

	const signalMediaDisabled = (kind: "audio" | "video") => {
		if (!sfuClient.isConnected()) return;
		try {
			sfuClient.sendMediaControl(kind === "video" ? "video_off" : "mute");
		} catch (_) {
			sfuClient.sendMediaControl({ type: kind, enabled: false });
		}
	};

	const failEndedTrackRecovery = async (kind: "audio" | "video") => {
		if (kind === "video") {
			try {
				const operation = createCameraOperation();
				await reconcileCameraTrack(null, "camera-track-ended", false, operation);
			} catch (error) {
				console.error("Failed to close ended camera publication:", error);
			}
			cleanupBackgroundSession();
			for (const track of mediaState.localStream?.getVideoTracks() ?? []) {
				mediaState.localStream?.removeTrack(track);
				stopLifecycleTrack(track);
			}
			mediaState.isCameraOn = false;
			setCameraEnabled(false);
			toast.error(
				"Camera stopped and could not be restarted. Check browser permissions and devices.",
			);
		} else {
			const manager = sfuManager.value;
			try {
				if (manager) {
					await manager.serializeSendMediaMutation(async () => {
						manager.closeLocalProducer("audio");
						manager.setLocalMediaTrack("audio", null);
					});
				}
			} catch (error) {
				console.error("Failed to close ended microphone publication:", error);
			}
			noiseCancellationSession?.cleanup();
			noiseCancellationSession = null;
			for (const track of mediaState.localStream?.getAudioTracks() ?? []) {
				mediaState.localStream?.removeTrack(track);
				stopLifecycleTrack(track);
			}
			mediaState.isMicOn = false;
			setMicEnabled(false);
			toast.error(
				"Microphone stopped and could not be restarted. Check browser permissions and devices.",
			);
		}
		signalMediaDisabled(kind);
	};

	const recoverEndedCameraTrack = async (endedTrack: MediaStreamTrack) => {
		if (
			cameraLifecycleAbortController.signal.aborted ||
			!mediaState.isCameraOn ||
			!mediaState.localStream?.getVideoTracks().includes(endedTrack)
		) return;
		try {
			await switchCam(selectedCameraId.value);
		} catch (error) {
			if (isCameraLifecycleAbort(error)) return;
			console.error("Failed to recover ended camera track:", error);
			await failEndedTrackRecovery("video");
		}
	};

	const recoverEndedMicrophoneTrack = async (endedTrack: MediaStreamTrack) => {
		if (
			cameraLifecycleAbortController.signal.aborted ||
			!mediaState.isMicOn ||
			!mediaState.localStream?.getAudioTracks().includes(endedTrack)
		) return;
		try {
			const currentStream = mediaState.localStream;
			const operation = createCameraOperation();
			const { stream: acquiredStream } = await acquireUserMedia(
				false,
				true,
				{ micDeviceId: selectedMicId.value },
				operation,
			);
			ownCameraStream(operation, acquiredStream);
			assertCurrentCameraOperation(operation);
			const candidate = acquiredStream
				.getAudioTracks()
				.find((track) => track.readyState === "live");
			if (
				!candidate ||
				!isCurrentCameraOperation(operation) ||
				!mediaState.isMicOn ||
				mediaState.localStream !== currentStream ||
				!currentStream.getAudioTracks().includes(endedTrack)
			) {
				stopLifecycleStream(acquiredStream);
				return;
			}

			for (const track of currentStream.getAudioTracks()) {
				currentStream.removeTrack(track);
			}
			currentStream.addTrack(candidate);
			noiseCancellationSession?.cleanup();
			noiseCancellationSession = null;
			const trackToPublish = await getProcessedAudioTrack(currentStream, operation);
			assertCurrentCameraOperation(operation);
			if (!trackToPublish || trackToPublish.readyState !== "live") {
				throw new Error("No live microphone track available after recovery");
			}

			assertCurrentCameraOperation(operation);
			if (!mediaState.isMicOn || candidate.readyState !== "live") {
				throw new Error("Microphone recovery became stale");
			}
			await sfuManager.value?.reconcileLocalProducerTrack(
				"audio",
				trackToPublish,
				{ resume: true },
			);
			for (const track of acquiredStream.getTracks()) {
				if (track !== candidate) stopLifecycleTrack(track);
			}
			stopLifecycleTrack(endedTrack);
			operation.ownedStreams.clear();
		} catch (error) {
			if (isCameraLifecycleAbort(error)) return;
			console.error("Failed to recover ended microphone track:", error);
			stopLifecycleTrack(endedTrack);
			await failEndedTrackRecovery("audio");
		}
	};

	function observeLocalTracks() {
		const cameraTrack =
			mediaState.localStream
				?.getVideoTracks()
				.find((track) => track.readyState === "live") ?? null;
		if (cameraTrack !== observedCameraTrack) {
			if (observedCameraTrack && cameraEndedListener) {
				observedCameraTrack.removeEventListener("ended", cameraEndedListener);
			}
			observedCameraTrack = cameraTrack;
			cameraEndedListener = cameraTrack
				? () => {
						void enqueueCameraTransition(() =>
							recoverEndedCameraTrack(cameraTrack),
						).catch((error) =>
							console.error("Camera track recovery failed:", error),
						);
					}
				: null;
			if (cameraTrack && cameraEndedListener) {
				cameraTrack.addEventListener("ended", cameraEndedListener);
			}
		}

		const microphoneTrack =
			mediaState.localStream
				?.getAudioTracks()
				.find((track) => track.readyState === "live") ?? null;
		if (microphoneTrack !== observedMicrophoneTrack) {
			if (observedMicrophoneTrack && microphoneEndedListener) {
				observedMicrophoneTrack.removeEventListener(
					"ended",
					microphoneEndedListener,
				);
			}
			observedMicrophoneTrack = microphoneTrack;
			microphoneEndedListener = microphoneTrack
				? () => {
						void enqueueMicrophoneTransition(() =>
							recoverEndedMicrophoneTrack(microphoneTrack),
						).catch((error) =>
							console.error("Microphone track recovery failed:", error),
						);
					}
				: null;
			if (microphoneTrack && microphoneEndedListener) {
				microphoneTrack.addEventListener("ended", microphoneEndedListener);
			}
		}
	}

	const applySpeakerDevice = async () => {
		try {
			const validSpeakerId = await getValidDeviceId(
				selectedSpeakerId.value,
				"speaker",
			);

			if (validSpeakerId && sfuManager.value) {
				await sfuManager.value.setAudioOutputDevice(validSpeakerId);
			}
		} catch (error) {
			console.warn("Failed to apply speaker device:", error);
		}
	};

	const initializeCameraImplementation = async () => {
		const operation = createCameraOperation();
		try {
			assertCurrentCameraOperation(operation);
			mediaState.setMedia(prefMicEnabled.value, prefCameraEnabled.value);

			if (mediaState.isCameraOn || mediaState.isMicOn) {
				const { stream } = await acquireUserMedia(
					mediaState.isCameraOn,
					mediaState.isMicOn,
					{},
					operation,
				);
				ownCameraStream(operation, stream);
				assertCurrentCameraOperation(operation);
				mediaState.localStream = stream;
				assertCurrentCameraOperation(operation);
				if (connectionState.connectionError) {
					connectionState.connectionError = null;
				}
				if (mediaState.isCameraOn) {
					assertCurrentCameraOperation(operation);
					mediaState.cameraPermissionGranted = true;
					await applyBackgroundEffects({
						createProducerIfMissing: false,
						recoverPublicationFailure: true,
						operation,
					});
					assertCurrentCameraOperation(operation);
				}
				if (mediaState.isMicOn) {
					assertCurrentCameraOperation(operation);
					mediaState.microphonePermissionGranted = true;
					if (prefNoiseCancellationEnabled.value) {
						try {
							const rawTrack = stream.getAudioTracks()[0];
							if (rawTrack) {
								const audioStream = new MediaStream([rawTrack]);
								const result =
									await noiseCancellation.applyNoiseCancellation(audioStream);
								assertCurrentCameraOperation(operation);
								noiseCancellationSession = result;
								const processedTrack = result.stream.getAudioTracks()[0];
								if (processedTrack?.readyState === "live") {
									stream.removeTrack(rawTrack);
									stream.addTrack(processedTrack);
								}
							}
						} catch (err) {
							if (!isCurrentCameraOperation(operation)) {
								throw cameraLifecycleAbort();
							}
							console.error("[NC] Failed to apply on initial join:", err);
						}
					}
				}
			}
			operation.ownedStreams.clear();
		} catch (error) {
			if (
				!isCurrentCameraOperation(operation) ||
				isCameraLifecycleAbort(error, operation)
			) {
				discardCameraOperationStreams(operation);
				return;
			}
			console.error("Failed to initialize camera:", error);

			mediaState.setMedia(false, false);
			setMicEnabled(false);
			setCameraEnabled(false);

			const isPermissionError =
				(error as Error).name === "NotAllowedError" ||
				(error as Error).name === "PermissionDeniedError";
			toast.warning(
				isPermissionError
					? "Media access denied. Enable permissions in browser settings."
					: "Media access failed. You can join without media.",
			);
		}
	};

	const initializeCamera = () =>
		enqueueCameraTransition(initializeCameraImplementation);

	const toggleMicrophoneImplementation = async () => {
		try {
			const enable = !mediaState.isMicOn;
			const publicationOwner = enable ? sfuManager.value : null;
			if (enable && !publicationOwner) return;
			let stream = mediaState.localStream;

			if (enable) {
				if (!stream) {
					try {
						const { stream: nextStream } = await acquireUserMedia(
							mediaState.isCameraOn,
							enable,
						);
						stream = nextStream;
						mediaState.localStream = stream;
						mediaState.cameraPermissionGranted = true;
						mediaState.microphonePermissionGranted = true;
					} catch (err) {
						if (isCameraLifecycleAbort(err)) return;
						console.error("Failed to get microphone stream:", err);
						const isPermissionError =
							(err as Error).name === "NotAllowedError" ||
							(err as Error).name === "PermissionDeniedError";
						toast.error(
							isPermissionError
								? "Microphone access denied. Enable in browser settings."
								: "Failed to access microphone",
						);
						return;
					}
				} else {
					const hasAudio = stream.getAudioTracks().length > 0;
					if (!hasAudio) {
						try {
							const { stream: audioOnly } = await acquireUserMedia(false, true);
							const newTrack = audioOnly.getAudioTracks()[0];
							if (newTrack) {
								stream.addTrack(newTrack);
								mediaState.microphonePermissionGranted = true;
							}
						} catch (err) {
							if (isCameraLifecycleAbort(err)) return;
							console.error("Failed to add audio track:", err);
							const isPermissionError =
								(err as Error).name === "NotAllowedError" ||
								(err as Error).name === "PermissionDeniedError";
							toast.error(
								isPermissionError
									? "Microphone access denied. Enable in browser settings."
									: "Could not enable microphone",
							);
							return;
						}
					} else {
						const at = stream.getAudioTracks()[0];
						if (at.readyState === "ended") {
							try {
								const { stream: audioOnly } = await acquireUserMedia(
									false,
									true,
								);
								const newTrack = audioOnly.getAudioTracks()[0];
								if (newTrack) {
									stream.removeTrack(at);
									stream.addTrack(newTrack);
									mediaState.microphonePermissionGranted = true;
								}
							} catch (err) {
								if (isCameraLifecycleAbort(err)) return;
								console.error("Failed to replace audio track:", err);
								const isPermissionError =
									(err as Error).name === "NotAllowedError" ||
									(err as Error).name === "PermissionDeniedError";
								toast.error(
									isPermissionError
										? "Microphone access denied. Enable in browser settings."
										: "Could not enable microphone",
								);
								return;
							}
						} else {
							at.enabled = true;
						}
					}
				}

				const track = await getProcessedAudioTrack(stream);
				if (track) {
					if (sfuManager.value !== publicationOwner) {
						track.enabled = false;
						return;
					}
					track.enabled = true;
					await publicationOwner.reconcileLocalProducerTrack("audio", track, {
						resume: true,
					});
					if (sfuManager.value !== publicationOwner) {
						publicationOwner.closeLocalProducer("audio", {
							reason: "manager-replaced",
						});
						track.enabled = false;
						const rawAudioTracks = stream.getAudioTracks();
						for (const audioTrack of rawAudioTracks) {
							stream.removeTrack(audioTrack);
							audioTrack.stop();
						}
						if (!rawAudioTracks.includes(track)) track.stop();
						if (noiseCancellationSession) {
							noiseCancellationSession.cleanup();
							noiseCancellationSession = null;
						}
						return;
					}
				}
			} else {
				if (stream) {
					const at = stream.getAudioTracks()[0];
					if (at) {
						at.stop();
						stream.removeTrack(at);
					}
				}

				if (noiseCancellationSession) {
					noiseCancellationSession.cleanup();
					noiseCancellationSession = null;
				}

				sfuManager.value?.pauseLocalProducer("audio");
			}

			mediaState.isMicOn = enable;
			setMicEnabled(enable);

			const currentUserId = sfuClient.getUserId();
			if (
				enable &&
				currentUserId &&
				raiseHandStore.raisedHands?.[currentUserId]
			) {
				try {
					await sfuClient.sendRaiseHand(false);
					raiseHandStore.lowerHand(currentUserId);
				} catch (error) {
					console.error("Failed to lower hand on unmute:", error);
				}
			}

			if (sfuClient.isConnected()) {
				try {
					sfuClient.sendMediaControl(enable ? "unmute" : "mute");
				} catch (_) {
					sfuClient.sendMediaControl({ type: "audio", enabled: enable });
				}
			}
		} catch (error) {
			if (isCameraLifecycleAbort(error)) return;
			console.error("Failed to toggle microphone:", error);
			toast.error("Failed to toggle microphone");
		}
	};
	const toggleMicrophone = () =>
		enqueueMicrophoneTransition(toggleMicrophoneImplementation);

	const toggleCameraImplementation = async () => {
		const operation = createCameraOperation();
		assertCurrentCameraOperation(operation);
		const enable = !mediaState.isCameraOn;
		const acquiredVideoTracks: MediaStreamTrack[] = [];
		try {
			let stream = mediaState.localStream;

			if (enable) {
				if (!stream) {
					try {
						const { stream: nextStream } = await acquireUserMedia(
							true,
							mediaState.isMicOn,
							{},
							operation,
						);
						ownCameraStream(operation, nextStream);
						stream = nextStream;
						assertCurrentCameraOperation(operation);
						mediaState.localStream = stream;
						acquiredVideoTracks.push(...stream.getVideoTracks());
						assertCurrentCameraOperation(operation);
						mediaState.cameraPermissionGranted = true;
						if (mediaState.isMicOn) {
							assertCurrentCameraOperation(operation);
							mediaState.microphonePermissionGranted = true;
						}
					} catch (err) {
						if (isCameraLifecycleAbort(err, operation)) throw err;
						console.error("Failed to get camera stream:", err);
						const isPermissionError =
							(err as Error).name === "NotAllowedError" ||
							(err as Error).name === "PermissionDeniedError";
						toast.error(
							isPermissionError
								? "Camera access denied. Enable in browser settings."
								: "Failed to access camera",
						);
						return;
					}
				} else {
					const liveVideoTrack = stream
						.getVideoTracks()
						.find((track) => track.readyState === "live");
					if (!liveVideoTrack) {
						try {
							const { stream: videoOnly } = await acquireUserMedia(
								true,
								false,
								{},
								operation,
							);
							ownCameraStream(operation, videoOnly);
							const newTracks = videoOnly.getVideoTracks();
							const newTrack = newTracks.find(
								(track) => track.readyState === "live",
							);
							if (newTrack) {
								acquiredVideoTracks.push(...newTracks);
								assertCurrentCameraOperation(operation);
								for (const oldTrack of stream.getVideoTracks()) {
									stream.removeTrack(oldTrack);
								}
								stream.addTrack(newTrack);
								assertCurrentCameraOperation(operation);
								mediaState.cameraPermissionGranted = true;
								if (mediaState.localVideo) {
									assertCurrentCameraOperation(operation);
									const localVideoEl =
										mediaState.localVideo as HTMLVideoElement;
									const videoTracks = stream.getVideoTracks();
									if (videoTracks.length > 0) {
										localVideoEl.srcObject = new MediaStream(videoTracks);
									}
								}
							}
						} catch (err) {
							if (isCameraLifecycleAbort(err, operation)) throw err;
							console.error("Failed to add video track:", err);
							const isPermissionError =
								(err as Error).name === "NotAllowedError" ||
								(err as Error).name === "PermissionDeniedError";
							toast.error(
								isPermissionError
									? "Camera access denied. Enable in browser settings."
									: "Could not enable camera",
							);
							return;
						}
					} else {
						assertCurrentCameraOperation(operation);
						liveVideoTrack.enabled = true;
					}
				}

				if (
					!stream.getVideoTracks().some((track) => track.readyState === "live")
				) {
					throw new Error("No live camera track available");
				}

				await applyBackgroundEffects({ operation });
				assertCurrentCameraOperation(operation);
			} else {
				await reconcileCameraTrack(null, "camera-disable", true, operation);
				assertCurrentCameraOperation(operation);
				cleanupBackgroundSession();
				if (stream) {
					for (const track of stream.getVideoTracks()) {
						track.stop();
						stream.removeTrack(track);
					}
				}
			}

			assertCurrentCameraOperation(operation);
			mediaState.isCameraOn = enable;
			assertCurrentCameraOperation(operation);
			setCameraEnabled(enable);

			assertCurrentCameraOperation(operation);
			if (sfuClient.isConnected()) {
				try {
					sfuClient.sendMediaControl(enable ? "video_on" : "video_off");
				} catch (_) {
					sfuClient.sendMediaControl({ type: "video", enabled: enable });
				}
			}
			operation.ownedStreams.clear();
		} catch (error) {
			if (
				!isCurrentCameraOperation(operation) ||
				isCameraLifecycleAbort(error, operation)
			) {
				discardCameraOperationStreams(operation);
				return;
			}
			if (enable) {
				const manager = sfuManager.value;
				if (manager?.getLocalProducerState("video")) {
					try {
						await reconcileCameraTrack(
							null,
							"camera-enable-rollback",
							true,
							operation,
						);
					} catch (rollbackError) {
						if (
							!isCurrentCameraOperation(operation) ||
							isCameraLifecycleAbort(rollbackError, operation)
						) {
							discardCameraOperationStreams(operation);
							return;
						}
						throw rollbackError;
					}
				}
				assertCurrentCameraOperation(operation);
				cleanupBackgroundSession();
				for (const track of acquiredVideoTracks) {
					mediaState.localStream?.removeTrack(track);
					track.stop();
				}
				assertCurrentCameraOperation(operation);
				mediaState.isCameraOn = false;
				setCameraEnabled(false);
			} else {
				cleanupBackgroundSession();
			}
			console.error("Failed to toggle camera:", error);
			toast.error("Failed to toggle camera");
			throw error;
		}
	};

	const toggleCamera = () =>
		enqueueCameraTransition(toggleCameraImplementation);

	const stopScreenShare = async (
		reason: ScreenShareStopReason,
		extra: ScreenShareStopExtra = {},
	) => {
		const metadata = getScreenShareStopMetadata(reason, extra);
		const manager = sfuManager.value;
		const screenStream = mediaState.screenShareStream;

		mediaState.isScreenSharing = false;

		const tracks = screenStream?.getTracks?.();
		if (tracks) {
			for (const t of tracks) {
				t.stop();
			}
		}
		const selfId = currentUser.currentUser.value?.user_id as string;
		if (selfId && mediaState.screenShareStreams) {
			if (mediaState.screenShareStreams[selfId]) {
				delete mediaState.screenShareStreams[selfId];
			}
		}
		if (mediaState.screenShareStream === screenStream) {
			mediaState.screenShareStream = null;
		}

		await manager?.stopScreenShare(metadata);
	};

	const toggleScreenShare = async () => {
		try {
			if (mediaState.isScreenSharing) {
				await stopScreenShare("user-click");
			} else {
				const hasOngoingRemoteShare =
					(mediaState.activeScreenShareConsumers || []).length > 0;
				if (hasOngoingRemoteShare) {
					const shouldContinue = await confirmScreenShareOverride();
					if (!shouldContinue) {
						return;
					}
				}

				type ScreenShareOptions = DisplayMediaStreamOptions & {
					displaySurface?: "monitor" | "window" | "browser";
					selfBrowserSurface?: "include" | "exclude";
					surfaceSwitching?: "include" | "exclude";
				};
				const screenShareOptions: ScreenShareOptions = {
					video: {
						width: { ideal: 1920, max: 1920 },
						height: { ideal: 1080, max: 1080 },
						frameRate: { ideal: 10, max: 20 },
					},
					displaySurface: "window",
					selfBrowserSurface: "exclude",
					surfaceSwitching: "include",
				};

				const screenStream =
					await navigator.mediaDevices.getDisplayMedia(screenShareOptions);
				if (!screenStream)
					throw new Error("Failed to obtain screen share stream");

				mediaState.screenShareStream = screenStream;
				mediaState.isScreenSharing = true;
				mediaState.localScreenShareStartedAt = Date.now();

				try {
					const screenTrack = screenStream.getVideoTracks()[0];
					const manager = sfuManager.value;
					if (!screenTrack || !manager) {
						throw new Error("Screen share transport is not available");
					}

					screenTrack.addEventListener("ended", () => {
						if (
							mediaState.isScreenSharing &&
							mediaState.screenShareStream === screenStream
						) {
							stopScreenShare("track-ended").catch((err) => {
								console.error("track-ended screen share cleanup failed:", err);
							});
						}
					});

					const publication = await manager.publishScreenTrack(screenTrack);
					if (!publication) {
						if (
							mediaState.isScreenSharing &&
							mediaState.screenShareStream === screenStream
						) {
							await stopScreenShare(
								screenTrack.readyState === "ended"
									? "track-ended"
									: "publish-failed",
							);
						}
						return;
					}

					// Ensure audio producer is available
					const audioProducer = manager.getLocalProducerState("audio");
					const micTrack = mediaState.localStream?.getAudioTracks?.()[0];
					if (micTrack) {
						try {
							await manager.reconcileLocalProducerTrack("audio", micTrack, {
								resume: true,
							});
						} catch (err) {
							console.warn(
								"Failed to publish audio after starting screen share",
								err,
							);
						}
					} else if (audioProducer?.paused) {
						manager.resumeLocalProducer("audio");
					}

					const currentScreenPublication =
						manager.getLocalProducerState("screen");
					if (
						sfuManager.value === manager &&
						mediaState.isScreenSharing &&
						mediaState.screenShareStream === screenStream &&
						screenTrack.readyState === "live" &&
						currentScreenPublication?.id === publication.id &&
						currentScreenPublication.track === screenTrack &&
						sfuClient.isConnected()
					) {
						sfuClient.sendScreenShare("start_share", {
							startedAt: mediaState.localScreenShareStartedAt,
						});
					}
				} catch (pubErr) {
					console.error("Failed to publish screen share producer:", pubErr);
					await stopScreenShare("publish-failed", {
						message: (pubErr as Error)?.message,
					});
					throw pubErr;
				}
			}
		} catch (error) {
			if ((error as Error).name === "NotAllowedError") {
				console.log("User cancelled screen share");
			} else {
				console.error("Screen share failed:", error);
				toast.error("Failed to start screen sharing");
			}
		}
	};

	function setLocalVideoRef(el: HTMLVideoElement | null) {
		localVideo.value = el;
		if (el && mediaState.localStream) {
			const videoEl = el;
			const streamToUse = mediaState.processedStream || mediaState.localStream;

			const currentStreamId = streamToUse.id;
			const trackedStreamId = el.dataset.sourceStreamId;

			if (!videoEl.srcObject || trackedStreamId !== currentStreamId) {
				const videoTracks = streamToUse.getVideoTracks();
				if (videoTracks.length > 0) {
					videoEl.srcObject = new MediaStream(videoTracks);
					el.dataset.sourceStreamId = currentStreamId;
				} else {
					videoEl.srcObject = streamToUse;
					el.dataset.sourceStreamId = currentStreamId;
				}
				videoEl.muted = true;
			}
		}
		mediaState.localVideo = el;
	}

	const setRemoteVideoRef = (participantId: string, el: HTMLVideoElement) => {
		sfuManager.value?.registerVideoElement(participantId, el);
	};

	const setScreenShareVideoRef = (el: HTMLVideoElement) => {
		if (!el) return;

		const participantId = el.dataset.participantId;
		if (participantId) {
			screenShareVideoElements.set(participantId, el);

			const store = mediaState.screenShareStreams || {};
			let stream: MediaStream | null = store[participantId] ?? null;
			if (!stream && currentUser.currentUser.value?.user_id === participantId) {
				stream = mediaState.screenShareStream;
			}

			if (stream instanceof MediaStream) {
				const currentStreamId = stream.id;
				const srcObject = el.srcObject;
				const existingStreamId =
					srcObject instanceof MediaStream ? srcObject.id : undefined;

				if (!el.srcObject || existingStreamId !== currentStreamId) {
					el.srcObject = stream;
					el.play?.().catch(() => {});
				}
			}
		}
	};

	// Watch noise cancellation toggle
	watch(prefNoiseCancellationEnabled, (enabled) => {
		void enqueueMicrophoneTransition(async () => {
			const operation = createCameraOperation();
			if (!mediaState.isMicOn) return;

			const freshTrack = await getFreshMicTrack(operation);
			assertCurrentCameraOperation(operation);
			if (!freshTrack) return;

			if (noiseCancellationSession) {
				noiseCancellationSession.cleanup();
				noiseCancellationSession = null;
			}

			let trackToPublish = freshTrack;
			if (enabled) {
				const audioStream = new MediaStream([freshTrack]);
				const processedTrack = await getProcessedAudioTrack(
					audioStream,
					operation,
				);
				if (processedTrack && processedTrack.readyState === "live") {
					trackToPublish = processedTrack;
				}
			}
			assertCurrentCameraOperation(operation);
			if (trackToPublish.readyState === "live") {
				await sfuManager.value?.reconcileLocalProducerTrack(
					"audio",
					trackToPublish,
					{ resume: true },
				);
			}
		}).catch((error) => {
			if (isCameraLifecycleAbort(error)) return;
			console.error("[Noise Cancellation] Failed to toggle:", error);
		});
	});

	// Watch chat state for notification context
	watch(
		() => mediaState.isScreenSharing,
		(isSharing) => {
			notificationContextManager.updateScreenShareState(isSharing);
		},
	);

	// Surface DTLN init failures as a non-blocking warning. The mic keeps
	// working on the raw track; this just tells the user why denoising is off.
	watch(noiseCancellation.error, (message) => {
		if (message) {
			toast.warning(
				`Noise cancellation unavailable: ${message}. Falling back to raw microphone.`,
			);
		}
	});

	observeLocalTracks();

	const cleanupLocalMedia = async () => {
		cameraLifecycleGeneration++;
		cameraLifecycleAbortController.abort(cameraLifecycleAbort());
		mediaState.isCameraOn = false;
		mediaState.isMicOn = false;
		mediaState.isScreenSharing = false;
		if (observedCameraTrack && cameraEndedListener) {
			observedCameraTrack.removeEventListener("ended", cameraEndedListener);
		}
		if (observedMicrophoneTrack && microphoneEndedListener) {
			observedMicrophoneTrack.removeEventListener(
				"ended",
				microphoneEndedListener,
			);
		}

		if (noiseCancellationSession) {
			noiseCancellationSession.cleanup();
			noiseCancellationSession = null;
		}

		if (mediaState.localStream) {
			for (const track of mediaState.localStream.getAudioTracks()) {
				track.stop();
			}
		}

		if (mediaState.screenShareStream) {
			for (const track of mediaState.screenShareStream.getTracks()) {
				track.stop();
			}
		}

		await enqueueCameraTransition(async () => {
			try {
				await reconcileCameraTrack(null, "camera-unmount", false);
			} finally {
				try {
					cleanupBackgroundSession();
				} finally {
					try {
						for (const track of mediaState.localStream?.getVideoTracks() ??
							[]) {
							try {
								stopLifecycleTrack(track);
							} catch {}
						}
						for (const track of detachedCameraTracks) {
							try {
								stopLifecycleTrack(track);
							} catch {}
						}
					} finally {
						detachedCameraTracks.clear();
						await backgroundEffects.dispose();
					}
				}
			}
		});
	};

	onUnmounted(() => {
		void cleanupLocalMedia().catch(() => {});
	});

	return {
		initializeCamera,
		acquireUserMedia,
		toggleMicrophone,
		toggleCamera,
		toggleScreenShare,
		switchInputDevice,
		applySpeakerDevice,
		applyBackgroundEffectsToLocalStream,
		republishMediaAfterE2EE,
		cleanupLocalMedia,
		setLocalVideoRef,
		setRemoteVideoRef,
		setScreenShareVideoRef,
		processedStream: mediaState.processedStream,
	};
}
