import { afterEach, describe, expect, it, vi } from "vitest";
import { SFUMeetingManager } from "../SFUMeetingManager";
import type { ConsumerManager } from "../media/ConsumerManager";
import type { ParticipantManager } from "../media/ParticipantManager";
import type { TransportManager } from "../media/TransportManager";
import type { VideoElementManager } from "../media/VideoElementManager";
import type { SFUMediaManager } from "../sfu/SFUMediaManager";

type TestableSFUMeetingManager = Pick<
	SFUMeetingManager,
	keyof SFUMeetingManager
> & {
	videoManager: VideoElementManager;
	participantManager: ParticipantManager;
	consumerManager: ConsumerManager;
	transportManager: TransportManager;
	mediaManager: SFUMediaManager;
	mediaHandler: SFUMediaManager["mediaHandler"];
};

const createManager = (client: never) =>
	new SFUMeetingManager(client) as unknown as TestableSFUMeetingManager;

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
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function prepareE2EEManager() {
	vi.stubGlobal("MediaStream", FakeMediaStream);
	const manager = createManager({
		isConnected: vi.fn(() => true),
		closeProducer: vi.fn().mockResolvedValue(undefined),
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
	it("escalates exhausted expected publication repair", async () => {
		const manager = createManager({} as never);
		const connection = (
			manager as unknown as {
				connectionManager: {
					expectedMedia: {
						observe: (entry: unknown) => void;
						repair: (
							key: string,
							stage: "publication",
							action: "recreate_producer",
							operation: () => Promise<void>,
						) => Promise<boolean>;
					};
					escalateRecovery: (trigger: unknown) => Promise<boolean>;
				};
			}
		).connectionManager;
		const escalate = vi
			.spyOn(connection, "escalateRecovery")
			.mockResolvedValue(true);
		connection.expectedMedia.observe({
			key: "local:microphone",
			direction: "local",
			media: "audio",
			source: "microphone",
			desired: true,
		});
		for (let attempt = 0; attempt < 4; attempt += 1) {
			await connection.expectedMedia.repair(
				"local:microphone",
				"publication",
				"recreate_producer",
				vi.fn().mockResolvedValue(undefined),
			);
		}

		expect(escalate).toHaveBeenCalledWith({
			scope: "publication",
			direction: "send",
			reason: "retry_limit",
		});
	});

	it("retries playback before reconciling media after browser resume", async () => {
		const manager = createManager({} as never);
		const retryPlayback = vi
			.spyOn(manager.videoManager, "retryPlayback")
			.mockResolvedValue();
		const reconcile = vi
			.spyOn(manager, "reconcileExpectedMedia")
			.mockResolvedValue();

		await manager.recoverBrowserLifecycle();

		expect(retryPlayback).toHaveBeenCalledOnce();
		expect(reconcile).toHaveBeenCalledOnce();
		expect(retryPlayback.mock.invocationCallOrder[0]).toBeLessThan(
			reconcile.mock.invocationCallOrder[0],
		);
	});

	it("rejects visible preferences while disconnected", async () => {
		const manager = createManager({
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
		const manager = createManager({
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
		const manager = createManager({
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

describe("SFUMeetingManager facade operations", () => {
	it("owns local producer creation, replacement, signaling, and closure", async () => {
		const closeProducer = vi.fn().mockResolvedValue(undefined);
		const pauseProducer = vi.fn().mockResolvedValue(undefined);
		const resumeProducer = vi.fn().mockResolvedValue(undefined);
		const client = {
			isConnected: vi.fn(() => true),
			closeProducer,
			pauseProducer,
			resumeProducer,
		} as never;
		const manager = createManager(client);
		const initialTrack = mediaTrack("initial", "video");
		const replacementTrack = mediaTrack("replacement", "video");
		const producer = {
			id: "video-producer",
			track: initialTrack,
			paused: false,
			closed: false,
			replaceTrack: vi.fn(async ({ track }: { track: MediaStreamTrack }) => {
				producer.track = track;
			}),
			pause: vi.fn(),
			resume: vi.fn(),
			close: vi.fn(),
		};
		vi.spyOn(manager.transportManager, "createProducer").mockResolvedValue(
			producer as never,
		);

		await manager.createLocalProducer("video", initialTrack);
		await manager.replaceLocalProducerTrack("video", replacementTrack);
		manager.pauseLocalProducer("video");
		manager.resumeLocalProducer("video");
		manager.closeLocalProducer("video");

		expect(producer.replaceTrack).toHaveBeenCalledWith({
			track: replacementTrack,
		});
		expect(pauseProducer).toHaveBeenCalledWith("video-producer");
		expect(resumeProducer).toHaveBeenCalledWith("video-producer");
		expect(closeProducer).toHaveBeenCalledWith("video-producer", {});
		expect(manager.getLocalProducerState("video")).toBeNull();
	});

	it("reconciles against a producer that appears while creation is pending", async () => {
		vi.stubGlobal("MediaStream", FakeMediaStream);
		const closeProducer = vi.fn().mockResolvedValue(undefined);
		const resumeProducer = vi.fn().mockResolvedValue(undefined);
		const manager = createManager({
			isConnected: vi.fn(() => true),
			closeProducer,
			resumeProducer,
		} as never);
		const track = mediaTrack("microphone", "audio");
		const creation = deferred<{
			id: string;
			track: MediaStreamTrack;
			closed: boolean;
			close: ReturnType<typeof vi.fn>;
		}>();
		const abandoned = {
			id: "abandoned-producer",
			track,
			closed: false,
			paused: false,
			close: vi.fn(),
		};
		const current = {
			id: "recovered-producer",
			track: mediaTrack("old-microphone", "audio"),
			closed: false,
			paused: true,
			replaceTrack: vi.fn(async ({ track: replacement }) => {
				current.track = replacement;
			}),
			resume: vi.fn(() => {
				current.paused = false;
			}),
			close: vi.fn(),
		};
		vi.spyOn(manager.transportManager, "createProducer").mockReturnValue(
			creation.promise as never,
		);

		const reconciliation = manager.reconcileLocalProducerTrack("audio", track, {
			resume: true,
		});
		await vi.waitFor(() =>
			expect(manager.transportManager.createProducer).toHaveBeenCalledOnce(),
		);
		manager.mediaHandler.setProducers({ audioProducer: current as never });
		creation.resolve(abandoned);
		await reconciliation;

		expect(abandoned.close).toHaveBeenCalledOnce();
		expect(closeProducer).toHaveBeenCalledWith("abandoned-producer", {});
		expect(current.replaceTrack).toHaveBeenCalledWith({ track });
		expect(current.resume).toHaveBeenCalledOnce();
		expect(manager.getLocalProducerState("audio")?.id).toBe("recovered-producer");
	});

	it("abandons a delayed screen producer after screen sharing stops", async () => {
		const closeProducer = vi.fn().mockResolvedValue(undefined);
		const manager = createManager({
			isConnected: vi.fn(() => true),
			closeProducer,
		} as never);
		const track = mediaTrack("screen", "video");
		const creation = deferred<{
			id: string;
			track: MediaStreamTrack;
			closed: boolean;
			paused: boolean;
			close: ReturnType<typeof vi.fn>;
		}>();
		const staleProducer = {
			id: "stale-screen-producer",
			track,
			closed: false,
			paused: false,
			close: vi.fn(),
		};
		vi.spyOn(manager.transportManager, "createProducer").mockReturnValue(
			creation.promise as never,
		);

		const publication = manager.publishScreenTrack(track);
		await vi.waitFor(() =>
			expect(manager.transportManager.createProducer).toHaveBeenCalledOnce(),
		);
		expect(manager.hasLocalMediaPublications()).toBe(true);
		const stopping = manager.stopScreenShare();
		creation.resolve(staleProducer);

		await expect(publication).resolves.toBeNull();
		await stopping;
		expect(staleProducer.close).toHaveBeenCalledOnce();
		expect(closeProducer).toHaveBeenCalledWith("stale-screen-producer", {});
		expect(manager.getLocalProducerState("screen")).toBeNull();
	});

	it("acknowledges screen stop before closing its producer", async () => {
		const stopSignal = deferred<unknown>();
		const sendScreenShare = vi.fn(() => stopSignal.promise);
		const closeProducer = vi.fn().mockResolvedValue(undefined);
		const manager = createManager({
			isConnected: vi.fn(() => true),
			sendScreenShare,
			closeProducer,
		} as never);
		const producer = {
			id: "screen-producer",
			track: mediaTrack("screen", "video"),
			closed: false,
			paused: false,
			close: vi.fn(),
		};
		manager.mediaHandler.setProducers({ screenProducer: producer as never });

		const stopping = manager.stopScreenShare({
			reason: "user-click",
			source: "screen-share",
		});
		await vi.waitFor(() => expect(sendScreenShare).toHaveBeenCalledOnce());
		const nextMutation = vi.fn();
		await manager.serializeSendMediaMutation(async () => nextMutation());

		expect(nextMutation).toHaveBeenCalledOnce();
		expect(producer.close).not.toHaveBeenCalled();
		expect(closeProducer).not.toHaveBeenCalled();
		stopSignal.resolve({ success: true });
		await stopping;

		expect(sendScreenShare).toHaveBeenCalledWith(
			"stop_share",
			expect.objectContaining({
				producerId: "screen-producer",
				reason: "user-click",
				source: "screen-share",
				stoppedAt: expect.any(Number),
			}),
		);
		expect(sendScreenShare.mock.invocationCallOrder[0]).toBeLessThan(
			closeProducer.mock.invocationCallOrder[0],
		);
		expect(manager.getLocalProducerState("screen")).toBeNull();
	});

	it("closes the screen producer when stop signaling rejects", async () => {
		const stopSignal = deferred<unknown>();
		const closeProducer = vi.fn().mockResolvedValue(undefined);
		const manager = createManager({
			isConnected: vi.fn(() => true),
			sendScreenShare: vi.fn(() => stopSignal.promise),
			closeProducer,
		} as never);
		const producer = {
			id: "screen-producer",
			track: mediaTrack("screen", "video"),
			closed: false,
			paused: false,
			close: vi.fn(),
		};
		manager.mediaHandler.setProducers({ screenProducer: producer as never });

		const stopping = manager.stopScreenShare({ reason: "track-ended" });
		stopSignal.reject(new Error("stop rejected"));

		await expect(stopping).resolves.toBeUndefined();
		expect(producer.close).toHaveBeenCalledOnce();
		expect(closeProducer).toHaveBeenCalledWith("screen-producer", {
			reason: "track-ended",
		});
		expect(manager.getLocalProducerState("screen")).toBeNull();
	});

	it("abandons a delayed screen producer when its track ends", async () => {
		const closeProducer = vi.fn().mockResolvedValue(undefined);
		const manager = createManager({
			isConnected: vi.fn(() => true),
			closeProducer,
		} as never);
		const track = mediaTrack("screen", "video");
		const creation = deferred<{
			id: string;
			track: MediaStreamTrack;
			closed: boolean;
			paused: boolean;
			close: ReturnType<typeof vi.fn>;
		}>();
		const staleProducer = {
			id: "ended-screen-producer",
			track,
			closed: false,
			paused: false,
			close: vi.fn(),
		};
		vi.spyOn(manager.transportManager, "createProducer").mockReturnValue(
			creation.promise as never,
		);

		const publication = manager.publishScreenTrack(track);
		await vi.waitFor(() =>
			expect(manager.transportManager.createProducer).toHaveBeenCalledOnce(),
		);
		Reflect.set(track, "readyState", "ended");
		creation.resolve(staleProducer);

		await expect(publication).resolves.toBeNull();
		expect(staleProducer.close).toHaveBeenCalledOnce();
		expect(closeProducer).toHaveBeenCalledWith("ended-screen-producer", {});
		expect(manager.getLocalProducerState("screen")).toBeNull();
	});

	it("invalidates a delayed screen publication when manager cleanup starts", async () => {
		const closeProducer = vi.fn().mockResolvedValue(undefined);
		const manager = createManager({
			isConnected: vi.fn(() => true),
			closeProducer,
			disconnect: vi.fn().mockResolvedValue(undefined),
		} as never);
		const track = mediaTrack("screen", "video");
		const creation = deferred<{
			id: string;
			track: MediaStreamTrack;
			closed: boolean;
			paused: boolean;
			close: ReturnType<typeof vi.fn>;
		}>();
		const staleProducer = {
			id: "cleanup-screen-producer",
			track,
			closed: false,
			paused: false,
			close: vi.fn(),
		};
		vi.spyOn(manager.transportManager, "createProducer").mockReturnValue(
			creation.promise as never,
		);

		const publication = manager.publishScreenTrack(track);
		await vi.waitFor(() =>
			expect(manager.transportManager.createProducer).toHaveBeenCalledOnce(),
		);
		const cleanup = manager.cleanup();
		creation.resolve(staleProducer);

		await expect(publication).resolves.toBeNull();
		await cleanup;
		expect(staleProducer.close).toHaveBeenCalledOnce();
		expect(closeProducer).toHaveBeenCalledWith("cleanup-screen-producer", {});
		expect(manager.getLocalProducerState("screen")).toBeNull();
	});

	it("keeps a recovered screen producer that replaces delayed creation", async () => {
		const closeProducer = vi.fn().mockResolvedValue(undefined);
		const manager = createManager({
			isConnected: vi.fn(() => true),
			closeProducer,
		} as never);
		const track = mediaTrack("screen", "video");
		const creation = deferred<{
			id: string;
			track: MediaStreamTrack;
			closed: boolean;
			paused: boolean;
			close: ReturnType<typeof vi.fn>;
		}>();
		const staleProducer = {
			id: "stale-screen-producer",
			track,
			closed: false,
			paused: false,
			close: vi.fn(),
		};
		const recoveredProducer = {
			id: "recovered-screen-producer",
			track,
			closed: false,
			paused: false,
			close: vi.fn(),
		};
		vi.spyOn(manager.transportManager, "createProducer").mockReturnValue(
			creation.promise as never,
		);

		const publication = manager.publishScreenTrack(track);
		await vi.waitFor(() =>
			expect(manager.transportManager.createProducer).toHaveBeenCalledOnce(),
		);
		manager.mediaHandler.setProducers({
			screenProducer: recoveredProducer as never,
		});
		creation.resolve(staleProducer);

		await expect(publication).resolves.toMatchObject({
			id: "recovered-screen-producer",
			track,
		});
		expect(staleProducer.close).toHaveBeenCalledOnce();
		expect(closeProducer).toHaveBeenCalledWith("stale-screen-producer", {});
		expect(manager.getLocalProducerState("screen")?.id).toBe(
			"recovered-screen-producer",
		);
	});

	it("does not overwrite replacement screen state after delayed creation", async () => {
		const closeProducer = vi.fn().mockResolvedValue(undefined);
		const manager = createManager({
			isConnected: vi.fn(() => true),
			closeProducer,
		} as never);
		const requestedTrack = mediaTrack("requested-screen", "video");
		const replacementTrack = mediaTrack("replacement-screen", "video");
		const creation = deferred<{
			id: string;
			track: MediaStreamTrack;
			closed: boolean;
			paused: boolean;
			close: ReturnType<typeof vi.fn>;
		}>();
		const staleProducer = {
			id: "stale-screen-producer",
			track: requestedTrack,
			closed: false,
			paused: false,
			close: vi.fn(),
		};
		const replacementProducer = {
			id: "replacement-screen-producer",
			track: replacementTrack,
			closed: false,
			paused: false,
			close: vi.fn(),
		};
		vi.spyOn(manager.transportManager, "createProducer").mockReturnValue(
			creation.promise as never,
		);

		const publication = manager.publishScreenTrack(requestedTrack);
		await vi.waitFor(() =>
			expect(manager.transportManager.createProducer).toHaveBeenCalledOnce(),
		);
		manager.mediaHandler.setProducers({
			screenProducer: replacementProducer as never,
		});
		creation.resolve(staleProducer);

		await expect(publication).resolves.toBeNull();
		expect(staleProducer.close).toHaveBeenCalledOnce();
		expect(replacementProducer.close).not.toHaveBeenCalled();
		expect(manager.getLocalProducerState("screen")?.track).toBe(
			replacementTrack,
		);
	});

	it("exposes only the video consumer id", () => {
		const manager = createManager({} as never);
		vi.spyOn(manager.consumerManager, "getVideoConsumer")
			.mockReturnValueOnce({
				id: "video-consumer",
				adaptivelyPaused: false,
			} as never)
			.mockReturnValueOnce(undefined);

		expect(manager.getVideoConsumerId("participant-1")).toBe("video-consumer");
		expect(manager.getVideoConsumerId("missing")).toBeNull();
	});

	it("returns immutable RTC samples and drops a producer replaced during sampling", async () => {
		const manager = createManager({
			getConnectionStatus: vi.fn(() => ({ connected: true })),
		} as never);
		const stats = deferred<Map<string, unknown>>();
		const oldProducer = {
			id: "old-producer",
			kind: "audio",
			track: mediaTrack("old-track", "audio"),
			closed: false,
			paused: false,
			appData: {},
			getStats: vi.fn(() => stats.promise),
		};
		manager.mediaHandler.setProducers({ audioProducer: oldProducer as never });

		const sampling = manager.sampleRTCStats();
		await vi.waitFor(() => expect(oldProducer.getStats).toHaveBeenCalledOnce());
		manager.mediaHandler.setProducers({
			audioProducer: {
				...oldProducer,
				id: "replacement-producer",
				getStats: vi.fn().mockResolvedValue(new Map()),
			} as never,
		});
		stats.resolve(
			new Map([
				["outbound", { id: "outbound", type: "outbound-rtp" }],
			]),
		);
		const sample = await sampling;

		expect(sample.streams).toEqual([]);
		expect(Object.isFrozen(sample)).toBe(true);
		expect(Object.isFrozen(sample.streams)).toBe(true);
		expect(sample).not.toHaveProperty("producers");
		expect(sample).not.toHaveProperty("transports");
		expect(sample).not.toHaveProperty("consumers");
	});

	it("routes host control through an acknowledged client request", async () => {
		const sendRequest = vi.fn().mockResolvedValue({ success: true });
		const manager = createManager({ sendRequest } as never);

		await manager.sendHostControl("mute_participant", "participant-1");

		expect(sendRequest).toHaveBeenCalledWith("host_control", {
			action: "mute_participant",
			targetParticipantId: "participant-1",
		});
	});

	it("keeps health monitoring active until its last facade subscriber leaves", () => {
		const manager = createManager({} as never);
		const monitor = Reflect.get(manager, "mediaHealthMonitor");
		const start = vi.spyOn(monitor, "start").mockImplementation(() => {});
		const stop = vi.spyOn(monitor, "stop").mockImplementation(() => {});
		const stopFirst = manager.startMediaHealthMonitoring(vi.fn());
		const stopSecond = manager.startMediaHealthMonitoring(vi.fn());

		stopFirst();
		expect(stop).not.toHaveBeenCalled();
		stopSecond();

		expect(start).toHaveBeenCalledTimes(2);
		expect(stop).toHaveBeenCalledOnce();
	});
});

describe("SFUMeetingManager recovery fallback", () => {
	it("keeps existing consumers after a successful ICE restart", async () => {
		const manager = createManager({
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
		const manager = createManager({
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
		const connection = (
			manager as unknown as {
				connectionManager: { escalateRecovery: (trigger: unknown) => Promise<boolean> };
			}
		).connectionManager;
		const escalate = vi
			.spyOn(connection, "escalateRecovery")
			.mockResolvedValue(true);
		const closeReceiveTransport = vi.spyOn(
			manager.transportManager,
			"closeReceiveTransport",
		);

		await expect(
			manager.recoverTransport("transport_send_failed"),
		).resolves.toBe("failed");

		expect(closeReceiveTransport).toHaveBeenCalledOnce();
		expect(escalate).toHaveBeenCalledWith({
			scope: "transport",
			direction: "both",
			reason: "rebuild_failed",
		});
	});
});

describe("SFUMeetingManager E2EE recovery tracks", () => {
	it("recreates a screen-only publication on the E2EE send transport", async () => {
		const manager = prepareE2EEManager();
		const screen = mediaTrack("screen", "video");
		const oldScreenProducer = {
			id: "old-screen",
			track: screen,
			close: vi.fn(),
		};
		const e2eeScreenProducer = {
			id: "e2ee-screen",
			track: screen,
			closed: false,
			paused: false,
			close: vi.fn(),
		};
		manager.mediaHandler.setProducers({
			screenProducer: oldScreenProducer as never,
		});
		const createProducer = vi
			.spyOn(manager.transportManager, "createProducer")
			.mockResolvedValue(e2eeScreenProducer as never);

		expect(manager.hasLocalMediaPublications()).toBe(true);
		await expect(manager.reconfigureForE2EE(null, null)).resolves.toEqual({
			videoPublished: false,
			audioPublished: false,
		});

		expect(oldScreenProducer.close).toHaveBeenCalledOnce();
		expect(manager.transportManager.createSendTransport).toHaveBeenCalledOnce();
		expect(createProducer).toHaveBeenCalledWith(screen, { type: "screen" });
		expect(manager.mediaHandler.screenProducer).toBe(e2eeScreenProducer);
		expect(screen.readyState).toBe("live");
	});

	it("recreates screen, camera, and microphone publications for E2EE", async () => {
		const manager = prepareE2EEManager();
		const screen = mediaTrack("screen", "video");
		const video = mediaTrack("video", "video");
		const audio = mediaTrack("audio", "audio");
		manager.mediaHandler.setProducers({
			screenProducer: { id: "old-screen", track: screen, close: vi.fn() } as never,
			videoProducer: { id: "old-video", track: video, close: vi.fn() } as never,
			audioProducer: { id: "old-audio", track: audio, close: vi.fn() } as never,
		});
		const producers = new Map(
			[video, audio, screen].map((track) => [
				track,
				{
					id: `e2ee-${track.id}`,
					track,
					closed: false,
					paused: false,
					close: vi.fn(),
				},
			]),
		);
		const createProducer = vi
			.spyOn(manager.transportManager, "createProducer")
			.mockImplementation(async (track) => producers.get(track) as never);

		await expect(
			manager.reconfigureForE2EE(
				new FakeMediaStream([video]) as never,
				new FakeMediaStream([audio]) as never,
			),
		).resolves.toEqual({ videoPublished: true, audioPublished: true });

		expect(createProducer).toHaveBeenNthCalledWith(1, video, { type: "camera" });
		expect(createProducer).toHaveBeenNthCalledWith(2, audio, {
			type: "microphone",
		});
		expect(createProducer).toHaveBeenNthCalledWith(3, screen, { type: "screen" });
		expect(manager.mediaHandler.videoProducer).toBe(producers.get(video));
		expect(manager.mediaHandler.audioProducer).toBe(producers.get(audio));
		expect(manager.mediaHandler.screenProducer).toBe(producers.get(screen));
	});

	it("removes screen consumers before the E2EE receive clear", async () => {
		const manager = prepareE2EEManager();
		const screen = {
			id: "screen-consumer",
			participantId: "alice",
			producerId: "screen-producer",
			isScreen: true,
		};
		vi.spyOn(
			manager.consumerManager,
			"getScreenShareConsumers",
		).mockReturnValue([screen] as never);
		const remove = vi
			.spyOn(manager.consumerManager, "removeConsumer")
			.mockReturnValue(screen as never);

		await manager.reconfigureForE2EE(null, null);

		expect(remove).toHaveBeenCalledWith("screen-consumer");
		expect(remove.mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(manager.consumerManager.clear).mock.invocationCallOrder[0],
		);
	});

	it("does not recreate an ended screen track during E2EE transition", async () => {
		const manager = prepareE2EEManager();
		const screen = mediaTrack("screen", "video");
		Reflect.set(screen, "readyState", "ended");
		const oldScreenProducer = {
			id: "old-screen",
			track: screen,
			close: vi.fn(),
		};
		manager.mediaHandler.setProducers({
			screenProducer: oldScreenProducer as never,
		});
		const createProducer = vi.spyOn(
			manager.transportManager,
			"createProducer",
		);

		expect(manager.hasLocalMediaPublications()).toBe(true);
		await manager.reconfigureForE2EE(null, null);

		expect(oldScreenProducer.close).toHaveBeenCalledOnce();
		expect(createProducer).not.toHaveBeenCalled();
		expect(manager.mediaHandler.screenProducer).toBeNull();
	});

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
		const manager = createManager(sfuClient);
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
