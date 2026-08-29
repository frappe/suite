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
import {
	LocalCaptureSession,
	type LocalCaptureKindPublicationResult,
	type LocalCaptureOperation,
	type MediaDeviceOverrides,
} from "../utils/media/LocalCaptureSession";
import type { MediaAttachmentFacade } from "../utils/media/VideoElementManager";
import notificationContextManager from "../utils/notificationContext";
import { isMobileDevice } from "../utils/device";
import type { SFUClient } from "../utils/SFUClient";
import type { SFUMeetingManager } from "../utils/SFUMeetingManager";
import type { ConnectionState } from "./useConnectionState";
import type { CurrentUser } from "./useCurrentUser";
import type { MediaState } from "./useMediaState";
import type { RaiseHandStore } from "./useRaiseHandStore";
import type { BackgroundEffectOptions } from "./useBackgroundEffects";

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
	mediaAttachments: MediaAttachmentFacade;
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
	setRemoteVideoRef: (
		participantId: string,
		el: HTMLVideoElement | null,
	) => void;
	setScreenShareVideoRef: (
		attachmentId: string,
		el: HTMLVideoElement | null,
	) => void;
	processedStream: MediaStream | null;
	cleanupLocalMedia: () => Promise<void>;
}

type ScreenShareStopReason =
	"user-click" | "track-ended" | "publish-failed" | "cleanup";

export interface E2EEMediaRepublishDetail {
	needsCamera?: boolean;
	needsMicrophone?: boolean;
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
		mediaAttachments,
		deviceManager,
		backgroundEffects,
		noiseCancellation,
	} = deps;

	const localVideo = ref<HTMLVideoElement | null>(null);
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
	let captureSession!: LocalCaptureSession;
	type CameraOperation = LocalCaptureOperation;
	const cameraLifecycleAbort = () =>
		new DOMException("Local capture lifecycle has ended", "AbortError");
	const createCameraOperation = () => captureSession.createOperation();
	const isCurrentCameraOperation = (operation: CameraOperation) =>
		captureSession.isCurrent(operation);
	const isCameraLifecycleAbort = (
		error: unknown,
		operation?: CameraOperation,
	) => captureSession.isLifecycleAbort(error, operation);
	const assertCurrentCameraOperation = (operation?: CameraOperation) =>
		captureSession.assertCurrent(operation);
	const stopLifecycleTrack = (track: MediaStreamTrack) =>
		captureSession.stopTrack(track);
	const stopLifecycleStream = (stream: MediaStream) =>
		captureSession.stopStream(stream);
	const ownCameraStream = (operation: CameraOperation, stream: MediaStream) =>
		captureSession.ownStream(operation, stream);
	const discardCameraOperationStreams = (operation: CameraOperation) =>
		captureSession.discardOwnedStreams(operation);
	const enqueueCameraTransition = <T>(operation: () => Promise<T>) =>
		captureSession.runCameraTransition(operation);
	const enqueueMicrophoneTransition = <T>(operation: () => Promise<T>) =>
		captureSession.runMicrophoneTransition(operation);

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

	const updateLocalPreview = (stream: MediaStream | null) => {
		void mediaAttachments
			.attachLocalPreview(stream)
			.catch((error) => console.warn("Could not update local preview:", error));
	};

	const reconcileCameraTrackImplementation = async (
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
								await manager.replaceLocalProducerTrack("video", previousTrack);
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

	captureSession = new LocalCaptureSession({
		capture: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
		devices: deviceManager,
		publication: {
			getOwner: () => sfuManager.value,
			reconcileCamera: reconcileCameraTrackImplementation,
			reconcileMicrophone: async (track, resume, operation) => {
				assertCurrentCameraOperation(operation);
				const manager = sfuManager.value;
				if (!manager) return;
				if (track) {
					await manager.reconcileLocalProducerTrack("audio", track, { resume });
				} else {
					await manager.serializeSendMediaMutation(async () => {
						assertCurrentCameraOperation(operation);
						manager.closeLocalProducer("audio");
						manager.setLocalMediaTrack("audio", null);
					});
				}
				assertCurrentCameraOperation(operation);
			},
			publish: async (stream, options) => {
				const manager = sfuManager.value;
				if (!manager) return {};
				const requestedVideoTrack = options.publishVideo
					? (stream
							.getVideoTracks()
							.find((track) => track.readyState === "live") ?? null)
					: null;
				const requestedAudioTrack = options.publishAudio
					? (stream
							.getAudioTracks()
							.find((track) => track.readyState === "live") ?? null)
					: null;
				const publication = (await manager.publishMedia(stream, options)) ?? {};
				const producerMatches = (
					producer: { track?: MediaStreamTrack | null } | null,
					track: MediaStreamTrack,
				) =>
					producer?.track?.readyState === "live" &&
					(producer.track === track || producer.track.id === track.id);
				const ensurePublished = async (
					kind: "video" | "audio",
					track: MediaStreamTrack | null,
				): Promise<LocalCaptureKindPublicationResult> => {
					if (!track) {
						return {
							status: "failed",
							error: new Error(
								`No live ${kind} track was requested for publication`,
							),
						};
					}
					const producer = manager.getLocalProducerState(kind);
					if (!producerMatches(producer, track)) {
						try {
							await manager.reconcileLocalProducerTrack(
								kind,
								track,
								kind === "audio" ? { resume: true } : {},
							);
						} catch (error) {
							return { status: "failed", error };
						}
					}
					const currentProducer = manager.getLocalProducerState(kind);
					if (!currentProducer) {
						return {
							status: "failed",
							error: new Error(
								`${kind === "video" ? "Video" : "Audio"} publication did not create a producer`,
							),
						};
					}
					return producerMatches(currentProducer, track)
						? { status: "published" }
						: {
								status: "failed",
								error: new Error(
									`${kind === "video" ? "Video" : "Audio"} publication did not publish the requested track`,
								),
							};
				};
				return {
					...(options.publishVideo
						? {
								video: Object.hasOwn(publication, "videoError")
									? {
											status: "failed" as const,
											error: publication.videoError,
										}
									: await ensurePublished(
											"video",
											requestedVideoTrack,
										),
							}
						: {}),
					...(options.publishAudio
						? {
								audio: Object.hasOwn(publication, "audioError")
									? {
											status: "failed" as const,
											error: publication.audioError,
										}
									: await ensurePublished(
											"audio",
											requestedAudioTrack,
										),
							}
						: {}),
				};
			},
		},
		getLocalStream: () => mediaState.localStream,
		setLocalStream: (stream) => {
			mediaState.localStream = stream;
		},
		isCameraEnabled: () => mediaState.isCameraOn,
		isMicrophoneEnabled: () => mediaState.isMicOn,
		setPermissionGranted: (type) => {
			if (type === "camera") mediaState.cameraPermissionGranted = true;
			else mediaState.microphonePermissionGranted = true;
		},
		applyCameraEffects: (options) => applyBackgroundEffects(options),
		cleanupCameraEffects: () => cleanupBackgroundSession(),
		prepareMicrophone: (stream, operation) =>
			prepareProcessedAudioTrack(stream, operation),
		cleanupMicrophoneEffects: () => {
			noiseCancellationSession?.cleanup();
			noiseCancellationSession = null;
		},
		getEffectiveCameraTrack,
		getEffectiveMicrophoneTrack: () =>
			noiseCancellationSession?.stream
				.getAudioTracks()
				.find((track) => track.readyState === "live") ??
			mediaState.localStream
				?.getAudioTracks()
				.find((track) => track.readyState === "live") ??
			null,
		onLocalStreamChanged: () => {
			if (mediaState.localVideo) {
				setLocalVideoRef(mediaState.localVideo as HTMLVideoElement);
			}
		},
		onCameraDisabled: () => {
			mediaState.isCameraOn = false;
			setCameraEnabled(false);
			toast.error("Failed to toggle camera");
		},
		onMicrophoneDisabled: () => {
			mediaState.isMicOn = false;
			setMicEnabled(false);
			toast.error("Failed to toggle microphone");
		},
		getSelectedDeviceId: (type) =>
			type === "camera" ? selectedCameraId.value : selectedMicId.value,
		setSelectedDeviceId: (type, deviceId) => {
			if (type === "camera") setSelectedCameraId(deviceId);
			else setSelectedMicId(deviceId);
		},
		getCameraConstraints: getCameraVideoConstraints,
		onCameraTrackEnded: (track) => recoverEndedCameraTrack(track),
		onMicrophoneTrackEnded: (track) => recoverEndedMicrophoneTrack(track),
		onTrackRecoveryError: (type, error) =>
			console.error(
				type === "camera"
					? "Camera track recovery failed:"
					: "Microphone track recovery failed:",
				error,
			),
	});

	const reconcileCameraTrack = (
		track: MediaStreamTrack | null,
		reason: string,
		createProducerIfMissing = true,
		operation?: CameraOperation,
	) =>
		captureSession.reconcileCamera(
			track,
			reason,
			createProducerIfMissing,
			operation,
		);

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
			const hasLiveRawVideo = mediaState.localStream
				?.getVideoTracks()
				.some((track) => track.readyState === "live");
			updateLocalPreview(hasLiveRawVideo ? mediaState.localStream : null);
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
			stopLifecycleTrack(track);
		}
		updateLocalPreview(null);
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
		const assertRawTrackCurrent = () => {
			assertCurrentCameraOperation(operation);
			if (
				rawTrack.readyState !== "live" ||
				!mediaState.localStream?.getVideoTracks().includes(rawTrack)
			) {
				throw new Error("Camera source ended during effects startup");
			}
		};

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
				assertRawTrackCurrent();
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
				if (
					rawTrack.readyState !== "live" ||
					!mediaState.localStream?.getVideoTracks().includes(rawTrack)
				) {
					result.cleanup();
					throw new Error("Camera source ended during effects startup");
				}
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
					updateLocalPreview(result.stream);
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
	): Promise<void> => captureSession.reacquireMediaAfterE2EE(detail);

	const switchSpeaker = async (deviceId: string) => {
		setSelectedSpeakerId(deviceId);
		await applySpeakerDevice();
	};

	const switchMic = (deviceId: string) =>
		captureSession.switchMicrophone(deviceId);

	const switchCam = (deviceId: string) => captureSession.switchCamera(deviceId);

	const switchInputDevice = async (type: DeviceType, deviceId: string) => {
		try {
			if (type === "speaker") {
				await switchSpeaker(deviceId);
			} else if (type === "microphone") {
				await switchMic(deviceId);
			} else if (type === "camera") {
				await switchCam(deviceId);
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
					stopLifecycleTrack(track);
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

	const prepareProcessedAudioTrack = async (
		stream: MediaStream,
		operation?: CameraOperation,
	) => {
		const originalTrack = stream.getAudioTracks()[0];
		if (!originalTrack) return null;

		if (!prefNoiseCancellationEnabled.value) {
			if (originalTrack.readyState === "ended") {
				const freshTrack = await getFreshMicTrack(operation);
				if (!freshTrack) return null;
				return {
					track: freshTrack,
					commit: () => {
						noiseCancellationSession?.cleanup();
						noiseCancellationSession = null;
					},
					discard: () => {},
				};
			}

			return {
				track: originalTrack,
				commit: () => {
					noiseCancellationSession?.cleanup();
					noiseCancellationSession = null;
				},
				discard: () => {},
			};
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
			const processedTrack = result.stream.getAudioTracks()[0];
			if (processedTrack) {
				let settled = false;
				return {
					track: processedTrack,
					commit: () => {
						if (settled) return;
						settled = true;
						noiseCancellationSession?.cleanup();
						noiseCancellationSession = result;
					},
					discard: () => {
						if (settled) return;
						settled = true;
						result.cleanup();
					},
				};
			}

			console.warn("[Noise Cancellation] No processed track returned");
			result.cleanup();
			return {
				track: originalTrack,
				commit: () => {},
				discard: () => {},
			};
		} catch (error) {
			if (isCameraLifecycleAbort(error, operation)) throw error;
			console.error("[Noise Cancellation] Failed to apply:", error);
			return {
				track: originalTrack,
				commit: () => {},
				discard: () => {},
			};
		}
	};

	const getProcessedAudioTrack = async (
		stream: MediaStream,
		operation?: CameraOperation,
	) => {
		const prepared = await prepareProcessedAudioTrack(stream, operation);
		prepared?.commit();
		return prepared?.track ?? null;
	};

	const acquireUserMedia = (
		videoEnabled: boolean,
		audioEnabled: boolean,
		deviceOverrides: MediaDeviceOverrides = {},
		operation: CameraOperation = createCameraOperation(),
	) =>
		captureSession.acquireUserMedia(
			videoEnabled,
			audioEnabled,
			deviceOverrides,
			operation,
		);

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
				await reconcileCameraTrack(
					null,
					"camera-track-ended",
					false,
					operation,
				);
			} catch (error) {
				console.error("Failed to close ended camera publication:", error);
			}
			cleanupBackgroundSession();
			for (const track of mediaState.localStream?.getVideoTracks() ?? []) {
				mediaState.localStream?.removeTrack(track);
				stopLifecycleTrack(track);
			}
			updateLocalPreview(null);
			mediaState.isCameraOn = false;
			setCameraEnabled(false);
			toast.error(
				"Camera stopped and could not be restarted. Check browser permissions and devices.",
			);
		} else {
			try {
				await captureSession.reconcileMicrophone(
					null,
					false,
					createCameraOperation(),
				);
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
			captureSession.isDisposed ||
			!mediaState.isCameraOn ||
			!mediaState.localStream?.getVideoTracks().includes(endedTrack)
		)
			return;
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
			captureSession.isDisposed ||
			!mediaState.isMicOn ||
			!mediaState.localStream?.getAudioTracks().includes(endedTrack)
		)
			return;
		try {
			await switchMic(selectedMicId.value);
		} catch (error) {
			if (isCameraLifecycleAbort(error)) return;
			console.error("Failed to recover ended microphone track:", error);
			stopLifecycleTrack(endedTrack);
			await failEndedTrackRecovery("audio");
		}
	};

	const applySpeakerDevice = async () => {
		let validSpeakerId = selectedSpeakerId.value;
		if (validSpeakerId) {
			try {
				await deviceManager.enumerateDevices();
				if (!deviceManager.isDeviceAvailable(validSpeakerId, "speaker")) {
					validSpeakerId =
						deviceManager.getDefaultDevice("speaker")?.deviceId ?? "";
					setSelectedSpeakerId(validSpeakerId);
				}
			} catch (error) {
				console.warn("Could not validate speaker device availability:", error);
			}
		}

		try {
			if (validSpeakerId)
				await mediaAttachments.setAudioOutputDevice(validSpeakerId);
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

			if (enable) {
				if (!(await captureSession.enableMicrophoneInTransition())) return;
			} else {
				const stream = mediaState.localStream;
				if (stream) {
					const at = stream.getAudioTracks()[0];
					if (at) {
						stopLifecycleTrack(at);
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
							false,
							{},
							operation,
						);
						ownCameraStream(operation, nextStream);
						const newTrack = nextStream
							.getVideoTracks()
							.find((track) => track.readyState === "live");
						if (!newTrack) throw new Error("No live camera track available");
						const committed = await captureSession.commitLocalTrack(
							"video",
							newTrack,
							operation,
						);
						stream = committed.stream;
						for (const oldTrack of committed.replacedTracks) {
							stopLifecycleTrack(oldTrack);
						}
						acquiredVideoTracks.push(newTrack);
						assertCurrentCameraOperation(operation);
						mediaState.cameraPermissionGranted = true;
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
								const committed = await captureSession.commitLocalTrack(
									"video",
									newTrack,
									operation,
								);
								stream = committed.stream;
								for (const oldTrack of committed.replacedTracks) {
									stopLifecycleTrack(oldTrack);
								}
								assertCurrentCameraOperation(operation);
								mediaState.cameraPermissionGranted = true;
								if (mediaState.localVideo) {
									assertCurrentCameraOperation(operation);
									setLocalVideoRef(mediaState.localVideo as HTMLVideoElement);
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
						stopLifecycleTrack(track);
						stream.removeTrack(track);
					}
				}
				updateLocalPreview(null);
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
					stopLifecycleTrack(track);
				}
				updateLocalPreview(null);
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
		mediaAttachments.removeScreenSharePreview("local-screen");

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
					if (
						mediaState.isScreenSharing &&
						mediaState.screenShareStream === screenStream
					) {
						await stopScreenShare("publish-failed", {
							message: (pubErr as Error)?.message,
						});
					}
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
		mediaAttachments.registerLocalPreview(el);
		const stream = mediaState.processedStream || mediaState.localStream;
		void mediaAttachments
			.attachLocalPreview(stream)
			.catch((error) => console.warn("Could not play local preview:", error));
		mediaState.localVideo = el;
	}

	const setRemoteVideoRef = (
		participantId: string,
		el: HTMLVideoElement | null,
	) => {
		mediaAttachments.registerRemoteVideoElement(participantId, el);
	};

	const setScreenShareVideoRef = (
		attachmentId: string,
		el: HTMLVideoElement | null,
	) => {
		mediaAttachments.registerScreenSharePreview(attachmentId, el);
		if (!el) return;
		const participantId = el.dataset.participantId;
		if (!participantId) return;
		const stream =
			mediaState.screenShareStreams?.[participantId] ??
			(currentUser.currentUser.value?.user_id === participantId
				? mediaState.screenShareStream
				: null);
		if (stream) {
			void mediaAttachments
				.attachScreenSharePreview(
					attachmentId,
					stream,
					attachmentId === "local-screen" ? "borrowed" : "owned",
				)
				.catch((error) => console.warn("Could not play screen share:", error));
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
				await captureSession.reconcileMicrophone(
					trackToPublish,
					true,
					operation,
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

	const cleanupLocalMedia = async () => {
		mediaAttachments.registerLocalPreview(null);
		void mediaAttachments.attachLocalPreview(null);
		mediaAttachments.removeScreenSharePreview("local-screen");
		mediaState.isCameraOn = false;
		mediaState.isMicOn = false;
		mediaState.isScreenSharing = false;
		if (noiseCancellationSession) {
			noiseCancellationSession.cleanup();
			noiseCancellationSession = null;
		}

		if (mediaState.screenShareStream) {
			for (const track of mediaState.screenShareStream.getTracks()) {
				track.stop();
			}
		}

		await captureSession.dispose(
			async () => {
				try {
					await reconcileCameraTrack(null, "camera-unmount", false);
				} finally {
					cleanupBackgroundSession();
				}
			},
			async () => {
				try {
					updateLocalPreview(null);
				} finally {
					await backgroundEffects.dispose();
					updateLocalPreview(null);
				}
			},
		);
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
