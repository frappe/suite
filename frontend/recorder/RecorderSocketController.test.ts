import { describe, expect, it, vi } from "vitest";
import type {
	RecorderStageProjectionEvent,
	RecorderStageSnapshot,
} from "../../suite/meet/types";
import type { Participant } from "../src/apps/meet/utils/media/ParticipantManager";
import type {
	RecorderParticipantData,
	RecorderParticipantUpdate,
} from "./protocol";
import {
	RecorderSocketController,
	type RecorderState,
	trustedAvatar,
} from "./RecorderSocketController";
import {
	CaptureCommandSupersededError,
	type RecorderConfig,
	type RecordingChallenge,
} from "./rendererBridge";

vi.stubGlobal("MediaStream", class MediaStream {});

const timestamp = (seconds: number) =>
	`2026-08-30T12:00:${String(seconds).padStart(2, "0")}.000Z`;
const config: RecorderConfig = {
	job: "j",
	grant: "g",
	meetingId: "r",
	sfuOrigin: "https://sfu.test",
	frappeOrigin: "https://frappe.test",
	socketPath: "/socket.io",
	acceptedAt: timestamp(0),
};
const challenge: RecordingChallenge = {
	protocol_version: 1,
	jti: "jti",
	socket_id: "socket",
	nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	issued_at: 1,
	expires_at: 11,
};
const participant = {
	participant_id: "alice",
	name: "Alice",
	audio_enabled: true,
	video_enabled: false,
};
const snapshot = (
	overrides: Partial<RecorderStageSnapshot> = {},
): RecorderStageSnapshot => ({
	protocol_version: 1,
	room_id: "site::r",
	cursor: 0,
	observed_at: timestamp(0),
	participants: [],
	producers: [],
	raised_hands: {},
	active_speaker_ids: [],
	...overrides,
});
const projectionEvent = (
	cursor: number,
	payload: RecorderStageProjectionEvent["payload"],
	observedAt = timestamp(cursor),
): RecorderStageProjectionEvent => ({
	protocol_version: 1,
	room_id: "site::r",
	cursor,
	observed_at: observedAt,
	payload,
});

interface ConsumerFixture {
	id: string;
	producerId: string;
	participantId: string;
	kind: "audio" | "video";
	isScreen: boolean;
}

const participantFixture = (data: RecorderParticipantData): Participant => ({
	user_id: data.participantId || data.user_id || "",
	user_name: data.userData?.name || data.user_name || "",
	avatar: data.userData?.avatar || data.avatar || null,
	initials: "",
	audio_enabled: data.userData?.audio_enabled ?? data.audio_enabled,
	video_enabled: data.userData?.video_enabled ?? data.video_enabled,
	participantId: data.participantId,
	userData: data.userData,
});

function harness(
	options: {
		snapshot?: unknown | unknown[];
		state?: RecorderState;
		noConsumer?: boolean;
		attachment?: (consumer: ConsumerFixture) => Promise<void>;
		onSnapshotRequest?: (emitProjection: (value: unknown) => void) => void;
	} = {},
) {
	const calls: string[] = [];
	const socketHandlers = new Map<string, (...args: unknown[]) => void>();
	const sfuHandlers = new Map<string, (...args: unknown[]) => void>();
	let consumerHandlers: Record<string, (...args: never[]) => void> = {};
	let participantHandlers: Record<string, (...args: never[]) => void> = {};
	let mediaHandlers: Record<string, (...args: never[]) => void> = {};
	let snapshotRequest = 0;
	const participants = new Map<string, Participant>();
	const consumers = new Map<string, ConsumerFixture>();
	const emitProjection = (value: unknown) =>
		sfuHandlers.get("recording:projection")?.(value);
	const channel = {
		on: vi.fn((event: string, handler: (...args: unknown[]) => void) =>
			socketHandlers.set(event, handler),
		),
		connect: vi.fn(async () => {
			calls.push("connect");
			socketHandlers.get("recording:challenge")?.(challenge);
		}),
		emit: vi.fn(
			(event: string, _data: unknown, callback?: (value: unknown) => void) => {
				calls.push(event);
				if (event === "recording:proof")
					callback?.({ protocol_version: 1, success: true });
				else if (event === "recording:get_projection_snapshot") {
					const configured = Array.isArray(options.snapshot)
						? options.snapshot[Math.min(snapshotRequest, options.snapshot.length - 1)]
						: options.snapshot;
					snapshotRequest += 1;
					options.onSnapshotRequest?.(emitProjection);
					callback?.({
						success: true,
						snapshot: configured ?? snapshot(),
					});
				} else callback?.({ success: true });
			},
		),
		disconnect: vi.fn(),
		off: vi.fn(),
		isConnected: vi.fn(),
		id: vi.fn(),
		updateAuth: vi.fn(),
	};
	const bridge = {
		sign: vi.fn(async () => "signature"),
		reportCaptureReady: vi.fn(),
		reportInterruption: vi.fn(),
		reportProofComplete: vi.fn(),
		reportJoinComplete: vi.fn(),
		reportFailure: vi.fn(),
	};
	const removeConsumer = vi.fn((id: string) => {
		const consumer = consumers.get(id);
		if (!consumer) return;
		consumers.delete(id);
		consumerHandlers.onConsumerRemoved?.(id as never, consumer as never);
	});
	const dependencies = {
			sfuClient: {
			connected: false,
			connectionDetails: {},
				on: vi.fn((event: string, handler: (...args: unknown[]) => void) =>
					sfuHandlers.set(event, handler),
				),
				off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
					if (sfuHandlers.get(event) === handler) sfuHandlers.delete(event);
				}),
			registerEventHandlers: vi.fn(),
			disconnect: vi.fn(),
		},
		transportManager: {
			initializeDevice: vi.fn(async () => calls.push("device")),
			createReceiveTransport: vi.fn(async () => calls.push("recv")),
			setEventHandlers: vi.fn(),
			cleanup: vi.fn(),
		},
		consumerManager: {
			setEventHandlers: vi.fn((handlers: typeof consumerHandlers) => {
				consumerHandlers = handlers;
			}),
			getConsumersByParticipant: vi.fn((id: string) =>
				[...consumers.values()].filter((item) => item.participantId === id),
			),
			getScreenShareConsumers: vi.fn(() =>
				[...consumers.values()].filter((item) => item.isScreen),
			),
			cleanupParticipantConsumers: vi.fn((id: string) => {
				for (const consumer of [...consumers.values()])
					if (consumer.participantId === id) removeConsumer(consumer.id);
			}),
			clear: vi.fn(() => {
				for (const consumer of [...consumers.values()])
					removeConsumer(consumer.id);
			}),
			removeConsumer,
		},
		participantManager: {
			setEventHandlers: vi.fn((handlers: typeof participantHandlers) => {
				participantHandlers = handlers;
			}),
			syncParticipants: vi.fn((values: RecorderParticipantData[]) => {
				for (const value of values) {
					const item = participantFixture(value);
					participants.set(item.user_id, item);
					participantHandlers.onParticipantAdded?.(item as never);
				}
			}),
			addParticipant: vi.fn((value: RecorderParticipantData) => {
				const item = participantFixture(value);
				participants.set(item.user_id, item);
				participantHandlers.onParticipantAdded?.(item as never);
				return item;
			}),
			removeParticipant: vi.fn((id: string) => {
				const removed = participants.delete(id);
				if (removed) participantHandlers.onParticipantRemoved?.(id as never);
				return removed;
			}),
			updateMediaState: vi.fn(),
			updateParticipant: vi.fn(
				(id: string, updates: RecorderParticipantUpdate) => {
					const current = participants.get(id);
					if (!current) return null;
					const updated = { ...current, ...updates } as Participant;
					participants.set(id, updated);
					participantHandlers.onParticipantUpdated?.(
						id as never,
						updated as never,
						updates as never,
					);
					return updated;
				},
			),
			getAllParticipants: vi.fn(() => [...participants.values()]),
		},
		videoManager: {
			removeVideoElement: vi.fn(),
			cancelDeferredAttachment: vi.fn(),
			cleanup: vi.fn(),
		},
		mediaManager: {
			setEventHandlers: vi.fn((handlers: typeof mediaHandlers) => {
				mediaHandlers = handlers;
			}),
			handleNewConsumer: vi.fn(async (consumer: ConsumerFixture) => {
				await options.attachment?.(consumer);
				if (consumer.isScreen)
					mediaHandlers.onScreenShareStarted?.({
						participantId: consumer.participantId,
						stream: new MediaStream(),
						consumer,
					} as never);
			}),
			handleConsumerLost: vi.fn(),
			subscribeToRemoteProducer: vi.fn(
				async (producer: {
					producerId: string;
					participantId: string;
					isScreen: boolean;
				}) => {
					if (options.noConsumer) return null;
					const consumer: ConsumerFixture = {
						id: `c-${producer.producerId}`,
						producerId: producer.producerId,
						participantId: producer.participantId,
						kind: producer.isScreen ? "video" : "audio",
						isScreen: producer.isScreen,
					};
					consumers.set(consumer.id, consumer);
					consumerHandlers.onConsumerAdded?.(consumer as never);
					return consumer;
				},
			),
			cancelPendingSubscriptions: vi.fn(async () => undefined),
			cleanup: vi.fn(),
		},
	};
	const controller = new RecorderSocketController(
		bridge as never,
		channel,
		options.state,
		dependencies as never,
	);
	return {
		bridge,
		calls,
		channel,
		consumers,
		controller,
		dependencies,
		emitProjection,
		participants,
		sfuHandlers,
	};
}

describe("RecorderSocketController", () => {
	it("uses one projection snapshot after the receive transport", async () => {
		const frameCommitted = vi.fn(async () => undefined);
		const h = harness({ state: { frameCommitted } });
		await h.controller.connect(config);
		expect(h.calls).toEqual([
			"connect",
			"recording:proof",
			"recording:join",
			"device",
			"recv",
			"recording:get_projection_snapshot",
		]);
		expect(h.controller.ready.value).toBe(true);
		expect(frameCommitted).toHaveBeenCalledOnce();
		expect(h.bridge.reportCaptureReady).toHaveBeenCalledOnce();
	});

	it("binds the first projection snapshot to the configured Meet Room", async () => {
		const h = harness({ snapshot: snapshot({ room_id: "site::other" }) });
		await expect(h.controller.connect(config)).rejects.toThrow(
			"Projection meeting mismatch",
		);
		expect(h.bridge.reportCaptureReady).not.toHaveBeenCalled();
	});

	it("attaches producers created during the initial committed-frame window", async () => {
		let h!: ReturnType<typeof harness>;
		const frameCommitted = vi.fn(async () => {
			if (frameCommitted.mock.calls.length !== 1) return;
			h.emitProjection(
				projectionEvent(1, {
					type: "producer_created",
					producer: {
						producer_id: "late",
						participant_id: "alice",
						kind: "audio",
						paused: false,
						is_screen: false,
						observed_at: timestamp(1),
					},
				}),
			);
		});
		h = harness({
			state: { frameCommitted },
			snapshot: snapshot({ participants: [participant] }),
		});
		await h.controller.connect(config);
		expect(frameCommitted).toHaveBeenCalledTimes(2);
		expect(h.consumers.has("c-late")).toBe(true);
		expect(h.bridge.reportCaptureReady).toHaveBeenCalledOnce();
	});

	it("recommits for persistent frame races without starving on transient events", async () => {
		let h!: ReturnType<typeof harness>;
		const frameCommitted = vi.fn(async () => {
			if (frameCommitted.mock.calls.length === 1) {
				h.emitProjection(
					projectionEvent(1, {
						type: "participant_updated",
						participant: { ...participant, name: "Alice Updated" },
					}),
				);
			} else if (frameCommitted.mock.calls.length === 2) {
				h.emitProjection(
					projectionEvent(2, {
						type: "hand_raised",
						participant_id: "alice",
						raised: true,
					}),
				);
			} else if (frameCommitted.mock.calls.length === 3) {
				h.emitProjection(
					projectionEvent(3, {
						type: "active_speaker",
						participant_ids: ["alice"],
					}),
				);
			} else {
				h.emitProjection(
					projectionEvent(4, {
						type: "chat_message",
						message_id: "during-commit",
						message: "transient",
						from_user: "alice",
						from_name: "Alice",
					}),
				);
			}
		});
		h = harness({
			state: { frameCommitted },
			snapshot: snapshot({ participants: [participant] }),
		});

		await h.controller.connect(config);

		expect(frameCommitted).toHaveBeenCalledTimes(4);
		expect(h.bridge.reportCaptureReady).toHaveBeenCalledOnce();
	});

	it("reconciles snapshot races and ignores duplicate cursors", async () => {
		const joined = projectionEvent(1, {
			type: "participant_joined",
			participant,
		});
		const producer = projectionEvent(2, {
			type: "producer_created",
			producer: {
				producer_id: "p1",
				participant_id: "alice",
				kind: "audio",
				paused: false,
				is_screen: false,
				observed_at: timestamp(2),
			},
		});
		const h = harness({
			onSnapshotRequest: (emit) => {
				emit(producer);
				emit(joined);
				emit(producer);
			},
		});
		await h.controller.connect(config);
		expect(h.participants.has("alice")).toBe(true);
		expect(
			h.dependencies.mediaManager.subscribeToRemoteProducer,
		).toHaveBeenCalledOnce();
	});

	it.each([
		projectionEvent(2, { type: "active_speaker", participant_ids: [] }),
		{
			...projectionEvent(1, { type: "active_speaker", participant_ids: [] }),
			extra: true,
		},
		{
			...projectionEvent(1, { type: "active_speaker", participant_ids: [] }),
			room_id: "other",
		},
	])(
		"interrupts and cleans up for a gap, invalid event, or room mismatch",
		async (event) => {
			const h = harness();
			await h.controller.connect(config);
			h.emitProjection(event);
			expect(h.bridge.reportInterruption).toHaveBeenCalledWith(
				"projection_invalid",
				expect.any(String),
			);
			expect(h.controller.ready.value).toBe(false);
			expect(h.dependencies.sfuClient.disconnect).toHaveBeenCalled();
		},
	);

	it("fails closed on an invalid snapshot without reporting configuration failure", async () => {
		const h = harness({ snapshot: { ...snapshot(), cursor: -1 } });
		await expect(h.controller.connect(config)).rejects.toThrow(
			"Invalid recorder projection snapshot",
		);
		expect(h.bridge.reportInterruption).toHaveBeenCalledWith(
			"projection_invalid",
			expect.any(String),
		);
		expect(h.bridge.reportFailure).not.toHaveBeenCalled();
	});

	it("uses the producer observation time for screen state", async () => {
		const screenStarted = vi.fn();
		const h = harness({
			state: { screenStarted },
			snapshot: snapshot({
				observed_at: timestamp(7),
				participants: [participant],
				producers: [
					{
						producer_id: "screen",
						participant_id: "alice",
						kind: "video",
						paused: false,
						is_screen: true,
						observed_at: timestamp(7),
					},
				],
			}),
		});
		await h.controller.connect(config);
		expect(screenStarted).toHaveBeenCalledWith(
			expect.objectContaining({ startedAt: Date.parse(timestamp(7)) }),
		);
	});

	it("fails readiness when required media does not produce a consumer", async () => {
		const h = harness({
			noConsumer: true,
			snapshot: snapshot({
				observed_at: timestamp(1),
				participants: [participant],
				producers: [
					{
						producer_id: "p1",
						participant_id: "alice",
						kind: "audio",
						paused: false,
						is_screen: false,
						observed_at: timestamp(1),
					},
				],
			}),
		});
		await expect(h.controller.connect(config)).rejects.toThrow(
			"did not create a consumer",
		);
		expect(h.bridge.reportCaptureReady).not.toHaveBeenCalled();
	});

	it("retains persistent state while capture preparation clears transients", async () => {
		const transientsCleared = vi.fn();
		const frameCommitted = vi.fn(async () => undefined);
		const h = harness({
			state: { transientsCleared, frameCommitted },
			snapshot: snapshot({ participants: [participant] }),
		});
		await h.controller.connect(config);
		frameCommitted.mockClear();
		await h.controller.prepareCapture(0);
		expect(transientsCleared).toHaveBeenCalledOnce();
		expect(frameCommitted).toHaveBeenCalledOnce();
		expect(h.participants.has("alice")).toBe(true);
	});

	it("applies participant updates without adding a duplicate participant", async () => {
		const participantUpdated = vi.fn();
		const h = harness({
			state: { participantUpdated },
			snapshot: snapshot({ participants: [participant] }),
		});
		await h.controller.connect(config);
		h.emitProjection(
			projectionEvent(1, {
				type: "participant_updated",
				participant: {
					...participant,
					name: "Alice Updated",
					avatar: "/files/updated.png",
					audio_enabled: false,
					video_enabled: true,
				},
			}),
		);
		expect(h.dependencies.participantManager.addParticipant).not.toHaveBeenCalled();
		expect(participantUpdated).toHaveBeenCalledWith(
			"alice",
			expect.objectContaining({
				user_name: "Alice Updated",
				audio_enabled: false,
				video_enabled: true,
			}),
		);
	});

	it("reconciles and attaches a changed producer set before a second epoch frame", async () => {
		let release!: () => void;
		const delayed = new Promise<void>((resolve) => (release = resolve));
		const frameCommitted = vi.fn(async () => undefined);
		const firstProducer = {
			producer_id: "p1", participant_id: "alice", kind: "audio" as const,
			paused: false, is_screen: false, observed_at: timestamp(0),
		};
		const secondProducer = { ...firstProducer, producer_id: "p2", observed_at: timestamp(2) };
		const h = harness({
			state: { frameCommitted },
			attachment: (consumer) => consumer.producerId === "p2" ? delayed : Promise.resolve(),
			snapshot: [
				snapshot({ participants: [participant], producers: [firstProducer] }),
				snapshot({ participants: [participant], producers: [firstProducer] }),
				snapshot({ cursor: 2, observed_at: timestamp(2), participants: [participant], producers: [secondProducer] }),
			],
		});
		await h.controller.connect(config);
		frameCommitted.mockClear();
		await h.controller.prepareCapture(0);
		await h.controller.captureStarted(0, timestamp(1));
		const recovery = h.controller.prepareCapture(1);
		await vi.waitFor(() =>
			expect(h.dependencies.mediaManager.subscribeToRemoteProducer).toHaveBeenCalledWith(
				expect.objectContaining({ producerId: "p2" }),
			),
		);
		expect(frameCommitted).toHaveBeenCalledTimes(1);
		expect(h.consumers.has("c-p1")).toBe(false);
		release();
		await recovery;
		expect(frameCommitted).toHaveBeenCalledTimes(2);
		expect(h.consumers.has("c-p2")).toBe(true);
	});

	it("rejects a recovery prepare when the replacement attachment fails", async () => {
		const producer = {
			producer_id: "p2", participant_id: "alice", kind: "audio" as const,
			paused: false, is_screen: false, observed_at: timestamp(2),
		};
		const h = harness({
			attachment: (consumer) => consumer.producerId === "p2"
				? Promise.reject(new Error("attachment failed"))
				: Promise.resolve(),
			snapshot: [
				snapshot({ participants: [participant] }),
				snapshot({ participants: [participant] }),
				snapshot({ cursor: 2, observed_at: timestamp(2), participants: [participant], producers: [producer] }),
			],
		});
		await h.controller.connect(config);
		await h.controller.prepareCapture(0);
		await h.controller.captureStarted(0, timestamp(1));
		await expect(h.controller.prepareCapture(1)).rejects.toThrow();
		expect(h.bridge.reportInterruption).toHaveBeenCalledWith(
			"media_attachment_failed",
			"attachment failed",
		);
	});

	it("excludes startup transients and filters buffered events at capture start", async () => {
		const chatReceived = vi.fn();
		const reactionReceived = vi.fn();
		const captureStarted = vi.fn();
		const h = harness({
			state: { chatReceived, reactionReceived, captureStarted },
			snapshot: [
				snapshot(),
				snapshot({ cursor: 1, observed_at: timestamp(1) }),
			],
		});
		await h.controller.connect(config);
		h.emitProjection(
			projectionEvent(1, {
				type: "chat_message",
				message_id: "startup",
				message: "startup",
				from_user: "alice",
				from_name: "Alice",
			}),
		);
		await h.controller.prepareCapture(0);
		h.emitProjection(
			projectionEvent(
				2,
				{ type: "reaction", from_user: "alice", reaction: "+1" },
				timestamp(4),
			),
		);
		h.emitProjection(
			projectionEvent(
				3,
				{
					type: "chat_message",
					message_id: "kept",
					message: "kept",
					from_user: "alice",
					from_name: "Alice",
				},
				timestamp(5),
			),
		);
		await h.controller.captureStarted(0, timestamp(5));
		expect(captureStarted).toHaveBeenCalledWith(timestamp(5));
		expect(reactionReceived).not.toHaveBeenCalled();
		expect(chatReceived).toHaveBeenCalledWith(
			expect.objectContaining({ id: "kept", text: "kept" }),
		);
		h.emitProjection(
			projectionEvent(
				4,
				{ type: "reaction", from_user: "alice", reaction: "wave" },
				timestamp(6),
			),
		);
		expect(reactionReceived).toHaveBeenCalledWith("alice", "wave");
	});

	it("makes exact capture repeats idempotent and rejects conflicts", async () => {
		const transientsCleared = vi.fn();
		const captureStarted = vi.fn();
		const h = harness({ state: { transientsCleared, captureStarted } });
		await h.controller.connect(config);
		await h.controller.prepareCapture(2);
		await h.controller.prepareCapture(2);
		await h.controller.captureStarted(2, timestamp(5));
		await h.controller.captureStarted(2, timestamp(5));
		expect(transientsCleared).toHaveBeenCalledOnce();
		expect(captureStarted).toHaveBeenCalledOnce();
		await expect(h.controller.prepareCapture(1)).rejects.toThrow("Stale");
		await expect(h.controller.captureStarted(2, timestamp(6))).rejects.toThrow(
			"Conflicting",
		);
		await h.controller.prepareCapture(3);
		await expect(h.controller.prepareCapture(4)).resolves.toBeUndefined();
	});

	it("lets a later epoch supersede a prepared epoch whose start command was lost", async () => {
		const transientsCleared = vi.fn();
		const h = harness({ state: { transientsCleared } });
		await h.controller.connect(config);

		await h.controller.prepareCapture(0);
		await h.controller.prepareCapture(1);
		await h.controller.captureStarted(1, timestamp(2));

		expect(transientsCleared).toHaveBeenCalledTimes(2);
	});

	it("prevents an in-flight prepare from mutating after a newer epoch supersedes it", async () => {
		let releaseOldFrame!: () => void;
		const oldFrame = new Promise<void>((resolve) => (releaseOldFrame = resolve));
		const frameCommitted = vi
			.fn<() => Promise<void>>()
			.mockResolvedValueOnce(undefined)
			.mockReturnValueOnce(oldFrame)
			.mockResolvedValue(undefined);
		const captureStarted = vi.fn();
		const h = harness({ state: { frameCommitted, captureStarted } });
		await h.controller.connect(config);

		const oldPrepare = h.controller.prepareCapture(0);
		await vi.waitFor(() => expect(frameCommitted).toHaveBeenCalledTimes(2));
		await expect(h.controller.prepareCapture(1)).resolves.toBeUndefined();
		releaseOldFrame();
		await expect(oldPrepare).rejects.toBeInstanceOf(CaptureCommandSupersededError);
		await h.controller.captureStarted(1, timestamp(2));
		expect(captureStarted).toHaveBeenCalledOnce();
	});

	it("allows exact retries after failed prepare and start attempts", async () => {
		const frameCommitted = vi
			.fn<() => Promise<void>>()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("frame failed"))
			.mockResolvedValue(undefined);
		const captureStarted = vi
			.fn<(timestamp: string) => void>()
			.mockImplementationOnce(() => {
				throw new Error("render start failed");
			});
		const h = harness({ state: { frameCommitted, captureStarted } });
		await h.controller.connect(config);
		await expect(h.controller.prepareCapture(0)).rejects.toThrow("frame failed");
		await expect(h.controller.prepareCapture(0)).resolves.toBeUndefined();
		await expect(h.controller.captureStarted(0, timestamp(1))).rejects.toThrow(
			"render start failed",
		);
		await expect(
			h.controller.captureStarted(0, timestamp(1)),
		).resolves.toBeUndefined();
		expect(frameCommitted).toHaveBeenCalledTimes(3);
		expect(captureStarted).toHaveBeenCalledTimes(2);
	});

	it("rejects capture commands after disconnect or projection failure", async () => {
		const disconnected = harness();
		await disconnected.controller.connect(config);
		disconnected.controller.disconnect();
		await expect(disconnected.controller.prepareCapture(0)).rejects.toThrow(
			"not ready",
		);
		await expect(
			disconnected.controller.captureStarted(0, timestamp(1)),
		).rejects.toThrow("not ready");

		const failed = harness();
		await failed.controller.connect(config);
		failed.emitProjection(
			projectionEvent(2, { type: "active_speaker", participant_ids: [] }),
		);
		await expect(failed.controller.prepareCapture(0)).rejects.toThrow();
	});

	it("fails closed locally when a capture command is rejected", async () => {
		const h = harness();
		await h.controller.connect(config);
		h.controller.failCaptureCommand("invalid command");
		expect(h.controller.ready.value).toBe(false);
		expect(h.bridge.reportInterruption).toHaveBeenCalledWith(
			"projection_invalid",
			"invalid command",
		);
		expect(h.dependencies.sfuClient.disconnect).toHaveBeenCalled();
	});

	it("retains consumer_closed transport cleanup", async () => {
		const h = harness();
		await h.controller.connect(config);
		h.sfuHandlers.get("consumer_closed")?.({ consumerId: "c1" });
		expect(h.dependencies.consumerManager.removeConsumer).toHaveBeenCalledWith(
			"c1",
		);
	});

	it("does not replay persistent events after syncing reconciled state", async () => {
		const updated = { ...participant, name: "Updated" };
		const h = harness({
			snapshot: [
				snapshot({ participants: [participant] }),
				snapshot({ participants: [participant] }),
			],
			onSnapshotRequest: (emit) => {
				if (h.controller.ready.value)
					emit(
						projectionEvent(1, {
							type: "participant_updated",
							participant: updated,
						}),
					);
			},
		});
		await h.controller.connect(config);
		h.dependencies.participantManager.updateParticipant.mockClear();
		await h.controller.prepareCapture(0);
		expect(
			h.dependencies.participantManager.updateParticipant,
		).not.toHaveBeenCalled();
	});

	it("removes recorder listeners and manager handlers during cleanup", async () => {
		const h = harness();
		await h.controller.connect(config);
		h.controller.disconnect();
		expect(h.channel.off).toHaveBeenCalledWith(
			"recording:challenge",
			expect.any(Function),
		);
		expect(h.dependencies.sfuClient.off).toHaveBeenCalledWith(
			"recording:projection",
			expect.any(Function),
		);
		expect(h.sfuHandlers.size).toBe(0);
	});

	it("rewrites only public avatars on the trusted Frappe origin", () => {
		expect(trustedAvatar("/files/avatar.png", "https://frappe.test")).toBe(
			"https://frappe.test/files/avatar.png",
		);
		for (const value of [
			"https://evil.test/a.png",
			"//evil.test/a.png",
			"/private/files/a.png",
			"data:image/png,x",
		])
			expect(trustedAvatar(value, "https://frappe.test")).toBeNull();
	});
});
