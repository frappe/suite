import { afterEach, describe, expect, it, vi } from "vitest";
import { ParticipantManager } from "../../media/ParticipantManager";
import {
	ParticipantConnection,
	type ParticipantConnectionStartOptions,
} from "../ParticipantConnection";

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

	it("reports publication failure without failing startup", async () => {
		const { connection } = createConnection();
		const publicationError = new Error("camera failed");
		const report = vi.fn();
		connection.eventHandlers.onInitialPublicationError = report;

		await expect(
			connection.start(
				startOptions({
					publishLocalMedia: vi.fn().mockRejectedValue(publicationError),
				}),
			),
		).resolves.toBe("ready");
		expect(report).toHaveBeenCalledWith(publicationError);
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
		sfuClient.getRoomParticipants.mockReturnValueOnce(snapshot.promise);
		const start = connection.start(startOptions());
		await vi.waitFor(() =>
			expect(sfuClient.getRoomParticipants).toHaveBeenCalled(),
		);

		await connection.disconnect();
		await expect(start).rejects.toMatchObject({ name: "AbortError" });
		snapshot.resolve([{ participantId: "late", user_id: "late" }]);
		await Promise.resolve();
		expect(participantManager.hasParticipant("late")).toBe(false);
		expect(connection.state).toBe("stopped");
	});

	it("retries a failed full rebuild with increasing delay", async () => {
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
		expect(connection.state).toBe("degraded");
		expect(sfuClient.joinRoom).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(999);
		expect(sfuClient.joinRoom).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		await rebuild;

		expect(sfuClient.joinRoom).toHaveBeenCalledTimes(3);
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
		expect(connection.state).toBe("degraded");
		await connection.disconnect();
		await expect(rebuild).rejects.toMatchObject({ name: "AbortError" });
		await vi.advanceTimersByTimeAsync(60000);

		expect(sfuClient.joinRoom).toHaveBeenCalledTimes(2);
		expect(connection.state).toBe("stopped");
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
});
