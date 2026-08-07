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

class FakeMediaStream {
	id = crypto.randomUUID();
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
	({
		id,
		kind: "audio",
		enabled: true,
		readyState: "live",
		stop: vi.fn(),
	} as unknown as MediaStreamTrack);

describe("useMediaControls", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("MediaStream", FakeMediaStream);
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
