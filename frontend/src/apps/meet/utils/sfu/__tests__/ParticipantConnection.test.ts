import { afterEach, describe, expect, it, vi } from "vitest";
import { ParticipantManager } from "../../media/ParticipantManager";
import {
	ParticipantConnection,
	type ParticipantConnectionStartOptions,
} from "../ParticipantConnection";
import { SFUMediaManager } from "../SFUMediaManager";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, reject, resolve };
}

function createConnection({ e2eeRequired = false } = {}) {
	const participantManager = new ParticipantManager();
	const handlers = new Map<string, (data: unknown) => unknown>();
	const sfuClient = {
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
		getExistingProducers: vi.fn().mockResolvedValue([]),
		getRoomParticipants: vi.fn().mockResolvedValue([]),
		isE2EERequired: vi.fn(() => e2eeRequired),
		joinRoom: vi.fn().mockResolvedValue(undefined),
		on: vi.fn((event: string, handler: (data: unknown) => unknown) => {
			handlers.set(event, handler);
		}),
	};
	const mediaManager = {
		cancelPendingSubscriptions: vi.fn().mockResolvedValue(undefined),
		cleanup: vi.fn(),
		rebuildSendSide: vi.fn().mockResolvedValue({}),
		subscribeToRemoteProducer: vi.fn().mockResolvedValue(undefined),
		processedConsumers: new Set<string>(),
		isScreenShareActive: false,
		mediaHandler: { localStream: null },
		consumerManager: {
			clear: vi.fn(),
			setEventHandlers: vi.fn(),
			getConsumersByParticipant: vi.fn(() => []),
			getScreenShareConsumers: vi.fn(() => []),
			removeConsumer: vi.fn(),
		},
		setEventHandlers: vi.fn(),
	};
	const transportManager = {
		cleanup: vi.fn(),
		closeReceiveTransport: vi.fn(),
		createReceiveTransport: vi.fn().mockResolvedValue(undefined),
		initializeDevice: vi.fn().mockResolvedValue(undefined),
		initialize: vi.fn(),
		isDeviceLoaded: vi.fn(() => true),
	};
	const recoveryManager = {
		setupTransportEventHandlers: vi.fn(),
		reset: vi.fn(),
	};
	const connection = new ParticipantConnection({
		sfuClient: sfuClient as never,
		videoManager: {} as never,
		participantManager,
		transportManager: transportManager as never,
		mediaManager: mediaManager as never,
		recoveryManager: recoveryManager as never,
	});
	vi.spyOn(connection.expectedMedia, "waitForHealthy").mockResolvedValue();
	connection.initialize("meeting-1", { user_id: "me" });
	return {
		connection,
		handlers,
		mediaManager,
		participantManager,
		recoveryManager,
		sfuClient,
		transportManager,
	};
}

function startOptions(
	overrides: Partial<ParticipantConnectionStartOptions> = {},
): ParticipantConnectionStartOptions {
	return {
		prepareJoin: vi.fn().mockResolvedValue({
			userData: { name: "Me", userId: "me" },
			mediaState: { audio_enabled: true, video_enabled: true },
		}),
		waitForE2EEReady: vi.fn().mockResolvedValue(undefined),
		publishLocalMedia: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

describe("ParticipantConnection lifecycle", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("becomes ready only after publication and initial reconciliation settle", async () => {
		const { connection } = createConnection();
		const publication = deferred<unknown>();
		const states: string[] = [];
		connection.eventHandlers.onLifecycleStateChange = (state) =>
			states.push(state);

		const start = connection.start(
			startOptions({
				publishLocalMedia: () => publication.promise,
			}),
		);
		await vi.waitFor(() => expect(connection.state).toBe("syncing"));
		expect(connection.state).not.toBe("ready");

		publication.resolve(undefined);
		await expect(start).resolves.toBe("ready");
		expect(states).toEqual(["starting", "syncing", "ready"]);
	});

	it("prepares join after connection details are available", async () => {
		const { connection, sfuClient } = createConnection();
		const prepareJoin = vi.fn(async () => {
			expect(sfuClient.connect).toHaveBeenCalledOnce();
			return {
				userData: { name: "Host", userId: "me", isHost: true },
				mediaState: { audio_enabled: false, video_enabled: true },
			};
		});

		await connection.start(startOptions({ prepareJoin }));

		expect(prepareJoin).toHaveBeenCalledOnce();
		expect(sfuClient.joinRoom).toHaveBeenCalledWith(
			"meeting-1",
			expect.objectContaining({ isHost: true }),
			{ audio_enabled: false, video_enabled: true },
			expect.objectContaining({ connectionId: expect.any(String) }),
		);
	});

	it("buffers live events from signaling connect until the first snapshot", async () => {
		const { connection, handlers, participantManager, sfuClient } =
			createConnection();
		const join = deferred<{
			userData: { name: string; userId: string };
			mediaState: { audio_enabled: boolean; video_enabled: boolean };
		}>();
		const start = connection.start(
			startOptions({ prepareJoin: () => join.promise }),
		);
		await vi.waitFor(() => expect(sfuClient.connect).toHaveBeenCalledOnce());

		handlers.get("participant_joined")?.({
			participantId: "alice",
			user_id: "alice",
		});
		expect(participantManager.hasParticipant("alice")).toBe(false);

		join.resolve({
			userData: { name: "Me", userId: "me" },
			mediaState: { audio_enabled: false, video_enabled: false },
		});
		await start;
		expect(participantManager.hasParticipant("alice")).toBe(true);
	});

	it("escalates an exhausted initial publication after degraded startup", async () => {
		const { connection, sfuClient } = createConnection();
		const publicationError = new Error("camera failed");
		const report = vi.fn();
		connection.eventHandlers.onInitialPublicationError = report;

		await expect(
			connection.start(
				startOptions({
					publishLocalMedia: vi.fn().mockRejectedValue(publicationError),
				}),
			),
		).resolves.toBe("degraded");
		expect(report).toHaveBeenCalledWith(publicationError);
		await vi.waitFor(() => expect(connection.state).toBe("ready"));
		expect(sfuClient.disconnect).toHaveBeenCalledOnce();
	});

	it("resolves degraded then retries snapshots only after returning online", async () => {
		vi.useFakeTimers();
		let online = false;
		vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
		const { connection, sfuClient } = createConnection();
		sfuClient.getRoomParticipants
			.mockRejectedValueOnce(new Error("snapshot unavailable"))
			.mockResolvedValueOnce([]);

		await expect(connection.start(startOptions())).resolves.toBe("degraded");
		await vi.advanceTimersByTimeAsync(5000);
		expect(sfuClient.getRoomParticipants).toHaveBeenCalledTimes(1);

		online = true;
		window.dispatchEvent(new Event("online"));
		await vi.advanceTimersByTimeAsync(999);
		expect(sfuClient.getRoomParticipants).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(sfuClient.getRoomParticipants).toHaveBeenCalledTimes(2);
		expect(connection.state).toBe("ready");
	});

	it("replays events received between failed snapshot attempts", async () => {
		vi.useFakeTimers();
		const { connection, handlers, participantManager, sfuClient } =
			createConnection();
		sfuClient.getRoomParticipants
			.mockRejectedValueOnce(new Error("snapshot unavailable"))
			.mockResolvedValueOnce([
				{ participantId: "alice", user_id: "alice" },
			]);

		await expect(connection.start(startOptions())).resolves.toBe("degraded");
		handlers.get("participant_left")?.({ participantId: "alice" });
		await vi.advanceTimersByTimeAsync(1000);

		expect(connection.state).toBe("ready");
		expect(participantManager.hasParticipant("alice")).toBe(false);
	});

	it("escalates after three failed snapshot retries", async () => {
		vi.useFakeTimers();
		const { connection, sfuClient } = createConnection();
		const escalate = vi.spyOn(connection, "escalateRecovery").mockResolvedValue(true);
		sfuClient.getRoomParticipants.mockRejectedValue(
			new Error("snapshot unavailable"),
		);

		await expect(connection.start(startOptions())).resolves.toBe("degraded");
		await vi.advanceTimersByTimeAsync(7000);

		expect(sfuClient.getRoomParticipants).toHaveBeenCalledTimes(4);
		expect(escalate).toHaveBeenCalledOnce();
		expect(escalate).toHaveBeenCalledWith({
			scope: "subscription",
			direction: "recv",
			reason: "snapshot_retry_limit",
		});
	});

	it("does not escalate snapshot retries after disconnect", async () => {
		vi.useFakeTimers();
		const { connection, sfuClient } = createConnection();
		const escalate = vi.spyOn(connection, "escalateRecovery").mockResolvedValue(true);
		sfuClient.getRoomParticipants.mockRejectedValue(
			new Error("snapshot unavailable"),
		);

		await expect(connection.start(startOptions())).resolves.toBe("degraded");
		await connection.disconnect();
		await vi.advanceTimersByTimeAsync(60000);

		expect(sfuClient.getRoomParticipants).toHaveBeenCalledOnce();
		expect(escalate).not.toHaveBeenCalled();
	});

	it("aborts E2EE readiness and prevents startup from mutating after cleanup", async () => {
		const { connection } = createConnection({ e2eeRequired: true });
		let readinessSignal: AbortSignal | undefined;
		const readiness = deferred<void>();
		const start = connection.start(
			startOptions({
				waitForE2EEReady: (signal) => {
					readinessSignal = signal;
					return readiness.promise;
				},
			}),
		);
		await vi.waitFor(() => expect(readinessSignal).toBeDefined());

		await connection.disconnect();
		await expect(start).rejects.toMatchObject({ name: "AbortError" });
		expect(readinessSignal?.aborted).toBe(true);
		expect(connection.state).toBe("stopped");
	});

	it("discards a snapshot that resolves after cleanup", async () => {
		const { connection, participantManager, sfuClient } = createConnection();
		const snapshot =
			deferred<Array<{ participantId: string; user_id: string }>>();
		const snapshotResolutionObserved = deferred<void>();
		sfuClient.getRoomParticipants.mockReturnValueOnce(
			snapshot.promise.then((participants) => {
				snapshotResolutionObserved.resolve();
				return participants;
			}),
		);
		const start = connection.start(startOptions());
		await vi.waitFor(() =>
			expect(sfuClient.getRoomParticipants).toHaveBeenCalled(),
		);

		await connection.disconnect();
		await expect(start).rejects.toMatchObject({ name: "AbortError" });
		snapshot.resolve([{ participantId: "late", user_id: "late" }]);
		await snapshotResolutionObserved.promise;
		expect(participantManager.hasParticipant("late")).toBe(false);
		expect(connection.state).toBe("stopped");
	});

	it("retries a failed fresh rebuild with bounded jitter", async () => {
		vi.useFakeTimers();
		const { connection, sfuClient } = createConnection();
		await connection.joinRoom(
			{ name: "Me", userId: "me" },
			{ audio_enabled: true, video_enabled: true },
		);
		sfuClient.joinRoom
			.mockRejectedValueOnce(new Error("rebuild failed"))
			.mockResolvedValueOnce(undefined);

		const rebuild = connection.rejoinAfterSignalingReconnect();
		await vi.advanceTimersByTimeAsync(0);
		expect(connection.state).toBe("recovering");
		expect(sfuClient.joinRoom).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1000);
		await rebuild;

		expect(sfuClient.joinRoom).toHaveBeenCalledTimes(3);
		expect(sfuClient.disconnect).toHaveBeenCalledTimes(2);
		expect(sfuClient.connect).toHaveBeenCalledTimes(2);
		expect(connection.state).toBe("ready");
	});

	it("cancels full rebuild backoff during cleanup", async () => {
		vi.useFakeTimers();
		const { connection, sfuClient } = createConnection();
		await connection.joinRoom(
			{ name: "Me", userId: "me" },
			{ audio_enabled: true, video_enabled: true },
		);
		sfuClient.joinRoom.mockRejectedValue(new Error("rebuild failed"));

		const rebuild = connection.rejoinAfterSignalingReconnect();
		await vi.advanceTimersByTimeAsync(0);
		expect(connection.state).toBe("recovering");
		await connection.disconnect();
		await expect(rebuild).rejects.toMatchObject({ name: "AbortError" });
		await vi.advanceTimersByTimeAsync(60000);

		expect(sfuClient.joinRoom).toHaveBeenCalledTimes(2);
		expect(connection.state).toBe("stopped");
	});

	it("disconnects a fresh reconnect that completes after cleanup", async () => {
		const { connection, sfuClient } = createConnection();
		await connection.joinRoom(
			{ name: "Me", userId: "me" },
			{ audio_enabled: true, video_enabled: true },
		);
		const reconnect = deferred<void>();
		sfuClient.connect.mockReturnValueOnce(reconnect.promise);

		const rebuild = connection.rejoinAfterSignalingReconnect();
		await vi.waitFor(() => expect(sfuClient.connect).toHaveBeenCalledOnce());
		await connection.disconnect();
		reconnect.resolve();

		await expect(rebuild).rejects.toMatchObject({ name: "AbortError" });
		expect(sfuClient.disconnect).toHaveBeenCalledTimes(3);
		expect(connection.isConnected).toBe(false);
		expect(connection.state).toBe("stopped");
	});

	it("waits for a hidden tab to become visible before verifying recovery", async () => {
		let hidden = true;
		vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
		const { connection } = createConnection();
		await connection.joinRoom(
			{ name: "Me", userId: "me" },
			{ audio_enabled: true, video_enabled: true },
		);

		const recovery = connection.rejoinAfterSignalingReconnect();
		await vi.waitFor(() => expect(connection.state).toBe("recovering"));
		expect(connection.expectedMedia.waitForHealthy).not.toHaveBeenCalled();

		hidden = false;
		document.dispatchEvent(new Event("visibilitychange"));
		await recovery;

		expect(connection.expectedMedia.waitForHealthy).toHaveBeenCalledOnce();
		expect(connection.state).toBe("ready");
	});

	it("enters terminal failure after three fresh rebuild attempts", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0);
		const { connection, mediaManager, sfuClient, transportManager } =
			createConnection();
		await connection.joinRoom(
			{ name: "Me", userId: "me" },
			{ audio_enabled: true, video_enabled: true },
		);
		const exhausted = vi.fn();
		connection.eventHandlers.onRecoveryExhausted = exhausted;
		sfuClient.joinRoom.mockRejectedValue(new Error("rebuild failed"));
		const trigger = {
			scope: "publication" as const,
			direction: "send" as const,
			reason: "retry_limit",
		};

		await expect(connection.escalateRecovery(trigger)).resolves.toBe(false);

		expect(sfuClient.disconnect).toHaveBeenCalledTimes(4);
		expect(sfuClient.connect).toHaveBeenCalledTimes(3);
		expect(mediaManager.cleanup).toHaveBeenCalledOnce();
		expect(transportManager.cleanup).toHaveBeenCalledOnce();
		expect(connection.isConnected).toBe(false);
		expect(connection.state).toBe("failed");
		expect(exhausted).toHaveBeenCalledWith(trigger);
	});

	it("serializes concurrent lifecycle starts", async () => {
		const { connection } = createConnection();
		const publication = deferred<unknown>();
		const first = connection.start(
			startOptions({
				publishLocalMedia: () => publication.promise,
			}),
		);
		const second = connection.start(startOptions());
		await vi.waitFor(() => expect(connection.state).toBe("syncing"));

		publication.resolve(undefined);
		await expect(first).resolves.toBe("ready");
		await expect(second).rejects.toThrow(
			"Cannot start participant connection from ready",
		);
	});

	it("does not run a queued start after cleanup", async () => {
		const { connection, sfuClient } = createConnection({ e2eeRequired: true });
		const readiness = deferred<void>();
		const first = connection.start(
			startOptions({ waitForE2EEReady: () => readiness.promise }),
		);
		const queued = connection.start(startOptions());
		await vi.waitFor(() => expect(sfuClient.joinRoom).toHaveBeenCalledOnce());

		await connection.disconnect();
		await expect(first).rejects.toMatchObject({ name: "AbortError" });
		await expect(queued).rejects.toMatchObject({ name: "AbortError" });
		expect(sfuClient.connect).toHaveBeenCalledOnce();
		expect(connection.state).toBe("stopped");
	});

	it("waits for media cleanup before disconnecting transports and signaling", async () => {
		const { connection, mediaManager, sfuClient, transportManager } =
			createConnection();
		const mediaCleanup = deferred<void>();
		const mediaCleanupEntered = deferred<void>();
		mediaManager.cleanup.mockImplementation(() => {
			mediaCleanupEntered.resolve();
			return mediaCleanup.promise;
		});

		const disconnect = connection.disconnect();
		await mediaCleanupEntered.promise;

		expect(mediaManager.cleanup).toHaveBeenCalledOnce();
		expect(transportManager.cleanup).not.toHaveBeenCalled();
		expect(sfuClient.disconnect).not.toHaveBeenCalled();

		mediaCleanup.resolve();
		await disconnect;

		expect(transportManager.cleanup).toHaveBeenCalledOnce();
		expect(sfuClient.disconnect).toHaveBeenCalledOnce();
		expect(mediaManager.cleanup.mock.invocationCallOrder[0]).toBeLessThan(
			transportManager.cleanup.mock.invocationCallOrder[0],
		);
	});

	it("disconnects transports and signaling when media cleanup rejects", async () => {
		const { connection, mediaManager, sfuClient, transportManager } =
			createConnection();
		const cleanupError = new Error("media cleanup failed");
		mediaManager.cleanup.mockRejectedValue(cleanupError);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(connection.disconnect()).resolves.toBeUndefined();

		expect(transportManager.cleanup).toHaveBeenCalledOnce();
		expect(sfuClient.disconnect).toHaveBeenCalledOnce();
		expect(consoleError).toHaveBeenCalledWith(
			"Error disconnecting from SFU:",
			cleanupError,
		);
		expect(connection.state).toBe("stopped");
	});

	it("disconnects transports while a cancelled consumer request is still pending", async () => {
		const { connection, sfuClient, transportManager } = createConnection();
		const consumerRequest = deferred<{
			id: string;
			producerId: string;
			kind: string;
			close: ReturnType<typeof vi.fn>;
		}>();
		const createConsumer = vi.fn(() => consumerRequest.promise);
		Object.assign(transportManager, { createConsumer });
		const addConsumer = vi.fn();
		const mediaManager = new SFUMediaManager(
			{
				transportManager: transportManager as never,
				videoManager: {} as never,
				consumerManager: {
					addConsumer,
					getConsumersByParticipant: vi.fn(() => []),
				} as never,
				participantManager: {} as never,
			},
			() => "me",
		);
		Reflect.set(connection, "mediaManager", mediaManager);
		const handlerCleanup = vi.spyOn(mediaManager.mediaHandler, "cleanup");
		const subscription = mediaManager.subscribeToRemoteProducer({
			producerId: "producer-1",
			participantId: "remote-1",
			isScreen: false,
		});
		const observedSubscription = subscription.catch((error: unknown) => error);
		await vi.waitFor(() => expect(createConsumer).toHaveBeenCalledOnce());

		await connection.disconnect();

		expect(handlerCleanup).toHaveBeenCalledOnce();
		expect(transportManager.cleanup).toHaveBeenCalledOnce();
		expect(sfuClient.disconnect).toHaveBeenCalledOnce();
		consumerRequest.resolve({
			id: "late-consumer",
			producerId: "producer-1",
			kind: "video",
			close: vi.fn(),
		});
		await expect(observedSubscription).resolves.toMatchObject({
			message: "Consumer subscription was cancelled",
		});
		expect(addConsumer).not.toHaveBeenCalled();
	});
});
