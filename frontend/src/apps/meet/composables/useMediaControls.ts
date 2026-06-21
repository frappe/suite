import { confirmDialog, toast } from "frappe-ui";
import { onUnmounted, type Ref, ref, watch } from "vue";
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
import type { SFUClient } from "../utils/SFUClient";
import type { SFUMeetingManager } from "../utils/SFUMeetingManager";
import type { ConnectionState } from "./useConnectionState";
import type { CurrentUser } from "./useCurrentUser";
import type { MediaState } from "./useMediaState";
import type { RaiseHandStore } from "./useRaiseHandStore";

const BLUETOOTH_DEVICE_LABEL_REGEX =
	/airpods|bluetooth|\bbt\b|wireless|jbl|bose|sony|beats|sennheiser|akg|jabra|anker|skullcandy|shure|bang\s*&\s*olufsen|b\s*&\s*o|marley|skullcandy|logitech\s*bt|plantronics|poly|razer\s*(?:bt|opus)|corsair|steelseries|hyperx|audeze|sennheiser|soundcore|tozo|earfun|earbuds|earbud/i;

const isBluetoothMicLabel = (label: string | undefined): boolean => {
	if (!label) return false;
	return BLUETOOTH_DEVICE_LABEL_REGEX.test(label.toLowerCase());
};

function getBackgroundEffectsFromStorage() {
	const blurEnabled = localStorage.getItem("backgroundEffects.blur") === "1";
	const imageEnabled = localStorage.getItem("backgroundEffects.image") === "1";
	const selectedImage =
		localStorage.getItem("backgroundEffects.imageName") || "";
	const blurIntensity = Number.parseInt(
		localStorage.getItem("backgroundEffects.blurIntensity") || "12",
		10,
	);
	const anyEnabled = blurEnabled || imageEnabled;

	return {
		blurEnabled,
		imageEnabled,
		selectedImage,
		blurIntensity,
		anyEnabled,
	};
}

interface BackgroundEffectsAPI {
	applyBackgroundEffects: (
		stream: MediaStream,
		options: Record<string, unknown>,
	) => Promise<{
		stream: MediaStream;
		cleanup: () => void;
		updateOptions: (opts: Record<string, unknown>) => Promise<void>;
	}>;
	stopProcessing: () => void;
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
		deviceOverrides?: Record<string, string>,
	) => Promise<{ stream: MediaStream; constraints: Record<string, unknown> }>;
	toggleMicrophone: () => Promise<void>;
	toggleCamera: () => Promise<void>;
	toggleScreenShare: () => Promise<void>;
	switchInputDevice: (type: DeviceType, deviceId: string) => Promise<void>;
	applySpeakerDevice: () => Promise<void>;
	applyBackgroundEffectsToLocalStream: () => Promise<void>;
	setLocalVideoRef: (el: HTMLElement | null) => void;
	setRemoteVideoRef: (participantId: string, el: HTMLElement) => void;
	setScreenShareVideoRef: (el: HTMLElement) => void;
	processedStream: MediaStream | null;
}

interface ProducerLike {
	id: string;
	track?: MediaStreamTrack | null;
	paused?: boolean;
	replaceTrack?: (args: { track: MediaStreamTrack }) => Promise<unknown>;
	resume?: () => void;
	pause?: () => void;
	close?: () => void;
}

interface MediaHandlerLike {
	localStream: MediaStream | null;
	audioProducer: ProducerLike | null;
	videoProducer: ProducerLike | null;
	screenProducer: ProducerLike | null;
	setProducers: (producers: {
		audioProducer?: ProducerLike;
		videoProducer?: ProducerLike;
		screenProducer?: ProducerLike;
	}) => void;
	stopScreenShare: () => void;
	cleanup: () => void;
}

function getMediaHandler(
	manager: SFUMeetingManager | null,
): MediaHandlerLike | null {
	return (manager?.mediaHandler as MediaHandlerLike | undefined) || null;
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

	const localVideo = ref<HTMLElement | null>(null);
	const screenShareVideoElements = new Map<string, HTMLElement>();
	const _unmutedByPushToTalk = ref(false);

	let backgroundSession: {
		stream: MediaStream;
		cleanup: () => void;
		updateOptions: (opts: Record<string, unknown>) => Promise<void>;
	} | null = null;
	let noiseCancellationSession: {
		stream: MediaStream;
		cleanup: () => void;
	} | null = null;

	const confirmScreenShareOverride = () =>
		new Promise<boolean>((resolve) => {
			confirmDialog({
				title: "Start Screen Share Anyway?",
				message:
					"Someone is already sharing their screen. Starting yours may result in multiple active screen shares.",
				onConfirm: ({ hideDialog }: { hideDialog: () => void }) => {
					hideDialog();
					resolve(true);
				},
				onCancel: () => resolve(false),
			});
		});

	const replacePublishedVideoTrack = async (
		stream: MediaStream | null,
		reason = "background-effect",
	) => {
		const manager = sfuManager.value;
		const mediaHandler = getMediaHandler(manager);
		const videoProducer = mediaHandler?.videoProducer;
		if (!videoProducer || mediaState.isScreenSharing) {
			return;
		}

		const targetStream = stream || mediaState.localStream;
		if (!targetStream) {
			return;
		}

		const [track] = targetStream.getVideoTracks();
		if (!track) {
			console.warn(
				`Skipped video track swap (${reason}) - no video track available`,
			);
			return;
		}
		if (track.readyState === "ended") {
			console.warn(
				`Skipped video track swap (${reason}) - track already ended`,
			);
			return;
		}

		try {
			if (typeof videoProducer.replaceTrack === "function") {
				await videoProducer.replaceTrack({ track });
			}
			track.enabled = true;
			console.log(`Replaced video track (${reason})`);

			if (localVideo.value) {
				setLocalVideoRef(localVideo.value);
			}
		} catch (error) {
			console.warn(`Failed to replace video track (${reason}):`, error);
		}
	};

	const applyBackgroundEffectsToLocalStream = async (forceRestart = false) => {
		const bgEffects = getBackgroundEffectsFromStorage();
		const wantsEffects = bgEffects.anyEnabled;
		const localStream = mediaState.localStream;
		const hasLiveVideoTrack =
			!!localStream &&
			localStream.getVideoTracks().some((track) => track.readyState === "live");

		if (!localStream || !hasLiveVideoTrack) {
			if (wantsEffects) {
				shouldApplyBackgroundEffectsWhenVideoAvailable = true;
			}
			if (backgroundSession) {
				backgroundSession.cleanup();
				backgroundSession = null;
			}
			if (mediaState.processedStream) {
				backgroundEffects.stopProcessing();
				mediaState.processedStream = null;
			}
			return;
		}

		shouldApplyBackgroundEffectsWhenVideoAvailable = false;

		try {
			if (backgroundSession && !forceRestart) {
				await backgroundSession.updateOptions({
					blurIntensity: bgEffects.blurIntensity,
					backgroundBlurEnabled: bgEffects.blurEnabled,
					backgroundImageEnabled: bgEffects.imageEnabled,
					selectedBackgroundImage: bgEffects.selectedImage,
				});
				return;
			}

			if (backgroundSession) {
				backgroundSession.cleanup();
				backgroundSession = null;
			}
			if (mediaState.processedStream) {
				backgroundEffects.stopProcessing();
				mediaState.processedStream = null;
			}

			const result = await backgroundEffects.applyBackgroundEffects(
				localStream,
				{
					blurIntensity: bgEffects.blurIntensity,
					backgroundBlurEnabled: bgEffects.blurEnabled,
					backgroundImageEnabled: bgEffects.imageEnabled,
					selectedBackgroundImage: bgEffects.selectedImage,
				},
			);
			backgroundSession = result;
			mediaState.processedStream = result.stream;
			await replacePublishedVideoTrack(result.stream, "background-enabled");
		} catch (error) {
			console.warn(
				"Failed to apply background effects to local stream:",
				error,
			);
			await replacePublishedVideoTrack(localStream, "background-error");
			if (backgroundSession) {
				backgroundSession.cleanup();
				backgroundSession = null;
			}
			if (mediaState.processedStream) {
				mediaState.processedStream = null;
				backgroundEffects.stopProcessing();
			}
		}
	};

	const switchSpeaker = async (deviceId: string) => {
		setSelectedSpeakerId(deviceId);
		await applySpeakerDevice();
	};

	const switchMic = async (deviceId: string) => {
		setSelectedMicId(deviceId);
		if (!mediaState.isMicOn || !mediaState.localStream) {
			return;
		}

		const mh = getMediaHandler(sfuManager.value);
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

		if (
			mh?.audioProducer &&
			typeof mh.audioProducer.replaceTrack === "function"
		) {
			await mh.audioProducer.replaceTrack({ track: trackToPublish });
			return;
		}

		if (!mh?.audioProducer && sfuManager.value?.transportManager) {
			const producer = await sfuManager.value.transportManager.createProducer(
				trackToPublish,
				{ type: "microphone" },
			);
			mh?.setProducers({ audioProducer: producer as ProducerLike });
		}
	};

	const switchCam = async (deviceId: string) => {
		setSelectedCameraId(deviceId);
		if (!mediaState.isCameraOn || !mediaState.localStream) {
			return;
		}

		const mh = getMediaHandler(sfuManager.value);
		const { stream: videoOnlyStream } = await acquireUserMedia(true, false, {
			cameraDeviceId: deviceId,
		});
		const newVideoTrack = videoOnlyStream.getVideoTracks()[0];
		if (!newVideoTrack) {
			return;
		}

		const currentVideoTracks = mediaState.localStream.getVideoTracks();
		for (const track of currentVideoTracks) {
			mediaState.localStream.removeTrack(track);
			track.stop();
		}
		mediaState.localStream.addTrack(newVideoTrack);

		const bgEffects = getBackgroundEffectsFromStorage();
		if (
			bgEffects.anyEnabled ||
			shouldApplyBackgroundEffectsWhenVideoAvailable
		) {
			await applyBackgroundEffectsToLocalStream(true);
		}

		const trackToPublish = mediaState.processedStream
			? mediaState.processedStream.getVideoTracks()[0]
			: newVideoTrack;

		if (trackToPublish && mh?.videoProducer) {
			if (typeof mh.videoProducer.replaceTrack === "function") {
				await mh.videoProducer.replaceTrack({ track: trackToPublish });
			}
		} else if (
			trackToPublish &&
			!mh?.videoProducer &&
			sfuManager.value?.transportManager
		) {
			const producer = await sfuManager.value.transportManager.createProducer(
				trackToPublish,
				{ type: "camera" },
			);
			mh?.setProducers({ videoProducer: producer as ProducerLike });
		}

		if (localVideo.value) {
			delete localVideo.value.dataset.sourceStreamId;
			setLocalVideoRef(localVideo.value);
		}
	};

	const switchInputDevice = async (type: DeviceType, deviceId: string) => {
		if (type === "speaker") {
			await switchSpeaker(deviceId);
		} else if (type === "microphone") {
			await switchMic(deviceId);
		} else if (type === "camera") {
			await switchCam(deviceId);
		}
	};

	let shouldApplyBackgroundEffectsWhenVideoAvailable = false;

	const getFreshMicTrack = async () => {
		try {
			const { stream: freshStream } = await acquireUserMedia(false, true, {
				micDeviceId: selectedMicId.value,
			});
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
			console.error("[Audio] Failed to get fresh mic track:", error);
			return null;
		}
	};

	const getProcessedAudioTrack = async (stream: MediaStream) => {
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
				return await getFreshMicTrack();
			}

			return originalTrack;
		}

		try {
			const audioStream = new MediaStream([originalTrack]);
			const result =
				await noiseCancellation.applyNoiseCancellation(audioStream);
			noiseCancellationSession = result;

			const processedTrack = result.stream.getAudioTracks()[0];
			if (processedTrack) {
				return processedTrack;
			}

			console.warn("[Noise Cancellation] No processed track returned");
			return originalTrack;
		} catch (error) {
			console.error("[Noise Cancellation] Failed to apply:", error);
			return originalTrack;
		}
	};

	const getValidDeviceId = async (
		storedDeviceId: string | null,
		deviceType: DeviceType,
	) => {
		if (!storedDeviceId) return null;

		try {
			await deviceManager.enumerateDevices({
				video: false,
				audio: false,
			});

			if (deviceManager.isDeviceAvailable(storedDeviceId, deviceType)) {
				return storedDeviceId;
			}

			const defaultDevice = deviceManager.getDefaultDevice(deviceType);
			if (defaultDevice) {
				if (deviceType === "camera") {
					setSelectedCameraId(defaultDevice.deviceId);
				} else if (deviceType === "microphone") {
					setSelectedMicId(defaultDevice.deviceId);
				} else if (deviceType === "speaker") {
					setSelectedSpeakerId(defaultDevice.deviceId);
				}

				return defaultDevice.deviceId;
			}

			if (deviceType === "camera") {
				setSelectedCameraId("");
			} else if (deviceType === "microphone") {
				setSelectedMicId("");
			} else if (deviceType === "speaker") {
				setSelectedSpeakerId("");
			}
			return null;
		} catch (error) {
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
	) => {
		const constraints: Record<string, unknown> = {};

		const audioConstraints = {
			channelCount: 1,
			echoCancellation: true,
			noiseSuppression: true,
			autoGainControl: true,
			sampleRate: 16000,
			sampleSize: 16,
		};

		if (videoEnabled) {
			constraints.video = {
				width: { ideal: 1280, min: 960 },
				height: { ideal: 720, min: 540 },
				frameRate: { ideal: 30, max: 30 },
			};

			const validCameraId = await getValidDeviceId(
				selectedCameraId.value,
				"camera",
			);
			if (validCameraId) {
				(constraints.video as Record<string, unknown>).deviceId = {
					exact: validCameraId,
				};
			}
		}

		if (audioEnabled) {
			const validMicId = await getValidDeviceId(
				selectedMicId.value,
				"microphone",
			);
			const selectedMic = validMicId
				? deviceManager.findDeviceById(validMicId, "microphone")
				: undefined;
			if (isBluetoothMicLabel(selectedMic?.label)) {
				audioConstraints.autoGainControl = false;
			}
			constraints.audio = { ...audioConstraints };

			if (validMicId) {
				(constraints.audio as Record<string, unknown>).deviceId = {
					exact: validMicId,
				};
			}
		}

		return constraints;
	};

	const acquireUserMedia = async (
		videoEnabled: boolean,
		audioEnabled: boolean,
		deviceOverrides: Record<string, string> = {},
	) => {
		const constraints = await buildMediaConstraints(videoEnabled, audioEnabled);

		if (videoEnabled && Object.hasOwn(deviceOverrides, "cameraDeviceId")) {
			const validCameraId = await getValidDeviceId(
				deviceOverrides.cameraDeviceId,
				"camera",
			);
			if (validCameraId && constraints.video) {
				(constraints.video as Record<string, unknown>).deviceId = {
					exact: validCameraId,
				};
			} else if ((constraints.video as Record<string, unknown>)?.deviceId) {
				delete (constraints.video as Record<string, unknown>).deviceId;
			}
		}

		if (audioEnabled && Object.hasOwn(deviceOverrides, "micDeviceId")) {
			const validMicId = await getValidDeviceId(
				deviceOverrides.micDeviceId,
				"microphone",
			);
			if (validMicId && constraints.audio) {
				(constraints.audio as Record<string, unknown>).deviceId = {
					exact: validMicId,
				};
			} else if ((constraints.audio as Record<string, unknown>)?.deviceId) {
				delete (constraints.audio as Record<string, unknown>).deviceId;
			}
		}

		const stream = await navigator.mediaDevices.getUserMedia(constraints);
		return { stream, constraints };
	};

	const applySpeakerDevice = async () => {
		try {
			const validSpeakerId = await getValidDeviceId(
				selectedSpeakerId.value,
				"speaker",
			);

			if (validSpeakerId && sfuManager.value?.videoManager) {
				const audioElements = sfuManager.value.videoManager.audioElements;

				for (const [, audioElement] of audioElements) {
					try {
						await audioElement.setSinkId(validSpeakerId);
					} catch (error) {
						console.warn("Failed to set speaker for participant:", error);
					}
				}
			}
		} catch (error) {
			console.warn("Failed to apply speaker device:", error);
		}
	};

	const initializeCamera = async () => {
		try {
			mediaState.setMedia(prefMicEnabled.value, prefCameraEnabled.value);

			if (mediaState.isCameraOn || mediaState.isMicOn) {
				const { stream } = await acquireUserMedia(
					mediaState.isCameraOn,
					mediaState.isMicOn,
				);
				mediaState.localStream = stream;
				if (connectionState.connectionError) {
					connectionState.connectionError = null;
				}
				if (mediaState.isCameraOn) {
					mediaState.cameraPermissionGranted = true;
					await applyBackgroundEffectsToLocalStream();
				}
				if (mediaState.isMicOn) {
					mediaState.microphonePermissionGranted = true;
					if (prefNoiseCancellationEnabled.value) {
						try {
							const rawTrack = stream.getAudioTracks()[0];
							if (rawTrack) {
								const audioStream = new MediaStream([rawTrack]);
								const result =
									await noiseCancellation.applyNoiseCancellation(audioStream);
								noiseCancellationSession = result;
								const processedTrack = result.stream.getAudioTracks()[0];
								if (processedTrack?.readyState === "live") {
									stream.removeTrack(rawTrack);
									stream.addTrack(processedTrack);
								}
							}
						} catch (err) {
							console.error("[NC] Failed to apply on initial join:", err);
						}
					}
				}
			}
		} catch (error) {
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

	const toggleMicrophone = async () => {
		try {
			const enable = !mediaState.isMicOn;
			const mh = getMediaHandler(sfuManager.value);
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
				if (mh?.audioProducer) {
					const audioProducer = mh.audioProducer;
					const currentTrack = audioProducer.track;
					if (currentTrack && currentTrack.readyState === "ended") {
						if (track && typeof audioProducer.replaceTrack === "function") {
							await audioProducer.replaceTrack({ track });
						}
					} else if (track) {
						track.enabled = true;
					}
					audioProducer.resume?.();

					if (sfuClient.isConnected()) {
						sfuClient.resumeProducer(audioProducer.id).catch(() => {});
					}
				} else if (track && sfuManager.value?.transportManager) {
					const producer =
						await sfuManager.value.transportManager.createProducer(track, {
							type: "microphone",
						});
					mh?.setProducers({ audioProducer: producer as ProducerLike });
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

				if (mh?.audioProducer) {
					const audioProducer = mh.audioProducer;
					audioProducer.pause?.();

					if (sfuClient.isConnected()) {
						sfuClient.pauseProducer(audioProducer.id);
					}
				}
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
			console.error("Failed to toggle microphone:", error);
			toast.error("Failed to toggle microphone");
		}
	};

	const toggleCamera = async () => {
		try {
			const enable = !mediaState.isCameraOn;
			const mh = getMediaHandler(sfuManager.value);
			let stream = mediaState.localStream;

			if (enable) {
				if (!stream) {
					try {
						const { stream: nextStream } = await acquireUserMedia(
							true,
							mediaState.isMicOn,
						);
						stream = nextStream;
						mediaState.localStream = stream;
						mediaState.cameraPermissionGranted = true;
						if (mediaState.isMicOn) {
							mediaState.microphonePermissionGranted = true;
						}
					} catch (err) {
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
					const hasVideo = stream.getVideoTracks().length > 0;
					if (!hasVideo) {
						try {
							const { stream: videoOnly } = await acquireUserMedia(true, false);
							const newTrack = videoOnly.getVideoTracks()[0];
							if (newTrack) {
								stream.addTrack(newTrack);
								mediaState.cameraPermissionGranted = true;
								if (mediaState.localVideo) {
									const localVideoEl =
										mediaState.localVideo as HTMLVideoElement;
									const videoTracks = stream.getVideoTracks();
									if (videoTracks.length > 0) {
										localVideoEl.srcObject = new MediaStream(videoTracks);
									}
								}
							}
						} catch (err) {
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
						const vt = stream.getVideoTracks()[0];
						if (vt.readyState === "ended") {
							try {
								const { stream: videoOnly } = await acquireUserMedia(
									true,
									false,
								);
								const newTrack = videoOnly.getVideoTracks()[0];
								if (newTrack) {
									stream.removeTrack(vt);
									stream.addTrack(newTrack);
									mediaState.cameraPermissionGranted = true;
									if (mediaState.localVideo) {
										const localVideoEl =
											mediaState.localVideo as HTMLVideoElement;
										const videoTracks = stream.getVideoTracks();
										if (videoTracks.length > 0) {
											localVideoEl.srcObject = new MediaStream(videoTracks);
										}
									}
								}
							} catch (err) {
								console.error("Failed to replace video track:", err);
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
							vt.enabled = true;
						}
					}
				}

				const bgEffects = getBackgroundEffectsFromStorage();
				if (
					bgEffects.anyEnabled ||
					shouldApplyBackgroundEffectsWhenVideoAvailable
				) {
					await applyBackgroundEffectsToLocalStream();
				}

				const track = stream.getVideoTracks()[0];
				if (mh?.videoProducer) {
					const videoProducer = mh.videoProducer;
					const trackToReplace = mediaState.processedStream
						? mediaState.processedStream.getVideoTracks()[0]
						: track;
					try {
						if (
							trackToReplace &&
							typeof videoProducer.replaceTrack === "function"
						) {
							await videoProducer.replaceTrack({ track: trackToReplace });
						}
					} catch (error) {
						console.warn("Failed to replace video track:", error);
					}
				} else if (track && sfuManager.value?.transportManager) {
					const trackToPublish = mediaState.processedStream
						? mediaState.processedStream.getVideoTracks()[0]
						: track;

					const producer =
						await sfuManager.value.transportManager.createProducer(
							trackToPublish,
							{ type: "camera" },
						);
					mh?.setProducers({ videoProducer: producer as ProducerLike });
				}
			} else {
				if (stream) {
					const vt = stream.getVideoTracks()[0];
					if (vt) {
						vt.stop();
						stream.removeTrack(vt);
					}
				}

				if (backgroundSession) {
					backgroundSession.cleanup();
					backgroundSession = null;
				}
				if (mediaState.processedStream) {
					backgroundEffects.stopProcessing();
					mediaState.processedStream = null;
				}

				if (mh?.videoProducer) {
					const videoProducer = mh.videoProducer;
					videoProducer.close?.();

					if (sfuClient.isConnected()) {
						sfuClient.closeProducer(videoProducer.id).catch(() => {});
					}

					mh.videoProducer = null;
				}
			}

			mediaState.isCameraOn = enable;
			setCameraEnabled(enable);

			if (sfuClient.isConnected()) {
				try {
					sfuClient.sendMediaControl(enable ? "video_on" : "video_off");
				} catch (_) {
					sfuClient.sendMediaControl({ type: "video", enabled: enable });
				}
			}
		} catch (error) {
			console.error("Failed to toggle camera:", error);
			toast.error("Failed to toggle camera");
		}
	};

	const toggleScreenShare = async () => {
		try {
			if (mediaState.isScreenSharing) {
				const mediaHandler = getMediaHandler(sfuManager.value);
				if (mediaHandler) {
					const sp = mediaHandler.screenProducer;
					if (sp?.id) {
						sp.close?.();

						if (sfuClient.isConnected()) {
							sfuClient.closeProducer(sp.id);
						}
					}
					mediaHandler.stopScreenShare();
				}

				const tracks = mediaState.screenShareStream?.getTracks?.();
				if (tracks) {
					for (const t of tracks) {
						t.stop();
					}
				}
				mediaState.isScreenSharing = false;
				const selfId = currentUser.currentUser.value?.user_id as string;
				if (selfId && mediaState.screenShareStreams) {
					if (mediaState.screenShareStreams[selfId]) {
						delete mediaState.screenShareStreams[selfId];
					}
				}
				mediaState.screenShareStream = null;

				if (sfuClient.isConnected()) {
					sfuClient.sendScreenShare("stop_share");
				}
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
					if (!screenTrack || !sfuManager.value?.transportManager) {
						throw new Error("Screen share transport is not available");
					}

					const producer =
						await sfuManager.value.transportManager.createProducer(
							screenTrack,
							{ type: "screen" },
						);
					const mh = getMediaHandler(sfuManager.value);
					if (mh) {
						mh.setProducers({
							screenProducer: producer,
						});
					}

					// Ensure audio producer is available
					if (mh?.audioProducer?.paused) {
						mh.audioProducer.resume?.();
					} else if (!mh?.audioProducer) {
						const localStream = mediaState.localStream;
						const micTrack = localStream?.getAudioTracks?.()[0];
						if (micTrack && sfuManager.value?.transportManager) {
							try {
								const newProducer =
									await sfuManager.value.transportManager.createProducer(
										micTrack,
										{ type: "microphone" },
									);
								mh?.setProducers({
									audioProducer: newProducer as ProducerLike,
								});
							} catch (err) {
								console.warn(
									"Failed to create audio producer after starting screen share",
									err,
								);
							}
						}
					}
				} catch (pubErr) {
					console.error("Failed to publish screen share producer:", pubErr);
					mediaState.isScreenSharing = false;
					mediaState.screenShareStream = null;
					for (const t of screenStream.getTracks()) {
						t.stop();
					}
					throw pubErr;
				}

				screenStream.getVideoTracks()[0].addEventListener("ended", () => {
					if (mediaState.isScreenSharing) {
						toggleScreenShare();
					}
				});

				if (sfuClient.isConnected()) {
					sfuClient.sendScreenShare("start_share", {
						startedAt: mediaState.localScreenShareStartedAt,
					});
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

	function setLocalVideoRef(el: HTMLElement | null) {
		localVideo.value = el;
		if (el && mediaState.localStream) {
			const videoEl = el as HTMLVideoElement;
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

	const setRemoteVideoRef = (participantId: string, el: HTMLElement) => {
		if (sfuManager.value?.videoManager) {
			sfuManager.value.videoManager.registerVideoElement(participantId, el);
		}
	};

	const setScreenShareVideoRef = (el: HTMLElement) => {
		if (!el) return;

		const participantId = (
			el as HTMLElement & { dataset: Record<string, string> }
		).dataset?.participantId;
		if (participantId) {
			screenShareVideoElements.set(participantId, el);

			const store = mediaState.screenShareStreams || {};
			let stream: MediaStream | null = store[participantId] ?? null;
			if (!stream && currentUser.currentUser.value?.user_id === participantId) {
				stream = mediaState.screenShareStream;
			}

			if (stream instanceof MediaStream) {
				const currentStreamId = stream.id;
				const srcObject = (el as HTMLVideoElement).srcObject;
				const existingStreamId =
					srcObject instanceof MediaStream ? srcObject.id : undefined;

				if (
					!(el as HTMLVideoElement).srcObject ||
					existingStreamId !== currentStreamId
				) {
					(el as HTMLVideoElement).srcObject = stream;
					(el as HTMLVideoElement).play?.().catch(() => {});
				}
			}
		}
	};

	// Watch noise cancellation toggle
	watch(prefNoiseCancellationEnabled, async (enabled) => {
		const mh = getMediaHandler(sfuManager.value);
		if (!mediaState.isMicOn || !mh) {
			return;
		}

		try {
			const freshTrack = await getFreshMicTrack();
			if (!freshTrack) {
				return;
			}

			if (noiseCancellationSession) {
				noiseCancellationSession.cleanup();
				noiseCancellationSession = null;
			}

			let trackToPublish = freshTrack;

			if (enabled) {
				const audioStream = new MediaStream([freshTrack]);
				const result =
					await noiseCancellation.applyNoiseCancellation(audioStream);
				noiseCancellationSession = result;

				const processedTrack = result.stream.getAudioTracks()[0];
				if (processedTrack && processedTrack.readyState === "live") {
					trackToPublish = processedTrack;
				}
			}

			if (mh?.audioProducer && trackToPublish.readyState === "live") {
				if (typeof mh.audioProducer.replaceTrack === "function") {
					await mh.audioProducer.replaceTrack({ track: trackToPublish });
				}
			}
		} catch (error) {
			console.error("[Noise Cancellation] Failed to toggle:", error);
		}
	});

	// Watch chat state for notification context
	watch(
		() => mediaState.isScreenSharing,
		(isSharing) => {
			notificationContextManager.updateScreenShareState(isSharing);
		},
	);

	// Watch processed stream changes and update producer track
	watch(
		() => mediaState.processedStream,
		async (newStream) => {
			const reason = newStream
				? "processed-stream-change"
				: "processed-stream-removed";
			await replacePublishedVideoTrack(newStream, reason);
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

	onUnmounted(() => {
		if (backgroundSession) {
			backgroundSession.cleanup();
			backgroundSession = null;
		}
		backgroundEffects.stopProcessing();

		if (noiseCancellationSession) {
			noiseCancellationSession.cleanup();
			noiseCancellationSession = null;
		}

		if (mediaState.localStream) {
			for (const track of mediaState.localStream.getTracks()) {
				track.stop();
			}
		}

		if (mediaState.screenShareStream) {
			for (const track of mediaState.screenShareStream.getTracks()) {
				track.stop();
			}
		}
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
		setLocalVideoRef,
		setRemoteVideoRef,
		setScreenShareVideoRef,
		processedStream: mediaState.processedStream,
	};
}
