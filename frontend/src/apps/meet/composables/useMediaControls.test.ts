import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, ref } from "vue";

vi.mock("frappe-ui", () => ({
	confirmDialog: vi.fn(),
	toast: {
		create: vi.fn(),
		error: vi.fn(),
		success: vi.fn(),
		warning: vi.fn(),
	},
}));

vi.mock("../data/mediaPreferences", () => ({
	cameraEnabled: ref(false),
	micEnabled: ref(false),
	noiseCancellationEnabled: ref(true),
	selectedCameraId: ref(""),
	selectedMicId: ref(""),
	selectedSpeakerId: ref(""),
	setCameraEnabled: vi.fn(),
	setMicEnabled: vi.fn(),
	setSelectedCameraId: vi.fn(),
	setSelectedMicId: vi.fn(),
	setSelectedSpeakerId: vi.fn(),
}));

const webglSpies = vi.hoisted(() => ({
	construct: vi.fn(),
	dispose: vi.fn(),
	initializeShaders: vi.fn(),
}));

vi.mock("../utils/webglShaders", () => ({
	WebGLManager: class {
		constructor() {
			webglSpies.construct();
		}
		initializeShaders = webglSpies.initializeShaders;
		dispose = webglSpies.dispose;
	},
}));

import { useBackgroundEffects } from "./useBackgroundEffects";
import { useMediaControls } from "./useMediaControls";
import { toast } from "frappe-ui";
import {
	cameraEnabled,
	micEnabled,
	noiseCancellationEnabled,
	selectedCameraId,
	selectedMicId,
	selectedSpeakerId,
	setCameraEnabled,
	setMicEnabled,
	setSelectedCameraId,
	setSelectedMicId,
} from "../data/mediaPreferences";
import { setAutoFramingPaused } from "../data/backgroundEffects";

class FakeMediaStream {
	id = "fake-media-stream";
	private tracks: MediaStreamTrack[];

	constructor(tracks: MediaStreamTrack[] = []) {
		this.tracks = [...tracks];
	}

	getAudioTracks() {
		return this.tracks.filter((track) => track.kind === "audio");
	}

	getVideoTracks() {
		return this.tracks.filter((track) => track.kind === "video");
	}

	getTracks() {
		return [...this.tracks];
	}

	addTrack(track: MediaStreamTrack) {
		this.tracks.push(track);
	}

	removeTrack(track: MediaStreamTrack) {
		this.tracks = this.tracks.filter((candidate) => candidate !== track);
	}
}

const localTrack = (id: string, kind: "audio" | "video") => {
	const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
	const track = Object.assign(Object.create(null), {
		id,
		kind,
		enabled: true,
		readyState: "live",
		stop: vi.fn(() => {
			track.readyState = "ended";
		}),
		addEventListener: vi.fn(
			(type: string, listener: EventListenerOrEventListenerObject) => {
				const handlers = listeners.get(type) ?? new Set();
				handlers.add(listener);
				listeners.set(type, handlers);
			},
		),
		removeEventListener: vi.fn(
			(type: string, listener: EventListenerOrEventListenerObject) => {
				listeners.get(type)?.delete(listener);
			},
		),
		dispatchEvent: vi.fn((event: Event) => {
			for (const listener of listeners.get(event.type) ?? []) {
				if (typeof listener === "function") listener.call(track, event);
				else listener.handleEvent(event);
			}
			return true;
		}),
	}) as MediaStreamTrack;
	return track;
};

const audioTrack = (id: string) => localTrack(id, "audio");

const videoTrack = (id: string, readyState: MediaStreamTrackState = "live") => {
	const track = localTrack(id, "video");
	Reflect.set(track, "readyState", readyState);
	return track;
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function withDeadline<T>(promise: Promise<T>, timeoutMs = 100): Promise<T> {
	return new Promise((resolve, reject) => {
		const deadline = setTimeout(
			() => reject(new Error("Operation did not settle after cancellation")),
			timeoutMs,
		);
		promise.then(
			(value) => {
				clearTimeout(deadline);
				resolve(value);
			},
			(reason) => {
				clearTimeout(deadline);
				reject(reason);
			},
		);
	});
}

interface TestVideoProducer {
	id: string;
	track?: MediaStreamTrack | null;
	paused?: boolean;
	replaceTrack?: ReturnType<typeof vi.fn>;
	pause?: ReturnType<typeof vi.fn>;
	resume?: ReturnType<typeof vi.fn>;
	close?: ReturnType<typeof vi.fn>;
}

interface CameraMediaStateOverrides {
	isMicOn?: boolean;
	isCameraOn?: boolean;
	localStream?: FakeMediaStream | null;
	processedStream?: FakeMediaStream | null;
	screenShareStream?: FakeMediaStream | null;
	screenShareStreams?: Record<string, FakeMediaStream>;
}

function createCameraHarness({
	mediaState = {},
	getUserMedia = vi.fn(),
	getDisplayMedia = vi.fn(),
	videoProducer = null,
	audioProducer = null,
	createProducer,
	publishScreenTrack,
	applyBackgroundEffects = vi.fn(),
	backgroundEffects: backgroundEffectsOverride,
	noiseCancellation: noiseCancellationOverride,
	publishMedia: publishMediaOverride,
	deviceManager = {},
}: {
	mediaState?: CameraMediaStateOverrides;
	getUserMedia?: ReturnType<typeof vi.fn>;
	getDisplayMedia?: ReturnType<typeof vi.fn>;
	videoProducer?: TestVideoProducer | null;
	audioProducer?: TestVideoProducer | null;
	createProducer?: ReturnType<typeof vi.fn>;
	publishScreenTrack?: ReturnType<typeof vi.fn>;
	applyBackgroundEffects?: ReturnType<typeof vi.fn>;
	backgroundEffects?: ReturnType<typeof useBackgroundEffects>;
	noiseCancellation?: object;
	publishMedia?: ReturnType<typeof vi.fn>;
	deviceManager?: object;
} = {}) {
	const state = Object.assign(
		{
			isMicOn: false,
			isCameraOn: false,
			isScreenSharing: false,
			localStream: new FakeMediaStream(),
			processedStream: null,
			screenShareStream: null,
			screenShareStreams: {},
			activeScreenShareConsumers: [],
			microphonePermissionGranted: false,
			cameraPermissionGranted: false,
			localVideo: null,
		},
		mediaState,
	);
	Object.assign(state, {
		setMedia: vi.fn((micEnabled: boolean, cameraIsEnabled: boolean) => {
			state.isMicOn = micEnabled;
			state.isCameraOn = cameraIsEnabled;
		}),
	});
	const mediaHandler = {
		audioProducer,
		videoProducer,
		screenProducer: null,
		localStream: new FakeMediaStream(),
		setProducers: vi.fn(
			(producers: {
				audioProducer?: TestVideoProducer;
				videoProducer?: TestVideoProducer;
			}) => {
				Object.assign(mediaHandler, producers);
			},
		),
		stopScreenShare: vi.fn(),
		cleanup: vi.fn(),
	};
	const producerFactory =
		createProducer ??
		vi.fn(async (track: MediaStreamTrack) => ({
			id: `producer-${track.id}`,
			track,
			close: vi.fn(),
		}));
	const createTestProducer = producerFactory as (
		track: MediaStreamTrack,
		options: { type: "microphone" | "camera" | "screen" },
	) => Promise<TestVideoProducer>;
	const getProducer = (kind: "audio" | "video" | "screen") => {
		if (kind === "audio") return mediaHandler.audioProducer;
		if (kind === "video") return mediaHandler.videoProducer;
		return mediaHandler.screenProducer as TestVideoProducer | null;
	};
	const setProducer = (
		kind: "audio" | "video" | "screen",
		producer: TestVideoProducer | null,
	) => {
		if (kind === "audio") mediaHandler.audioProducer = producer;
		else if (kind === "video") mediaHandler.videoProducer = producer;
		else mediaHandler.screenProducer = producer as never;
	};
	const setLocalMediaTrack = vi.fn(
		(kind: "audio" | "video", track: MediaStreamTrack | null) => {
			const existingTracks =
				kind === "video"
					? mediaHandler.localStream.getVideoTracks()
					: mediaHandler.localStream.getAudioTracks();
			for (const existingTrack of existingTracks) {
				mediaHandler.localStream.removeTrack(existingTrack);
			}
			if (track?.readyState === "live")
				mediaHandler.localStream.addTrack(track);
		},
	);
	const publishMedia =
		publishMediaOverride ??
		vi.fn(
			async (
				stream: MediaStream,
				options: { publishVideo?: boolean; publishAudio?: boolean },
			) => {
				const result: {
					videoProducer?: TestVideoProducer;
					audioProducer?: TestVideoProducer;
				} = {};
				if (options.publishVideo) {
					const track = stream.getVideoTracks()[0] ?? null;
					setLocalMediaTrack("video", track);
					if (track) {
						const producer = await createTestProducer(track, { type: "camera" });
						mediaHandler.setProducers({ videoProducer: producer });
						result.videoProducer = producer;
					}
				}
				if (options.publishAudio) {
					const track = stream.getAudioTracks()[0] ?? null;
					setLocalMediaTrack("audio", track);
					if (track) {
						const producer = await createTestProducer(track, {
							type: "microphone",
						});
						mediaHandler.setProducers({ audioProducer: producer });
						result.audioProducer = producer;
					}
				}
				return result;
			},
		);
	const manager = {
		mediaHandler,
		publishMedia,
		setLocalMediaTrack,
		serializeSendMediaMutation: vi.fn((operation: () => Promise<unknown>) =>
			operation(),
		),
		transportManager: { createProducer: producerFactory },
		getLocalProducerState: vi.fn((kind: "audio" | "video" | "screen") => {
			const producer = getProducer(kind);
			return producer
				? {
						id: producer.id,
						track: producer.track ?? null,
						paused: producer.paused ?? false,
					}
				: null;
		}),
		replaceLocalProducerTrack: vi.fn(
			async (kind: "audio" | "video" | "screen", track: MediaStreamTrack) => {
				const producer = getProducer(kind);
				if (!producer) return false;
				if (!producer.replaceTrack)
					throw new Error("Producer cannot replace track");
				await producer.replaceTrack({ track });
				return true;
			},
		),
		createLocalProducer: vi.fn(
			async (kind: "audio" | "video" | "screen", track: MediaStreamTrack) => {
				const producer = await createTestProducer(track, {
					type:
						kind === "audio"
							? "microphone"
							: kind === "video"
								? "camera"
								: "screen",
				});
				setProducer(kind, producer);
				return {
					id: producer.id,
					track: producer.track ?? null,
					paused: producer.paused ?? false,
				};
			},
		),
		publishScreenTrack:
			publishScreenTrack ??
			vi.fn(async (track: MediaStreamTrack) => {
				const producer = await createTestProducer(track, { type: "screen" });
				setProducer("screen", producer);
				return {
					id: producer.id,
					track: producer.track ?? null,
					paused: producer.paused ?? false,
				};
			}),
		reconcileLocalProducerTrack: vi.fn(
			async (
				kind: "audio" | "video" | "screen",
				track: MediaStreamTrack,
				options: { resume?: boolean } = {},
			) => {
				const producer = getProducer(kind);
				let current = producer;
				if (current) {
					if (current.track !== track) {
						if (!current.replaceTrack)
							throw new Error("Producer cannot replace track");
						await current.replaceTrack({ track });
					}
				} else {
					current = await createTestProducer(track, {
						type:
							kind === "audio"
								? "microphone"
								: kind === "video"
									? "camera"
									: "screen",
					});
					setProducer(kind, current);
				}
				if (options.resume) current.resume?.();
				if (kind !== "screen") setLocalMediaTrack(kind, track);
				return {
					id: current.id,
					track: current.track ?? null,
					paused: current.paused ?? false,
				};
			},
		),
		closeLocalProducer: vi.fn((kind: "audio" | "video" | "screen") => {
			const producer = getProducer(kind);
			producer?.close?.();
			setProducer(kind, null);
			if (producer?.id) void sfuClient.closeProducer(producer.id);
			if (kind === "screen") mediaHandler.stopScreenShare();
		}),
		stopScreenShare: vi.fn(async (metadata = {}) => {
			const producer = getProducer("screen");
			if (!producer) return;
			setProducer("screen", null);
			try {
				if (sfuClient.isConnected()) {
				await sfuClient.sendScreenShare("stop_share", {
					...metadata,
					producerId: producer.id,
					stoppedAt: Date.now(),
				});
				}
			} catch {
			} finally {
				producer.close?.();
				await sfuClient.closeProducer(producer.id, metadata);
				mediaHandler.stopScreenShare();
			}
		}),
		pauseLocalProducer: vi.fn((kind: "audio" | "video" | "screen") => {
			getProducer(kind)?.pause?.();
		}),
		resumeLocalProducer: vi.fn((kind: "audio" | "video" | "screen") => {
			getProducer(kind)?.resume?.();
		}),
	};
	const sfuClient = {
		getUserId: vi.fn(() => null),
		isConnected: vi.fn(() => true),
		closeProducer: vi.fn().mockResolvedValue(undefined),
		sendMediaControl: vi.fn(),
		sendScreenShare: vi.fn(),
	};
	const stopProcessing = backgroundEffectsOverride?.stopProcessing ?? vi.fn();
	const dispose =
		backgroundEffectsOverride?.dispose ?? vi.fn().mockResolvedValue(undefined);
	const effectsApi =
		backgroundEffectsOverride ??
		({
			applyBackgroundEffects,
			stopProcessing,
			dispose,
			processedStream: ref(null),
		} as never);
	Object.defineProperty(navigator, "mediaDevices", {
		configurable: true,
		value: { getDisplayMedia, getUserMedia },
	});

	const managerRef = ref(manager);
	const mediaAttachments = {
		registerRemoteVideoElement: vi.fn(),
		registerLocalPreview: vi.fn(),
		attachLocalPreview: vi.fn().mockResolvedValue(undefined),
		registerScreenSharePreview: vi.fn(),
		attachScreenSharePreview: vi.fn().mockResolvedValue(undefined),
		removeScreenSharePreview: vi.fn(),
		attachBackgroundEffectsSource: vi.fn().mockResolvedValue(undefined),
		removeBackgroundEffectsSource: vi.fn(),
		setAudioOutputDevice: vi.fn().mockResolvedValue(undefined),
	};
	const controls = useMediaControls({
		mediaState: state,
		connectionState: { connectionError: null },
		raiseHandStore: { raisedHands: {}, lowerHand: vi.fn() },
		currentUser: { currentUser: ref(null) },
		sfuClient,
		sfuManager: managerRef,
		mediaAttachments,
		deviceManager,
		backgroundEffects: effectsApi,
		noiseCancellation: noiseCancellationOverride ?? { error: ref(null) },
		toast: {},
		mediaPreferences: {},
	} as never);

	return {
		applyBackgroundEffects: effectsApi.applyBackgroundEffects,
		controls,
		createProducer: producerFactory,
		dispose,
		mediaHandler,
		manager,
		managerRef,
		mediaAttachments,
		publishMedia,
		setLocalMediaTrack,
		sfuClient,
		state,
		stopProcessing,
	};
}

describe("useMediaControls", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("MediaStream", FakeMediaStream);
		localStorage.clear();
		cameraEnabled.value = false;
		micEnabled.value = false;
		noiseCancellationEnabled.value = true;
		selectedSpeakerId.value = "";
		selectedCameraId.value = "";
		selectedMicId.value = "";
		setAutoFramingPaused(false);
	});

	it("delegates local preview attachment and unmount to the media owner", async () => {
		const camera = videoTrack("camera");
		const { controls, mediaAttachments, state } = createCameraHarness({
			mediaState: { localStream: new FakeMediaStream([camera]) },
		});
		const element = document.createElement("video");

		controls.setLocalVideoRef(element);
		await vi.waitFor(() =>
			expect(mediaAttachments.attachLocalPreview).toHaveBeenCalledWith(
				state.localStream,
			),
		);
		controls.setLocalVideoRef(null);

		expect(mediaAttachments.registerLocalPreview).toHaveBeenNthCalledWith(
			1,
			element,
		);
		expect(mediaAttachments.registerLocalPreview).toHaveBeenLastCalledWith(
			null,
		);
		expect(camera.stop).not.toHaveBeenCalled();
	});

	it("delegates remote video replacement and unmount to the media owner", () => {
		const { controls, mediaAttachments } = createCameraHarness();
		const first = document.createElement("video");
		const replacement = document.createElement("video");

		controls.setRemoteVideoRef("p1", first);
		controls.setRemoteVideoRef("p1", replacement);
		controls.setRemoteVideoRef("p1", null);

		expect(mediaAttachments.registerRemoteVideoElement.mock.calls).toEqual([
			["p1", first],
			["p1", replacement],
			["p1", null],
		]);
	});

	it("registers local and remote screen-share previews with explicit ownership", async () => {
		const localScreen = new FakeMediaStream([videoTrack("local-screen")]);
		const remoteScreen = new FakeMediaStream([videoTrack("remote-screen")]);
		const { controls, mediaAttachments, state } = createCameraHarness({
			mediaState: {
				screenShareStream: localScreen,
				screenShareStreams: { local: localScreen, remote: remoteScreen },
			},
		});
		const localElement = document.createElement("video");
		localElement.dataset.participantId = "local";
		const remoteElement = document.createElement("video");
		remoteElement.dataset.participantId = "remote";
		state.screenShareStream = localScreen;

		controls.setScreenShareVideoRef("local-screen", localElement);
		controls.setScreenShareVideoRef("consumer-1", remoteElement);
		await vi.waitFor(() =>
			expect(mediaAttachments.attachScreenSharePreview).toHaveBeenCalledTimes(
				2,
			),
		);

		expect(mediaAttachments.attachScreenSharePreview).toHaveBeenCalledWith(
			"local-screen",
			localScreen,
			"borrowed",
		);
		expect(mediaAttachments.attachScreenSharePreview).toHaveBeenCalledWith(
			"consumer-1",
			remoteScreen,
			"owned",
		);
	});

	it("does not signal screen-share start when publication resolves after stop", async () => {
		const screenTrack = videoTrack("screen");
		const screenStream = new FakeMediaStream([screenTrack]);
		const publication = deferred<null>();
		const publishScreenTrack = vi.fn(() => publication.promise);
		const harness = createCameraHarness({
			getDisplayMedia: vi.fn().mockResolvedValue(screenStream),
			publishScreenTrack,
		});

		const starting = harness.controls.toggleScreenShare();
		await vi.waitFor(() =>
			expect(publishScreenTrack).toHaveBeenCalledWith(screenTrack),
		);
		await harness.controls.toggleScreenShare();
		publication.resolve(null);
		await starting;

		expect(harness.sfuClient.sendScreenShare).not.toHaveBeenCalledWith(
			"start_share",
			expect.anything(),
		);
		expect(harness.state.isScreenSharing).toBe(false);
	});

	it("does not stop a replacement screen share when an old publication rejects", async () => {
		const firstTrack = videoTrack("first-screen");
		const secondTrack = videoTrack("second-screen");
		const firstStream = new FakeMediaStream([firstTrack]);
		const secondStream = new FakeMediaStream([secondTrack]);
		const firstPublication = deferred<{
			id: string;
			track: MediaStreamTrack;
			paused: boolean;
		}>();
		const secondPublication = deferred<{
			id: string;
			track: MediaStreamTrack;
			paused: boolean;
		}>();
		const secondProducer: TestVideoProducer = {
			id: "second-screen-producer",
			track: secondTrack,
			close: vi.fn(),
		};
		let harness!: ReturnType<typeof createCameraHarness>;
		const publishScreenTrack = vi.fn((track: MediaStreamTrack) => {
			if (track === firstTrack) return firstPublication.promise;
			harness.mediaHandler.screenProducer = secondProducer as never;
			return secondPublication.promise;
		});
		harness = createCameraHarness({
			getDisplayMedia: vi
				.fn()
				.mockResolvedValueOnce(firstStream)
				.mockResolvedValueOnce(secondStream),
			publishScreenTrack,
		});

		const firstStarting = harness.controls.toggleScreenShare();
		await vi.waitFor(() =>
			expect(publishScreenTrack).toHaveBeenCalledWith(firstTrack),
		);
		await harness.controls.toggleScreenShare();
		void harness.controls.toggleScreenShare();
		await vi.waitFor(() =>
			expect(publishScreenTrack).toHaveBeenCalledWith(secondTrack),
		);
		expect(harness.state.screenShareStream).toBe(secondStream);

		firstPublication.reject(new Error("first publication failed"));
		await firstStarting;

		expect(harness.state.screenShareStream).toBe(secondStream);
		expect(harness.state.isScreenSharing).toBe(true);
		expect(harness.manager.getLocalProducerState("screen")).toEqual({
			id: secondProducer.id,
			track: secondTrack,
			paused: false,
		});
		expect(firstTrack.stop).toHaveBeenCalledOnce();
		expect(secondTrack.stop).not.toHaveBeenCalled();
		expect(secondProducer.close).not.toHaveBeenCalled();
		expect(harness.sfuClient.sendScreenShare).not.toHaveBeenCalledWith(
			"stop_share",
			expect.anything(),
		);
	});

	it("does not signal screen-share start through a replaced manager", async () => {
		const screenTrack = videoTrack("screen");
		const screenStream = new FakeMediaStream([screenTrack]);
		const publication = deferred<{
			id: string;
			track: MediaStreamTrack;
			paused: boolean;
		}>();
		const harness = createCameraHarness({
			getDisplayMedia: vi.fn().mockResolvedValue(screenStream),
			publishScreenTrack: vi.fn(() => publication.promise),
		});

		const starting = harness.controls.toggleScreenShare();
		await vi.waitFor(() =>
			expect(harness.manager.publishScreenTrack).toHaveBeenCalledWith(
				screenTrack,
			),
		);
		harness.mediaHandler.screenProducer = {
			id: "screen-producer",
			track: screenTrack,
		} as never;
		harness.managerRef.value = {} as never;
		publication.resolve({
			id: "screen-producer",
			track: screenTrack,
			paused: false,
		});
		await starting;

		expect(harness.sfuClient.sendScreenShare).not.toHaveBeenCalledWith(
			"start_share",
			expect.anything(),
		);
	});

	it("does not signal an old screen publication after its producer is replaced", async () => {
		const screenTrack = videoTrack("screen");
		const replacementTrack = videoTrack("replacement-screen");
		const screenStream = new FakeMediaStream([screenTrack]);
		const publication = deferred<{
			id: string;
			track: MediaStreamTrack;
			paused: boolean;
		}>();
		const harness = createCameraHarness({
			getDisplayMedia: vi.fn().mockResolvedValue(screenStream),
			publishScreenTrack: vi.fn(() => publication.promise),
		});

		const starting = harness.controls.toggleScreenShare();
		await vi.waitFor(() =>
			expect(harness.manager.publishScreenTrack).toHaveBeenCalledWith(
				screenTrack,
			),
		);
		harness.mediaHandler.screenProducer = {
			id: "replacement-producer",
			track: replacementTrack,
		} as never;
		publication.resolve({
			id: "old-producer",
			track: screenTrack,
			paused: false,
		});
		await starting;

		expect(harness.sfuClient.sendScreenShare).not.toHaveBeenCalledWith(
			"start_share",
			expect.anything(),
		);
	});

	it("reacquires and republishes an enabled camera whose track ends", async () => {
		selectedCameraId.value = "selected-camera";
		const oldTrack = videoTrack("old-camera");
		const nextTrack = videoTrack("next-camera");
		const producer: TestVideoProducer = {
			id: "camera-producer",
			track: oldTrack,
			replaceTrack: vi.fn(async ({ track }) => {
				producer.track = track;
			}),
		};
		const getUserMedia = vi
			.fn()
			.mockResolvedValue(new FakeMediaStream([nextTrack]));
		const harness = createCameraHarness({
			mediaState: {
				isCameraOn: true,
				localStream: new FakeMediaStream([oldTrack]),
			},
			getUserMedia,
			videoProducer: producer,
		});

		Reflect.set(oldTrack, "readyState", "ended");
		oldTrack.dispatchEvent(new Event("ended"));

		await vi.waitFor(() =>
			expect(producer.replaceTrack).toHaveBeenCalledOnce(),
		);
		expect(
			(getUserMedia.mock.calls[0][0].video as MediaTrackConstraints).deviceId,
		).toEqual({ exact: "selected-camera" });
		expect(producer.track).toBe(nextTrack);
		expect(harness.state.localStream.getVideoTracks()).toEqual([nextTrack]);
		expect(oldTrack.stop).toHaveBeenCalledOnce();
		expect(harness.state.isCameraOn).toBe(true);
	});

	it("reacquires and republishes an enabled microphone whose track ends", async () => {
		selectedMicId.value = "selected-mic";
		const oldTrack = audioTrack("old-mic");
		const nextTrack = audioTrack("next-mic");
		const producer: TestVideoProducer = {
			id: "audio-producer",
			track: oldTrack,
			replaceTrack: vi.fn(async ({ track }) => {
				producer.track = track;
			}),
		};
		const getUserMedia = vi
			.fn()
			.mockResolvedValue(new FakeMediaStream([nextTrack]));
		const harness = createCameraHarness({
			mediaState: {
				isMicOn: true,
				localStream: new FakeMediaStream([oldTrack]),
			},
			getUserMedia,
			audioProducer: producer,
			deviceManager: {
				enumerateDevices: vi.fn(),
				isDeviceAvailable: vi.fn(() => true),
				findDeviceById: vi.fn(() => ({ label: "Built-in Microphone" })),
			},
		});

		Reflect.set(oldTrack, "readyState", "ended");
		oldTrack.dispatchEvent(new Event("ended"));

		await vi.waitFor(() =>
			expect(producer.replaceTrack).toHaveBeenCalledOnce(),
		);
		expect(
			(getUserMedia.mock.calls[0][0].audio as MediaTrackConstraints).deviceId,
		).toEqual({ exact: "selected-mic" });
		expect(producer.track).toBe(nextTrack);
		expect(harness.state.localStream.getAudioTracks()).toEqual([nextTrack]);
		expect(oldTrack.stop).toHaveBeenCalledOnce();
		expect(harness.state.isMicOn).toBe(true);
	});

	it("turns off camera truthfully when ended-track recovery fails", async () => {
		const oldTrack = videoTrack("old-camera");
		const producer = {
			id: "camera-producer",
			track: oldTrack,
			close: vi.fn(),
		};
		const harness = createCameraHarness({
			mediaState: {
				isCameraOn: true,
				localStream: new FakeMediaStream([oldTrack]),
			},
			getUserMedia: vi
				.fn()
				.mockRejectedValue(new DOMException("Denied", "NotAllowedError")),
			videoProducer: producer,
		});

		Reflect.set(oldTrack, "readyState", "ended");
		oldTrack.dispatchEvent(new Event("ended"));

		await vi.waitFor(() => expect(harness.state.isCameraOn).toBe(false));
		expect(setCameraEnabled).toHaveBeenCalledWith(false);
		expect(producer.close).toHaveBeenCalledOnce();
		expect(harness.sfuClient.sendMediaControl).toHaveBeenCalledWith(
			"video_off",
		);
		expect(toast.error).toHaveBeenCalledWith(
			"Camera stopped and could not be restarted. Check browser permissions and devices.",
		);
	});

	it("turns off microphone truthfully when ended-track recovery fails", async () => {
		const oldTrack = audioTrack("old-mic");
		const producer = {
			id: "audio-producer",
			track: oldTrack,
			close: vi.fn(),
		};
		const harness = createCameraHarness({
			mediaState: {
				isMicOn: true,
				localStream: new FakeMediaStream([oldTrack]),
			},
			getUserMedia: vi
				.fn()
				.mockRejectedValue(new DOMException("Denied", "NotAllowedError")),
			audioProducer: producer,
		});

		Reflect.set(oldTrack, "readyState", "ended");
		oldTrack.dispatchEvent(new Event("ended"));

		await vi.waitFor(() => expect(harness.state.isMicOn).toBe(false));
		expect(setMicEnabled).toHaveBeenCalledWith(false);
		expect(producer.close).toHaveBeenCalledOnce();
		expect(harness.sfuClient.sendMediaControl).toHaveBeenCalledWith("mute");
		expect(toast.error).toHaveBeenCalledWith(
			"Microphone stopped and could not be restarted. Check browser permissions and devices.",
		);
	});

	it("observes a microphone replaced by noise cancellation toggling", async () => {
		const oldTrack = audioTrack("old-mic");
		const freshTrack = audioTrack("fresh-mic");
		const recoveredTrack = audioTrack("recovered-mic");
		const producer: TestVideoProducer = {
			id: "audio-producer",
			track: oldTrack,
			replaceTrack: vi.fn(async ({ track }) => {
				producer.track = track;
			}),
		};
		const getUserMedia = vi
			.fn()
			.mockResolvedValue(new FakeMediaStream([recoveredTrack]))
			.mockResolvedValueOnce(new FakeMediaStream([freshTrack]))
			.mockResolvedValueOnce(new FakeMediaStream([recoveredTrack]));
		createCameraHarness({
			mediaState: {
				isMicOn: true,
				localStream: new FakeMediaStream([oldTrack]),
			},
			getUserMedia,
			audioProducer: producer,
		});

		noiseCancellationEnabled.value = false;
		await vi.waitFor(() =>
			expect(producer.replaceTrack).toHaveBeenCalledOnce(),
		);
		Reflect.set(freshTrack, "readyState", "ended");
		freshTrack.dispatchEvent(new Event("ended"));

		await vi.waitFor(() =>
			expect(getUserMedia.mock.calls.length).toBeGreaterThan(1),
		);
	});

	it("stops microphone recovery that resolves after unmount", async () => {
		const oldTrack = audioTrack("old-mic");
		const lateTrack = audioTrack("late-mic");
		const request = deferred<MediaStream>();
		const replaceTrack = vi.fn();
		let harness!: ReturnType<typeof createCameraHarness>;
		const app = createApp(
			defineComponent({
				setup() {
					harness = createCameraHarness({
						mediaState: {
							isMicOn: true,
							localStream: new FakeMediaStream([oldTrack]),
						},
						getUserMedia: vi.fn(() => request.promise),
						audioProducer: {
							id: "audio-producer",
							track: oldTrack,
							replaceTrack,
						},
					});
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));
		Reflect.set(oldTrack, "readyState", "ended");
		oldTrack.dispatchEvent(new Event("ended"));
		await vi.waitFor(() =>
			expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce(),
		);

		app.unmount();
		request.resolve(new FakeMediaStream([lateTrack]) as never);

		await vi.waitFor(() => expect(lateTrack.stop).toHaveBeenCalledOnce());
		expect(replaceTrack).not.toHaveBeenCalled();
		expect(harness.state.localStream.getAudioTracks()).not.toContain(lateTrack);
	});

	it("does not publish microphone recovery after processing finishes post-unmount", async () => {
		const oldTrack = audioTrack("old-mic");
		const candidate = audioTrack("candidate-mic");
		const processed = audioTrack("processed-mic");
		const processing = deferred<{
			stream: MediaStream;
			cleanup: () => void;
		}>();
		const processingEntered = deferred<void>();
		const replaceTrack = vi.fn();
		const cleanup = vi.fn();
		const applyNoiseCancellation = vi.fn(() => {
			processingEntered.resolve();
			return processing.promise;
		});
		let harness!: ReturnType<typeof createCameraHarness>;
		const app = createApp(
			defineComponent({
				setup() {
					harness = createCameraHarness({
						mediaState: {
							isMicOn: true,
							localStream: new FakeMediaStream([oldTrack]),
						},
						getUserMedia: vi
							.fn()
							.mockResolvedValue(new FakeMediaStream([candidate])),
						audioProducer: {
							id: "audio-producer",
							track: oldTrack,
							replaceTrack,
						},
						noiseCancellation: {
							error: ref(null),
							applyNoiseCancellation,
						},
					});
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));
		Reflect.set(oldTrack, "readyState", "ended");
		oldTrack.dispatchEvent(new Event("ended"));
		await processingEntered.promise;
		app.unmount();
		processing.resolve({
			stream: new FakeMediaStream([processed]) as never,
			cleanup,
		});

		await vi.waitFor(() => expect(candidate.stop).toHaveBeenCalledOnce());
		expect(cleanup).toHaveBeenCalledOnce();
		expect(processed.stop).toHaveBeenCalledOnce();
		expect(replaceTrack).not.toHaveBeenCalled();
	});

	it("does not replace the microphone after noise cancellation resolves post-unmount", async () => {
		const oldTrack = audioTrack("old-mic");
		const freshTrack = audioTrack("fresh-mic");
		const processed = audioTrack("processed-mic");
		const processing = deferred<{
			stream: MediaStream;
			cleanup: () => void;
		}>();
		const processingEntered = deferred<void>();
		const cleanup = vi.fn();
		const replaceTrack = vi.fn();
		noiseCancellationEnabled.value = false;
		const app = createApp(
			defineComponent({
				setup() {
					createCameraHarness({
						mediaState: {
							isMicOn: true,
							localStream: new FakeMediaStream([oldTrack]),
						},
						getUserMedia: vi
							.fn()
							.mockResolvedValue(new FakeMediaStream([freshTrack])),
						audioProducer: {
							id: "audio-producer",
							track: oldTrack,
							replaceTrack,
						},
						noiseCancellation: {
							error: ref(null),
							applyNoiseCancellation: vi.fn(() => {
								processingEntered.resolve();
								return processing.promise;
							}),
						},
					});
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));
		noiseCancellationEnabled.value = true;
		await processingEntered.promise;
		app.unmount();
		processing.resolve({
			stream: new FakeMediaStream([processed]) as never,
			cleanup,
		});

		await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
		expect(processed.stop).toHaveBeenCalledOnce();
		expect(replaceTrack).not.toHaveBeenCalled();
	});

	it("falls back to the default microphone when Firefox cannot find the selected device", async () => {
		const fallbackStream = new FakeMediaStream([audioTrack("fallback")]);
		const requestedConstraints: MediaStreamConstraints[] = [];
		const getUserMedia = vi.fn((constraints: MediaStreamConstraints) => {
			requestedConstraints.push(structuredClone(constraints));
			if (requestedConstraints.length === 1) {
				return Promise.reject(
					new DOMException(
						"The object can not be found here.",
						"NotFoundError",
					),
				);
			}
			return Promise.resolve(fallbackStream);
		});
		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: { getUserMedia },
		});

		const controls = useMediaControls({
			mediaState: {},
			connectionState: {},
			raiseHandStore: {},
			currentUser: {},
			sfuClient: {},
			sfuManager: ref(null),
			deviceManager: {
				enumerateDevices: vi.fn().mockResolvedValue(undefined),
				isDeviceAvailable: vi.fn(() => true),
				findDeviceById: vi.fn(() => ({ label: "Built-in Microphone" })),
			},
			backgroundEffects: {},
			noiseCancellation: { error: ref(null) },
			toast: {},
			mediaPreferences: {},
		} as never);

		const result = await controls.acquireUserMedia(false, true, {
			micDeviceId: "remembered-mic",
		});

		expect(result.stream).toBe(fallbackStream);
		expect(getUserMedia).toHaveBeenCalledTimes(2);
		expect(
			(requestedConstraints[0].audio as MediaTrackConstraints).deviceId,
		).toEqual({
			exact: "remembered-mic",
		});
		expect(
			(requestedConstraints[1].audio as MediaTrackConstraints).deviceId,
		).toBeUndefined();
	});

	it("preserves the selected camera when only the microphone is unavailable", async () => {
		const fallbackStream = new FakeMediaStream([audioTrack("fallback")]);
		const requestedConstraints: MediaStreamConstraints[] = [];
		const getUserMedia = vi.fn((constraints: MediaStreamConstraints) => {
			requestedConstraints.push(structuredClone(constraints));
			if (requestedConstraints.length === 1) {
				return Promise.reject(
					new DOMException("Missing device", "NotFoundError"),
				);
			}
			return Promise.resolve(fallbackStream);
		});
		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: { getUserMedia },
		});

		const controls = useMediaControls({
			mediaState: {},
			connectionState: {},
			raiseHandStore: {},
			currentUser: {},
			sfuClient: {},
			sfuManager: ref(null),
			deviceManager: {
				enumerateDevices: vi.fn().mockResolvedValue(undefined),
				isDeviceAvailable: vi.fn(() => true),
				findDeviceById: vi.fn(() => ({ label: "Built-in Microphone" })),
			},
			backgroundEffects: {},
			noiseCancellation: { error: ref(null) },
			toast: {},
			mediaPreferences: {},
		} as never);

		await controls.acquireUserMedia(true, true, {
			cameraDeviceId: "selected-camera",
			micDeviceId: "missing-mic",
		});

		expect(
			(requestedConstraints[1].audio as MediaTrackConstraints).deviceId,
		).toBeUndefined();
		expect(
			(requestedConstraints[1].video as MediaTrackConstraints).deviceId,
		).toEqual({ exact: "selected-camera" });
		expect(setSelectedMicId).toHaveBeenCalledWith("");
		expect(setSelectedCameraId).not.toHaveBeenCalled();
	});

	it("does not clear device selections for other overconstrained settings", async () => {
		const resolutionError = Object.assign(
			new DOMException("Resolution unavailable", "OverconstrainedError"),
			{ constraint: "width" },
		);
		const getUserMedia = vi.fn().mockRejectedValue(resolutionError);
		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: { getUserMedia },
		});

		const controls = useMediaControls({
			mediaState: {},
			connectionState: {},
			raiseHandStore: {},
			currentUser: {},
			sfuClient: {},
			sfuManager: ref(null),
			deviceManager: {
				enumerateDevices: vi.fn().mockResolvedValue(undefined),
				isDeviceAvailable: vi.fn(() => true),
				findDeviceById: vi.fn(() => ({ label: "Built-in Microphone" })),
			},
			backgroundEffects: {},
			noiseCancellation: { error: ref(null) },
			toast: {},
			mediaPreferences: {},
		} as never);

		await expect(
			controls.acquireUserMedia(true, true, {
				cameraDeviceId: "selected-camera",
				micDeviceId: "selected-mic",
			}),
		).rejects.toBe(resolutionError);

		expect(getUserMedia).toHaveBeenCalledTimes(1);
		expect(setSelectedMicId).not.toHaveBeenCalled();
		expect(setSelectedCameraId).not.toHaveBeenCalled();
	});

	it("replaces a stale live processed track before resuming the microphone", async () => {
		const sourceTrack = audioTrack("source");
		const staleProcessedTrack = audioTrack("stale-processed");
		const nextProcessedTrack = audioTrack("next-processed");
		const replaceTrack = vi.fn().mockResolvedValue(undefined);
		const resume = vi.fn();
		const audioProducer = {
			id: "audio-producer",
			track: staleProcessedTrack,
			replaceTrack,
			resume,
		};
		const mediaState = {
			isMicOn: false,
			isCameraOn: false,
			isScreenSharing: false,
			localStream: new FakeMediaStream(),
			processedStream: null,
			screenShareStream: null,
			screenShareStreams: {},
			microphonePermissionGranted: false,
			cameraPermissionGranted: false,
		};
		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: {
				getUserMedia: vi
					.fn()
					.mockResolvedValue(new FakeMediaStream([sourceTrack])),
			},
		});

		const controls = useMediaControls({
			mediaState,
			connectionState: { connectionError: null },
			raiseHandStore: { raisedHands: {}, lowerHand: vi.fn() },
			currentUser: { currentUser: ref(null) },
			sfuClient: {
				getUserId: vi.fn(() => null),
				isConnected: vi.fn(() => true),
				resumeProducer: vi.fn().mockResolvedValue(undefined),
				sendMediaControl: vi.fn(),
			},
			sfuManager: ref({
				reconcileLocalProducerTrack: vi.fn(async (_kind, track) => {
					await audioProducer.replaceTrack({ track });
					audioProducer.resume();
				}),
			}),
			deviceManager: {},
			backgroundEffects: {
				applyBackgroundEffects: vi.fn(),
				stopProcessing: vi.fn(),
				processedStream: ref(null),
			},
			noiseCancellation: {
				applyNoiseCancellation: vi.fn().mockResolvedValue({
					stream: new FakeMediaStream([nextProcessedTrack]),
					cleanup: vi.fn(),
				}),
				isProcessing: ref(false),
				error: ref(null),
			},
			toast: {} as never,
			mediaPreferences: {} as never,
		} as never);

		await controls.toggleMicrophone();

		expect(replaceTrack).toHaveBeenCalledWith({ track: nextProcessedTrack });
		expect(replaceTrack.mock.invocationCallOrder[0]).toBeLessThan(
			resume.mock.invocationCallOrder[0],
		);
	});

	it("re-reads a producer that appears while microphone switching acquires media", async () => {
		noiseCancellationEnabled.value = false;
		const acquisition = deferred<MediaStream>();
		const oldTrack = audioTrack("old-microphone");
		const nextTrack = audioTrack("next-microphone");
		const appearedProducer: TestVideoProducer = {
			id: "recovered-producer",
			track: oldTrack,
			replaceTrack: vi.fn(async ({ track }) => {
				appearedProducer.track = track;
			}),
			resume: vi.fn(),
		};
		const harness = createCameraHarness({
			mediaState: {
				isMicOn: true,
				localStream: new FakeMediaStream([oldTrack]),
			},
			getUserMedia: vi.fn(() => acquisition.promise),
			deviceManager: {
				enumerateDevices: vi.fn().mockResolvedValue(undefined),
				isDeviceAvailable: vi.fn(() => true),
				findDeviceById: vi.fn(),
			},
		});

		const switching = harness.controls.switchInputDevice(
			"microphone",
			"next-microphone",
		);
		await vi.waitFor(() =>
			expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled(),
		);
		harness.mediaHandler.audioProducer = appearedProducer;
		acquisition.resolve(new FakeMediaStream([nextTrack]) as never);
		await switching;

		expect(appearedProducer.replaceTrack).toHaveBeenCalledWith({
			track: nextTrack,
		});
		expect(appearedProducer.resume).toHaveBeenCalledOnce();
		expect(harness.createProducer).not.toHaveBeenCalled();
	});

	it("creates a producer that disappears while microphone processing is pending", async () => {
		const sourceTrack = audioTrack("source");
		const processedTrack = audioTrack("processed");
		const processing = deferred<{
			stream: MediaStream;
			cleanup: () => void;
		}>();
		const applyNoiseCancellation = vi.fn(() => processing.promise);
		const harness = createCameraHarness({
			getUserMedia: vi
				.fn()
				.mockResolvedValue(new FakeMediaStream([sourceTrack])),
			audioProducer: {
				id: "producer-before-recovery",
				track: audioTrack("stale"),
				replaceTrack: vi.fn(),
				resume: vi.fn(),
			},
			noiseCancellation: {
				applyNoiseCancellation,
				isProcessing: ref(false),
				error: ref(null),
			},
		});

		const enabling = harness.controls.toggleMicrophone();
		await vi.waitFor(() =>
			expect(applyNoiseCancellation).toHaveBeenCalledOnce(),
		);
		harness.mediaHandler.audioProducer = null;
		processing.resolve({
			stream: new FakeMediaStream([processedTrack]) as never,
			cleanup: vi.fn(),
		});
		await enabling;

		expect(harness.createProducer).toHaveBeenCalledOnce();
		expect(harness.createProducer).toHaveBeenCalledWith(processedTrack, {
			type: "microphone",
		});
		expect(harness.mediaHandler.audioProducer?.track).toBe(processedTrack);
		expect(harness.state.isMicOn).toBe(true);
	});

	it("settles two immediate microphone toggles from on back to on", async () => {
		vi.useFakeTimers();
		try {
			const acquisition = deferred<MediaStream>();
			const oldTrack = audioTrack("old-microphone");
			const nextTrack = audioTrack("next-microphone");
			const producer: TestVideoProducer = {
				id: "audio-producer",
				track: oldTrack,
				pause: vi.fn(),
				resume: vi.fn(),
				replaceTrack: vi.fn(async ({ track }) => {
					producer.track = track;
				}),
			};
			const harness = createCameraHarness({
				mediaState: {
					isMicOn: true,
					localStream: new FakeMediaStream([oldTrack]),
				},
				getUserMedia: vi.fn(() => acquisition.promise),
				audioProducer: producer,
				noiseCancellation: {
					error: ref(null),
					applyNoiseCancellation: vi.fn(async (stream: MediaStream) => ({
						stream,
						cleanup: vi.fn(),
					})),
				},
			});

			const toggles = Promise.all([
				harness.controls.toggleMicrophone(),
				harness.controls.toggleMicrophone(),
			]);
			let settled = false;
			void toggles.then(() => {
				settled = true;
			});
			await vi.advanceTimersByTimeAsync(0);
			acquisition.resolve(new FakeMediaStream([nextTrack]) as never);
			await vi.advanceTimersByTimeAsync(100);

			expect(settled).toBe(true);
			await toggles;
			expect(harness.state.isMicOn).toBe(true);
			expect(harness.state.localStream.getAudioTracks()).toEqual([nextTrack]);
			expect(producer.track).toBe(nextTrack);
			expect(oldTrack.stop).toHaveBeenCalledOnce();
			expect(nextTrack.stop).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("serializes overlapping camera toggles and finishes camera-off", async () => {
		const firstAcquisition = deferred<MediaStream>();
		const firstTrack = videoTrack("first");
		const secondTrack = videoTrack("second");
		const getUserMedia = vi
			.fn()
			.mockReturnValueOnce(firstAcquisition.promise)
			.mockResolvedValueOnce(new FakeMediaStream([secondTrack]));
		const { controls, mediaHandler, state } = createCameraHarness({
			getUserMedia,
		});

		const firstToggle = controls.toggleCamera();
		const secondToggle = controls.toggleCamera();
		await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled());

		expect(getUserMedia).toHaveBeenCalledTimes(1);
		firstAcquisition.resolve(new FakeMediaStream([firstTrack]));
		await Promise.all([firstToggle, secondToggle]);

		expect(getUserMedia).toHaveBeenCalledTimes(1);
		expect(state.isCameraOn).toBe(false);
		expect((state.localStream as FakeMediaStream).getVideoTracks()).toEqual([]);
		expect(firstTrack.stop).toHaveBeenCalledOnce();
		expect(secondTrack.stop).not.toHaveBeenCalled();
		expect(mediaHandler.videoProducer).toBeNull();
	});

	it.each(["camera-first", "microphone-first"] as const)(
		"atomically merges simultaneous first camera and microphone enables ($s)",
		async (completionOrder) => {
			const cameraRequest = deferred<MediaStream>();
			const microphoneRequest = deferred<MediaStream>();
			const camera = videoTrack("concurrent-camera");
			const microphone = audioTrack("concurrent-microphone");
			const getUserMedia = vi.fn((constraints: MediaStreamConstraints) =>
				constraints.video ? cameraRequest.promise : microphoneRequest.promise,
			);
			const harness = createCameraHarness({
				mediaState: { localStream: null },
				getUserMedia,
				noiseCancellation: {
					error: ref(null),
					applyNoiseCancellation: vi.fn(async (stream: MediaStream) => ({
						stream,
						cleanup: vi.fn(),
					})),
				},
			});

			const enablingCamera = harness.controls.toggleCamera();
			const enablingMicrophone = harness.controls.toggleMicrophone();
			await vi.waitFor(() => {
				expect(
					getUserMedia.mock.calls.some(([constraints]) => constraints.video),
				).toBe(true);
				expect(
					getUserMedia.mock.calls.some(([constraints]) => constraints.audio),
				).toBe(true);
			});
			if (completionOrder === "camera-first") {
				cameraRequest.resolve(new FakeMediaStream([camera]) as never);
				await vi.waitFor(() => expect(harness.state.isCameraOn).toBe(true));
				microphoneRequest.resolve(new FakeMediaStream([microphone]) as never);
			} else {
				microphoneRequest.resolve(new FakeMediaStream([microphone]) as never);
				await vi.waitFor(() => expect(harness.state.isMicOn).toBe(true));
				cameraRequest.resolve(new FakeMediaStream([camera]) as never);
			}
			await Promise.all([enablingCamera, enablingMicrophone]);

			expect(harness.state.localStream?.getVideoTracks()).toEqual([camera]);
			expect(harness.state.localStream?.getAudioTracks()).toEqual([microphone]);
			expect(camera.stop).not.toHaveBeenCalled();
			expect(microphone.stop).not.toHaveBeenCalled();
			expect(camera.addEventListener).toHaveBeenCalledWith(
				"ended",
				expect.any(Function),
			);
			expect(microphone.addEventListener).toHaveBeenCalledWith(
				"ended",
				expect.any(Function),
			);
		},
	);

	it("rolls back acquired video when camera producer creation fails", async () => {
		const candidate = videoTrack("candidate");
		const createProducer = vi
			.fn()
			.mockRejectedValue(new Error("producer failed"));
		const { controls, setLocalMediaTrack, state } = createCameraHarness({
			getUserMedia: vi.fn().mockResolvedValue(new FakeMediaStream([candidate])),
			createProducer,
		});

		await expect(controls.toggleCamera()).rejects.toThrow("producer failed");

		expect(state.isCameraOn).toBe(false);
		expect((state.localStream as FakeMediaStream).getVideoTracks()).toEqual([]);
		expect(candidate.stop).toHaveBeenCalledOnce();
		expect(setLocalMediaTrack).not.toHaveBeenCalled();
	});

	it("does not install a camera producer when its track ends during creation", async () => {
		const candidate = videoTrack("candidate");
		const creationEntered = deferred<void>();
		const releaseCreation = deferred<TestVideoProducer>();
		const unusableProducer = {
			id: "unusable-producer",
			track: candidate,
			close: vi.fn(),
		};
		const createProducer = vi.fn(() => {
			creationEntered.resolve();
			return releaseCreation.promise;
		});
		const { controls, mediaHandler, setLocalMediaTrack, sfuClient } =
			createCameraHarness({
				getUserMedia: vi
					.fn()
					.mockResolvedValue(new FakeMediaStream([candidate])),
				createProducer,
			});

		const toggle = controls.toggleCamera();
		await creationEntered.promise;
		Reflect.set(candidate, "readyState", "ended");
		releaseCreation.resolve(unusableProducer);
		await expect(toggle).rejects.toThrow("ended during reconciliation");

		expect(unusableProducer.close).toHaveBeenCalledOnce();
		expect(sfuClient.closeProducer).toHaveBeenCalledWith("unusable-producer");
		expect(mediaHandler.videoProducer).toBeNull();
		expect(setLocalMediaTrack).not.toHaveBeenCalledWith("video", candidate);
		expect(mediaHandler.localStream.getVideoTracks()).toEqual([]);
	});

	it("restores the previous producer track when replacement ends in flight", async () => {
		const previous = videoTrack("previous");
		const candidate = videoTrack("candidate");
		const replacementEntered = deferred<void>();
		const releaseReplacement = deferred<void>();
		const producer = {
			id: "camera-producer",
			track: previous,
			replaceTrack: vi.fn(async ({ track }: { track: MediaStreamTrack }) => {
				if (track === candidate) {
					replacementEntered.resolve();
					await releaseReplacement.promise;
				}
				producer.track = track;
			}),
		};
		const { controls, mediaHandler, setLocalMediaTrack, state } =
			createCameraHarness({
				mediaState: {
					isCameraOn: true,
					localStream: new FakeMediaStream([previous]),
				},
				getUserMedia: vi
					.fn()
					.mockResolvedValue(new FakeMediaStream([candidate])),
				videoProducer: producer,
				deviceManager: {
					enumerateDevices: vi.fn().mockResolvedValue(undefined),
					isDeviceAvailable: vi.fn(() => true),
					findDeviceById: vi.fn(),
				},
			});

		const switching = controls.switchInputDevice("camera", "next-camera");
		await replacementEntered.promise;
		Reflect.set(candidate, "readyState", "ended");
		releaseReplacement.resolve();
		await switching;

		expect(producer.track.id).toBe(previous.id);
		expect(previous.stop).not.toHaveBeenCalled();
		expect(candidate.stop).toHaveBeenCalledOnce();
		expect(mediaHandler.localStream.getVideoTracks()).toEqual([previous]);
		expect(setLocalMediaTrack).not.toHaveBeenCalledWith("video", candidate);
		expect(state.localStream.getVideoTracks()).toEqual([previous]);
	});

	it("runs a queued camera action after an earlier action rejects", async () => {
		const firstTrack = videoTrack("first");
		const secondTrack = videoTrack("second");
		const firstProducer = deferred<TestVideoProducer>();
		const createProducer = vi
			.fn()
			.mockReturnValueOnce(firstProducer.promise)
			.mockResolvedValueOnce({ id: "producer-second", track: secondTrack });
		const { controls, mediaHandler, setLocalMediaTrack, state } =
			createCameraHarness({
				getUserMedia: vi
					.fn()
					.mockResolvedValueOnce(new FakeMediaStream([firstTrack]))
					.mockResolvedValueOnce(new FakeMediaStream([secondTrack])),
				createProducer,
			});

		const failedToggle = controls.toggleCamera();
		await vi.waitFor(() => expect(createProducer).toHaveBeenCalledTimes(1));
		const successfulToggle = controls.toggleCamera();
		firstProducer.reject(new Error("producer failed"));

		await expect(failedToggle).rejects.toThrow("producer failed");
		await expect(successfulToggle).resolves.toBeUndefined();
		expect(state.isCameraOn).toBe(true);
		expect((state.localStream as FakeMediaStream).getVideoTracks()).toEqual([
			secondTrack,
		]);
		expect(firstTrack.stop).toHaveBeenCalledOnce();
		expect(secondTrack.stop).not.toHaveBeenCalled();
		expect(mediaHandler.videoProducer).toEqual({
			id: "producer-second",
			track: secondTrack,
		});
		expect(mediaHandler.localStream.getVideoTracks()).toEqual([secondTrack]);
		expect(setLocalMediaTrack).toHaveBeenLastCalledWith("video", secondTrack);
	});

	it("reconciles an effect track once when enabling the camera", async () => {
		localStorage.setItem("backgroundEffects.blur", "1");
		const raw = videoTrack("raw");
		const processed = videoTrack("processed");
		const replaceTrack = vi.fn().mockResolvedValue(undefined);
		const producer = {
			id: "camera-producer",
			track: videoTrack("old"),
			replaceTrack,
		};
		const { controls, setLocalMediaTrack } = createCameraHarness({
			getUserMedia: vi.fn().mockResolvedValue(new FakeMediaStream([raw])),
			videoProducer: producer,
			applyBackgroundEffects: vi.fn().mockResolvedValue({
				stream: new FakeMediaStream([processed]),
				cleanup: vi.fn(),
				updateOptions: vi.fn(),
			}),
		});

		await controls.toggleCamera();

		expect(replaceTrack).toHaveBeenCalledTimes(1);
		expect(replaceTrack).toHaveBeenCalledWith({ track: processed });
		expect(setLocalMediaTrack).toHaveBeenCalledWith("video", processed);
	});

	it("publishes auto-framed output without requiring a background effect", async () => {
		localStorage.setItem("backgroundEffects.autoFraming", "1");
		const raw = videoTrack("raw");
		const framed = videoTrack("framed");
		const replaceTrack = vi.fn().mockResolvedValue(undefined);
		const applyBackgroundEffects = vi.fn().mockResolvedValue({
			stream: new FakeMediaStream([framed]),
			cleanup: vi.fn(),
			updateOptions: vi.fn(),
		});
		const { controls, setLocalMediaTrack } = createCameraHarness({
			getUserMedia: vi.fn().mockResolvedValue(new FakeMediaStream([raw])),
			videoProducer: {
				id: "camera-producer",
				track: videoTrack("old"),
				replaceTrack,
			},
			applyBackgroundEffects,
		});

		await controls.toggleCamera();

		expect(applyBackgroundEffects).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				autoFramingEnabled: true,
				backgroundBlurEnabled: false,
				backgroundImageEnabled: false,
			}),
			expect.any(AbortSignal),
		);
		expect(replaceTrack).toHaveBeenCalledWith({ track: framed });
		expect(setLocalMediaTrack).toHaveBeenCalledWith("video", framed);
	});

	it("pauses an active auto-framing session without replacing its track", async () => {
		localStorage.setItem("backgroundEffects.autoFraming", "1");
		const raw = videoTrack("raw");
		const framed = videoTrack("framed");
		const updateOptions = vi.fn().mockResolvedValue(undefined);
		const applyBackgroundEffects = vi.fn().mockResolvedValue({
			stream: new FakeMediaStream([framed]),
			cleanup: vi.fn(),
			updateOptions,
		});
		const { controls } = createCameraHarness({
			mediaState: {
				isCameraOn: true,
				localStream: new FakeMediaStream([raw]),
			},
			applyBackgroundEffects,
		});
		await controls.applyBackgroundEffectsToLocalStream();

		setAutoFramingPaused(true);
		await controls.applyBackgroundEffectsToLocalStream();

		expect(applyBackgroundEffects).toHaveBeenCalledOnce();
		expect(updateOptions).toHaveBeenCalledWith(
			expect.objectContaining({ autoFramingPaused: true }),
		);
	});

	it("falls back to live raw video when processed output has ended", async () => {
		localStorage.setItem("backgroundEffects.blur", "1");
		const raw = videoTrack("raw");
		const endedProcessed = videoTrack("ended-processed", "ended");
		const replaceTrack = vi.fn().mockResolvedValue(undefined);
		const { controls, mediaAttachments, setLocalMediaTrack, state } =
			createCameraHarness({
				getUserMedia: vi.fn().mockResolvedValue(new FakeMediaStream([raw])),
				videoProducer: {
					id: "camera-producer",
					track: videoTrack("old"),
					replaceTrack,
				},
				applyBackgroundEffects: vi.fn().mockResolvedValue({
					stream: new FakeMediaStream([endedProcessed]),
					cleanup: vi.fn(),
					updateOptions: vi.fn(),
				}),
			});

		await controls.toggleCamera();

		expect(replaceTrack).toHaveBeenCalledOnce();
		expect(replaceTrack).toHaveBeenCalledWith({ track: raw });
		expect(setLocalMediaTrack).toHaveBeenCalledWith("video", raw);
		expect(mediaAttachments.attachLocalPreview).toHaveBeenLastCalledWith(
			state.localStream,
		);
	});

	it("restores the raw preview after an effects transformation error", async () => {
		localStorage.setItem("backgroundEffects.blur", "1");
		const raw = videoTrack("raw");
		const { controls, mediaAttachments, state } = createCameraHarness({
			mediaState: {
				isCameraOn: true,
				localStream: new FakeMediaStream([raw]),
			},
			applyBackgroundEffects: vi
				.fn()
				.mockRejectedValue(new Error("transformation failed")),
		});

		await controls.applyBackgroundEffectsToLocalStream();

		expect(state.processedStream).toBeNull();
		expect(mediaAttachments.attachLocalPreview).toHaveBeenLastCalledWith(
			state.localStream,
		);
	});

	it("publishes raw video once when effects return the input stream", async () => {
		localStorage.setItem("backgroundEffects.blur", "1");
		const raw = videoTrack("raw");
		const replaceTrack = vi.fn().mockResolvedValue(undefined);
		const cleanup = vi.fn();
		const { controls, setLocalMediaTrack, state } = createCameraHarness({
			getUserMedia: vi.fn().mockResolvedValue(new FakeMediaStream([raw])),
			videoProducer: {
				id: "camera-producer",
				track: videoTrack("old"),
				replaceTrack,
			},
			applyBackgroundEffects: vi.fn(async (stream: MediaStream) => ({
				stream,
				cleanup,
				updateOptions: vi.fn(),
			})),
		});

		await controls.toggleCamera();

		expect(state.processedStream).toBeNull();
		expect(cleanup).toHaveBeenCalledOnce();
		expect(replaceTrack).toHaveBeenCalledOnce();
		expect(replaceTrack).toHaveBeenCalledWith({ track: raw });
		expect(setLocalMediaTrack).toHaveBeenCalledWith("video", raw);
	});

	it("does not create a producer during public effects application", async () => {
		localStorage.setItem("backgroundEffects.blur", "1");
		const raw = videoTrack("raw");
		const processed = videoTrack("processed");
		const createProducer = vi.fn().mockResolvedValue({
			id: "initial-producer",
			track: processed,
		});
		const { controls, manager, mediaHandler, state } = createCameraHarness({
			mediaState: {
				isCameraOn: true,
				localStream: new FakeMediaStream([raw]),
			},
			createProducer,
			applyBackgroundEffects: vi.fn().mockResolvedValue({
				stream: new FakeMediaStream([processed]),
				cleanup: vi.fn(),
				updateOptions: vi.fn(),
			}),
		});

		await controls.applyBackgroundEffectsToLocalStream();

		expect(createProducer).not.toHaveBeenCalled();
		expect(state.processedStream?.getVideoTracks()).toEqual([processed]);
		expect(mediaHandler.videoProducer).toBeNull();
		expect(mediaHandler.localStream.getVideoTracks()).toEqual([processed]);

		await manager.publishMedia(new FakeMediaStream([processed]), {
			publishVideo: true,
			publishAudio: false,
		});

		expect(createProducer).toHaveBeenCalledOnce();
		expect(createProducer).toHaveBeenCalledWith(processed, { type: "camera" });
	});

	it("switches to new raw video after effects are disabled", async () => {
		localStorage.setItem("backgroundEffects.blur", "1");
		const oldRaw = videoTrack("old-raw");
		const oldProcessed = videoTrack("old-processed");
		const nextRaw = videoTrack("next-raw");
		const processedStream = new FakeMediaStream([oldProcessed]);
		const cleanup = vi.fn(() => {
			oldProcessed.stop();
			processedStream.removeTrack(oldProcessed);
		});
		const producer = {
			id: "camera-producer",
			track: oldRaw,
			replaceTrack: vi.fn(async ({ track }) => {
				producer.track = track;
			}),
		};
		const applyBackgroundEffects = vi.fn().mockResolvedValue({
			stream: processedStream,
			cleanup,
			updateOptions: vi.fn(),
		});
		const { controls, mediaHandler, state } = createCameraHarness({
			mediaState: {
				isCameraOn: true,
				localStream: new FakeMediaStream([oldRaw]),
			},
			getUserMedia: vi.fn().mockResolvedValue(new FakeMediaStream([nextRaw])),
			videoProducer: producer,
			applyBackgroundEffects,
		});
		await controls.applyBackgroundEffectsToLocalStream();
		localStorage.clear();

		await controls.switchInputDevice("camera", "next-camera");

		expect(applyBackgroundEffects).toHaveBeenCalledOnce();
		expect(cleanup).toHaveBeenCalledOnce();
		expect(oldProcessed.stop).toHaveBeenCalledOnce();
		expect(state.processedStream).toBeNull();
		expect(producer.track).toBe(nextRaw);
		expect(mediaHandler.localStream.getVideoTracks()).toEqual([nextRaw]);
		expect(oldRaw.stop).toHaveBeenCalledOnce();
		expect(nextRaw.stop).not.toHaveBeenCalled();
	});

	it("keeps processed video live until queued raw reconciliation completes", async () => {
		localStorage.setItem("backgroundEffects.blur", "1");
		const raw = videoTrack("raw");
		const processed = videoTrack("processed");
		const processedStream = new FakeMediaStream([processed]);
		const cleanup = vi.fn(() => processed.stop());
		const producer = {
			id: "camera-producer",
			track: raw,
			replaceTrack: vi.fn(async ({ track }) => {
				producer.track = track;
			}),
		};
		const { controls, manager, mediaHandler } = createCameraHarness({
			mediaState: {
				isCameraOn: true,
				localStream: new FakeMediaStream([raw]),
			},
			videoProducer: producer,
			applyBackgroundEffects: vi.fn().mockResolvedValue({
				stream: processedStream,
				cleanup,
				updateOptions: vi.fn(),
			}),
		});
		let sendQueue: Promise<unknown> = Promise.resolve();
		manager.serializeSendMediaMutation.mockImplementation(
			(operation: () => Promise<unknown>) => {
				const result = sendQueue.then(operation);
				sendQueue = result.catch(() => undefined);
				return result;
			},
		);

		await controls.applyBackgroundEffectsToLocalStream();
		expect(producer.track).toBe(processed);
		const releaseMutation = deferred<void>();
		const activeMutationEntered = deferred<void>();
		const activeMutation = manager.serializeSendMediaMutation(async () => {
			activeMutationEntered.resolve();
			await releaseMutation.promise;
		});
		await activeMutationEntered.promise;
		localStorage.clear();
		const disableEffects = controls.applyBackgroundEffectsToLocalStream();

		expect(cleanup).not.toHaveBeenCalled();
		expect(processed.readyState).toBe("live");
		expect(producer.track).toBe(processed);

		releaseMutation.resolve();
		await Promise.all([activeMutation, disableEffects]);

		expect(producer.track).toBe(raw);
		expect(mediaHandler.localStream.getVideoTracks()).toEqual([raw]);
		expect(cleanup).toHaveBeenCalledOnce();
		expect(processed.readyState).toBe("ended");
	});

	it("force-restarts established effects before E2EE camera republish", async () => {
		localStorage.setItem("backgroundEffects.blur", "1");
		const oldRaw = videoTrack("old-raw");
		const adoptedRaw = videoTrack("adopted-raw");
		const oldGenerated = videoTrack("old-generated");
		const newGenerated = videoTrack("new-generated");
		const healthyAudio = audioTrack("healthy-audio");
		const oldProcessedStream = new FakeMediaStream([oldGenerated]);
		const rawReconciliationEntered = deferred<void>();
		const releaseRawReconciliation = deferred<void>();
		const oldCleanup = vi.fn(() => oldGenerated.stop());
		const producer = {
			id: "camera-producer",
			track: oldRaw,
			replaceTrack: vi.fn(async ({ track }: { track: MediaStreamTrack }) => {
				if (track === adoptedRaw) {
					rawReconciliationEntered.resolve();
					await releaseRawReconciliation.promise;
				}
				producer.track = track;
			}),
		};
		const applyBackgroundEffects = vi
			.fn()
			.mockResolvedValueOnce({
				stream: oldProcessedStream,
				cleanup: oldCleanup,
				updateOptions: vi.fn(),
			})
			.mockResolvedValueOnce({
				stream: new FakeMediaStream([newGenerated]),
				cleanup: vi.fn(),
				updateOptions: vi.fn(),
			});
		const publishMedia = vi.fn().mockResolvedValue({});
		const { controls, state } = createCameraHarness({
			mediaState: {
				isCameraOn: true,
				isMicOn: true,
				localStream: new FakeMediaStream([oldRaw, healthyAudio]),
			},
			getUserMedia: vi
				.fn()
				.mockResolvedValue(new FakeMediaStream([adoptedRaw])),
			videoProducer: producer,
			applyBackgroundEffects,
			publishMedia,
		});
		await controls.applyBackgroundEffectsToLocalStream();
		expect(producer.track).toBe(oldGenerated);

		const republish = controls.republishMediaAfterE2EE({ needsCamera: true });
		await rawReconciliationEntered.promise;

		expect(oldGenerated.readyState).toBe("live");
		expect(oldCleanup).not.toHaveBeenCalled();
		expect(applyBackgroundEffects).toHaveBeenCalledTimes(1);
		releaseRawReconciliation.resolve();
		await republish;

		expect(oldCleanup).toHaveBeenCalledOnce();
		expect(oldGenerated.readyState).toBe("ended");
		expect(applyBackgroundEffects).toHaveBeenCalledTimes(2);
		const restartedInput = applyBackgroundEffects.mock
			.calls[1][0] as MediaStream;
		expect(restartedInput.getVideoTracks()).toEqual([adoptedRaw]);
		expect(restartedInput.getAudioTracks()).toEqual([healthyAudio]);
		expect(healthyAudio.stop).not.toHaveBeenCalled();
		expect(producer.track).toBe(newGenerated);
		expect(publishMedia).toHaveBeenCalledOnce();
		const [publishedStream, options] = publishMedia.mock.calls[0] as [
			MediaStream,
			{ publishVideo: boolean; publishAudio: boolean },
		];
		expect(publishedStream.getVideoTracks()).toEqual([newGenerated]);
		expect(publishedStream.getAudioTracks()).toEqual([]);
		expect(options).toEqual({ publishVideo: true, publishAudio: false });
		expect(state.localStream.getAudioTracks()).toEqual([healthyAudio]);
	});

	it("keeps microphone UI and media on when combined E2EE video publication fails", async () => {
		const oldCamera = videoTrack("old-camera");
		const oldMicrophone = audioTrack("old-microphone");
		const nextCamera = videoTrack("next-camera");
		const nextMicrophone = audioTrack("next-microphone");
		const videoError = new Error("video publication failed");
		const harness = createCameraHarness({
			mediaState: {
				isCameraOn: true,
				isMicOn: true,
				localStream: new FakeMediaStream([oldCamera, oldMicrophone]),
			},
			getUserMedia: vi
				.fn()
				.mockResolvedValue(new FakeMediaStream([nextCamera, nextMicrophone])),
			publishMedia: vi.fn().mockResolvedValue({
				videoError,
				audioProducer: {
					id: "audio-producer",
					track: nextMicrophone,
				},
			}),
		});

		await expect(
			harness.controls.republishMediaAfterE2EE({
				needsCamera: true,
				needsMicrophone: true,
			}),
		).rejects.toBe(videoError);

		expect(harness.state.isCameraOn).toBe(false);
		expect(harness.state.isMicOn).toBe(true);
		expect(harness.state.localStream.getVideoTracks()).toEqual([]);
		expect(harness.state.localStream.getAudioTracks()).toEqual([
			nextMicrophone,
		]);
		expect(nextCamera.stop).toHaveBeenCalledOnce();
		expect(nextMicrophone.stop).not.toHaveBeenCalled();
		expect(setCameraEnabled).toHaveBeenCalledWith(false);
		expect(setMicEnabled).not.toHaveBeenCalledWith(false);
	});

	it("does not treat a falsy typed error as successful E2EE video publication", async () => {
			const publication = { videoError: null };
			const oldCamera = videoTrack("old-camera");
			const nextCamera = videoTrack("next-camera");
			const harness = createCameraHarness({
				mediaState: {
					isCameraOn: true,
					localStream: new FakeMediaStream([oldCamera]),
				},
				getUserMedia: vi
					.fn()
					.mockResolvedValue(new FakeMediaStream([nextCamera])),
				publishMedia: vi.fn().mockResolvedValue(publication),
			});

			const outcome = await harness.controls
				.republishMediaAfterE2EE({ needsCamera: true })
				.then(
					() => ({ status: "resolved" as const, error: undefined }),
					(error: unknown) => ({ status: "rejected" as const, error }),
				);

			expect(outcome.status).toBe("rejected");
			expect(outcome.error).toBeNull();
			expect(harness.state.isCameraOn).toBe(false);
			expect(harness.state.localStream.getVideoTracks()).toEqual([]);
			expect(nextCamera.stop).toHaveBeenCalledOnce();
	});

	it("fails when a detached published producer is removed from current manager state", async () => {
		const oldCamera = videoTrack("old-camera");
		const nextCamera = videoTrack("next-camera");
		const detachedProducer = {
			id: "detached-camera-producer",
			track: nextCamera,
		};
		const harness = createCameraHarness({
			mediaState: {
				isCameraOn: true,
				localStream: new FakeMediaStream([oldCamera]),
			},
			getUserMedia: vi
				.fn()
				.mockResolvedValue(new FakeMediaStream([nextCamera])),
			publishMedia: vi.fn().mockResolvedValue({
				videoProducer: detachedProducer,
			}),
		});
		harness.manager.getLocalProducerState.mockReturnValue(null);
		harness.manager.reconcileLocalProducerTrack.mockResolvedValue({
			id: detachedProducer.id,
			track: nextCamera,
			paused: false,
		});

		await expect(
			harness.controls.republishMediaAfterE2EE({ needsCamera: true }),
		).rejects.toThrow("Video publication did not create a producer");

		expect(
			harness.manager.reconcileLocalProducerTrack,
		).toHaveBeenCalledWith("video", nextCamera, {});
		expect(harness.state.isCameraOn).toBe(false);
		expect(nextCamera.stop).toHaveBeenCalledOnce();
	});

	it("reconciles a stale pre-existing producer to the requested E2EE track", async () => {
		const oldMicrophone = audioTrack("old-microphone");
		const nextMicrophone = audioTrack("next-microphone");
		const replaceTrack = vi.fn(
			async ({ track }: { track: MediaStreamTrack }) => {
				producer.track = track;
			},
		);
		const producer: TestVideoProducer = {
			id: "stale-audio-producer",
			track: oldMicrophone,
			replaceTrack,
			resume: vi.fn(),
		};
		const harness = createCameraHarness({
			mediaState: {
				isMicOn: true,
				localStream: new FakeMediaStream([oldMicrophone]),
			},
			getUserMedia: vi
				.fn()
				.mockResolvedValue(new FakeMediaStream([nextMicrophone])),
			audioProducer: producer,
			publishMedia: vi.fn().mockResolvedValue({}),
		});

		await harness.controls.republishMediaAfterE2EE({ needsMicrophone: true });

		expect(replaceTrack).toHaveBeenCalledWith({ track: nextMicrophone });
		expect(producer.track).toBe(nextMicrophone);
		expect(harness.manager.reconcileLocalProducerTrack).toHaveBeenCalledWith(
			"audio",
			nextMicrophone,
			{ resume: true },
		);
		expect(harness.state.isMicOn).toBe(true);
		expect(nextMicrophone.stop).not.toHaveBeenCalled();
	});

	it("falls back to raw video when public effect replacement fails", async () => {
		localStorage.setItem("backgroundEffects.blur", "1");
		const raw = videoTrack("raw");
		const oldPublished = videoTrack("old-published");
		const candidate = videoTrack("candidate");
		const candidateStream = new FakeMediaStream([candidate]);
		const cleanup = vi.fn(() => {
			candidate.stop();
			candidateStream.removeTrack(candidate);
		});
		const producer = {
			id: "camera-producer",
			track: oldPublished,
			replaceTrack: vi
				.fn()
				.mockRejectedValueOnce(new Error("replace failed"))
				.mockImplementationOnce(async ({ track }) => {
					producer.track = track;
				}),
		};
		const { controls, mediaAttachments, mediaHandler, state } =
			createCameraHarness({
				mediaState: {
					isCameraOn: true,
					localStream: new FakeMediaStream([raw]),
				},
				videoProducer: producer,
				applyBackgroundEffects: vi.fn().mockResolvedValue({
					stream: candidateStream,
					cleanup,
					updateOptions: vi.fn(),
				}),
			});

		await controls.applyBackgroundEffectsToLocalStream();

		expect(cleanup).toHaveBeenCalledOnce();
		expect(candidate.stop).toHaveBeenCalledOnce();
		expect(raw.stop).not.toHaveBeenCalled();
		expect(raw.readyState).toBe("live");
		expect(state.processedStream).toBeNull();
		expect(mediaHandler.videoProducer).toBe(producer);
		expect(producer.track).toBe(raw);
		expect(mediaHandler.localStream.getVideoTracks()).toEqual([raw]);
		expect(mediaAttachments.attachLocalPreview.mock.calls).toEqual([
			[candidateStream],
			[state.localStream],
		]);
		expect(producer.replaceTrack.mock.invocationCallOrder[1]).toBeLessThan(
			cleanup.mock.invocationCallOrder[0],
		);
	});

	it("turns camera off when public effect fallback also fails", async () => {
		localStorage.setItem("backgroundEffects.blur", "1");
		const raw = videoTrack("raw");
		const candidate = videoTrack("candidate");
		const candidateStream = new FakeMediaStream([candidate]);
		const cleanup = vi.fn(() => candidate.stop());
		const close = vi.fn();
		const producer = {
			id: "camera-producer",
			track: videoTrack("old-published"),
			close,
			replaceTrack: vi.fn().mockRejectedValue(new Error("replace failed")),
		};
		const { controls, mediaHandler, state } = createCameraHarness({
			mediaState: {
				isCameraOn: true,
				localStream: new FakeMediaStream([raw]),
			},
			videoProducer: producer,
			applyBackgroundEffects: vi.fn().mockResolvedValue({
				stream: candidateStream,
				cleanup,
				updateOptions: vi.fn(),
			}),
		});

		await expect(
			controls.applyBackgroundEffectsToLocalStream(),
		).rejects.toThrow("replace failed");

		expect(cleanup).toHaveBeenCalledOnce();
		expect(candidate.stop).toHaveBeenCalledOnce();
		expect(raw.stop).toHaveBeenCalledOnce();
		expect((state.localStream as FakeMediaStream).getVideoTracks()).toEqual([]);
		expect(state.processedStream).toBeNull();
		expect(state.isCameraOn).toBe(false);
		expect(close).toHaveBeenCalledOnce();
		expect(mediaHandler.videoProducer).toBeNull();
		expect(mediaHandler.localStream.getVideoTracks()).toEqual([]);
	});

	it("synchronizes the effective track after switching cameras", async () => {
		const oldTrack = videoTrack("old");
		const nextTrack = videoTrack("next");
		const replaceTrack = vi.fn().mockResolvedValue(undefined);
		const { controls, mediaHandler, setLocalMediaTrack } = createCameraHarness({
			mediaState: {
				isCameraOn: true,
				localStream: new FakeMediaStream([oldTrack]),
			},
			getUserMedia: vi.fn().mockResolvedValue(new FakeMediaStream([nextTrack])),
			videoProducer: {
				id: "camera-producer",
				track: oldTrack,
				replaceTrack,
			},
		});

		await controls.switchInputDevice("camera", "next-camera");

		expect(replaceTrack).toHaveBeenCalledWith({ track: nextTrack });
		expect(setLocalMediaTrack).toHaveBeenCalledWith("video", nextTrack);
		expect(mediaHandler.localStream.getVideoTracks()).toEqual([nextTrack]);
		expect(oldTrack.stop).toHaveBeenCalledOnce();
		expect(setSelectedCameraId).toHaveBeenCalledWith("next-camera");
	});

	it("persists camera selection while camera-off without media mutation", async () => {
		const getUserMedia = vi.fn();
		const replaceTrack = vi.fn();
		const { controls, createProducer, setLocalMediaTrack } =
			createCameraHarness({
				getUserMedia,
				videoProducer: {
					id: "camera-producer",
					track: videoTrack("old"),
					replaceTrack,
				},
			});

		await controls.switchInputDevice("camera", "next-camera");

		expect(setSelectedCameraId).toHaveBeenCalledWith("next-camera");
		expect(getUserMedia).not.toHaveBeenCalled();
		expect(replaceTrack).not.toHaveBeenCalled();
		expect(createProducer).not.toHaveBeenCalled();
		expect(setLocalMediaTrack).not.toHaveBeenCalled();
	});

	it("keeps the selected speaker when device enumeration fails", async () => {
		selectedSpeakerId.value = "selected-speaker";
		const enumerationError = new Error("enumeration failed");
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { controls, mediaAttachments } = createCameraHarness({
			deviceManager: {
				enumerateDevices: vi.fn().mockRejectedValue(enumerationError),
				isDeviceAvailable: vi.fn(),
				getDefaultDevice: vi.fn(),
				findDeviceById: vi.fn(),
			},
		});

		await controls.applySpeakerDevice();

		expect(mediaAttachments.setAudioOutputDevice).toHaveBeenCalledWith(
			"selected-speaker",
		);
		expect(consoleWarn).toHaveBeenCalledWith(
			"Could not validate speaker device availability:",
			enumerationError,
		);
	});

	it("restores old raw video when an effects camera switch cannot reconcile", async () => {
		localStorage.setItem("backgroundEffects.blur", "1");
		selectedCameraId.value = "old-camera";
		const oldRaw = videoTrack("old-raw");
		const oldProcessed = videoTrack("old-processed");
		const candidateRaw = videoTrack("candidate-raw");
		const candidateProcessed = videoTrack("candidate-processed");
		const candidateStream = new FakeMediaStream([candidateProcessed]);
		const cleanup = vi.fn(() => {
			candidateProcessed.stop();
			candidateStream.removeTrack(candidateProcessed);
		});
		const producer = {
			id: "camera-producer",
			track: oldProcessed,
			replaceTrack: vi
				.fn()
				.mockRejectedValueOnce(new Error("replace failed"))
				.mockImplementation(async ({ track }) => {
					producer.track = track;
				}),
		};
		const { controls, mediaHandler, setLocalMediaTrack, state } =
			createCameraHarness({
				mediaState: {
					isCameraOn: true,
					localStream: new FakeMediaStream([oldRaw]),
					processedStream: new FakeMediaStream([oldProcessed]),
				},
				getUserMedia: vi
					.fn()
					.mockResolvedValue(new FakeMediaStream([candidateRaw])),
				videoProducer: producer,
				applyBackgroundEffects: vi.fn().mockResolvedValue({
					stream: candidateStream,
					cleanup,
					updateOptions: vi.fn(),
				}),
			});

		await controls.switchInputDevice("camera", "next-camera");

		expect(state.isCameraOn).toBe(true);
		expect((state.localStream as FakeMediaStream).getVideoTracks()).toEqual([
			oldRaw,
		]);
		expect(state.processedStream).toBeNull();
		expect(oldRaw.readyState).toBe("live");
		expect(candidateRaw.stop).toHaveBeenCalledOnce();
		expect(candidateProcessed.stop).toHaveBeenCalledOnce();
		expect(cleanup).toHaveBeenCalledOnce();
		expect(producer.track).toBe(oldRaw);
		expect(mediaHandler.videoProducer).toBe(producer);
		expect(mediaHandler.localStream.getVideoTracks()).toEqual([oldRaw]);
		expect(setLocalMediaTrack).toHaveBeenLastCalledWith("video", oldRaw);
		expect(setSelectedCameraId).not.toHaveBeenCalledWith("next-camera");
		expect(selectedCameraId.value).toBe("old-camera");
	});

	it("turns the camera fully off when effects switch rollback also fails", async () => {
		localStorage.setItem("backgroundEffects.blur", "1");
		const oldRaw = videoTrack("old-raw");
		const oldProcessed = videoTrack("old-processed");
		const candidateRaw = videoTrack("candidate-raw");
		const candidateProcessed = videoTrack("candidate-processed");
		const candidateStream = new FakeMediaStream([candidateProcessed]);
		const cleanup = vi.fn(() => candidateProcessed.stop());
		const close = vi.fn();
		const producer = {
			id: "camera-producer",
			track: oldProcessed,
			close,
			replaceTrack: vi.fn().mockRejectedValue(new Error("replace failed")),
		};
		const { controls, mediaHandler, setLocalMediaTrack, state } =
			createCameraHarness({
				mediaState: {
					isCameraOn: true,
					localStream: new FakeMediaStream([oldRaw]),
					processedStream: new FakeMediaStream([oldProcessed]),
				},
				getUserMedia: vi
					.fn()
					.mockResolvedValue(new FakeMediaStream([candidateRaw])),
				videoProducer: producer,
				applyBackgroundEffects: vi.fn().mockResolvedValue({
					stream: candidateStream,
					cleanup,
					updateOptions: vi.fn(),
				}),
			});

		await expect(
			controls.switchInputDevice("camera", "next-camera"),
		).rejects.toThrow("replace failed");

		expect(state.isCameraOn).toBe(false);
		expect((state.localStream as FakeMediaStream).getVideoTracks()).toEqual([]);
		expect(oldRaw.stop).toHaveBeenCalledOnce();
		expect(candidateRaw.stop).toHaveBeenCalledOnce();
		expect(candidateProcessed.stop).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledOnce();
		expect(mediaHandler.videoProducer).toBeNull();
		expect(mediaHandler.localStream.getVideoTracks()).toEqual([]);
		expect(setLocalMediaTrack).toHaveBeenLastCalledWith("video", null);
	});

	it("stops camera media that resolves after its owner unmounts", async () => {
		const acquisition = deferred<MediaStream>();
		const requestEntered = deferred<void>();
		const lateVideo = videoTrack("late-video");
		const lateAudio = audioTrack("late-audio");
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		let harness!: ReturnType<typeof createCameraHarness>;
		const app = createApp(
			defineComponent({
				setup() {
					harness = createCameraHarness({
						getUserMedia: vi.fn(() => {
							requestEntered.resolve();
							return acquisition.promise;
						}),
					});
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		const toggle = harness.controls.toggleCamera();
		await requestEntered.promise;
		app.unmount();
		await toggle;
		await vi.waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce());
		expect(harness.createProducer).not.toHaveBeenCalled();
		expect(harness.applyBackgroundEffects).not.toHaveBeenCalled();
		expect(setSelectedCameraId).not.toHaveBeenCalled();
		expect(setCameraEnabled).not.toHaveBeenCalled();
		expect(consoleError).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.warning).not.toHaveBeenCalled();

		acquisition.resolve(new FakeMediaStream([lateVideo, lateAudio]) as never);
		await vi.waitFor(() => expect(lateVideo.stop).toHaveBeenCalledOnce());
		expect(lateAudio.stop).toHaveBeenCalledOnce();
		expect(harness.state.isCameraOn).toBe(false);
		expect(harness.state.localStream.getTracks()).toEqual([]);
	});

	it("cancels camera enable while acquired media waits in effects", async () => {
		localStorage.setItem("backgroundEffects.blur", "1");
		const raw = videoTrack("acquired-raw");
		const processed = videoTrack("acquired-processed");
		const acquisitionEntered = deferred<void>();
		const effectsEntered = deferred<void>();
		const releaseEffects = deferred<void>();
		const cleanup = vi.fn(() => processed.stop());
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		let harness!: ReturnType<typeof createCameraHarness>;
		const app = createApp(
			defineComponent({
				setup() {
					harness = createCameraHarness({
						getUserMedia: vi.fn(() => {
							acquisitionEntered.resolve();
							return Promise.resolve(new FakeMediaStream([raw]));
						}),
						applyBackgroundEffects: vi.fn(async () => {
							effectsEntered.resolve();
							await releaseEffects.promise;
							return {
								stream: new FakeMediaStream([processed]),
								cleanup,
								updateOptions: vi.fn(),
							};
						}),
					});
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		const toggle = harness.controls.toggleCamera();
		await acquisitionEntered.promise;
		await effectsEntered.promise;
		app.unmount();
		releaseEffects.resolve();
		await expect(toggle).resolves.toBeUndefined();
		await vi.waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce());

		expect(raw.stop).toHaveBeenCalledOnce();
		expect(cleanup).toHaveBeenCalledOnce();
		expect(processed.stop).toHaveBeenCalledOnce();
		expect(harness.state.isCameraOn).toBe(false);
		expect(setCameraEnabled).not.toHaveBeenCalled();
		expect(setSelectedCameraId).not.toHaveBeenCalled();
		expect(harness.createProducer).not.toHaveBeenCalled();
		expect(harness.sfuClient.sendMediaControl).not.toHaveBeenCalled();
		expect(consoleError).not.toHaveBeenCalled();
		expect(consoleWarn).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.warning).not.toHaveBeenCalled();
	});

	it("silently aborts a camera request that rejects after unmount", async () => {
		selectedCameraId.value = "remembered-camera";
		const acquisition = deferred<MediaStream>();
		const requestEntered = deferred<void>();
		const getUserMedia = vi.fn(() => {
			requestEntered.resolve();
			return acquisition.promise;
		});
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		let harness!: ReturnType<typeof createCameraHarness>;
		const app = createApp(
			defineComponent({
				setup() {
					harness = createCameraHarness({ getUserMedia });
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		const toggle = harness.controls.toggleCamera();
		await requestEntered.promise;
		app.unmount();
		await toggle;
		await vi.waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce());
		acquisition.reject(new DOMException("Missing camera", "NotFoundError"));

		expect(getUserMedia).toHaveBeenCalledOnce();
		expect(setSelectedCameraId).not.toHaveBeenCalled();
		expect(setCameraEnabled).not.toHaveBeenCalled();
		expect(consoleError).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.warning).not.toHaveBeenCalled();
		expect(harness.createProducer).not.toHaveBeenCalled();
		expect(harness.state.isCameraOn).toBe(false);
	});

	it("does not commit an automatic default-device repair after unmount", async () => {
		selectedCameraId.value = "missing-camera";
		const acquisition = deferred<MediaStream>();
		const requestEntered = deferred<void>();
		const lateTrack = videoTrack("late-default-camera");
		let harness!: ReturnType<typeof createCameraHarness>;
		const app = createApp(
			defineComponent({
				setup() {
					harness = createCameraHarness({
						getUserMedia: vi.fn(() => {
							requestEntered.resolve();
							return acquisition.promise;
						}),
						deviceManager: {
							enumerateDevices: vi.fn().mockResolvedValue(undefined),
							isDeviceAvailable: vi.fn(() => false),
							getDefaultDevice: vi.fn(() => ({
								deviceId: "default-camera",
							})),
							findDeviceById: vi.fn(),
						},
					});
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		const toggle = harness.controls.toggleCamera();
		await requestEntered.promise;
		app.unmount();
		await toggle;
		await vi.waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce());

		expect(setSelectedCameraId).not.toHaveBeenCalled();
		acquisition.resolve(new FakeMediaStream([lateTrack]) as never);
		await vi.waitFor(() => expect(lateTrack.stop).toHaveBeenCalledOnce());
	});

	it("stops a stream invalidated in the outer acquisition handoff", async () => {
		selectedCameraId.value = "missing-camera";
		const resolvedTrack = videoTrack("handoff-camera");
		const resolvedStream = new FakeMediaStream([resolvedTrack]);
		const requestEntered = deferred<void>();
		const browserFulfillments: Array<(stream: MediaStream) => void> = [];
		const browserRequest = {
			then(
				onFulfilled: (stream: MediaStream) => void,
				_onRejected?: (error: unknown) => void,
			) {
				browserFulfillments.push(onFulfilled);
				requestEntered.resolve();
				return Promise.resolve();
			},
		};
		let harness!: ReturnType<typeof createCameraHarness>;
		const app = createApp(
			defineComponent({
				setup() {
					harness = createCameraHarness({
						getUserMedia: vi.fn(() => browserRequest),
						deviceManager: {
							enumerateDevices: vi.fn().mockResolvedValue(undefined),
							isDeviceAvailable: vi.fn(() => false),
							getDefaultDevice: vi.fn(() => ({
								deviceId: "default-camera",
							})),
							findDeviceById: vi.fn(),
						},
					});
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		const acquisition = harness.controls.acquireUserMedia(true, false);
		await requestEntered.promise;
		expect(browserFulfillments).toHaveLength(2);
		for (const fulfill of browserFulfillments) fulfill(resolvedStream as never);
		app.unmount();

		await expect(acquisition).rejects.toMatchObject({ name: "AbortError" });
		await vi.waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce());
		expect(resolvedTrack.stop).toHaveBeenCalledOnce();
		expect(setSelectedCameraId).not.toHaveBeenCalled();
		expect(harness.state.localStream.getTracks()).toEqual([]);
	});

	it("aborts an entered fallback request without committing repairs", async () => {
		selectedCameraId.value = "remembered-camera";
		const fallbackRequest = deferred<MediaStream>();
		const fallbackEntered = deferred<void>();
		const lateTrack = videoTrack("late-fallback-camera");
		const getUserMedia = vi
			.fn()
			.mockRejectedValueOnce(
				new DOMException("Missing camera", "NotFoundError"),
			)
			.mockImplementationOnce(() => {
				fallbackEntered.resolve();
				return fallbackRequest.promise;
			});
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		let harness!: ReturnType<typeof createCameraHarness>;
		const app = createApp(
			defineComponent({
				setup() {
					harness = createCameraHarness({
						getUserMedia,
						deviceManager: {
							enumerateDevices: vi.fn().mockResolvedValue(undefined),
							isDeviceAvailable: vi.fn(() => true),
							findDeviceById: vi.fn(),
						},
					});
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		const toggle = harness.controls.toggleCamera();
		await fallbackEntered.promise;
		app.unmount();
		await toggle;
		await vi.waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce());

		expect(getUserMedia).toHaveBeenCalledTimes(2);
		expect(setSelectedCameraId).not.toHaveBeenCalled();
		expect(setCameraEnabled).not.toHaveBeenCalled();
		expect(harness.createProducer).not.toHaveBeenCalled();
		expect(harness.applyBackgroundEffects).not.toHaveBeenCalled();
		expect(consoleError).not.toHaveBeenCalled();
		expect(consoleWarn).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.warning).not.toHaveBeenCalled();

		fallbackRequest.resolve(new FakeMediaStream([lateTrack]) as never);
		await vi.waitFor(() => expect(lateTrack.stop).toHaveBeenCalledOnce());
	});

	it("silently aborts Meeting E2EE reacquisition during unmount", async () => {
		localStorage.setItem("backgroundEffects.blur", "1");
		const acquisition = deferred<MediaStream>();
		const requestEntered = deferred<void>();
		const lateTrack = videoTrack("late-e2ee-camera");
		const rawTrack = videoTrack("current-raw-camera");
		const generatedTrack = videoTrack("current-generated-camera");
		const healthyAudio = audioTrack("healthy-audio");
		const producer = {
			id: "camera-producer",
			track: rawTrack,
			close: vi.fn(),
			replaceTrack: vi.fn(async ({ track }: { track: MediaStreamTrack }) => {
				producer.track = track;
			}),
		};
		const generatedCleanup = vi.fn(() => generatedTrack.stop());
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		let harness!: ReturnType<typeof createCameraHarness>;
		const app = createApp(
			defineComponent({
				setup() {
					harness = createCameraHarness({
						mediaState: {
							isCameraOn: true,
							isMicOn: true,
							localStream: new FakeMediaStream([rawTrack, healthyAudio]),
						},
						videoProducer: producer,
						applyBackgroundEffects: vi.fn().mockResolvedValue({
							stream: new FakeMediaStream([generatedTrack]),
							cleanup: generatedCleanup,
							updateOptions: vi.fn(),
						}),
						getUserMedia: vi.fn(() => {
							requestEntered.resolve();
							return acquisition.promise;
						}),
					});
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));
		await harness.controls.applyBackgroundEffectsToLocalStream();
		expect(producer.track).toBe(generatedTrack);

		const republish = harness.controls.republishMediaAfterE2EE({
			needsCamera: true,
		});
		await requestEntered.promise;
		app.unmount();
		await expect(republish).resolves.toBeUndefined();
		await vi.waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce());

		expect(consoleError).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.warning).not.toHaveBeenCalled();
		expect(harness.publishMedia).not.toHaveBeenCalled();
		expect(harness.applyBackgroundEffects).toHaveBeenCalledOnce();
		expect(producer.close).toHaveBeenCalledOnce();
		expect(rawTrack.stop).toHaveBeenCalledOnce();
		expect(generatedCleanup).toHaveBeenCalledOnce();
		expect(generatedTrack.stop).toHaveBeenCalledOnce();
		acquisition.resolve(new FakeMediaStream([lateTrack]) as never);
		await vi.waitFor(() => expect(lateTrack.stop).toHaveBeenCalledOnce());
	});

	it.each(["camera", "microphone"] as const)(
		"silently aborts deferred %s switching during unmount",
		async (deviceType) => {
			const acquisition = deferred<MediaStream>();
			const requestEntered = deferred<void>();
			const currentTrack =
				deviceType === "camera"
					? videoTrack("current-camera")
					: audioTrack("current-microphone");
			const lateTrack =
				deviceType === "camera"
					? videoTrack("late-camera")
					: audioTrack("late-microphone");
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const consoleWarn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => {});
			let harness!: ReturnType<typeof createCameraHarness>;
			const app = createApp(
				defineComponent({
					setup() {
						harness = createCameraHarness({
							mediaState: {
								isCameraOn: deviceType === "camera",
								isMicOn: deviceType === "microphone",
								localStream: new FakeMediaStream([currentTrack]),
							},
							getUserMedia: vi.fn(() => {
								requestEntered.resolve();
								return acquisition.promise;
							}),
							deviceManager: {
								enumerateDevices: vi.fn().mockResolvedValue(undefined),
								isDeviceAvailable: vi.fn(() => true),
								findDeviceById: vi.fn(),
							},
						});
						return () => null;
					},
				}),
			);
			app.mount(document.createElement("div"));

			const switching = harness.controls.switchInputDevice(
				deviceType,
				"next-device",
			);
			await requestEntered.promise;
			app.unmount();
			await expect(switching).resolves.toBeUndefined();
			await vi.waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce());

			expect(consoleError).not.toHaveBeenCalled();
			expect(consoleWarn).not.toHaveBeenCalled();
			expect(toast.error).not.toHaveBeenCalled();
			expect(toast.warning).not.toHaveBeenCalled();
			acquisition.resolve(new FakeMediaStream([lateTrack]) as never);
			await vi.waitFor(() => expect(lateTrack.stop).toHaveBeenCalledOnce());
		},
	);

	it("cancels an acquired camera switch before reconciliation after unmount", async () => {
		const oldTrack = videoTrack("old-camera");
		const candidateTrack = videoTrack("candidate-camera");
		const acquisitionEntered = deferred<void>();
		const reconciliationEntered = deferred<void>();
		const releaseReconciliation = deferred<void>();
		const replaceTrack = vi.fn();
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		let harness!: ReturnType<typeof createCameraHarness>;
		const app = createApp(
			defineComponent({
				setup() {
					harness = createCameraHarness({
						mediaState: {
							isCameraOn: true,
							localStream: new FakeMediaStream([oldTrack]),
						},
						videoProducer: {
							id: "camera-producer",
							track: oldTrack,
							replaceTrack,
							close: vi.fn(),
						},
						getUserMedia: vi.fn(() => {
							acquisitionEntered.resolve();
							return Promise.resolve(new FakeMediaStream([candidateTrack]));
						}),
						deviceManager: {
							enumerateDevices: vi.fn().mockResolvedValue(undefined),
							isDeviceAvailable: vi.fn(() => true),
							findDeviceById: vi.fn(),
						},
					});
					harness.manager.serializeSendMediaMutation.mockImplementation(
						async (operation: () => Promise<unknown>) => {
							reconciliationEntered.resolve();
							await releaseReconciliation.promise;
							return operation();
						},
					);
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		const switching = harness.controls.switchInputDevice(
			"camera",
			"next-camera",
		);
		await acquisitionEntered.promise;
		await reconciliationEntered.promise;
		app.unmount();
		releaseReconciliation.resolve();
		await expect(switching).resolves.toBeUndefined();
		await vi.waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce());

		expect(oldTrack.stop).toHaveBeenCalledOnce();
		expect(candidateTrack.stop).toHaveBeenCalledOnce();
		expect(replaceTrack).not.toHaveBeenCalled();
		expect(harness.createProducer).not.toHaveBeenCalled();
		expect(harness.sfuClient.sendMediaControl).not.toHaveBeenCalled();
		expect(setSelectedCameraId).not.toHaveBeenCalled();
		expect(setCameraEnabled).not.toHaveBeenCalled();
		expect(harness.state.isCameraOn).toBe(false);
		expect(consoleError).not.toHaveBeenCalled();
		expect(consoleWarn).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.warning).not.toHaveBeenCalled();
	});

	it("keeps source video live until terminal producer cleanup finishes", async () => {
		const raw = videoTrack("raw");
		const stop = vi.mocked(raw.stop);
		const close = vi.fn();
		const terminalCleanup = deferred<void>();
		const terminalCleanupWaitEntered = deferred<void>();
		let harness!: ReturnType<typeof createCameraHarness>;
		const app = createApp(
			defineComponent({
				setup() {
					harness = createCameraHarness({
						mediaState: {
							isCameraOn: true,
							localStream: new FakeMediaStream([raw]),
						},
						videoProducer: { id: "camera-producer", track: raw, close },
					});
					harness.manager.serializeSendMediaMutation.mockImplementation(() => {
						terminalCleanupWaitEntered.resolve();
						return terminalCleanup.promise.then(() =>
							Promise.reject(
								new DOMException("Media cleaned up", "AbortError"),
							),
						);
					});
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		app.unmount();
		await terminalCleanupWaitEntered.promise;
		expect(stop).not.toHaveBeenCalled();

		close();
		terminalCleanup.resolve();
		await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
		expect(close.mock.invocationCallOrder[0]).toBeLessThan(
			stop.mock.invocationCallOrder[0],
		);
	});

	it("silences terminal send cleanup AbortError after camera lifecycle abort", async () => {
		const raw = videoTrack("terminal-cleanup-camera");
		const cleanupEntered = deferred<void>();
		const releaseCleanup = deferred<void>();
		const terminalAbort = new DOMException(
			"SFU media manager reached terminal state",
			"AbortError",
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		let harness!: ReturnType<typeof createCameraHarness>;
		const app = createApp(
			defineComponent({
				setup() {
					harness = createCameraHarness({
						mediaState: {
							isCameraOn: true,
							localStream: new FakeMediaStream([raw]),
						},
					});
					let serializationCount = 0;
					harness.manager.serializeSendMediaMutation.mockImplementation(
						async () => {
							serializationCount++;
							if (serializationCount === 1) {
								cleanupEntered.resolve();
								await releaseCleanup.promise;
							}
							throw terminalAbort;
						},
					);
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		const toggle = harness.controls.toggleCamera();
		await cleanupEntered.promise;
		app.unmount();
		releaseCleanup.resolve();
		await expect(toggle).resolves.toBeUndefined();
		await vi.waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce());

		expect(raw.stop).toHaveBeenCalledOnce();
		expect(setCameraEnabled).not.toHaveBeenCalled();
		expect(harness.sfuClient.sendMediaControl).not.toHaveBeenCalled();
		expect(consoleError).not.toHaveBeenCalled();
		expect(consoleWarn).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.warning).not.toHaveBeenCalled();
	});

	it("surfaces an ordinary AbortError while the camera lifecycle is active", async () => {
		const raw = videoTrack("active-camera");
		const ordinaryAbort = new DOMException(
			"Operation was interrupted",
			"AbortError",
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		let harness!: ReturnType<typeof createCameraHarness>;
		const app = createApp(
			defineComponent({
				setup() {
					harness = createCameraHarness({
						mediaState: {
							isCameraOn: true,
							localStream: new FakeMediaStream([raw]),
						},
					});
					harness.manager.serializeSendMediaMutation.mockRejectedValue(
						ordinaryAbort,
					);
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		await expect(harness.controls.toggleCamera()).rejects.toBe(ordinaryAbort);
		expect(consoleError).toHaveBeenCalledWith(
			"Failed to toggle camera:",
			ordinaryAbort,
		);
		expect(toast.error).toHaveBeenCalledWith("Failed to toggle camera");

		app.unmount();
		await vi.waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce());
	});

	it("disposes delegated effects only after queued camera cleanup", async () => {
		const raw = videoTrack("raw");
		const cleanupEntered = deferred<void>();
		const releaseCleanup = deferred<void>();
		let harness!: ReturnType<typeof createCameraHarness>;
		const app = createApp(
			defineComponent({
				setup() {
					harness = createCameraHarness({
						mediaState: {
							isCameraOn: true,
							localStream: new FakeMediaStream([raw]),
						},
					});
					harness.manager.serializeSendMediaMutation.mockImplementation(
						async (operation: () => Promise<unknown>) => {
							cleanupEntered.resolve();
							await releaseCleanup.promise;
							return operation();
						},
					);
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		app.unmount();
		await cleanupEntered.promise;
		expect(harness.dispose).not.toHaveBeenCalled();
		expect(raw.stop).not.toHaveBeenCalled();

		releaseCleanup.resolve();
		await vi.waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce());
		expect(raw.stop).toHaveBeenCalledOnce();
		expect(raw.stop.mock.invocationCallOrder[0]).toBeLessThan(
			harness.dispose.mock.invocationCallOrder[0],
		);
	});

	it("queues camera initialization ahead of unmount effects disposal", async () => {
		cameraEnabled.value = true;
		localStorage.setItem("backgroundEffects.blur", "1");
		const raw = videoTrack("initial-camera");
		const initializationEntered = deferred<void>();
		const releaseInitialization = deferred<void>();
		const initializationFinished = vi.fn();
		const teardownReconciliationEntered = vi.fn();
		const initializeError = new Error("initialization failed after unmount");
		const close = vi.fn().mockResolvedValue(undefined);
		class FakeSelfieSegmentation {
			setOptions() {}
			onResults() {}
			async initialize() {
				initializationEntered.resolve();
				await releaseInitialization.promise;
				initializationFinished();
				throw initializeError;
			}
			close = close;
		}
		vi.stubGlobal("SelfieSegmentation", FakeSelfieSegmentation);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		let harness!: ReturnType<typeof createCameraHarness>;
		let dispose!: ReturnType<typeof vi.fn>;
		const app = createApp(
			defineComponent({
				setup() {
					const effects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					dispose = vi.fn(() => effects.dispose());
					harness = createCameraHarness({
						getUserMedia: vi.fn().mockResolvedValue(new FakeMediaStream([raw])),
						backgroundEffects: { ...effects, dispose } as never,
					});
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));
		harness.manager.serializeSendMediaMutation.mockImplementation(
			async (operation: () => Promise<unknown>) => {
				teardownReconciliationEntered();
				return operation();
			},
		);

		const initialization = harness.controls.initializeCamera();
		await initializationEntered.promise;
		app.unmount();
		expect(dispose).not.toHaveBeenCalled();
		expect(raw.stop).not.toHaveBeenCalled();

		releaseInitialization.resolve();
		await expect(initialization).resolves.toBeUndefined();
		await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
		expect(initializationFinished.mock.invocationCallOrder[0]).toBeLessThan(
			teardownReconciliationEntered.mock.invocationCallOrder[0],
		);
		expect(
			teardownReconciliationEntered.mock.invocationCallOrder[0],
		).toBeLessThan(dispose.mock.invocationCallOrder[0]);
		expect(harness.state.localStream.getTracks()).toEqual([]);
		expect(raw.stop).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledOnce();
		expect(harness.state.isCameraOn).toBe(false);
		expect(setCameraEnabled).not.toHaveBeenCalled();
		expect(harness.createProducer).not.toHaveBeenCalled();
		expect(harness.sfuClient.sendMediaControl).not.toHaveBeenCalled();
		expect(consoleError).not.toHaveBeenCalled();
		expect(consoleWarn).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.warning).not.toHaveBeenCalled();
	});

	it("continues terminal camera cleanup when effects session cleanup throws", async () => {
		localStorage.setItem("backgroundEffects.blur", "1");
		const raw = videoTrack("raw-camera");
		const processed = videoTrack("processed-camera");
		const cleanupError = new Error("session cleanup failed");
		const cleanup = vi.fn(() => {
			processed.stop();
			throw cleanupError;
		});
		const producer = {
			id: "camera-producer",
			track: raw,
			close: vi.fn(),
			replaceTrack: vi.fn(async ({ track }: { track: MediaStreamTrack }) => {
				producer.track = track;
			}),
		};
		let harness!: ReturnType<typeof createCameraHarness>;
		const app = createApp(
			defineComponent({
				setup() {
					harness = createCameraHarness({
						mediaState: {
							isCameraOn: true,
							localStream: new FakeMediaStream([raw]),
						},
						videoProducer: producer,
						applyBackgroundEffects: vi.fn().mockResolvedValue({
							stream: new FakeMediaStream([processed]),
							cleanup,
							updateOptions: vi.fn(),
						}),
					});
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));
		await harness.controls.applyBackgroundEffectsToLocalStream();

		app.unmount();
		await vi.waitFor(() => expect(harness.dispose).toHaveBeenCalledOnce());
		expect(cleanup).toHaveBeenCalledOnce();
		expect(processed.stop).toHaveBeenCalledOnce();
		expect(raw.stop).toHaveBeenCalledOnce();
		expect(harness.stopProcessing).toHaveBeenCalledOnce();
		expect(producer.close).toHaveBeenCalledOnce();
	});

	it("returns the same final background-effects disposal", async () => {
		let effects!: ReturnType<typeof useBackgroundEffects>;
		const app = createApp(
			defineComponent({
				setup() {
					effects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		const firstDispose = effects.dispose();
		const secondDispose = effects.dispose();

		expect(secondDispose).toBe(firstDispose);
		await firstDispose;
		app.unmount();
	});

	it("cancels a provisional track reader while background image loading is pending", async () => {
		const cancelError = new Error("reader cancel rejected");
		const cancel = vi.fn().mockRejectedValue(cancelError);
		const readerAllocated = deferred<void>();
		const imageLoadingStarted = deferred<void>();
		class FakeTrackProcessor {
			readable = {
				getReader: () => {
					readerAllocated.resolve();
					return { cancel, read: vi.fn(() => new Promise(() => {})) };
				},
			};
		}
		class PendingImage {
			crossOrigin = "";
			onload: (() => void) | null = null;
			onerror: ((error: unknown) => void) | null = null;
			private currentSrc = "";
			get src() {
				return this.currentSrc;
			}
			set src(value: string) {
				this.currentSrc = value;
				if (value) imageLoadingStarted.resolve();
			}
		}
		class FakeSelfieSegmentation {
			setOptions() {}
			onResults() {}
			initialize = vi.fn().mockResolvedValue(undefined);
			close = vi.fn().mockResolvedValue(undefined);
		}
		vi.stubGlobal("SelfieSegmentation", FakeSelfieSegmentation);
		vi.stubGlobal("Image", PendingImage);
		vi.stubGlobal("MediaStreamTrackProcessor", FakeTrackProcessor);
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			drawImage: vi.fn(),
			clearRect: vi.fn(),
		} as never);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const inputTrack = Object.assign(videoTrack("input"), {
			getSettings: () => ({ width: 640, height: 480 }),
		});
		let effects!: ReturnType<typeof useBackgroundEffects>;
		const app = createApp(
			defineComponent({
				setup() {
					effects = useBackgroundEffects();
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		const applying = effects.applyBackgroundEffects(
			new FakeMediaStream([inputTrack]) as never,
			{
				backgroundImageEnabled: true,
				selectedBackgroundImage: "beach",
			},
		);
		await readerAllocated.promise;
		await imageLoadingStarted.promise;
		app.unmount();

		await expect(withDeadline(applying)).rejects.toMatchObject({
			name: "AbortError",
		});
		await effects.dispose();
		expect(cancel).toHaveBeenCalledOnce();
		expect(consoleError).not.toHaveBeenCalled();
		expect(consoleWarn).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.warning).not.toHaveBeenCalled();
	});

	it("detaches provisional fallback video while playback is pending", async () => {
		Reflect.deleteProperty(window, "MediaStreamTrackProcessor");
		const playbackEntered = deferred<void>();
		const releasePlayback = deferred<void>();
		let fallbackVideo: HTMLMediaElement | null = null;
		vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
			function () {
				fallbackVideo = this;
				playbackEntered.resolve();
				return releasePlayback.promise;
			},
		);
		class FakeSelfieSegmentation {
			setOptions() {}
			onResults() {}
			initialize = vi.fn().mockResolvedValue(undefined);
			close = vi.fn().mockResolvedValue(undefined);
		}
		vi.stubGlobal("SelfieSegmentation", FakeSelfieSegmentation);
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			drawImage: vi.fn(),
			clearRect: vi.fn(),
		} as never);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const inputTrack = Object.assign(videoTrack("input"), {
			getSettings: () => ({ width: 640, height: 480 }),
		});
		let effects!: ReturnType<typeof useBackgroundEffects>;
		const app = createApp(
			defineComponent({
				setup() {
					effects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		const applying = effects.applyBackgroundEffects(
			new FakeMediaStream([inputTrack]) as never,
			{ backgroundBlurEnabled: true },
		);
		await playbackEntered.promise;
		await effects.dispose();

		await expect(withDeadline(applying)).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(fallbackVideo?.srcObject).toBeNull();
		expect(consoleError).not.toHaveBeenCalled();
		expect(consoleWarn).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.warning).not.toHaveBeenCalled();
		releasePlayback.resolve();
		app.unmount();
	});

	it("draws each source frame once when auto framing is disabled", async () => {
		const frame = { close: vi.fn() } as unknown as VideoFrame;
		const bitmap = { close: vi.fn() };
		const read = vi
			.fn()
			.mockResolvedValueOnce({ done: false, value: frame })
			.mockImplementation(() => new Promise(() => {}));
		class FakeTrackProcessor {
			readable = {
				getReader: () => ({
					cancel: vi.fn().mockResolvedValue(undefined),
					read,
				}),
			};
		}
		const processingContext = { drawImage: vi.fn(), clearRect: vi.fn() };
		const outputContext = { drawImage: vi.fn(), clearRect: vi.fn() };
		const outputTrack = videoTrack("output");
		vi.stubGlobal("MediaStreamTrackProcessor", FakeTrackProcessor);
		vi.stubGlobal("OffscreenCanvas", undefined);
		vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
		vi.spyOn(HTMLCanvasElement.prototype, "getContext")
			.mockReturnValueOnce(processingContext as never)
			.mockReturnValueOnce(outputContext as never);
		Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
			configurable: true,
			value: vi.fn(() => new FakeMediaStream([outputTrack])),
		});
		const inputTrack = Object.assign(videoTrack("input"), {
			getSettings: () => ({ width: 640, height: 480 }),
		});
		let effects!: ReturnType<typeof useBackgroundEffects>;
		const app = createApp(
			defineComponent({
				setup() {
					effects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		const session = await effects.applyBackgroundEffects(
			new FakeMediaStream([inputTrack]) as never,
			{ autoFramingEnabled: false },
		);
		await vi.waitFor(() => expect(bitmap.close).toHaveBeenCalledOnce());

		expect(
			processingContext.drawImage.mock.calls.filter(
				([source]) => source === bitmap,
			),
		).toHaveLength(1);
		session.cleanup();
		await effects.dispose();
		app.unmount();
	});

	it("initializes WebGL only when a background effect is enabled", async () => {
		class FakeTrackProcessor {
			readable = {
				getReader: () => ({
					cancel: vi.fn().mockResolvedValue(undefined),
					read: vi.fn(() => new Promise(() => {})),
				}),
			};
		}
		const context = { drawImage: vi.fn(), clearRect: vi.fn() };
		const outputTrack = videoTrack("output");
		vi.stubGlobal("MediaStreamTrackProcessor", FakeTrackProcessor);
		vi.stubGlobal("OffscreenCanvas", undefined);
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			context as never,
		);
		Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
			configurable: true,
			value: vi.fn(() => new FakeMediaStream([outputTrack])),
		});
		const inputTrack = Object.assign(videoTrack("input"), {
			getSettings: () => ({ width: 640, height: 480 }),
		});
		let effects!: ReturnType<typeof useBackgroundEffects>;
		const app = createApp(
			defineComponent({
				setup() {
					effects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		const session = await effects.applyBackgroundEffects(
			new FakeMediaStream([inputTrack]) as never,
			{ autoFramingEnabled: true },
		);
		expect(webglSpies.construct).not.toHaveBeenCalled();

		await session.updateOptions({ backgroundBlurEnabled: true });
		expect(webglSpies.construct).toHaveBeenCalledOnce();
		expect(webglSpies.initializeShaders).toHaveBeenCalledOnce();
		session.cleanup();
		await effects.dispose();
		app.unmount();
	});

	it("closes every provisional stream resource when allocation aborts", async () => {
		const operation = new AbortController();
		const lateFrame = { close: vi.fn() } as unknown as VideoFrame;
		const releaseRead = deferred<{
			done: boolean;
			value?: VideoFrame;
		}>();
		const cancel = vi.fn(() => {
			releaseRead.resolve({ done: false, value: lateFrame });
			return Promise.reject(new Error("reader cancel rejected"));
		});
		const closeWriter = vi
			.fn()
			.mockRejectedValue(new Error("writer close rejected"));
		const generatedTrack = Object.assign(videoTrack("generated"), {
			writable: { getWriter: () => ({ close: closeWriter, write: vi.fn() }) },
		});
		class FakeTrackProcessor {
			readable = {
				getReader: () => ({ cancel, read: vi.fn(() => releaseRead.promise) }),
			};
		}
		class FakeTrackGenerator {
			id = generatedTrack.id;
			kind = generatedTrack.kind;
			readyState = generatedTrack.readyState;
			stop = generatedTrack.stop;
			writable = generatedTrack.writable;
		}
		const context = { drawImage: vi.fn(), clearRect: vi.fn() };
		class FakeOffscreenCanvas {
			width: number;
			height: number;
			constructor(width: number, height: number) {
				this.width = width;
				this.height = height;
			}
			getContext() {
				return context;
			}
			transferToImageBitmap() {
				return { close: vi.fn() };
			}
		}
		class AbortingMediaStream extends FakeMediaStream {
			constructor(tracks: MediaStreamTrack[] = []) {
				super(tracks);
				if (tracks.some((track) => track.id === generatedTrack.id)) {
					operation.abort(
						new DOMException("Allocation superseded", "AbortError"),
					);
				}
			}
		}
		class FakeSelfieSegmentation {
			setOptions() {}
			onResults() {}
			initialize = vi.fn().mockResolvedValue(undefined);
			close = vi.fn().mockResolvedValue(undefined);
			send = vi.fn();
		}
		vi.stubGlobal("SelfieSegmentation", FakeSelfieSegmentation);
		vi.stubGlobal("MediaStream", AbortingMediaStream);
		vi.stubGlobal("MediaStreamTrackProcessor", FakeTrackProcessor);
		vi.stubGlobal("MediaStreamTrackGenerator", FakeTrackGenerator);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			context as never,
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const inputTrack = Object.assign(videoTrack("input"), {
			getSettings: () => ({ width: 640, height: 480 }),
		});
		let effects!: ReturnType<typeof useBackgroundEffects>;
		const app = createApp(
			defineComponent({
				setup() {
					effects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		await expect(
			withDeadline(
				effects.applyBackgroundEffects(
					new FakeMediaStream([inputTrack]) as never,
					{ backgroundBlurEnabled: true },
					operation.signal,
				),
			),
		).rejects.toMatchObject({ name: "AbortError" });

		expect(cancel).toHaveBeenCalledOnce();
		expect(lateFrame.close).toHaveBeenCalledOnce();
		expect(closeWriter).toHaveBeenCalledOnce();
		expect(generatedTrack.stop).toHaveBeenCalledOnce();
		expect(consoleError).not.toHaveBeenCalled();
		expect(consoleWarn).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.warning).not.toHaveBeenCalled();
		await effects.dispose();
		app.unmount();
	});

	it("replaces a poisoned segmentation model after fatal reset failure", async () => {
		const secondRead = deferred<{ done: boolean; value: VideoFrame }>();
		const neverRead = new Promise<never>(() => {});
		const firstFrame = { close: vi.fn() } as unknown as VideoFrame;
		const secondFrame = { close: vi.fn() } as unknown as VideoFrame;
		const read = vi
			.fn()
			.mockResolvedValueOnce({ done: false, value: firstFrame })
			.mockImplementationOnce(() => secondRead.promise)
			.mockImplementation(() => neverRead);
		const cancel = vi.fn().mockResolvedValue(undefined);
		class FakeTrackProcessor {
			readable = { getReader: () => ({ cancel, read }) };
		}
		const instances: FakeSelfieSegmentation[] = [];
		class FakeSelfieSegmentation {
			readonly index = instances.length;
			close = vi.fn().mockResolvedValue(undefined);
			reset = vi.fn(() => {
				if (this.index === 0) throw new Error("reset failed");
			});
			send = vi.fn(async () => {
				if (this.index === 0) {
					const error = new Error("poisoned wasm state");
					error.name = "RuntimeError";
					throw error;
				}
			});
			constructor() {
				instances.push(this);
			}
			setOptions() {}
			onResults() {}
			initialize = vi.fn().mockResolvedValue(undefined);
		}
		const outputTrack = videoTrack("output");
		const context = { drawImage: vi.fn(), clearRect: vi.fn() };
		vi.stubGlobal("SelfieSegmentation", FakeSelfieSegmentation);
		vi.stubGlobal("MediaStreamTrackProcessor", FakeTrackProcessor);
		vi.stubGlobal("OffscreenCanvas", undefined);
		vi.stubGlobal(
			"createImageBitmap",
			vi.fn().mockResolvedValue({ close: vi.fn() }),
		);
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			context as never,
		);
		Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
			configurable: true,
			value: vi.fn(() => new FakeMediaStream([outputTrack])),
		});
		const inputTrack = Object.assign(videoTrack("input"), {
			getSettings: () => ({ width: 640, height: 480 }),
		});
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		let effects!: ReturnType<typeof useBackgroundEffects>;
		const app = createApp(
			defineComponent({
				setup() {
					effects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));
		const session = await effects.applyBackgroundEffects(
			new FakeMediaStream([inputTrack]) as never,
			{ backgroundBlurEnabled: true },
		);

		await vi.waitFor(() => expect(instances).toHaveLength(2));
		expect(instances[0].close).toHaveBeenCalledOnce();
		secondRead.resolve({ done: false, value: secondFrame });
		await vi.waitFor(() => expect(instances[1].send).toHaveBeenCalledOnce());

		session.cleanup();
		await effects.dispose();
		expect(instances[1].close).toHaveBeenCalledOnce();
		expect(consoleError).toHaveBeenCalledWith(
			"Frame processing error:",
			expect.objectContaining({ name: "RuntimeError" }),
		);
		app.unmount();
	});

	it("moves another active effects owner onto a replacement model", async () => {
		const releaseFatalSend = deferred<void>();
		const peerReadEntered = deferred<void>();
		const releasePeerRead = deferred<{ done: boolean; value: VideoFrame }>();
		const neverRead = new Promise<never>(() => {});
		const ownerFrame = { close: vi.fn() } as unknown as VideoFrame;
		const peerFrame = { close: vi.fn() } as unknown as VideoFrame;
		let processorIndex = 0;
		class FakeTrackProcessor {
			readonly index = processorIndex++;
			readable = {
				getReader: () => ({
					cancel: vi.fn().mockResolvedValue(undefined),
					read:
						this.index === 0
							? vi
									.fn()
									.mockResolvedValueOnce({ done: false, value: ownerFrame })
									.mockImplementation(() => neverRead)
							: vi
									.fn(() => {
										peerReadEntered.resolve();
										return releasePeerRead.promise;
									})
									.mockImplementationOnce(() => {
										peerReadEntered.resolve();
										return releasePeerRead.promise;
									})
									.mockImplementation(() => neverRead),
				}),
			};
		}
		const instances: FakeSelfieSegmentation[] = [];
		class FakeSelfieSegmentation {
			readonly index = instances.length;
			close = vi.fn().mockResolvedValue(undefined);
			reset = vi.fn(() => {
				if (this.index === 0) throw new Error("reset failed");
			});
			send = vi.fn(async () => {
				if (this.index !== 0) return;
				await releaseFatalSend.promise;
				const error = new Error("poisoned wasm state");
				error.name = "RuntimeError";
				throw error;
			});
			constructor() {
				instances.push(this);
			}
			setOptions() {}
			onResults() {}
			initialize = vi.fn().mockResolvedValue(undefined);
		}
		const context = { drawImage: vi.fn(), clearRect: vi.fn() };
		vi.stubGlobal("SelfieSegmentation", FakeSelfieSegmentation);
		vi.stubGlobal("MediaStreamTrackProcessor", FakeTrackProcessor);
		vi.stubGlobal("OffscreenCanvas", undefined);
		vi.stubGlobal(
			"createImageBitmap",
			vi.fn().mockResolvedValue({ close: vi.fn() }),
		);
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			context as never,
		);
		Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
			configurable: true,
			value: vi.fn(() => new FakeMediaStream([videoTrack("output")])),
		});
		const firstInput = Object.assign(videoTrack("first-input"), {
			getSettings: () => ({ width: 640, height: 480 }),
		});
		const secondInput = Object.assign(videoTrack("second-input"), {
			getSettings: () => ({ width: 640, height: 480 }),
		});
		let firstEffects!: ReturnType<typeof useBackgroundEffects>;
		let secondEffects!: ReturnType<typeof useBackgroundEffects>;
		const app = createApp(
			defineComponent({
				setup() {
					firstEffects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					secondEffects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		const firstSession = await firstEffects.applyBackgroundEffects(
			new FakeMediaStream([firstInput]) as never,
			{ backgroundBlurEnabled: true },
		);
		const secondSession = await secondEffects.applyBackgroundEffects(
			new FakeMediaStream([secondInput]) as never,
			{ backgroundBlurEnabled: true },
		);
		await peerReadEntered.promise;
		releaseFatalSend.resolve();
		await vi.waitFor(() => expect(instances).toHaveLength(2));

		releasePeerRead.resolve({ done: false, value: peerFrame });
		await vi.waitFor(() => expect(instances[1].send).toHaveBeenCalledOnce());
		expect(instances[0].send).toHaveBeenCalledOnce();
		expect(secondEffects.isProcessing.value).toBe(true);

		firstSession.cleanup();
		secondSession.cleanup();
		await Promise.all([firstEffects.dispose(), secondEffects.dispose()]);
		app.unmount();
	});

	it("halts fatal recovery when poisoned model invalidation cannot close", async () => {
		const firstFrame = { close: vi.fn() } as unknown as VideoFrame;
		const releaseRead = deferred<{ done: boolean }>();
		const read = vi
			.fn()
			.mockResolvedValueOnce({ done: false, value: firstFrame })
			.mockImplementation(() => releaseRead.promise);
		const closeError = new Error("fault close failed");
		const instances: FakeSelfieSegmentation[] = [];
		class FakeSelfieSegmentation {
			close = vi
				.fn()
				.mockRejectedValueOnce(closeError)
				.mockRejectedValueOnce(closeError)
				.mockResolvedValueOnce(undefined);
			reset = vi.fn(() => {
				throw new Error("reset failed");
			});
			send = vi.fn(async () => {
				const error = new Error("poisoned wasm state");
				error.name = "BindingError";
				throw error;
			});
			constructor() {
				instances.push(this);
			}
			setOptions() {}
			onResults() {}
			initialize = vi.fn().mockResolvedValue(undefined);
		}
		class FakeTrackProcessor {
			readable = {
				getReader: () => ({
					cancel: vi.fn().mockResolvedValue(undefined),
					read,
				}),
			};
		}
		const outputTrack = videoTrack("output");
		const context = { drawImage: vi.fn(), clearRect: vi.fn() };
		vi.stubGlobal("SelfieSegmentation", FakeSelfieSegmentation);
		vi.stubGlobal("MediaStreamTrackProcessor", FakeTrackProcessor);
		vi.stubGlobal("OffscreenCanvas", undefined);
		vi.stubGlobal(
			"createImageBitmap",
			vi.fn().mockResolvedValue({ close: vi.fn() }),
		);
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			context as never,
		);
		Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
			configurable: true,
			value: vi.fn(() => new FakeMediaStream([outputTrack])),
		});
		const inputTrack = Object.assign(videoTrack("input"), {
			getSettings: () => ({ width: 640, height: 480 }),
		});
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		let effects!: ReturnType<typeof useBackgroundEffects>;
		const app = createApp(
			defineComponent({
				setup() {
					effects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));
		const session = await effects.applyBackgroundEffects(
			new FakeMediaStream([inputTrack]) as never,
			{ backgroundBlurEnabled: true },
		);

		await vi.waitFor(() =>
			expect(consoleError).toHaveBeenCalledWith(
				"Failed to recover from frame error:",
				closeError,
			),
		);
		expect(instances).toHaveLength(1);
		expect(instances[0].close).toHaveBeenCalledOnce();
		await expect(effects.loadModel()).rejects.toBe(closeError);
		expect(instances).toHaveLength(1);
		expect(instances[0].close).toHaveBeenCalledTimes(2);

		session.cleanup();
		releaseRead.resolve({ done: true });
		await effects.dispose();
		expect(instances).toHaveLength(1);
		expect(instances[0].close).toHaveBeenCalledTimes(3);
		app.unmount();
	});

	it("releases a shared effects model that initializes during disposal", async () => {
		const initializationEntered = deferred<void>();
		const releaseInitialization = deferred<void>();
		const close = vi.fn().mockResolvedValue(undefined);
		class FakeSelfieSegmentation {
			setOptions() {}
			onResults() {}
			async initialize() {
				initializationEntered.resolve();
				await releaseInitialization.promise;
			}
			close = close;
		}
		vi.stubGlobal("SelfieSegmentation", FakeSelfieSegmentation);
		let effects!: ReturnType<typeof useBackgroundEffects>;
		const app = createApp(
			defineComponent({
				setup() {
					effects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		const loading = effects.loadModel().catch((error: unknown) => error);
		await initializationEntered.promise;
		const disposal = effects.dispose();
		expect(close).not.toHaveBeenCalled();

		releaseInitialization.resolve();
		await expect(loading).resolves.toMatchObject({ name: "AbortError" });
		await disposal;
		expect(close).toHaveBeenCalledOnce();
		app.unmount();
	});

	it("keeps an initializing effects model for an owner arriving during release", async () => {
		const initializationEntered = deferred<void>();
		const releaseInitialization = deferred<void>();
		const secondOwnerMounted = deferred<void>();
		const close = vi.fn().mockResolvedValue(undefined);
		let mountSecondOwner = () => {};
		class FakeSelfieSegmentation {
			setOptions() {}
			onResults() {}
			async initialize() {
				initializationEntered.resolve();
				await releaseInitialization.promise;
				mountSecondOwner();
			}
			close = close;
		}
		vi.stubGlobal("SelfieSegmentation", FakeSelfieSegmentation);
		let firstEffects!: ReturnType<typeof useBackgroundEffects>;
		let secondEffects!: ReturnType<typeof useBackgroundEffects>;
		const firstApp = createApp(
			defineComponent({
				setup() {
					firstEffects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					return () => null;
				},
			}),
		);
		firstApp.mount(document.createElement("div"));

		const firstLoading = firstEffects
			.loadModel()
			.catch((error: unknown) => error);
		await initializationEntered.promise;
		const firstDisposal = firstEffects.dispose();
		const secondApp = createApp(
			defineComponent({
				setup() {
					secondEffects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					return () => null;
				},
			}),
		);
		let secondLoading!: Promise<unknown>;
		mountSecondOwner = () => {
			secondApp.mount(document.createElement("div"));
			secondLoading = secondEffects.loadModel();
			secondOwnerMounted.resolve();
		};

		releaseInitialization.resolve();
		await secondOwnerMounted.promise;
		await expect(firstLoading).resolves.toMatchObject({ name: "AbortError" });
		await Promise.all([firstDisposal, secondLoading]);
		expect(close).not.toHaveBeenCalled();

		await secondEffects.dispose();
		expect(close).toHaveBeenCalledOnce();
		firstApp.unmount();
		secondApp.unmount();
	});

	it("rejects model loading after its effects owner is disposed", async () => {
		const instances: FakeSelfieSegmentation[] = [];
		class FakeSelfieSegmentation {
			constructor() {
				instances.push(this);
			}
			setOptions() {}
			onResults() {}
			initialize = vi.fn().mockResolvedValue(undefined);
			close = vi.fn().mockResolvedValue(undefined);
		}
		vi.stubGlobal("SelfieSegmentation", FakeSelfieSegmentation);
		let effects!: ReturnType<typeof useBackgroundEffects>;
		const app = createApp(
			defineComponent({
				setup() {
					effects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));
		await effects.dispose();

		await expect(effects.loadModel()).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(instances).toHaveLength(0);
		app.unmount();
	});

	it("surfaces model AbortError while its effects owner remains active", async () => {
		const abortError = new DOMException("Model load interrupted", "AbortError");
		const close = vi.fn().mockResolvedValue(undefined);
		class FakeSelfieSegmentation {
			setOptions() {}
			onResults() {}
			initialize = vi.fn().mockRejectedValue(abortError);
			close = close;
		}
		vi.stubGlobal("SelfieSegmentation", FakeSelfieSegmentation);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		let effects!: ReturnType<typeof useBackgroundEffects>;
		const app = createApp(
			defineComponent({
				setup() {
					effects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					return () => null;
				},
			}),
		);
		app.mount(document.createElement("div"));

		await expect(effects.loadModel()).rejects.toBe(abortError);
		expect(close).toHaveBeenCalledOnce();
		expect(consoleError).toHaveBeenCalledWith(
			"Failed to load MediaPipe Selfie Segmentation model:",
			abortError,
		);
		expect(toast.error).toHaveBeenCalledWith(
			"Failed to load the background effects model. Please try again.",
		);
		await effects.dispose();
		app.unmount();
	});

	it("does not return an effects model while that model is closing", async () => {
		const closeEntered = deferred<void>();
		const releaseClose = deferred<void>();
		const instances: FakeSelfieSegmentation[] = [];
		class FakeSelfieSegmentation {
			constructor() {
				instances.push(this);
			}
			setOptions() {}
			onResults() {}
			initialize = vi.fn().mockResolvedValue(undefined);
			close = vi.fn(async () => {
				closeEntered.resolve();
				await releaseClose.promise;
			});
		}
		vi.stubGlobal("SelfieSegmentation", FakeSelfieSegmentation);
		let firstEffects!: ReturnType<typeof useBackgroundEffects>;
		let secondEffects!: ReturnType<typeof useBackgroundEffects>;
		const firstApp = createApp(
			defineComponent({
				setup() {
					firstEffects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					return () => null;
				},
			}),
		);
		firstApp.mount(document.createElement("div"));
		const firstModel = await firstEffects.loadModel();

		const firstDisposal = firstEffects.dispose();
		await closeEntered.promise;
		const secondApp = createApp(
			defineComponent({
				setup() {
					secondEffects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					return () => null;
				},
			}),
		);
		secondApp.mount(document.createElement("div"));
		const secondLoading = secondEffects.loadModel();

		releaseClose.resolve();
		const [, secondModel] = await Promise.all([firstDisposal, secondLoading]);
		expect(secondModel).not.toBe(firstModel);
		expect(instances).toHaveLength(2);

		await secondEffects.dispose();
		expect(instances[1].close).toHaveBeenCalledOnce();
		firstApp.unmount();
		secondApp.unmount();
	});

	it("retries closing the shared model after close rejects", async () => {
		const closeError = new Error("close failed");
		const close = vi
			.fn()
			.mockRejectedValueOnce(closeError)
			.mockResolvedValueOnce(undefined);
		const instances: FakeSelfieSegmentation[] = [];
		class FakeSelfieSegmentation {
			constructor() {
				instances.push(this);
			}
			setOptions() {}
			onResults() {}
			initialize = vi.fn().mockResolvedValue(undefined);
			close = close;
		}
		vi.stubGlobal("SelfieSegmentation", FakeSelfieSegmentation);
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		let firstEffects!: ReturnType<typeof useBackgroundEffects>;
		let secondEffects!: ReturnType<typeof useBackgroundEffects>;
		const firstApp = createApp(
			defineComponent({
				setup() {
					firstEffects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					return () => null;
				},
			}),
		);
		firstApp.mount(document.createElement("div"));
		const firstModel = await firstEffects.loadModel();
		await firstEffects.dispose();

		const secondApp = createApp(
			defineComponent({
				setup() {
					secondEffects = useBackgroundEffects({ autoCleanupOnUnmount: false });
					return () => null;
				},
			}),
		);
		secondApp.mount(document.createElement("div"));
		const secondModel = await secondEffects.loadModel();
		expect(secondModel).toBe(firstModel);
		expect(instances).toHaveLength(1);

		await secondEffects.dispose();
		expect(close).toHaveBeenCalledTimes(2);
		expect(consoleWarn).toHaveBeenCalledOnce();
		expect(consoleWarn).toHaveBeenCalledWith(
			"Failed to close MediaPipe instance:",
			closeError,
		);
		firstApp.unmount();
		secondApp.unmount();
	});

	it("default unmount keeps the shared model until the last owner disposes", async () => {
		const close = vi.fn().mockResolvedValue(undefined);
		class FakeSelfieSegmentation {
			setOptions() {}
			onResults() {}
			initialize = vi.fn().mockResolvedValue(undefined);
			close = close;
		}
		vi.stubGlobal("SelfieSegmentation", FakeSelfieSegmentation);
		let firstEffects!: ReturnType<typeof useBackgroundEffects>;
		let secondEffects!: ReturnType<typeof useBackgroundEffects>;
		const firstApp = createApp(
			defineComponent({
				setup() {
					firstEffects = useBackgroundEffects();
					return () => null;
				},
			}),
		);
		const secondApp = createApp(
			defineComponent({
				setup() {
					secondEffects = useBackgroundEffects();
					return () => null;
				},
			}),
		);
		firstApp.mount(document.createElement("div"));
		secondApp.mount(document.createElement("div"));
		await firstEffects.loadModel();

		firstApp.unmount();
		await firstEffects.dispose();
		expect(close).not.toHaveBeenCalled();

		secondApp.unmount();
		await secondEffects.dispose();
		expect(close).toHaveBeenCalledOnce();
	});
});
