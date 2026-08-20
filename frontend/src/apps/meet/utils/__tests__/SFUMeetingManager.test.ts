import { afterEach, describe, expect, it, vi } from "vitest";
import { SFUMeetingManager } from "../SFUMeetingManager";

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

const mediaTrack = (id: string, kind: "audio" | "video") =>
	({ id, kind, readyState: "live" }) as MediaStreamTrack;

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function prepareE2EEManager() {
	vi.stubGlobal("MediaStream", FakeMediaStream);
	const manager = new SFUMeetingManager({
		isConnected: vi.fn(() => true),
	} as never);
	const connectionManager = (
		manager as unknown as {
			connectionManager: {
				clearBufferedReconciliationEvents: () => void;
				setupExistingParticipants: () => Promise<void>;
			};
		}
	).connectionManager;
	vi.spyOn(
		manager.mediaManager,
		"cancelPendingSubscriptions",
	).mockResolvedValue();
	vi.spyOn(manager.consumerManager, "clear").mockImplementation(() => {});
	vi.spyOn(
		connectionManager,
		"clearBufferedReconciliationEvents",
	).mockImplementation(() => {});
	vi.spyOn(connectionManager, "setupExistingParticipants").mockResolvedValue();
	vi.spyOn(manager.transportManager, "cleanup").mockImplementation(() => {});
	vi.spyOn(manager.transportManager, "initializeDevice").mockResolvedValue();
	vi.spyOn(
		manager.transportManager,
		"createReceiveTransport",
	).mockResolvedValue(undefined);
	vi.spyOn(manager.transportManager, "createSendTransport").mockResolvedValue(
		undefined,
	);
	return manager;
}

describe("SFUMeetingManager adaptive streaming", () => {
	it("rejects visible preferences while disconnected", async () => {
		const manager = new SFUMeetingManager({
			isConnected: vi.fn(() => false),
		} as never);

		await expect(
			manager.updateConsumerStreamPreferences("consumer-1", {
				visible: true,
				width: 640,
				height: 360,
			}),
		).rejects.toThrow("disconnected");
	});

	it("rejects a failed visible preference without clearing adaptive pause", async () => {
		const manager = new SFUMeetingManager({
			isConnected: vi.fn(() => true),
			updateConsumerPreferences: vi.fn().mockRejectedValue(new Error("offline")),
		} as never);
		const updateConsumer = vi.spyOn(manager.consumerManager, "updateConsumer");

		await expect(
			manager.updateConsumerStreamPreferences("consumer-1", {
				visible: true,
				width: 640,
				height: 360,
			}),
		).rejects.toThrow("offline");
		expect(updateConsumer).not.toHaveBeenCalled();
	});

	it("keeps the latest hidden preference when an older resume resolves late", async () => {
		const visibleRequest = deferred<unknown>();
		const hiddenRequest = deferred<unknown>();
		const updateConsumerPreferences = vi
			.fn()
			.mockReturnValueOnce(visibleRequest.promise)
			.mockReturnValueOnce(hiddenRequest.promise);
		const manager = new SFUMeetingManager({
			isConnected: vi.fn(() => true),
			updateConsumerPreferences,
		} as never);
		const updateConsumer = vi.spyOn(manager.consumerManager, "updateConsumer");

		const visible = manager.updateConsumerStreamPreferences("consumer-1", {
			visible: true,
			width: 640,
			height: 360,
		});
		const hidden = manager.updateConsumerStreamPreferences("consumer-1", {
			visible: false,
			width: 0,
			height: 0,
		});
		hiddenRequest.resolve(null);
		await hidden;
		visibleRequest.resolve(null);
		await visible;

		expect(updateConsumer).toHaveBeenCalledOnce();
		expect(updateConsumer).toHaveBeenCalledWith("consumer-1", {
			adaptivelyPaused: true,
		});
	});
});

describe("SFUMeetingManager recovery fallback", () => {
	it("keeps existing consumers after a successful ICE restart", async () => {
		const manager = new SFUMeetingManager({
			isConnected: vi.fn(() => true),
		} as never);
		vi.spyOn(
			manager.transportManager,
			"restartAllTransportIce",
		).mockResolvedValue({
			send: "restarted",
			recv: "restarted",
		});
		const closeReceiveTransport = vi.spyOn(
			manager.transportManager,
			"closeReceiveTransport",
		);

		await expect(
			manager.recoverTransport("transport_recv_failed"),
		).resolves.toBe("recovered");

		expect(closeReceiveTransport).not.toHaveBeenCalled();
	});

	it("resets receive media when send rebuild fails", async () => {
		const manager = new SFUMeetingManager({
			isConnected: vi.fn(() => true),
		} as never);
		vi.spyOn(
			manager.transportManager,
			"restartAllTransportIce",
		).mockResolvedValue({
			send: "failed",
			recv: "failed",
		});
		vi.spyOn(manager.mediaManager, "rebuildSendSide").mockRejectedValue(
			new Error("send rebuild failed"),
		);
		const closeReceiveTransport = vi.spyOn(
			manager.transportManager,
			"closeReceiveTransport",
		);

		await expect(
			manager.recoverTransport("transport_send_failed"),
		).resolves.toBe("failed");

		expect(closeReceiveTransport).toHaveBeenCalledOnce();
	});
});

describe("SFUMeetingManager E2EE recovery tracks", () => {
	it("restores active recovery tracks before recreating producers", async () => {
		const manager = prepareE2EEManager();
		const video = mediaTrack("video", "video");
		const audio = mediaTrack("audio", "audio");
		manager.mediaHandler.setProducers({
			videoProducer: { close: vi.fn() } as never,
			audioProducer: { close: vi.fn() } as never,
		});
		const synchronize = vi.spyOn(manager.mediaManager, "setLocalTrack");
		const createProducer = vi
			.spyOn(manager.transportManager, "createProducer")
			.mockImplementation(async (track) => ({ track }) as never);

		const result = await manager.reconfigureForE2EE(
			new FakeMediaStream([video]) as never,
			new FakeMediaStream([audio]) as never,
		);

		expect(result).toEqual({ videoPublished: true, audioPublished: true });
		expect(manager.mediaHandler.localStream?.getVideoTracks()).toEqual([video]);
		expect(manager.mediaHandler.localStream?.getAudioTracks()).toEqual([audio]);
		expect(synchronize).toHaveBeenCalledWith("video", video);
		expect(synchronize).toHaveBeenCalledWith("audio", audio);
		expect(synchronize.mock.invocationCallOrder[0]).toBeLessThan(
			createProducer.mock.invocationCallOrder[0],
		);
		expect(synchronize.mock.invocationCallOrder[1]).toBeLessThan(
			createProducer.mock.invocationCallOrder[1],
		);
		vi.unstubAllGlobals();
	});

	it("retains an active recovery track when E2EE producer recreation fails", async () => {
		const manager = prepareE2EEManager();
		const video = mediaTrack("video", "video");
		manager.mediaHandler.setProducers({
			videoProducer: { close: vi.fn() } as never,
		});
		const synchronize = vi.spyOn(manager.mediaManager, "setLocalTrack");
		const createProducer = vi
			.spyOn(manager.transportManager, "createProducer")
			.mockRejectedValue(new Error("producer failed"));

		const result = await manager.reconfigureForE2EE(
			new FakeMediaStream([video]) as never,
			null,
		);

		expect(result).toEqual({ videoPublished: false, audioPublished: false });
		expect(manager.mediaHandler.localStream?.getVideoTracks()).toEqual([video]);
		expect(synchronize).toHaveBeenCalledWith("video", video);
		expect(synchronize.mock.invocationCallOrder[0]).toBeLessThan(
			createProducer.mock.invocationCallOrder[0],
		);
		vi.unstubAllGlobals();
	});

	it("waits for an earlier send-media mutation before E2EE cleanup", async () => {
		const manager = prepareE2EEManager();
		const mutationStarted = deferred<void>();
		const releaseMutation = deferred<void>();
		const mutation = manager.mediaManager.serializeSendMediaMutation(
			async () => {
				mutationStarted.resolve();
				await releaseMutation.promise;
			},
		);
		await mutationStarted.promise;

		const reconfiguration = manager.reconfigureForE2EE(null, null);

		expect(
			manager.mediaManager.cancelPendingSubscriptions,
		).not.toHaveBeenCalled();
		releaseMutation.resolve();
		await Promise.all([mutation, reconfiguration]);
		expect(
			manager.mediaManager.cancelPendingSubscriptions,
		).toHaveBeenCalledOnce();
	});

	it("holds later send-media mutations until E2EE recreation finishes", async () => {
		const manager = prepareE2EEManager();
		const initializeStarted = deferred<void>();
		const releaseInitialize = deferred<void>();
		vi.mocked(manager.transportManager.initializeDevice).mockImplementation(
			async () => {
				initializeStarted.resolve();
				await releaseInitialize.promise;
			},
		);

		const reconfiguration = manager.reconfigureForE2EE(null, null);
		await initializeStarted.promise;
		let mutationRan = false;
		const mutation = manager.mediaManager.serializeSendMediaMutation(
			async () => {
				mutationRan = true;
			},
		);

		expect(mutationRan).toBe(false);
		releaseInitialize.resolve();
		await Promise.all([reconfiguration, mutation]);
		expect(mutationRan).toBe(true);
	});

	it("reports a selected track that ends while queued as unpublished", async () => {
		const manager = prepareE2EEManager();
		const video = mediaTrack("video", "video");
		manager.mediaHandler.setProducers({
			videoProducer: { id: "old-video-producer", close: vi.fn() } as never,
		});
		const createProducer = vi
			.spyOn(manager.transportManager, "createProducer")
			.mockResolvedValue({} as never);
		const activeMutationEntered = deferred<void>();
		const releaseActiveMutation = deferred<void>();
		const activeMutation = manager.mediaManager.serializeSendMediaMutation(
			async () => {
				activeMutationEntered.resolve();
				await releaseActiveMutation.promise;
			},
		);
		await activeMutationEntered.promise;

		const reconfiguration = manager.reconfigureForE2EE(
			new FakeMediaStream([video]) as never,
			null,
		);
		Reflect.set(video, "readyState", "ended");
		releaseActiveMutation.resolve();

		await activeMutation;
		await expect(reconfiguration).resolves.toEqual({
			videoPublished: false,
			audioPublished: false,
		});
		expect(createProducer).not.toHaveBeenCalled();
		expect(manager.mediaHandler.localStream?.getVideoTracks()).toEqual([]);
	});

	it("closes an E2EE producer when its track ends during creation", async () => {
		const manager = prepareE2EEManager();
		const video = mediaTrack("video", "video");
		const creationEntered = deferred<void>();
		const releaseCreation = deferred<{
			id: string;
			track: MediaStreamTrack;
			close: ReturnType<typeof vi.fn>;
		}>();
		const unusableProducer = {
			id: "unusable-video-producer",
			track: video,
			close: vi.fn(),
		};
		manager.mediaHandler.setProducers({
			videoProducer: { id: "old-video-producer", close: vi.fn() } as never,
		});
		vi.spyOn(manager.transportManager, "createProducer").mockImplementation(
			() => {
				creationEntered.resolve();
				return releaseCreation.promise as never;
			},
		);

		const reconfiguration = manager.reconfigureForE2EE(
			new FakeMediaStream([video]) as never,
			null,
		);
		await creationEntered.promise;
		Reflect.set(video, "readyState", "ended");
		releaseCreation.resolve(unusableProducer);

		await expect(reconfiguration).resolves.toEqual({
			videoPublished: false,
			audioPublished: false,
		});
		expect(unusableProducer.close).toHaveBeenCalledOnce();
		expect(manager.mediaHandler.videoProducer).toBeNull();
		expect(manager.mediaHandler.localStream?.getVideoTracks()).toEqual([]);
	});

	it("rechecks video publication after awaited audio creation", async () => {
		const manager = prepareE2EEManager();
		const video = mediaTrack("video", "video");
		const audio = mediaTrack("audio", "audio");
		const videoProducer = {
			id: "video-producer",
			track: video,
			close: vi.fn(),
		};
		const audioProducer = {
			id: "audio-producer",
			track: audio,
			close: vi.fn(),
		};
		const audioCreationEntered = deferred<void>();
		const releaseAudioCreation = deferred<typeof audioProducer>();
		manager.mediaHandler.setProducers({
			videoProducer: { id: "old-video", close: vi.fn() } as never,
			audioProducer: { id: "old-audio", close: vi.fn() } as never,
		});
		vi.spyOn(manager.transportManager, "createProducer")
			.mockResolvedValueOnce(videoProducer as never)
			.mockImplementationOnce(() => {
				audioCreationEntered.resolve();
				return releaseAudioCreation.promise as never;
			});

		const reconfiguration = manager.reconfigureForE2EE(
			new FakeMediaStream([video]) as never,
			new FakeMediaStream([audio]) as never,
		);
		await audioCreationEntered.promise;
		Reflect.set(video, "readyState", "ended");
		releaseAudioCreation.resolve(audioProducer);

		await expect(reconfiguration).resolves.toEqual({
			videoPublished: false,
			audioPublished: true,
		});
		expect(videoProducer.close).toHaveBeenCalledOnce();
		expect(audioProducer.close).not.toHaveBeenCalled();
		expect(manager.mediaHandler.videoProducer).toBeNull();
		expect(manager.mediaHandler.audioProducer).toBe(audioProducer);
	});

	it("logs an unrelated AbortError while E2EE reconfiguration is active", async () => {
		const manager = prepareE2EEManager();
		const abortError = new DOMException("Unrelated interruption", "AbortError");
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const connectionManager = Reflect.get(manager, "connectionManager") as {
			setupExistingParticipants: () => Promise<void>;
		};
		vi.spyOn(connectionManager, "setupExistingParticipants").mockRejectedValue(
			abortError,
		);

		await expect(manager.reconfigureForE2EE(null, null)).rejects.toBe(
			abortError,
		);

		expect(consoleError).toHaveBeenCalledWith(
			"E2EE reconfiguration failed:",
			abortError,
		);
	});

	it("disconnects while E2EE participant setup has an unresolved consumer", async () => {
		vi.stubGlobal("MediaStream", FakeMediaStream);
		const disconnectClient = vi.fn().mockResolvedValue(undefined);
		const sfuClient = {
			isConnected: vi.fn(() => true),
			isE2EERequired: vi.fn(() => false),
			disconnect: disconnectClient,
			getRoomParticipants: vi
				.fn()
				.mockResolvedValue([
					{ participantId: "remote-1", user_id: "remote-1" },
				]),
			getExistingProducers: vi.fn().mockResolvedValue([
				{
					id: "remote-producer",
					participantId: "remote-1",
					isScreen: false,
				},
			]),
		} as never;
		const manager = new SFUMeetingManager(sfuClient);
		manager.initialize({
			meetingId: "meeting-1",
			currentUser: { user_id: "me" },
		});
		const video = mediaTrack("video", "video");
		manager.mediaHandler.setProducers({
			videoProducer: { id: "old-video", close: vi.fn() } as never,
		});
		vi.spyOn(manager.transportManager, "cleanup").mockImplementation(() => {});
		vi.spyOn(manager.transportManager, "initializeDevice").mockResolvedValue();
		vi.spyOn(
			manager.transportManager,
			"createReceiveTransport",
		).mockResolvedValue(undefined);
		vi.spyOn(manager.transportManager, "createSendTransport").mockResolvedValue(
			undefined,
		);
		vi.spyOn(manager.transportManager, "isDeviceLoaded").mockReturnValue(true);
		vi.spyOn(manager.transportManager, "createProducer").mockResolvedValue({
			id: "e2ee-video",
			track: video,
			close: vi.fn(),
		} as never);
		const consumerRequest = deferred<{
			id: string;
			producerId: string;
			kind: string;
			close: ReturnType<typeof vi.fn>;
		}>();
		const consumerCreationEntered = deferred<void>();
		vi.spyOn(manager.transportManager, "createConsumer").mockImplementation(
			() => {
				consumerCreationEntered.resolve();
				return consumerRequest.promise as never;
			},
		);
		const addConsumer = vi.spyOn(manager.consumerManager, "addConsumer");
		const handlerCleanup = vi.spyOn(manager.mediaHandler, "cleanup");
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const lifecycle = new AbortController();

		const reconfiguration = manager.reconfigureForE2EE(
			new FakeMediaStream([video]) as never,
			null,
			lifecycle.signal,
		);
		const observedReconfiguration = reconfiguration.catch(
			(error: unknown) => error,
		);
		await consumerCreationEntered.promise;
		lifecycle.abort(new DOMException("Participant disconnected", "AbortError"));
		const disconnect = manager.disconnect();
		await disconnect;

		expect(handlerCleanup).toHaveBeenCalledTimes(2);
		expect(disconnectClient).toHaveBeenCalledOnce();
		await expect(observedReconfiguration).resolves.toMatchObject({
			name: "AbortError",
		});
		expect(consoleError).not.toHaveBeenCalled();
		const lateConsumer = {
			id: "late-consumer",
			producerId: "remote-producer",
			kind: "video",
			close: vi.fn(),
		};
		consumerRequest.resolve(lateConsumer);
		await vi.waitFor(() => expect(lateConsumer.close).toHaveBeenCalledOnce());
		expect(addConsumer).not.toHaveBeenCalled();
	});
});
