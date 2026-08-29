import type { DeviceType } from "./DeviceManager";

export interface LocalCaptureDeviceManager {
	enumerateDevices: () => Promise<void>;
	isDeviceAvailable: (deviceId: string, deviceType: DeviceType) => boolean;
	getDefaultDevice: (
		deviceType: DeviceType,
	) => { deviceId: string; label?: string } | null;
	findDeviceById: (
		deviceId: string,
		deviceType: DeviceType,
	) => { label?: string } | undefined;
}

export interface LocalCaptureOperation {
	readonly generation: number;
	readonly signal: AbortSignal;
	readonly ownedStreams: Set<MediaStream>;
	publicationOwner?: object | null;
}

export type LocalCaptureKindPublicationResult =
	| { status: "published" }
	| { status: "failed"; error: unknown };

export interface LocalCapturePublicationResult {
	video?: LocalCaptureKindPublicationResult;
	audio?: LocalCaptureKindPublicationResult;
}

export interface PreparedMicrophoneTrack {
	track: MediaStreamTrack;
	commit: () => void;
	discard: () => void;
}

export interface LocalCapturePublication {
	getOwner: () => object | null;
	reconcileCamera: (
		track: MediaStreamTrack | null,
		reason: string,
		createProducerIfMissing: boolean,
		operation?: LocalCaptureOperation,
	) => Promise<void>;
	reconcileMicrophone: (
		track: MediaStreamTrack | null,
		resume: boolean,
		operation?: LocalCaptureOperation,
	) => Promise<void>;
	publish: (
		stream: MediaStream,
		options: { publishVideo: boolean; publishAudio: boolean },
	) => Promise<LocalCapturePublicationResult>;
}

export interface LocalCaptureSessionOptions {
	capture: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
	devices: LocalCaptureDeviceManager;
	publication: LocalCapturePublication;
	getLocalStream: () => MediaStream | null;
	setLocalStream: (stream: MediaStream) => void;
	isCameraEnabled: () => boolean;
	isMicrophoneEnabled: () => boolean;
	setPermissionGranted: (type: "camera" | "microphone") => void;
	applyCameraEffects: (options: {
		forceRestart?: boolean;
		createProducerIfMissing?: boolean;
		recoverPublicationFailure?: boolean;
		operation: LocalCaptureOperation;
	}) => Promise<void>;
	cleanupCameraEffects: () => void;
	prepareMicrophone: (
		stream: MediaStream,
		operation: LocalCaptureOperation,
	) => Promise<PreparedMicrophoneTrack | null>;
	cleanupMicrophoneEffects: () => void;
	getEffectiveCameraTrack: () => MediaStreamTrack | null;
	getEffectiveMicrophoneTrack: () => MediaStreamTrack | null;
	onLocalStreamChanged?: () => void;
	onCameraDisabled: (error: unknown) => void;
	onMicrophoneDisabled: (error: unknown) => void;
	getSelectedDeviceId: (type: "camera" | "microphone") => string;
	setSelectedDeviceId: (
		type: "camera" | "microphone",
		deviceId: string,
	) => void;
	getCameraConstraints: () => MediaTrackConstraints;
	onCameraTrackEnded?: (track: MediaStreamTrack) => Promise<void>;
	onMicrophoneTrackEnded?: (track: MediaStreamTrack) => Promise<void>;
	onTrackRecoveryError?: (
		type: "camera" | "microphone",
		error: unknown,
	) => void;
}

export interface MediaDeviceOverrides {
	cameraDeviceId?: string;
	micDeviceId?: string;
}

export interface ReacquireMediaOptions {
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

const BLUETOOTH_DEVICE_LABEL_REGEX =
	/airpods|bluetooth|\bbt\b|wireless|jbl|bose|sony|beats|sennheiser|akg|jabra|anker|skullcandy|shure|bang\s*&\s*olufsen|b\s*&\s*o|marley|skullcandy|logitech\s*bt|plantronics|poly|razer\s*(?:bt|opus)|corsair|steelseries|hyperx|audeze|sennheiser|soundcore|tozo|earfun|earbuds|earbud/i;

const isBluetoothMicLabel = (label: string | undefined): boolean =>
	!!label && BLUETOOTH_DEVICE_LABEL_REGEX.test(label.toLowerCase());

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

export class LocalCaptureSession {
	private cameraTransitionQueue: Promise<unknown> = Promise.resolve();
	private microphoneTransitionQueue: Promise<unknown> = Promise.resolve();
	private streamCommitQueue: Promise<unknown> = Promise.resolve();
	private lifecycleGeneration = 0;
	private readonly lifecycleAbortController = new AbortController();
	private readonly stoppedTracks = new WeakSet<MediaStreamTrack>();
	private readonly detachedCameraTracks = new Set<MediaStreamTrack>();
	private observedCameraTrack: MediaStreamTrack | null = null;
	private observedMicrophoneTrack: MediaStreamTrack | null = null;
	private cameraEndedListener: (() => void) | null = null;
	private microphoneEndedListener: (() => void) | null = null;
	private disposal: Promise<void> | null = null;

	constructor(private readonly options: LocalCaptureSessionOptions) {
		this.observeLocalTracks();
	}

	private lifecycleAbort(): DOMException {
		return new DOMException("Local capture lifecycle has ended", "AbortError");
	}

	createOperation(): LocalCaptureOperation {
		const operation: LocalCaptureOperation = {
			generation: this.lifecycleGeneration,
			signal: this.lifecycleAbortController.signal,
			ownedStreams: new Set(),
		};
		const owner = this.options.publication.getOwner();
		if (owner) operation.publicationOwner = owner;
		return operation;
	}

	get isDisposed(): boolean {
		return this.lifecycleAbortController.signal.aborted;
	}

	isCurrent(operation: LocalCaptureOperation): boolean {
		return (
			!operation.signal.aborted &&
			operation.generation === this.lifecycleGeneration &&
			(operation.publicationOwner === undefined ||
				operation.publicationOwner === this.options.publication.getOwner())
		);
	}

	isPublicationOwnerReplaced(operation: LocalCaptureOperation): boolean {
		return (
			!operation.signal.aborted &&
			operation.generation === this.lifecycleGeneration &&
			operation.publicationOwner !== undefined &&
			operation.publicationOwner !== this.options.publication.getOwner()
		);
	}

	isLifecycleAbort(error: unknown, operation?: LocalCaptureOperation): boolean {
		const candidate = error as { name?: unknown; message?: unknown } | null;
		return (
			candidate?.name === "AbortError" &&
			((operation?.signal ?? this.lifecycleAbortController.signal).aborted ||
				candidate.message === "Local capture lifecycle has ended")
		);
	}

	assertCurrent(operation?: LocalCaptureOperation): void {
		if (operation && !this.isCurrent(operation)) throw this.lifecycleAbort();
	}

	assertGeneration(generation: number): void {
		if (generation !== this.lifecycleGeneration) throw this.lifecycleAbort();
	}

	runCameraTransition<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.cameraTransitionQueue.then(async () => {
			try {
				return await operation();
			} finally {
				this.observeLocalTracks();
			}
		});
		this.cameraTransitionQueue = result.catch(() => undefined);
		return result;
	}

	runMicrophoneTransition<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.microphoneTransitionQueue.then(async () => {
			try {
				return await operation();
			} finally {
				this.observeLocalTracks();
			}
		});
		this.microphoneTransitionQueue = result.catch(() => undefined);
		return result;
	}

	private runCombinedTransition<T>(operation: () => Promise<T>): Promise<T> {
		const previousCamera = this.cameraTransitionQueue;
		const previousMicrophone = this.microphoneTransitionQueue;
		const result = Promise.all([previousCamera, previousMicrophone]).then(
			async () => {
				try {
					return await operation();
				} finally {
					this.observeLocalTracks();
				}
			},
		);
		const settled = result.catch(() => undefined);
		this.cameraTransitionQueue = settled;
		this.microphoneTransitionQueue = settled;
		return result;
	}

	runStreamCommit<T>(
		operation: LocalCaptureOperation,
		commit: () => T,
	): Promise<T> {
		const result = this.streamCommitQueue.then(() => {
			this.assertCurrent(operation);
			const value = commit();
			this.assertCurrent(operation);
			this.observeLocalTracks();
			return value;
		});
		this.streamCommitQueue = result.catch(() => undefined);
		return result;
	}

	commitLocalTrack(
		kind: "audio" | "video",
		track: MediaStreamTrack,
		operation: LocalCaptureOperation,
	): Promise<{ stream: MediaStream; replacedTracks: MediaStreamTrack[] }> {
		return this.runStreamCommit(operation, () => {
			if (track.readyState !== "live") {
				throw new Error(`Cannot commit ended ${kind} track`);
			}
			const stream = this.options.getLocalStream() ?? new MediaStream();
			const replacedTracks =
				kind === "video" ? stream.getVideoTracks() : stream.getAudioTracks();
			for (const replacedTrack of replacedTracks) {
				stream.removeTrack(replacedTrack);
			}
			if (!stream.getTracks().includes(track)) stream.addTrack(track);
			if (this.options.getLocalStream() !== stream) {
				this.options.setLocalStream(stream);
			}
			return { stream, replacedTracks };
		});
	}

	stopTrack(track: MediaStreamTrack): void {
		if (this.stoppedTracks.has(track)) return;
		this.stoppedTracks.add(track);
		track.stop();
	}

	stopStream(stream: MediaStream): void {
		for (const track of stream.getTracks()) this.stopTrack(track);
	}

	ownStream(operation: LocalCaptureOperation, stream: MediaStream): void {
		operation.ownedStreams.add(stream);
		if (!this.isCurrent(operation)) {
			this.stopStream(stream);
			throw this.lifecycleAbort();
		}
	}

	releaseOwnedStreams(operation: LocalCaptureOperation): void {
		operation.ownedStreams.clear();
	}

	relinquishOwnedStreams(operation: LocalCaptureOperation): void {
		const sharedTracks = new Set(
			this.options.getLocalStream()?.getTracks() ?? [],
		);
		for (const stream of operation.ownedStreams) {
			for (const track of stream.getTracks()) {
				if (!sharedTracks.has(track)) this.stopTrack(track);
			}
		}
		operation.ownedStreams.clear();
	}

	discardOwnedStreams(operation: LocalCaptureOperation): void {
		const localStream = this.options.getLocalStream();
		for (const stream of operation.ownedStreams) {
			for (const track of stream.getTracks()) {
				localStream?.removeTrack(track);
				this.stopTrack(track);
			}
		}
		operation.ownedStreams.clear();
	}

	detachCameraTrack(track: MediaStreamTrack): void {
		this.detachedCameraTracks.add(track);
	}

	releaseDetachedCameraTrack(track: MediaStreamTrack): void {
		this.detachedCameraTracks.delete(track);
	}

	async reconcileCamera(
		track: MediaStreamTrack | null,
		reason: string,
		createProducerIfMissing = true,
		operation?: LocalCaptureOperation,
	): Promise<void> {
		this.assertCurrent(operation);
		if (track && track.readyState !== "live") {
			throw new Error(`Cannot reconcile ended camera track (${reason})`);
		}
		if (operation && operation.publicationOwner === undefined) {
			const owner = this.options.publication.getOwner();
			if (owner) operation.publicationOwner = owner;
		}
		await this.options.publication.reconcileCamera(
			track,
			reason,
			createProducerIfMissing,
			operation,
		);
		this.assertCurrent(operation);
		if (track && track.readyState !== "live") {
			throw new Error(`Camera track ended during reconciliation (${reason})`);
		}
	}

	async publish(
		stream: MediaStream,
		options: { publishVideo: boolean; publishAudio: boolean },
		operation: LocalCaptureOperation,
	): Promise<LocalCapturePublicationResult> {
		this.assertCurrent(operation);
		if (operation.publicationOwner === undefined) {
			const owner = this.options.publication.getOwner();
			if (owner) operation.publicationOwner = owner;
		}
		if (!operation.publicationOwner) {
			return {
				...(options.publishVideo
					? {
							video: {
								status: "failed" as const,
								error: new Error("Video publication owner is unavailable"),
							},
						}
					: {}),
				...(options.publishAudio
					? {
							audio: {
								status: "failed" as const,
								error: new Error("Audio publication owner is unavailable"),
							},
						}
					: {}),
			};
		}
		const published = await this.options.publication.publish(stream, options);
		this.assertCurrent(operation);
		const result: LocalCapturePublicationResult = {};
		if (options.publishVideo) {
			result.video = stream
				.getVideoTracks()
				.some((track) => track.readyState === "live")
				? (published.video ?? {
						status: "failed",
						error: new Error("Video publication did not report an outcome"),
					})
				: {
						status: "failed",
						error: new Error("Local track ended during publication"),
					};
		}
		if (options.publishAudio) {
			result.audio = stream
				.getAudioTracks()
				.some((track) => track.readyState === "live")
				? (published.audio ?? {
						status: "failed",
						error: new Error("Audio publication did not report an outcome"),
					})
				: {
						status: "failed",
						error: new Error("Local track ended during publication"),
					};
		}
		return result;
	}

	async reconcileMicrophone(
		track: MediaStreamTrack | null,
		resume: boolean,
		operation?: LocalCaptureOperation,
	): Promise<void> {
		this.assertCurrent(operation);
		if (track && track.readyState !== "live") {
			throw new Error("Cannot reconcile ended microphone track");
		}
		if (operation && operation.publicationOwner === undefined) {
			const owner = this.options.publication.getOwner();
			if (owner) operation.publicationOwner = owner;
		}
		await this.options.publication.reconcileMicrophone(
			track,
			resume,
			operation,
		);
		this.assertCurrent(operation);
		if (track && track.readyState !== "live") {
			throw new Error("Microphone track ended during reconciliation");
		}
	}

	async acquireUserMedia(
		videoEnabled: boolean,
		audioEnabled: boolean,
		deviceOverrides: MediaDeviceOverrides = {},
		operation: LocalCaptureOperation = this.createOperation(),
	): Promise<{ stream: MediaStream; constraints: MediaStreamConstraints }> {
		const operationGeneration = operation.generation;
		const lifecycleSignal = operation.signal;
		const stagedSelections = new Map<DeviceType, string>();
		const constraints = await this.buildMediaConstraints(
			videoEnabled,
			audioEnabled,
			operationGeneration,
			stagedSelections,
		);
		this.assertCurrent(operation);

		if (videoEnabled && Object.hasOwn(deviceOverrides, "cameraDeviceId")) {
			const validCameraId = await this.getValidDeviceId(
				deviceOverrides.cameraDeviceId ?? null,
				"camera",
				operationGeneration,
				stagedSelections,
			);
			if (validCameraId && typeof constraints.video === "object") {
				constraints.video.deviceId = { exact: validCameraId };
			} else if (typeof constraints.video === "object") {
				delete constraints.video.deviceId;
			}
		}

		if (audioEnabled && Object.hasOwn(deviceOverrides, "micDeviceId")) {
			const validMicId = await this.getValidDeviceId(
				deviceOverrides.micDeviceId ?? null,
				"microphone",
				operationGeneration,
				stagedSelections,
			);
			if (validMicId && typeof constraints.audio === "object") {
				constraints.audio.deviceId = { exact: validMicId };
			} else if (typeof constraints.audio === "object") {
				delete constraints.audio.deviceId;
			}
		}

		const requestUserMedia = () => {
			this.assertCurrent(operation);
			const browserRequest = this.options.capture(constraints);
			void browserRequest.then(
				(requestedStream) => {
					if (
						lifecycleSignal.aborted ||
						operationGeneration !== this.lifecycleGeneration
					) {
						this.stopStream(requestedStream);
					}
				},
				() => {},
			);

			return new Promise<MediaStream>((resolve, reject) => {
				const abort = () => reject(this.lifecycleAbort());
				lifecycleSignal.addEventListener("abort", abort, { once: true });
				browserRequest.then(
					(requestedStream) => {
						lifecycleSignal.removeEventListener("abort", abort);
						if (
							lifecycleSignal.aborted ||
							operationGeneration !== this.lifecycleGeneration
						) {
							this.stopStream(requestedStream);
							reject(this.lifecycleAbort());
							return;
						}
						resolve(requestedStream);
					},
					(error) => {
						lifecycleSignal.removeEventListener("abort", abort);
						if (
							lifecycleSignal.aborted ||
							operationGeneration !== this.lifecycleGeneration
						) {
							reject(this.lifecycleAbort());
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
			if (this.isLifecycleAbort(error, operation)) throw error;
			const audioConstraints =
				typeof constraints.audio === "object" ? constraints.audio : null;
			const videoConstraints =
				typeof constraints.video === "object" ? constraints.video : null;
			const audioDeviceId = audioConstraints?.deviceId;
			const videoDeviceId = videoConstraints?.deviceId;

			if (
				!this.isMissingDeviceError(error) ||
				(!audioDeviceId && !videoDeviceId)
			) {
				throw error;
			}

			if (audioDeviceId && videoDeviceId) {
				delete audioConstraints.deviceId;
				try {
					stream = await requestUserMedia();
					stagedSelections.set("microphone", "");
				} catch (audioFallbackError) {
					if (this.isLifecycleAbort(audioFallbackError, operation))
						throw audioFallbackError;
					if (!this.isMissingDeviceError(audioFallbackError))
						throw audioFallbackError;
					audioConstraints.deviceId = audioDeviceId;
					delete videoConstraints.deviceId;
				}

				if (!stream) {
					try {
						stream = await requestUserMedia();
						stagedSelections.set("camera", "");
					} catch (videoFallbackError) {
						if (this.isLifecycleAbort(videoFallbackError, operation))
							throw videoFallbackError;
						if (!this.isMissingDeviceError(videoFallbackError))
							throw videoFallbackError;
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
		if (!this.isCurrent(operation)) {
			this.stopStream(stream);
			throw this.lifecycleAbort();
		}
		for (const [deviceType, deviceId] of stagedSelections) {
			this.assertCurrent(operation);
			if (deviceType !== "speaker") {
				this.options.setSelectedDeviceId(deviceType, deviceId);
			}
		}
		return { stream, constraints };
	}

	reacquireMediaAfterE2EE(detail: ReacquireMediaOptions = {}): Promise<void> {
		const runTransition =
			detail.needsCamera === true && detail.needsMicrophone === true
				? this.runCombinedTransition.bind(this)
				: detail.needsMicrophone === true
					? this.runMicrophoneTransition.bind(this)
					: this.runCameraTransition.bind(this);
		return runTransition(async () => {
			const operation = this.createOperation();
			this.assertCurrent(operation);
			const requestedCamera =
				detail.needsCamera === true && this.options.isCameraEnabled();
			const requestedMicrophone =
				detail.needsMicrophone === true && this.options.isMicrophoneEnabled();
			if (!requestedCamera && !requestedMicrophone) return;
			const currentStream = this.options.getLocalStream();
			const cameraTrackBeforeRequest =
				currentStream
					?.getVideoTracks()
					.find((track) => track.readyState === "live") ?? null;
			const microphoneTrackBeforeRequest =
				currentStream
					?.getAudioTracks()
					.find((track) => track.readyState === "live") ?? null;

			let adoptedCamera = false;
			let adoptedMicrophone = false;
			let acquiredCameraTrack: MediaStreamTrack | null = null;
			let acquiredMicrophoneTrack: MediaStreamTrack | null = null;
			const rollbackKind = async (
				kind: "camera" | "microphone",
				error: unknown,
			) => {
				if (kind === "camera") {
					try {
						await this.reconcileCamera(
							null,
							"e2ee-publication-failed",
							false,
							operation,
						);
					} finally {
						if (this.isCurrent(operation)) {
							this.options.cleanupCameraEffects();
							if (acquiredCameraTrack) {
								this.options.getLocalStream()?.removeTrack(acquiredCameraTrack);
								this.stopTrack(acquiredCameraTrack);
							}
							this.options.onCameraDisabled(error);
						}
					}
				} else {
					try {
						await this.reconcileMicrophone(null, false, operation);
					} finally {
						if (this.isCurrent(operation)) {
							this.options.cleanupMicrophoneEffects();
							if (acquiredMicrophoneTrack) {
								this.options
									.getLocalStream()
									?.removeTrack(acquiredMicrophoneTrack);
								this.stopTrack(acquiredMicrophoneTrack);
							}
							this.options.onMicrophoneDisabled(error);
						}
					}
				}
			};
			try {
				const { stream: acquiredStream } = await this.acquireUserMedia(
					requestedCamera,
					requestedMicrophone,
					{},
					operation,
				);
				this.ownStream(operation, acquiredStream);
				this.assertCurrent(operation);
				const merged = mergeReacquiredMedia({
					acquiredStream,
					currentStream: this.options.getLocalStream(),
					requestedCamera,
					requestedMicrophone,
					cameraEnabled: this.options.isCameraEnabled(),
					microphoneEnabled: this.options.isMicrophoneEnabled(),
					cameraTrackBeforeRequest,
					microphoneTrackBeforeRequest,
				});
				adoptedCamera = merged.adoptedCamera;
				adoptedMicrophone = merged.adoptedMicrophone;
				const stream = merged.stream;
				acquiredCameraTrack = adoptedCamera
					? (acquiredStream.getVideoTracks()[0] ?? null)
					: null;
				acquiredMicrophoneTrack = adoptedMicrophone
					? (acquiredStream.getAudioTracks()[0] ?? null)
					: null;
				operation.ownedStreams.clear();
				const adoptedTracks = acquiredStream
					.getTracks()
					.filter((track) => stream.getTracks().includes(track));
				if (adoptedTracks.length > 0) {
					operation.ownedStreams.add(new MediaStream(adoptedTracks));
				}
				this.assertCurrent(operation);
				this.options.setLocalStream(stream);
				if (adoptedCamera) {
					this.options.setPermissionGranted("camera");
					await this.options.applyCameraEffects({
						forceRestart: true,
						createProducerIfMissing: false,
						recoverPublicationFailure: true,
						operation,
					});
					this.assertCurrent(operation);
				}
				if (adoptedMicrophone) {
					this.options.setPermissionGranted("microphone");
				}
				this.options.onLocalStreamChanged?.();

				if (!adoptedCamera && !adoptedMicrophone) {
					operation.ownedStreams.clear();
					return;
				}
				const effectiveVideoTrack = adoptedCamera
					? this.options.getEffectiveCameraTrack()
					: null;
				const effectiveAudioTrack = adoptedMicrophone
					? this.options.getEffectiveMicrophoneTrack()
					: null;
				const videoTrack =
					effectiveVideoTrack?.readyState === "live" ? effectiveVideoTrack : null;
				const audioTrack =
					effectiveAudioTrack?.readyState === "live" ? effectiveAudioTrack : null;
				let publication: LocalCapturePublicationResult = {
					...(adoptedCamera && !videoTrack
						? {
								video: {
									status: "failed" as const,
									error: new Error(
										"No live effective camera track is available for publication",
									),
								},
							}
						: {}),
					...(adoptedMicrophone && !audioTrack
						? {
								audio: {
									status: "failed" as const,
									error: new Error(
										"No live effective microphone track is available for publication",
									),
								},
							}
						: {}),
				};
				if (videoTrack || audioTrack) {
					try {
						publication = {
							...publication,
							...(await this.publish(
								new MediaStream([
									...(videoTrack ? [videoTrack] : []),
									...(audioTrack ? [audioTrack] : []),
								]),
								{
									publishVideo: !!videoTrack,
									publishAudio: !!audioTrack,
								},
								operation,
							)),
						};
					} catch (error) {
						if (!this.isCurrent(operation)) throw error;
						const rollbacks: Promise<void>[] = [];
						if (adoptedCamera) rollbacks.push(rollbackKind("camera", error));
						if (adoptedMicrophone) {
							rollbacks.push(rollbackKind("microphone", error));
						}
						await Promise.allSettled(rollbacks);
						operation.ownedStreams.clear();
						throw error;
					}
				}

				const failedKinds: Array<{
					kind: "camera" | "microphone";
					error: unknown;
				}> = [];
				if (adoptedCamera && publication.video?.status === "failed") {
					failedKinds.push({
						kind: "camera",
						error: publication.video.error,
					});
				}
				if (adoptedMicrophone && publication.audio?.status === "failed") {
					failedKinds.push({
						kind: "microphone",
						error: publication.audio.error,
					});
				}
				if (failedKinds.length > 0) {
					await Promise.allSettled(
						failedKinds.map(({ kind, error }) => rollbackKind(kind, error)),
					);
					operation.ownedStreams.clear();
					throw failedKinds.length === 1
						? failedKinds[0].error
						: new AggregateError(
								failedKinds.map(({ error }) => error),
								"Failed to publish reacquired local media",
							);
				}
				operation.ownedStreams.clear();
			} catch (error) {
				if (this.isPublicationOwnerReplaced(operation)) {
					this.relinquishOwnedStreams(operation);
					return;
				}
				this.discardOwnedStreams(operation);
				if (
					!this.isCurrent(operation) ||
					this.isLifecycleAbort(error, operation)
				) {
					return;
				}
				throw error;
			}
		});
	}

	switchCamera(deviceId: string): Promise<void> {
		return this.runCameraTransition(async () => {
			const operation = this.createOperation();
			this.assertCurrent(operation);
			const localStream = this.options.getLocalStream();
			if (!this.options.isCameraEnabled() || !localStream) {
				this.options.setSelectedDeviceId("camera", deviceId);
				return;
			}

			const oldVideoTracks = localStream.getVideoTracks();
			let candidateStream: MediaStream;
			try {
				({ stream: candidateStream } = await this.acquireUserMedia(
					true,
					false,
					{ cameraDeviceId: deviceId },
					operation,
				));
				this.ownStream(operation, candidateStream);
			} catch (error) {
				if (
					!this.isCurrent(operation) ||
					this.isLifecycleAbort(error, operation)
				) {
					this.discardOwnedStreams(operation);
					return;
				}
				throw error;
			}
			const candidateTracks = candidateStream.getVideoTracks();
			const newVideoTrack = candidateTracks.find(
				(track) => track.readyState === "live",
			);
			if (!newVideoTrack) {
				this.discardOwnedStreams(operation);
				return;
			}

			await this.runStreamCommit(operation, () => {
				for (const track of oldVideoTracks) {
					this.detachCameraTrack(track);
					localStream.removeTrack(track);
				}
				localStream.addTrack(newVideoTrack);
			});

			try {
				await this.options.applyCameraEffects({
					forceRestart: true,
					operation,
				});
				this.assertCurrent(operation);
				if (
					newVideoTrack.readyState !== "live" ||
					!this.options
						.getLocalStream()
						?.getVideoTracks()
						.includes(newVideoTrack)
				) {
					throw new Error("Camera track ended during effects startup");
				}
				for (const track of oldVideoTracks) {
					this.stopTrack(track);
					this.releaseDetachedCameraTrack(track);
				}
				this.options.setSelectedDeviceId("camera", deviceId);
				this.releaseOwnedStreams(operation);
			} catch (error) {
				if (
					!this.isCurrent(operation) ||
					this.isLifecycleAbort(error, operation)
				) {
					if (this.isPublicationOwnerReplaced(operation)) {
						this.relinquishOwnedStreams(operation);
						const currentTracks = new Set(
							this.options.getLocalStream()?.getTracks() ?? [],
						);
						for (const track of oldVideoTracks) {
							if (!currentTracks.has(track)) this.stopTrack(track);
							this.releaseDetachedCameraTrack(track);
						}
						return;
					}
					this.discardOwnedStreams(operation);
					if (!operation.signal.aborted) {
						this.options.cleanupCameraEffects();
						for (const track of oldVideoTracks) {
							if (track.readyState === "live") localStream.addTrack(track);
							this.releaseDetachedCameraTrack(track);
						}
						this.options.onLocalStreamChanged?.();
					}
					return;
				}
				for (const track of oldVideoTracks) {
					if (track.readyState === "live") {
						localStream.addTrack(track);
						this.releaseDetachedCameraTrack(track);
					}
				}
				if (!this.options.isCameraEnabled()) {
					this.options.cleanupCameraEffects();
					for (const track of [...candidateTracks, ...oldVideoTracks]) {
						localStream.removeTrack(track);
						if (track.readyState === "live") this.stopTrack(track);
					}
					throw error;
				}

				const fallbackTrack = oldVideoTracks.find(
					(track) => track.readyState === "live",
				);
				try {
					if (!fallbackTrack) throw error;
					await this.reconcileCamera(
						fallbackTrack,
						"camera-switch-rollback",
						true,
						operation,
					);
					this.options.cleanupCameraEffects();
					for (const track of candidateTracks) {
						localStream.removeTrack(track);
						this.stopTrack(track);
					}
					this.releaseOwnedStreams(operation);
				} catch (fallbackError) {
					if (
						!this.isCurrent(operation) ||
						this.isLifecycleAbort(fallbackError, operation)
					) {
						this.discardOwnedStreams(operation);
						return;
					}
					await this.reconcileCamera(
						null,
						"camera-switch-rollback-failed",
						true,
						operation,
					);
					this.options.cleanupCameraEffects();
					for (const track of [...candidateTracks, ...oldVideoTracks]) {
						localStream.removeTrack(track);
						this.stopTrack(track);
					}
					this.options.onCameraDisabled(fallbackError);
					throw fallbackError;
				}
				console.warn("Failed to switch camera, restored raw video:", error);
			}

			this.assertCurrent(operation);
			this.options.onLocalStreamChanged?.();
		});
	}

	switchMicrophone(deviceId: string): Promise<void> {
		this.options.setSelectedDeviceId("microphone", deviceId);
		return this.runMicrophoneTransition(async () => {
			if (!this.options.isMicrophoneEnabled()) return;
			await this.replaceMicrophone({ micDeviceId: deviceId }, true);
		});
	}

	enableMicrophone(): Promise<boolean> {
		return this.runMicrophoneTransition(() =>
			this.enableMicrophoneInTransition(),
		);
	}

	enableMicrophoneInTransition(): Promise<boolean> {
		return this.replaceMicrophone({}, false);
	}

	private async replaceMicrophone(
		deviceOverrides: MediaDeviceOverrides,
		wasEnabled: boolean,
	): Promise<boolean> {
		const operation = this.createOperation();
		const previousStream = this.options.getLocalStream();
		const previousRawTracks = previousStream?.getAudioTracks() ?? [];
		const previousPublishedTrack = this.options.getEffectiveMicrophoneTrack();
		let prepared: PreparedMicrophoneTrack | null = null;
		let preparedSettled = false;
		let publicationMayHaveChanged = false;
		const discardPrepared = () => {
			if (!prepared || preparedSettled) return;
			preparedSettled = true;
			const wasEnded = prepared.track.readyState === "ended";
			try {
				prepared.discard();
			} finally {
				if (!wasEnded && prepared.track.readyState === "ended") {
					this.stoppedTracks.add(prepared.track);
				}
			}
		};

		try {
			const { stream: candidateStream } = await this.acquireUserMedia(
				false,
				true,
				deviceOverrides,
				operation,
			);
			this.ownStream(operation, candidateStream);
			const candidateTrack = candidateStream
				.getAudioTracks()
				.find((track) => track.readyState === "live");
			if (!candidateTrack) {
				throw new Error("No live microphone track was acquired");
			}

			prepared = await this.options.prepareMicrophone(
				candidateStream,
				operation,
			);
			this.assertCurrent(operation);
			if (!prepared || prepared.track.readyState !== "live") {
				throw new Error("No live processed microphone track is available");
			}
			if (this.options.isMicrophoneEnabled() !== wasEnabled) {
				throw this.lifecycleAbort();
			}

			publicationMayHaveChanged = true;
			await this.reconcileMicrophone(prepared.track, true, operation);
			const committed = await this.runStreamCommit(operation, () => {
				if (
					this.options.isMicrophoneEnabled() !== wasEnabled ||
					candidateTrack.readyState !== "live" ||
					prepared?.track.readyState !== "live"
				) {
					throw this.lifecycleAbort();
				}
				const stream = this.options.getLocalStream() ?? new MediaStream();
				const currentTracks = stream.getAudioTracks();
				const newerTrack = currentTracks.find(
					(track) =>
						track.readyState === "live" && !previousRawTracks.includes(track),
				);
				if (newerTrack) throw this.lifecycleAbort();
				prepared.commit();
				preparedSettled = true;
				for (const track of currentTracks) stream.removeTrack(track);
				stream.addTrack(candidateTrack);
				if (this.options.getLocalStream() !== stream) {
					this.options.setLocalStream(stream);
				}
				return { stream, replacedTracks: currentTracks };
			});

			for (const track of candidateStream.getTracks()) {
				if (track !== candidateTrack) this.stopTrack(track);
			}
			this.releaseOwnedStreams(operation);
			for (const track of committed.replacedTracks) this.stopTrack(track);
			this.options.setPermissionGranted("microphone");
			this.options.onLocalStreamChanged?.();
			return true;
		} catch (error) {
			try {
				discardPrepared();
			} catch {}
			this.discardOwnedStreams(operation);
			if (
				publicationMayHaveChanged &&
				!this.isDisposed &&
				this.isCurrent(operation)
			) {
				const canRestore =
					this.options.isMicrophoneEnabled() === wasEnabled &&
					wasEnabled &&
					previousPublishedTrack?.readyState === "live";
				let rollbackFailed = false;
				let rollbackError: unknown;
				try {
					if (canRestore) {
						await this.reconcileMicrophone(
							previousPublishedTrack,
							true,
							operation,
						);
					} else {
						await this.reconcileMicrophone(null, false, operation);
					}
				} catch (candidateRollbackError) {
					if (!this.isCurrent(operation)) return false;
					rollbackFailed = true;
					rollbackError = candidateRollbackError;
					try {
						await this.reconcileMicrophone(null, false, operation);
					} catch (clearError) {
						if (!this.isCurrent(operation)) return false;
						rollbackError = clearError;
					}
				}

				if (!this.isCurrent(operation)) return false;
				if (!canRestore || rollbackFailed) {
					this.options.cleanupMicrophoneEffects();
					for (const track of previousRawTracks) {
						previousStream?.removeTrack(track);
						this.stopTrack(track);
					}
					this.options.onMicrophoneDisabled(
						rollbackFailed ? rollbackError : error,
					);
				}
				if (rollbackFailed) throw rollbackError;
			}

			if (
				!this.isCurrent(operation) ||
				this.isLifecycleAbort(error, operation)
			) {
				return false;
			}
			throw error;
		}
	}

	private async getValidDeviceId(
		storedDeviceId: string | null,
		deviceType: DeviceType,
		generation?: number,
		stagedSelections?: Map<DeviceType, string>,
	): Promise<string | null> {
		if (!storedDeviceId) return null;

		try {
			await this.options.devices.enumerateDevices();
			if (generation !== undefined) this.assertGeneration(generation);

			if (this.options.devices.isDeviceAvailable(storedDeviceId, deviceType)) {
				return storedDeviceId;
			}

			const defaultDevice = this.options.devices.getDefaultDevice(deviceType);
			const nextDeviceId = defaultDevice?.deviceId ?? "";
			if (stagedSelections) {
				stagedSelections.set(deviceType, nextDeviceId);
			} else if (deviceType !== "speaker") {
				this.options.setSelectedDeviceId(deviceType, nextDeviceId);
			}
			return defaultDevice?.deviceId ?? null;
		} catch (error) {
			if (this.isLifecycleAbort(error)) throw error;
			console.warn(
				`Could not validate ${deviceType} device availability:`,
				error,
			);
			return storedDeviceId;
		}
	}

	private async buildMediaConstraints(
		videoEnabled: boolean,
		audioEnabled: boolean,
		generation: number,
		stagedSelections: Map<DeviceType, string>,
	): Promise<MediaStreamConstraints> {
		const constraints: MediaStreamConstraints = {};
		if (videoEnabled) {
			const videoConstraints = this.options.getCameraConstraints();
			const validCameraId = await this.getValidDeviceId(
				this.options.getSelectedDeviceId("camera"),
				"camera",
				generation,
				stagedSelections,
			);
			if (validCameraId) videoConstraints.deviceId = { exact: validCameraId };
			constraints.video = videoConstraints;
		}

		if (audioEnabled) {
			const validMicId = await this.getValidDeviceId(
				this.options.getSelectedDeviceId("microphone"),
				"microphone",
				generation,
				stagedSelections,
			);
			const selectedMic = validMicId
				? this.options.devices.findDeviceById(validMicId, "microphone")
				: undefined;
			const audioConstraints: MediaTrackConstraints = {
				channelCount: { ideal: 2 },
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: !isBluetoothMicLabel(selectedMic?.label),
			};
			if (validMicId) audioConstraints.deviceId = { exact: validMicId };
			constraints.audio = audioConstraints;
		}
		return constraints;
	}

	private isMissingDeviceError(candidate: unknown): boolean {
		const error = candidate as Error & { constraint?: string };
		return (
			error.name === "NotFoundError" ||
			(error.name === "OverconstrainedError" && error.constraint === "deviceId")
		);
	}

	observeLocalTracks(): void {
		const stream = this.options.getLocalStream();
		const cameraTrack =
			stream?.getVideoTracks().find((track) => track.readyState === "live") ??
			null;
		if (cameraTrack !== this.observedCameraTrack) {
			if (this.observedCameraTrack && this.cameraEndedListener) {
				this.observedCameraTrack.removeEventListener(
					"ended",
					this.cameraEndedListener,
				);
			}
			this.observedCameraTrack = cameraTrack;
			this.cameraEndedListener = cameraTrack
				? () => {
						void this.options
							.onCameraTrackEnded?.(cameraTrack)
							.catch((error) =>
								this.options.onTrackRecoveryError?.("camera", error),
							);
					}
				: null;
			if (cameraTrack && this.cameraEndedListener) {
				cameraTrack.addEventListener("ended", this.cameraEndedListener);
			}
		}

		const microphoneTrack =
			stream?.getAudioTracks().find((track) => track.readyState === "live") ??
			null;
		if (microphoneTrack !== this.observedMicrophoneTrack) {
			if (this.observedMicrophoneTrack && this.microphoneEndedListener) {
				this.observedMicrophoneTrack.removeEventListener(
					"ended",
					this.microphoneEndedListener,
				);
			}
			this.observedMicrophoneTrack = microphoneTrack;
			this.microphoneEndedListener = microphoneTrack
				? () => {
						void Promise.resolve()
							.then(() =>
								this.options.onMicrophoneTrackEnded?.(microphoneTrack),
							)
							.catch((error) =>
								this.options.onTrackRecoveryError?.("microphone", error),
							);
					}
				: null;
			if (microphoneTrack && this.microphoneEndedListener) {
				microphoneTrack.addEventListener("ended", this.microphoneEndedListener);
			}
		}
	}

	private stopObserving(): void {
		if (this.observedCameraTrack && this.cameraEndedListener) {
			this.observedCameraTrack.removeEventListener(
				"ended",
				this.cameraEndedListener,
			);
		}
		if (this.observedMicrophoneTrack && this.microphoneEndedListener) {
			this.observedMicrophoneTrack.removeEventListener(
				"ended",
				this.microphoneEndedListener,
			);
		}
		this.observedCameraTrack = null;
		this.observedMicrophoneTrack = null;
		this.cameraEndedListener = null;
		this.microphoneEndedListener = null;
	}

	dispose(
		beforeStoppingTracks: () => Promise<void>,
		afterStoppingTracks: () => Promise<void> = async () => {},
	): Promise<void> {
		if (this.disposal) return this.disposal;
		this.lifecycleGeneration++;
		this.lifecycleAbortController.abort(this.lifecycleAbort());
		this.stopObserving();
		this.disposal = Promise.all([
			this.cameraTransitionQueue,
			this.microphoneTransitionQueue,
			this.streamCommitQueue,
		]).then(async () => {
			let cleanupError: unknown;
			try {
				await beforeStoppingTracks();
			} catch (error) {
				cleanupError = error;
			} finally {
				for (const track of this.options.getLocalStream()?.getTracks() ?? []) {
					try {
						this.stopTrack(track);
					} catch {}
				}
				for (const track of this.detachedCameraTracks) {
					try {
						this.stopTrack(track);
					} catch {}
				}
				this.detachedCameraTracks.clear();
			}
			try {
				await afterStoppingTracks();
			} finally {
				if (cleanupError) throw cleanupError;
			}
		});
		return this.disposal;
	}
}
