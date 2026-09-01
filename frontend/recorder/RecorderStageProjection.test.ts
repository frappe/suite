import { describe, expect, it } from "vitest";
import type {
	RecorderStageProjectionEvent,
	RecorderStageSnapshot,
} from "../../suite/meet/types";
import { RecorderStageProjection } from "./RecorderStageProjection";

const at = (second: number) =>
	`2026-08-30T12:00:${String(second).padStart(2, "0")}.000Z`;
const snapshot = (cursor = 0): RecorderStageSnapshot => ({
	protocol_version: 1,
	room_id: "site::room",
	cursor,
	observed_at: at(0),
	participants: [],
	producers: [],
	raised_hands: {},
	active_speaker_ids: [],
});
const event = (
	cursor: number,
	payload: RecorderStageProjectionEvent["payload"] = {
		type: "active_speaker",
		participant_ids: [],
	},
): RecorderStageProjectionEvent => ({
	protocol_version: 1,
	room_id: "site::room",
	cursor,
	observed_at: at(cursor),
	payload,
});

describe("RecorderStageProjection", () => {
	it("buffers before snapshot, discards old events, and replays contiguously", () => {
		const projection = new RecorderStageProjection();
		expect(projection.applyEvent(event(3))).toEqual([]);
		expect(projection.applyEvent(event(1))).toEqual([]);
		expect(projection.applyEvent(event(2))).toEqual([]);
		expect(projection.initialize(snapshot(1))).toEqual([event(2), event(3)]);
		expect(projection.cursor).toBe(3);
	});

	it("applies duplicates idempotently and throws on gaps", () => {
		const projection = new RecorderStageProjection();
		projection.initialize(snapshot());
		expect(projection.applyEvent(event(1))).toEqual([event(1)]);
		expect(projection.applyEvent(event(1))).toEqual([]);
		expect(() => projection.applyEvent(event(3))).toThrow("cursor gap");
	});

	it("retains projected participant, producer, hand, and speaker state", () => {
		const projection = new RecorderStageProjection();
		projection.initialize(snapshot());
		projection.applyEvent(
			event(1, {
				type: "participant_joined",
				participant: {
					participant_id: "alice",
					name: "Alice",
					audio_enabled: true,
					video_enabled: false,
				},
			}),
		);
		projection.applyEvent(
			event(2, {
				type: "producer_created",
				producer: {
					producer_id: "p1",
					participant_id: "alice",
					kind: "audio",
					paused: false,
					is_screen: false,
					observed_at: at(2),
				},
			}),
		);
		projection.applyEvent(
			event(3, { type: "producer_updated", producer_id: "p1", paused: true }),
		);
		projection.applyEvent(
			event(4, { type: "hand_raised", participant_id: "alice", raised: true }),
		);
		projection.applyEvent(
			event(5, { type: "active_speaker", participant_ids: ["alice"] }),
		);
		expect(projection.participants.has("alice")).toBe(true);
		expect(projection.producers.get("p1")).toMatchObject({
			paused: true,
			observed_at: at(3),
		});
		expect(projection.raisedHands.get("alice")).toBe(at(4));
		expect(projection.activeSpeakerIds).toEqual(["alice"]);
	});

	it("throws on room mismatch and repeated initialization", () => {
		const projection = new RecorderStageProjection();
		projection.initialize(snapshot());
		expect(() => projection.initialize(snapshot())).toThrow(
			"already initialized",
		);
		expect(() =>
			projection.applyEvent({ ...event(1), room_id: "other" }),
		).toThrow("room mismatch");
	});

	it("adopts the scoped snapshot room and validates pre-snapshot events against it", () => {
		const projection = new RecorderStageProjection();
		projection.applyEvent(event(1));
		expect(projection.initialize(snapshot())).toEqual([event(1)]);
		expect(projection.roomId).toBe("site::room");

		const mismatch = new RecorderStageProjection();
		mismatch.applyEvent({ ...event(1), room_id: "other::room" });
		expect(() => mismatch.initialize(snapshot())).toThrow("room mismatch");
	});

	it("binds the first snapshot to the configured meeting id", () => {
		expect(() =>
			new RecorderStageProjection("other").initialize(snapshot()),
		).toThrow("meeting mismatch");
		expect(() =>
			new RecorderStageProjection("room").initialize(snapshot()),
		).not.toThrow();
	});

	it("rejects conflicting duplicates, regressions, and invalid relationships", () => {
		const projection = new RecorderStageProjection();
		projection.initialize(snapshot());
		projection.applyEvent(
			event(1, { type: "participant_joined", participant: {
				participant_id: "alice", name: "Alice", audio_enabled: true, video_enabled: true,
			} }),
		);
		expect(() => projection.applyEvent({
			...event(1, { type: "participant_left", participant_id: "alice" }),
		})).toThrow("Conflicting");
		expect(() => projection.applyEvent(event(2, {
			type: "producer_created",
			producer: { producer_id: "orphan", participant_id: "bob", kind: "audio", paused: false, is_screen: false, observed_at: at(2) },
		}))).toThrow("absent");
	});
});
