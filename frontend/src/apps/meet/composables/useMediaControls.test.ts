import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

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

import { useMediaControls } from "./useMediaControls";
import {
	setSelectedCameraId,
	setSelectedMicId,
} from "../data/mediaPreferences";

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

const audioTrack = (id: string) =>
	Object.assign(Object.create(null), {
		id,
		kind: "audio",
		enabled: true,
		readyState: "live",
		stop: vi.fn(),
	}) as MediaStreamTrack;

describe("useMediaControls", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("MediaStream", FakeMediaStream);
	});

	it("falls back to the default microphone when Firefox cannot find the selected device", async () => {
		const fallbackStream = new FakeMediaStream([audioTrack("fallback")]);
		const requestedConstraints: MediaStreamConstraints[] = [];
		const getUserMedia = vi.fn((constraints: MediaStreamConstraints) => {
			requestedConstraints.push(structuredClone(constraints));
			if (requestedConstraints.length === 1) {
				return Promise.reject(
					new DOMException("The object can not be found here.", "NotFoundError"),
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
				return Promise.reject(new DOMException("Missing device", "NotFoundError"));
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
				mediaHandler: {
					audioProducer,
					videoProducer: null,
					screenProducer: null,
					localStream: null,
					setProducers: vi.fn(),
					stopScreenShare: vi.fn(),
					cleanup: vi.fn(),
				},
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
});
