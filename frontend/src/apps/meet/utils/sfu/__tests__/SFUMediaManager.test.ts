import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SFUMediaManager } from "../SFUMediaManager";

type MockTransportManager = {
	closeSendTransport: ReturnType<typeof vi.fn>;
	discardProducer: ReturnType<typeof vi.fn>;
	createProducer: ReturnType<typeof vi.fn>;
	createSendTransport: ReturnType<typeof vi.fn>;
	createConsumer: ReturnType<typeof vi.fn>;
};
type MockParticipantManager = {
	hasParticipant: ReturnType<typeof vi.fn>;
	getParticipant: ReturnType<typeof vi.fn>;
	updateParticipant: ReturnType<typeof vi.fn>;
};

class FakeMediaStream {
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

	addTrack(track: MediaStreamTrack) {
		this.tracks.push(track);
	}

	removeTrack(track: MediaStreamTrack) {
		this.tracks = this.tracks.filter((candidate) => candidate !== track);
	}
}

const mediaTrack = (
	id: string,
	kind: "audio" | "video",
	readyState: MediaStreamTrackState = "live",
) =>
	({ id, kind, readyState, stop: vi.fn() }) as unknown as MediaStreamTrack;

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

function createManager(
	opts: {
		currentUserId?: string | null;
		hasParticipant?: boolean;
		isScreenPublicationCurrent?: (track: MediaStreamTrack) => boolean;
	} = {},
): {
	mediaManager: SFUMediaManager;
	transportManager: MockTransportManager;
	videoManager: { attachStream: ReturnType<typeof vi.fn> };
	consumerManager: {
		addConsumer: ReturnType<typeof vi.fn>;
		getConsumersByParticipant: ReturnType<typeof vi.fn>;
		removeConsumer: ReturnType<typeof vi.fn>;
	};
	participantManager: MockParticipantManager;
} {
	const transportManager: MockTransportManager = {
		closeSendTransport: vi.fn(),
		discardProducer: vi.fn(async (producer: { close: () => void }) => {
			producer.close();
		}),
		createProducer: vi.fn().mockResolvedValue({}),
		createSendTransport: vi.fn(),
		createConsumer: vi.fn().mockResolvedValue({
			id: "new-c1",
			producerId: "producer-1",
			kind: "video",
			track: { kind: "video" },
			appData: { type: "camera" },
			close: vi.fn(),
		}),
	};

	const videoManager = {
		attachStream: vi.fn(),
	};

	const consumerManager = {
		getConsumersByParticipant: vi.fn(() => []),
		removeConsumer: vi.fn(),
		addConsumer: vi.fn((c) => ({
			id: c.id,
			producerId: c.producerId,
			kind: c.kind,
			track: c.track,
		})),
	};

	const participantManager: MockParticipantManager = {
		hasParticipant: vi.fn().mockReturnValue(opts.hasParticipant ?? true),
		getParticipant: vi.fn().mockReturnValue({ video_enabled: true }),
		updateParticipant: vi.fn(),
	};

	const getCurrentUserId = vi.fn().mockReturnValue(opts.currentUserId ?? "me");

	const mediaManager = new SFUMediaManager(
		{
			transportManager: transportManager as never,
			videoManager: videoManager as never,
			consumerManager: consumerManager as never,
			participantManager: participantManager as never,
			isScreenPublicationCurrent: opts.isScreenPublicationCurrent,
		},
		getCurrentUserId,
	);

	return {
		mediaManager,
		transportManager,
		videoManager,
		consumerManager,
		participantManager,
	};
}

describe("SFUMediaManager.subscribeToRemoteProducer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("shares one subscription across concurrent callers", async () => {
		const { mediaManager, transportManager } = createManager();
		const request = {
			producerId: "producer-1",
			participantId: "remote-1",
			isScreen: false,
		};

		await Promise.all([
			mediaManager.subscribeToRemoteProducer(request),
			mediaManager.subscribeToRemoteProducer(request),
		]);

		expect(transportManager.createConsumer).toHaveBeenCalledTimes(1);
	});

	it("retries an initial subscription until it succeeds", async () => {
		const { mediaManager, transportManager } = createManager();
		transportManager.createConsumer
			.mockRejectedValueOnce(new Error("not ready"))
			.mockResolvedValueOnce({
				id: "new-c1",
				producerId: "producer-1",
				kind: "video",
				track: { kind: "video" },
				appData: { type: "camera" },
				close: vi.fn(),
			});

		const subscription = mediaManager.subscribeToRemoteProducer({
			producerId: "producer-1",
			participantId: "remote-1",
			isScreen: false,
		});
		await vi.advanceTimersByTimeAsync(250);

		await expect(subscription).resolves.toMatchObject({ id: "new-c1" });
		expect(transportManager.createConsumer).toHaveBeenCalledTimes(2);
	});

	it("exhausts one automatic retry chain", async () => {
		const { mediaManager, transportManager } = createManager();
		const onRecoveryExhausted = vi.fn();
		mediaManager.setEventHandlers({ onRecoveryExhausted });
		transportManager.createConsumer.mockRejectedValue(new Error("server down"));

		const subscription = mediaManager.subscribeToRemoteProducer({
			producerId: "producer-1",
			participantId: "remote-1",
			isScreen: false,
		});
		void subscription.catch(() => {});
		await vi.advanceTimersByTimeAsync(1000);

		await expect(subscription).rejects.toThrow("server down");
		expect(transportManager.createConsumer).toHaveBeenCalledTimes(3);
		expect(onRecoveryExhausted).toHaveBeenCalledOnce();
	});

	it("discards an in-flight subscription when its producer closes", async () => {
		const { mediaManager, transportManager, consumerManager } = createManager();
		const request = deferred<{
			id: string;
			producerId: string;
			kind: string;
			track: { kind: string };
			appData: { type: string };
			close: ReturnType<typeof vi.fn>;
		}>();
		transportManager.createConsumer.mockReturnValue(request.promise);
		const subscription = mediaManager.subscribeToRemoteProducer({
			producerId: "producer-1",
			participantId: "remote-1",
			isScreen: false,
		});
		const rejected = expect(subscription).rejects.toMatchObject({
			name: "AbortError",
		});

		mediaManager.cancelProducerSubscription("remote-1", "producer-1");
		request.resolve({
			id: "stale-c1",
			producerId: "producer-1",
			kind: "video",
			track: { kind: "video" },
			appData: { type: "camera" },
			close: vi.fn(),
		});

		await rejected;
		expect(consumerManager.removeConsumer).toHaveBeenCalledWith("stale-c1");
	});

	it("discards a subscription that finishes after receive teardown", async () => {
		const { mediaManager, transportManager, consumerManager } = createManager();
		let resolveConsumer: (consumer: {
			id: string;
			producerId: string;
			kind: string;
			close: ReturnType<typeof vi.fn>;
		}) => void = () => {};
		transportManager.createConsumer.mockReturnValue(
			new Promise((resolve) => {
				resolveConsumer = resolve;
			}),
		);
		const consumer = {
			id: "stale-c1",
			producerId: "producer-1",
			kind: "video",
			close: vi.fn(),
		};

		const subscription = mediaManager.subscribeToRemoteProducer({
			producerId: "producer-1",
			participantId: "remote-1",
			isScreen: false,
		});
		const cancellation = mediaManager.cancelPendingSubscriptions();
		resolveConsumer(consumer);

		await expect(subscription).rejects.toThrow("cancelled");
		await cancellation;
		expect(consumer.close).toHaveBeenCalledTimes(1);
		expect(consumerManager.addConsumer).not.toHaveBeenCalled();
	});

	it("does not hold terminal cleanup for a pending consumer", async () => {
		const { mediaManager, transportManager, consumerManager } = createManager();
		const consumerRequest = deferred<{
			id: string;
			producerId: string;
			kind: string;
			close: ReturnType<typeof vi.fn>;
		}>();
		transportManager.createConsumer.mockReturnValue(consumerRequest.promise);
		const consumer = {
			id: "late-consumer",
			producerId: "producer-1",
			kind: "video",
			close: vi.fn(),
		};
		const handlerCleanup = vi.spyOn(mediaManager.mediaHandler, "cleanup");
		const subscription = mediaManager.subscribeToRemoteProducer({
			producerId: "producer-1",
			participantId: "remote-1",
			isScreen: false,
		});
		const observedSubscription = subscription.catch((error: unknown) => error);
		await vi.waitFor(() =>
			expect(transportManager.createConsumer).toHaveBeenCalledOnce(),
		);

		await mediaManager.cleanup();

		expect(handlerCleanup).toHaveBeenCalledOnce();
		expect(consumerManager.addConsumer).not.toHaveBeenCalled();
		consumerRequest.resolve(consumer);
		await expect(observedSubscription).resolves.toMatchObject({
			message: "Consumer subscription was cancelled",
		});
		expect(consumer.close).toHaveBeenCalledOnce();
		expect(consumerManager.addConsumer).not.toHaveBeenCalled();
	});
});

describe("SFUMediaManager.attachAudioConsumer", () => {
	it("propagates audio attachment failures", async () => {
		const { mediaManager, videoManager } = createManager();
		vi.stubGlobal("MediaStream", class {
			constructor(_tracks: unknown[]) {}
		});
		videoManager.attachStream.mockRejectedValue(new Error("audio blocked"));

		await expect(mediaManager.attachAudioConsumer("remote-1", {
			track: { kind: "audio" },
		} as never)).rejects.toThrow("audio blocked");
		vi.unstubAllGlobals();
	});
});

describe("SFUMediaManager endpoint media handoff", () => {
	it("reattaches the surviving consumer even when the closed consumer is already gone", async () => {
		const { mediaManager, consumerManager } = createManager();
		vi.stubGlobal("MediaStream", FakeMediaStream);
		const closed = {
			producerId: "producer-1",
			kind: "video",
			track: mediaTrack("track-1", "video"),
		} as never;
		const survivor = {
			producerId: "producer-2",
			kind: "video",
			isScreen: false,
			track: mediaTrack("track-2", "video"),
			consumer: { closed: false },
		} as never;
		await mediaManager.attachVideoConsumer("remote-1", closed);
		const attach = vi.spyOn(mediaManager, "attachVideoConsumer");
		consumerManager.getConsumersByParticipant.mockReturnValue([survivor]);

		await mediaManager.reattachAfterProducerClosed("remote-1", "producer-1");

		expect(attach).toHaveBeenCalledWith("remote-1", survivor);
		vi.unstubAllGlobals();
	});

	it("does not replace media when a non-attached endpoint closes", async () => {
		const { mediaManager, consumerManager } = createManager();
		vi.stubGlobal("MediaStream", FakeMediaStream);
		await mediaManager.attachVideoConsumer("remote-1", {
			producerId: "producer-1",
			kind: "video",
			track: mediaTrack("track-1", "video"),
		} as never);
		const attach = vi.spyOn(mediaManager, "attachVideoConsumer");
		consumerManager.getConsumersByParticipant.mockReturnValue([]);

		await mediaManager.reattachAfterProducerClosed("remote-1", "producer-2");

		expect(attach).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it("lets a newer endpoint attachment win over an in-flight handoff", async () => {
		const { mediaManager, consumerManager, videoManager } = createManager();
		vi.stubGlobal("MediaStream", FakeMediaStream);
		const firstAttachment = deferred<void>();
		const closed = {
			producerId: "producer-1",
			kind: "video",
			track: mediaTrack("track-1", "video"),
		} as never;
		const survivor = {
			producerId: "producer-2",
			kind: "video",
			isScreen: false,
			track: mediaTrack("track-2", "video"),
			consumer: { closed: false },
		} as never;
		const newest = {
			producerId: "producer-3",
			kind: "video",
			track: mediaTrack("track-3", "video"),
		} as never;
		await mediaManager.attachVideoConsumer("remote-1", closed);
		videoManager.attachStream.mockClear();
		consumerManager.getConsumersByParticipant.mockReturnValue([survivor]);
		videoManager.attachStream
			.mockImplementationOnce(() => firstAttachment.promise)
			.mockResolvedValueOnce(undefined);

		const handoff = mediaManager.reattachAfterProducerClosed(
			"remote-1",
			"producer-1",
		);
		await vi.waitFor(() => expect(videoManager.attachStream).toHaveBeenCalledOnce());
		const newerAttachment = mediaManager.attachVideoConsumer("remote-1", newest);
		firstAttachment.resolve();
		await Promise.all([handoff, newerAttachment]);

		expect(videoManager.attachStream).toHaveBeenCalledTimes(2);
		expect(
			(videoManager.attachStream.mock.calls[1][1] as FakeMediaStream)
				.getVideoTracks()[0]?.id,
		).toBe("track-3");
		vi.unstubAllGlobals();
	});

	it("retries handoff when a newer endpoint attachment fails", async () => {
		const { mediaManager, consumerManager, videoManager } = createManager();
		vi.stubGlobal("MediaStream", FakeMediaStream);
		const closed = {
			producerId: "producer-1",
			kind: "video",
			track: mediaTrack("track-1", "video"),
		} as never;
		const survivor = {
			producerId: "producer-2",
			kind: "video",
			isScreen: false,
			track: mediaTrack("track-2", "video"),
			consumer: { closed: false },
		} as never;
		const failed = {
			producerId: "producer-3",
			kind: "video",
			track: mediaTrack("track-3", "video"),
		} as never;
		await mediaManager.attachVideoConsumer("remote-1", closed);
		videoManager.attachStream.mockClear();
		consumerManager.getConsumersByParticipant.mockReturnValue([survivor]);
		videoManager.attachStream
			.mockRejectedValueOnce(new Error("attachment failed"))
			.mockResolvedValueOnce(undefined);

		const failedAttachment = mediaManager.attachVideoConsumer("remote-1", failed);
		await mediaManager.reattachAfterProducerClosed("remote-1", "producer-1");
		await expect(failedAttachment).rejects.toThrow("attachment failed");
		await vi.waitFor(() => expect(videoManager.attachStream).toHaveBeenCalledTimes(2));

		expect(
			(videoManager.attachStream.mock.calls[1][1] as FakeMediaStream)
				.getVideoTracks()[0]?.id,
		).toBe("track-2");
		vi.unstubAllGlobals();
	});
});

describe("SFUMediaManager.rebuildSendSide", () => {
	it("recreates the send transport and republishes live local tracks", async () => {
		const { mediaManager, transportManager } = createManager();
		const videoTrack = { kind: "video", readyState: "live" };
		const audioTrack = { kind: "audio", readyState: "live" };
		mediaManager.mediaHandler.localStream = new FakeMediaStream([
			videoTrack as never,
			audioTrack as never,
		]) as never;
		mediaManager.mediaHandler.setProducers({
			audioProducer: { close: vi.fn() } as never,
			videoProducer: { close: vi.fn() } as never,
		});

		await mediaManager.rebuildSendSide();

		expect(transportManager.closeSendTransport).toHaveBeenCalledTimes(1);
		expect(transportManager.createSendTransport).toHaveBeenCalledTimes(1);
		expect(transportManager.createProducer).toHaveBeenCalledWith(videoTrack, {
			type: "camera",
		});
		expect(transportManager.createProducer).toHaveBeenCalledWith(audioTrack, {
			type: "microphone",
		});
	});

	it("does not create a send transport without live local tracks", async () => {
		const { mediaManager, transportManager } = createManager();
		mediaManager.mediaHandler.localStream = {
			getAudioTracks: () => [],
			getVideoTracks: () => [{ kind: "video", readyState: "ended" }],
		} as never;

		await expect(mediaManager.rebuildSendSide()).resolves.toEqual({});

		expect(transportManager.closeSendTransport).toHaveBeenCalledTimes(1);
		expect(transportManager.createSendTransport).not.toHaveBeenCalled();
		expect(transportManager.createProducer).not.toHaveBeenCalled();
	});

	it("republishes a live screen share after rebuilding the send transport", async () => {
		const { mediaManager, transportManager } = createManager();
		const screenTrack = { kind: "video", readyState: "live" };
		mediaManager.mediaHandler.setProducers({
			screenProducer: { track: screenTrack } as never,
		});

		await mediaManager.rebuildSendSide();

		expect(transportManager.createSendTransport).toHaveBeenCalledTimes(1);
		expect(transportManager.createProducer).toHaveBeenCalledWith(screenTrack, {
			type: "screen",
		});
	});

	it("discards a delayed screen recovery after sharing stops", async () => {
		let currentScreen: MediaStreamTrack | null = null;
		const screenTrack = mediaTrack("screen", "video");
		currentScreen = screenTrack;
		const { mediaManager, transportManager } = createManager({
			isScreenPublicationCurrent: (track) => track === currentScreen,
		});
		const creation = deferred<{
			id: string;
			track: MediaStreamTrack;
			close: ReturnType<typeof vi.fn>;
		}>();
		const staleProducer = {
			id: "stale-screen",
			track: screenTrack,
			close: vi.fn(),
		};
		mediaManager.mediaHandler.setProducers({
			screenProducer: { track: screenTrack } as never,
		});
		transportManager.createProducer.mockReturnValue(creation.promise);

		const recovery = mediaManager.rebuildSendSide();
		await vi.waitFor(() => expect(transportManager.createProducer).toHaveBeenCalledOnce());
		currentScreen = null;
		creation.resolve(staleProducer);

		await expect(recovery).resolves.toEqual({});
		expect(transportManager.discardProducer).toHaveBeenCalledWith(staleProducer);
		expect(mediaManager.mediaHandler.screenProducer).toBeNull();
	});

	it("discards a delayed screen recovery when its track ends", async () => {
		const { mediaManager, transportManager } = createManager();
		const screenTrack = mediaTrack("screen", "video");
		const creation = deferred<{
			id: string;
			track: MediaStreamTrack;
			close: ReturnType<typeof vi.fn>;
		}>();
		const staleProducer = {
			id: "ended-screen",
			track: screenTrack,
			close: vi.fn(),
		};
		mediaManager.mediaHandler.setProducers({
			screenProducer: { track: screenTrack } as never,
		});
		transportManager.createProducer.mockReturnValue(creation.promise);

		const recovery = mediaManager.rebuildSendSide();
		await vi.waitFor(() => expect(transportManager.createProducer).toHaveBeenCalledOnce());
		Reflect.set(screenTrack, "readyState", "ended");
		creation.resolve(staleProducer);

		await expect(recovery).resolves.toEqual({});
		expect(transportManager.discardProducer).toHaveBeenCalledWith(staleProducer);
		expect(mediaManager.mediaHandler.screenProducer).toBeNull();
	});

	it("waits for camera reconciliation before rebuilding the send side", async () => {
		vi.stubGlobal("MediaStream", FakeMediaStream);
		const { mediaManager, transportManager } = createManager();
		const oldVideo = mediaTrack("old-video", "video");
		const nextVideo = mediaTrack("next-video", "video");
		const oldProducer = { id: "old-producer", track: oldVideo };
		const replacementStarted = deferred<void>();
		const releaseReplacement = deferred<void>();
		mediaManager.mediaHandler.localStream = new FakeMediaStream([
			oldVideo,
		]) as never;
		mediaManager.mediaHandler.setProducers({ videoProducer: oldProducer as never });
		const rebuiltProducer = { id: "rebuilt-producer", track: nextVideo };
		transportManager.createProducer.mockResolvedValue(rebuiltProducer);

		const cameraMutation = mediaManager.serializeSendMediaMutation(async () => {
			replacementStarted.resolve();
			await releaseReplacement.promise;
			oldProducer.track = nextVideo;
			mediaManager.setLocalTrack("video", nextVideo);
		});
		await replacementStarted.promise;
		const rebuild = mediaManager.rebuildSendSide();

		expect(transportManager.closeSendTransport).not.toHaveBeenCalled();
		releaseReplacement.resolve();
		await Promise.all([cameraMutation, rebuild]);

		expect(transportManager.createProducer).toHaveBeenCalledOnce();
		expect(transportManager.createProducer).toHaveBeenCalledWith(nextVideo, {
			type: "camera",
		});
		expect(mediaManager.mediaHandler.videoProducer).toBe(rebuiltProducer);
		expect(mediaManager.mediaHandler.videoProducer).not.toBe(oldProducer);
		expect(mediaManager.mediaHandler.localStream?.getVideoTracks()).toEqual([
			nextVideo,
		]);
		vi.unstubAllGlobals();
	});
});

describe("SFUMediaManager local recovery tracks", () => {
	beforeEach(() => {
		vi.stubGlobal("MediaStream", FakeMediaStream);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("replaces video while preserving audio without stopping displaced tracks", () => {
		const { mediaManager } = createManager();
		const audio = mediaTrack("audio", "audio");
		const oldVideo = mediaTrack("old-video", "video");
		const nextVideo = mediaTrack("next-video", "video");
		mediaManager.mediaHandler.localStream = new FakeMediaStream([
			audio,
			oldVideo,
		]) as never;

		mediaManager.setLocalTrack("video", nextVideo);

		expect(mediaManager.mediaHandler.localStream?.getAudioTracks()).toEqual([
			audio,
		]);
		expect(mediaManager.mediaHandler.localStream?.getVideoTracks()).toEqual([
			nextVideo,
		]);
		expect(oldVideo.stop).not.toHaveBeenCalled();
	});

	it("clears every video track while preserving audio", () => {
		const { mediaManager } = createManager();
		const audio = mediaTrack("audio", "audio");
		const firstVideo = mediaTrack("first-video", "video");
		const secondVideo = mediaTrack("second-video", "video");
		mediaManager.mediaHandler.localStream = new FakeMediaStream([
			audio,
			firstVideo,
			secondVideo,
		]) as never;

		mediaManager.setLocalTrack("video", null);

		expect(mediaManager.mediaHandler.localStream).not.toBeNull();
		expect(mediaManager.mediaHandler.localStream?.getAudioTracks()).toEqual([
			audio,
		]);
		expect(mediaManager.mediaHandler.localStream?.getVideoTracks()).toEqual([]);
		expect(firstVideo.stop).not.toHaveBeenCalled();
		expect(secondVideo.stop).not.toHaveBeenCalled();
	});

	it("rebuilds with the newly synchronized video track", async () => {
		const { mediaManager, transportManager } = createManager();
		const oldVideo = mediaTrack("old-video", "video");
		const nextVideo = mediaTrack("next-video", "video");
		mediaManager.mediaHandler.localStream = new FakeMediaStream([
			oldVideo,
		]) as never;
		mediaManager.setLocalTrack("video", nextVideo);

		await mediaManager.rebuildSendSide();

		expect(transportManager.createProducer).toHaveBeenCalledWith(nextVideo, {
			type: "camera",
		});
		expect(transportManager.createProducer).not.toHaveBeenCalledWith(
			oldVideo,
			expect.anything(),
		);
	});

	it("synchronizes only live requested initial tracks before producer creation", async () => {
		const { mediaManager, transportManager } = createManager();
		const video = mediaTrack("video", "video");
		const audio = mediaTrack("audio", "audio");
		const input = new FakeMediaStream([video, audio]);
		const synchronize = vi.spyOn(mediaManager, "setLocalTrack");
		transportManager.createProducer.mockRejectedValueOnce(
			new Error("producer failed"),
		);

		const result = await mediaManager.publishMedia(input as never, {
			publishVideo: true,
			publishAudio: false,
		});

		expect(mediaManager.mediaHandler.localStream?.getVideoTracks()).toEqual([
			video,
		]);
		expect(mediaManager.mediaHandler.localStream?.getAudioTracks()).toEqual([]);
		expect(synchronize).toHaveBeenCalledWith("video", video);
		expect(synchronize).not.toHaveBeenCalledWith("audio", expect.anything());
		expect(synchronize.mock.invocationCallOrder[0]).toBeLessThan(
			transportManager.createProducer.mock.invocationCallOrder[0],
		);
		expect(result.videoError).toEqual(new Error("producer failed"));
		expect(result.audioError).toBeUndefined();

		transportManager.createProducer.mockResolvedValueOnce({});
		await mediaManager.rebuildSendSide();

		expect(transportManager.createProducer).toHaveBeenCalledTimes(2);
		expect(transportManager.createProducer).toHaveBeenLastCalledWith(video, {
			type: "camera",
		});
		expect(mediaManager.mediaHandler.localStream?.getAudioTracks()).toEqual([]);
	});

	it("reports audio and video producer outcomes independently", async () => {
		const { mediaManager, transportManager } = createManager();
		const video = mediaTrack("video", "video");
		const audio = mediaTrack("audio", "audio");
		const videoProducer = { id: "video-producer", track: video };
		transportManager.createProducer
			.mockResolvedValueOnce(videoProducer)
			.mockRejectedValueOnce(new Error("audio failed"));

		const result = await mediaManager.publishMedia(
			new FakeMediaStream([video, audio]) as never,
			{ publishVideo: true, publishAudio: true },
		);

		expect(result.videoProducer).toBe(videoProducer);
		expect(result.videoError).toBeUndefined();
		expect(result.audioProducer).toBeUndefined();
		expect(result.audioError).toEqual(new Error("audio failed"));
	});

	it("serializes controls behind all initial publication retries", async () => {
		vi.useFakeTimers();
		const { mediaManager, transportManager } = createManager();
		const video = mediaTrack("video", "video");
		const videoProducer = { id: "video-producer", track: video };
		transportManager.createProducer
			.mockRejectedValueOnce(new Error("temporary failure"))
			.mockResolvedValueOnce(videoProducer);
		const ordering: string[] = [];

		const publication = mediaManager.publishInitialMedia(
			new FakeMediaStream([video]) as never,
			{ publishVideo: true, publishAudio: false },
			undefined,
			() => {
				ordering.push("reconciled");
			},
		);
		await vi.waitFor(() =>
			expect(transportManager.createProducer).toHaveBeenCalledOnce(),
		);
		let controlRan = false;
		const control = mediaManager.serializeSendMediaMutation(async () => {
			controlRan = true;
			ordering.push("control");
		});

		expect(controlRan).toBe(false);
		await vi.runAllTimersAsync();
		await Promise.all([publication, control]);

		expect(transportManager.createProducer).toHaveBeenCalledTimes(2);
		expect(controlRan).toBe(true);
		expect(ordering).toEqual(["reconciled", "control"]);
		vi.useRealTimers();
	});

	it("finishes initial publication before a later send-media mutation", async () => {
		const { mediaManager, transportManager } = createManager();
		const initialTrack = mediaTrack("initial-video", "video");
		const finalTrack = mediaTrack("final-video", "video");
		const initialProducer = { id: "initial-producer", track: initialTrack };
		const finalProducer = { id: "final-producer", track: finalTrack };
		const producerCreation = deferred<typeof initialProducer>();
		const producerCreationEntered = deferred<void>();
		transportManager.createProducer.mockImplementation(() => {
			producerCreationEntered.resolve();
			return producerCreation.promise;
		});

		const publication = mediaManager.publishMedia(
			new FakeMediaStream([initialTrack]) as never,
			{ publishVideo: true, publishAudio: false },
		);
		await producerCreationEntered.promise;
		let mutationRan = false;
		const mutation = mediaManager.serializeSendMediaMutation(async () => {
			mutationRan = true;
			mediaManager.mediaHandler.setProducers({
				videoProducer: finalProducer as never,
			});
			mediaManager.setLocalTrack("video", finalTrack);
		});

		expect(mutationRan).toBe(false);
		producerCreation.resolve(initialProducer);
		await Promise.all([publication, mutation]);

		expect(mediaManager.mediaHandler.videoProducer).toBe(finalProducer);
		expect(mediaManager.mediaHandler.videoProducer).not.toBe(initialProducer);
		expect(mediaManager.mediaHandler.localStream?.getVideoTracks()).toEqual([
			finalTrack,
		]);
	});

	it("does not duplicate producers or overwrite their recovery tracks", async () => {
		const { mediaManager, transportManager } = createManager();
		const currentVideo = mediaTrack("current-video", "video");
		const currentAudio = mediaTrack("current-audio", "audio");
		const replacementVideo = mediaTrack("replacement-video", "video");
		const replacementAudio = mediaTrack("replacement-audio", "audio");
		const videoProducer = { id: "video-producer", track: currentVideo };
		const audioProducer = { id: "audio-producer", track: currentAudio };
		mediaManager.mediaHandler.setProducers({
			videoProducer: videoProducer as never,
			audioProducer: audioProducer as never,
		});
		mediaManager.mediaHandler.localStream = new FakeMediaStream([
			currentVideo,
			currentAudio,
		]) as never;

		await mediaManager.publishMedia(
			new FakeMediaStream([replacementVideo, replacementAudio]) as never,
			{ publishVideo: true, publishAudio: true },
		);

		expect(transportManager.createSendTransport).not.toHaveBeenCalled();
		expect(transportManager.createProducer).not.toHaveBeenCalled();
		expect(mediaManager.mediaHandler.videoProducer).toBe(videoProducer);
		expect(mediaManager.mediaHandler.audioProducer).toBe(audioProducer);
		expect(mediaManager.mediaHandler.localStream?.getVideoTracks()).toEqual([
			currentVideo,
		]);
		expect(mediaManager.mediaHandler.localStream?.getAudioTracks()).toEqual([
			currentAudio,
		]);
	});

	it("closes a producer whose track ends during creation", async () => {
		const { mediaManager, transportManager } = createManager();
		const previous = mediaTrack("previous-video", "video");
		const candidate = mediaTrack("candidate-video", "video");
		const creationEntered = deferred<void>();
		const releaseCreation = deferred<{
			id: string;
			track: MediaStreamTrack;
			close: ReturnType<typeof vi.fn>;
		}>();
		const unusableProducer = {
			id: "unusable-producer",
			track: candidate,
			close: vi.fn(),
		};
		mediaManager.mediaHandler.localStream = new FakeMediaStream([
			previous,
		]) as never;
		transportManager.createProducer.mockImplementation(() => {
			creationEntered.resolve();
			return releaseCreation.promise;
		});

		const publication = mediaManager.publishMedia(
			new FakeMediaStream([candidate]) as never,
			{ publishVideo: true, publishAudio: false },
		);
		await creationEntered.promise;
		Reflect.set(candidate, "readyState", "ended");
		releaseCreation.resolve(unusableProducer);

		await expect(publication).resolves.toEqual({});
		expect(unusableProducer.close).toHaveBeenCalledOnce();
		expect(transportManager.discardProducer).toHaveBeenCalledWith(unusableProducer);
		expect(mediaManager.mediaHandler.videoProducer).toBeNull();
		expect(mediaManager.mediaHandler.localStream?.getVideoTracks()).toEqual([
			previous,
		]);
	});

	it("does not erase newer media for false options or missing live tracks", async () => {
		const { mediaManager, transportManager } = createManager();
		const newerVideo = mediaTrack("newer-video", "video");
		const producer = { id: "newer-producer", track: newerVideo };
		const installation = mediaManager.serializeSendMediaMutation(async () => {
			mediaManager.mediaHandler.setProducers({ videoProducer: producer as never });
			mediaManager.setLocalTrack("video", newerVideo);
		});
		const staleFalsePublication = mediaManager.publishMedia(
			new FakeMediaStream([]) as never,
			{ publishVideo: false, publishAudio: false },
		);

		await Promise.all([installation, staleFalsePublication]);
		expect(mediaManager.mediaHandler.videoProducer).toBe(producer);
		expect(mediaManager.mediaHandler.localStream?.getVideoTracks()).toEqual([
			newerVideo,
		]);

		await mediaManager.publishMedia(
			new FakeMediaStream([mediaTrack("ended", "video", "ended")]) as never,
			{ publishVideo: true, publishAudio: false },
		);
		expect(mediaManager.mediaHandler.videoProducer).toBe(producer);
		expect(mediaManager.mediaHandler.localStream?.getVideoTracks()).toEqual([
			newerVideo,
		]);
		expect(transportManager.createProducer).not.toHaveBeenCalled();

		mediaManager.setLocalTrack("video", null);
		expect(mediaManager.mediaHandler.localStream?.getVideoTracks()).toEqual([]);
	});
});

describe("SFUMediaManager cleanup", () => {
	beforeEach(() => {
		vi.stubGlobal("MediaStream", FakeMediaStream);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("invalidates queued send work and performs terminal cleanup once", async () => {
		const { mediaManager } = createManager();
		const ordering: string[] = [];
		const releaseActive = deferred<void>();
		const activeStarted = deferred<void>();
		const releaseReceiveCancellation = deferred<void>();
		let receiveCancellationSettled = false;
		void releaseReceiveCancellation.promise.then(() => {
			receiveCancellationSettled = true;
		});
		const activeProducer = { id: "active-producer", close: vi.fn() };
		const queuedOperation = vi.fn().mockResolvedValue(undefined);
		const cancelPendingSubscriptions = vi
			.spyOn(mediaManager, "cancelPendingSubscriptions")
			.mockReturnValue(releaseReceiveCancellation.promise);
		const originalHandlerCleanup =
			mediaManager.mediaHandler.cleanup.bind(mediaManager.mediaHandler);
		const handlerCleanup = vi
			.spyOn(mediaManager.mediaHandler, "cleanup")
			.mockImplementation(() => {
				ordering.push("cleanup");
				originalHandlerCleanup();
			});
		const queuedRejectionObserved = deferred<void>();
		mediaManager.processedConsumers.add("consumer-1");
		mediaManager.isScreenShareActive = true;

		const activeMutation = mediaManager.serializeSendMediaMutation(async () => {
			activeStarted.resolve();
			await releaseActive.promise;
			mediaManager.mediaHandler.setProducers({
				videoProducer: activeProducer as never,
			});
		});
		await activeStarted.promise;
		const queuedMutation = mediaManager.serializeSendMediaMutation(queuedOperation);
		let queuedError: unknown;
		let callerRejected = false;
		const observeQueuedMutation = queuedMutation.catch((error: unknown) => {
			queuedError = error;
			callerRejected = true;
			ordering.push("rejected");
			queuedRejectionObserved.resolve();
		});
		const cleanup = mediaManager.cleanup();
		const duplicateCleanup = mediaManager.cleanup();

		expect(duplicateCleanup).toBe(cleanup);
		expect(cancelPendingSubscriptions).toHaveBeenCalledOnce();
		expect(handlerCleanup).not.toHaveBeenCalled();
		releaseActive.resolve();
		await activeMutation;
		await queuedRejectionObserved.promise;
		expect(queuedOperation).not.toHaveBeenCalled();
		expect(callerRejected).toBe(true);
		expect(handlerCleanup).toHaveBeenCalledOnce();
		expect(ordering).toEqual(["cleanup", "rejected"]);
		expect(activeProducer.close).toHaveBeenCalledOnce();
		expect(receiveCancellationSettled).toBe(false);
		await cleanup;
		await observeQueuedMutation;

		expect(queuedError).toMatchObject({ name: "AbortError" });
		expect(mediaManager.mediaHandler.localStream).toBeNull();
		expect(mediaManager.processedConsumers).toEqual(new Set());
		expect(mediaManager.isScreenShareActive).toBe(false);

		const postCleanupOperation = vi.fn().mockResolvedValue(undefined);
		await expect(
			mediaManager.serializeSendMediaMutation(postCleanupOperation),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(postCleanupOperation).not.toHaveBeenCalled();
		expect(handlerCleanup).toHaveBeenCalledOnce();
		releaseReceiveCancellation.resolve();
	});

	it("handles receive cancellation rejection without blocking cleanup", async () => {
		const { mediaManager } = createManager();
		const cancellationError = new Error("receive cancellation failed");
		vi.spyOn(mediaManager, "cancelPendingSubscriptions").mockRejectedValue(
			cancellationError,
		);
		const warningObserved = deferred<void>();
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {
			warningObserved.resolve();
		});

		await expect(mediaManager.cleanup()).resolves.toBeUndefined();
		await warningObserved.promise;

		expect(consoleWarn).toHaveBeenCalledWith(
			"Failed to cancel pending media subscriptions:",
			cancellationError,
		);
	});

	it("rejects new subscriptions after cleanup starts", async () => {
		const { mediaManager, transportManager } = createManager();
		const cleanup = mediaManager.cleanup();

		await expect(
			mediaManager.subscribeToRemoteProducer({
				producerId: "producer-after-cleanup",
				participantId: "remote-1",
				isScreen: false,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(transportManager.createConsumer).not.toHaveBeenCalled();
		await cleanup;
	});
});

describe("SFUMediaManager.handleConsumerLost", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const baseInfo = {
		consumerId: "lost-c1",
		participantId: "remote-1",
		producerId: "producer-1",
		kind: "video",
		isScreen: false,
	};

	it("re-subscribes to the same producer after the debounce delay", async () => {
		const { mediaManager, transportManager } = createManager();
		await mediaManager.handleConsumerLost(baseInfo);

		expect(transportManager.createConsumer).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(250);

		expect(transportManager.createConsumer).toHaveBeenCalledTimes(1);
		expect(transportManager.createConsumer).toHaveBeenCalledWith(
			"producer-1",
			expect.objectContaining({ isScreen: false }),
		);
	});

	it("removes and recreates only the consumer that never started", async () => {
		const { mediaManager, transportManager, consumerManager } = createManager();
		await mediaManager.recoverConsumer({
			id: "stalled-c1",
			participantId: "remote-1",
			producerId: "producer-1",
			kind: "video",
			isScreen: false,
		} as never);

		expect(consumerManager.removeConsumer).toHaveBeenCalledWith("stalled-c1");
		await vi.advanceTimersByTimeAsync(250);
		expect(transportManager.createConsumer).toHaveBeenCalledOnce();
	});

	it("does not re-subscribe if the participant has left", async () => {
		const { mediaManager, transportManager } = createManager({
			hasParticipant: false,
		});
		await mediaManager.handleConsumerLost(baseInfo);

		await vi.advanceTimersByTimeAsync(1000);
		expect(transportManager.createConsumer).not.toHaveBeenCalled();
	});

	it("cancels a delayed re-subscription during teardown", async () => {
		const { mediaManager, transportManager } = createManager();
		await mediaManager.handleConsumerLost(baseInfo);
		await mediaManager.cancelPendingSubscriptions();

		await vi.advanceTimersByTimeAsync(1000);

		expect(transportManager.createConsumer).not.toHaveBeenCalled();
	});

	it("does not re-subscribe to its own consumer", async () => {
		const { mediaManager, transportManager } = createManager({
			currentUserId: "remote-1",
		});
		await mediaManager.handleConsumerLost(baseInfo);

		await vi.advanceTimersByTimeAsync(1000);
		expect(transportManager.createConsumer).not.toHaveBeenCalled();
	});

	it("does not re-subscribe without a producerId", async () => {
		const { mediaManager, transportManager } = createManager();
		await mediaManager.handleConsumerLost({
			...baseInfo,
			producerId: "",
		});

		await vi.advanceTimersByTimeAsync(1000);
		expect(transportManager.createConsumer).not.toHaveBeenCalled();
	});

	it("automatically caps lost-consumer recovery at 3 attempts", async () => {
		const { mediaManager, transportManager } = createManager();
		const onRecoveryExhausted = vi.fn();
		mediaManager.setEventHandlers({ onRecoveryExhausted });
		transportManager.createConsumer.mockRejectedValue(new Error("server down"));

		await mediaManager.handleConsumerLost(baseInfo);
		await vi.advanceTimersByTimeAsync(1000);
		expect(transportManager.createConsumer).toHaveBeenCalledTimes(3);
		expect(onRecoveryExhausted).toHaveBeenCalledOnce();
	});

	it("treats a successful re-subscribe as a fresh retry budget", async () => {
		const { mediaManager, transportManager } = createManager();

		transportManager.createConsumer.mockResolvedValue({
			id: "new-c1",
			producerId: "producer-1",
			kind: "video",
			track: { kind: "video" },
			appData: { type: "camera" },
		});

		await mediaManager.handleConsumerLost(baseInfo);
		await vi.advanceTimersByTimeAsync(250);
		expect(transportManager.createConsumer).toHaveBeenCalledTimes(1);

		await mediaManager.handleConsumerLost(baseInfo);
		await vi.advanceTimersByTimeAsync(250);
		expect(transportManager.createConsumer).toHaveBeenCalledTimes(2);

		await mediaManager.handleConsumerLost(baseInfo);
		await vi.advanceTimersByTimeAsync(250);
		expect(transportManager.createConsumer).toHaveBeenCalledTimes(3);

		await mediaManager.handleConsumerLost(baseInfo);
		await vi.advanceTimersByTimeAsync(250);
		expect(transportManager.createConsumer).toHaveBeenCalledTimes(4);
	});
});
