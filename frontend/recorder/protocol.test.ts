import { describe, expect, it } from "vitest";
import {
	parseRecorderStageProjectionEvent,
	parseRecorderStageSnapshot,
	parseRecordingProjectionSnapshotResponse,
	parseRecordingChallenge,
	parseRecordingProofResponse,
} from "./protocol";

const observedAt = "2026-08-30T12:00:00.000Z";
const stageSnapshot = {
	protocol_version: 1,
	room_id: "room",
	cursor: 0,
	observed_at: observedAt,
	participants: [
		{
			participant_id: "alice",
			name: "Alice",
			audio_enabled: true,
			video_enabled: false,
		},
	],
	producers: [
		{
			producer_id: "producer",
			participant_id: "alice",
			kind: "video",
			paused: false,
			is_screen: true,
			observed_at: observedAt,
		},
	],
	raised_hands: { alice: observedAt },
	active_speaker_ids: ["alice"],
};
const stageEvent = {
	protocol_version: 1,
	room_id: "room",
	cursor: 1,
	observed_at: observedAt,
	payload: {
		type: "chat_message",
		message_id: "message",
		message: "Hello",
		from_user: "alice",
		from_name: "Alice",
	},
};

const challenge = {
	protocol_version: 1,
	jti: "grant-1",
	socket_id: "socket-1",
	nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	issued_at: 1_700_000_000,
	expires_at: 1_700_000_010,
};

describe("recording proof protocol", () => {
	it("accepts the exact version 1 challenge", () => {
		expect(parseRecordingChallenge(challenge)).toEqual(challenge);
	});

	it.each([
		{ ...challenge, protocol_version: 2 },
		{ ...challenge, protocol_version: 1.5 },
		{ ...challenge, issued_at: 1.5 },
		{ ...challenge, extra: true },
		(({ protocol_version: _, ...value }) => value)(challenge),
	])("rejects a non-contract challenge %#", (value) => {
		expect(parseRecordingChallenge(value)).toBeNull();
	});

	it.each([
		{ protocol_version: 1, success: true },
		{
			protocol_version: 1,
			success: false,
			reason_code: "invalid_proof",
			diagnostic: "Invalid proof",
		},
	])("accepts the exact proof response %#", (value) => {
		expect(parseRecordingProofResponse(value)).toEqual(value);
	});

	it.each([
		{ success: true },
		{ protocol_version: 2, success: true },
		{ protocol_version: 1, success: true, error: "unexpected" },
		{ protocol_version: 1, success: false },
		{ protocol_version: 1, success: false, error: "", extra: true },
	])("rejects a non-contract proof response %#", (value) => {
		expect(parseRecordingProofResponse(value)).toBeNull();
	});
});

describe("recorder stage projection protocol", () => {
	it("accepts exact snapshots, responses, and finite payload events", () => {
		expect(parseRecorderStageSnapshot(stageSnapshot)).toEqual(stageSnapshot);
		expect(
			parseRecordingProjectionSnapshotResponse({
				success: true,
				snapshot: stageSnapshot,
			}),
		).toEqual({ success: true, snapshot: stageSnapshot });
		expect(parseRecorderStageProjectionEvent(stageEvent)).toEqual(stageEvent);
	});

	it.each([
		{ ...stageSnapshot, protocol_version: 2 },
		{ ...stageSnapshot, cursor: -1 },
		{ ...stageSnapshot, cursor: 1.5 },
		{ ...stageSnapshot, observed_at: "2026-08-30T12:00:00Z" },
		{ ...stageSnapshot, observed_at: "2026-13-30T12:00:00.000Z" },
		{ ...stageSnapshot, raised_hands: { alice: "yesterday" } },
		{
			...stageSnapshot,
			participants: [{ ...stageSnapshot.participants[0], extra: true }],
		},
		{
			...stageSnapshot,
			producers: [{ ...stageSnapshot.producers[0], kind: "data" }],
		},
		{ ...stageSnapshot, extra: true },
	])("rejects invalid or unknown snapshot data %#", (value) => {
		expect(parseRecorderStageSnapshot(value)).toBeNull();
	});

	it.each([
		{ ...stageEvent, cursor: 0 },
		{ ...stageEvent, cursor: Number.MAX_SAFE_INTEGER + 1 },
		{ ...stageEvent, observed_at: "2026-08-30T12:00:00+00:00" },
		{ ...stageEvent, payload: { type: "unknown" } },
		{ ...stageEvent, payload: { ...stageEvent.payload, extra: true } },
		{ ...stageEvent, extra: true },
	])("rejects invalid, unknown, or inexact projection events %#", (value) => {
		expect(parseRecorderStageProjectionEvent(value)).toBeNull();
	});

	it.each([
		{ success: true, snapshot: stageSnapshot, extra: true },
		{ success: false, error: "failed", extra: true },
		{ success: false, error: "" },
	])("rejects inexact snapshot responses %#", (value) => {
		expect(parseRecordingProjectionSnapshotResponse(value)).toBeNull();
	});
});
