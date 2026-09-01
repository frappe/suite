import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	parseRecorderStageProjectionEvent,
	parseRecorderStageSnapshot,
	parseRecordingChallenge,
	parseRecordingProofResponse,
} from "./protocol";
import {
	parseCaptureStartedMessage,
	parseConfigureMessage,
	parsePrepareCaptureMessage,
} from "./rendererBridge";

type VectorSet = { accepted: unknown[]; rejected: unknown[] };

const contract = JSON.parse(
	readFileSync(
		resolve(process.cwd(), "../suite/meet/recording/contracts/v1.json"),
		"utf8",
	),
) as {
	vocabularies: { recorder_stage_projection_payload_types: string[] };
	vectors: {
		proof_challenges: {
			accepted: unknown[];
			rejected: unknown[];
		};
		proof_responses: { accepted: unknown[]; rejected: unknown[] };
		renderer_configure: { accepted: unknown[]; rejected: unknown[] };
		recorder_stage_snapshots: VectorSet;
		recorder_stage_projection_events: VectorSet;
		renderer_prepare_capture: VectorSet;
		renderer_capture_started: VectorSet;
	};
};

describe("recording protocol contract v1", () => {
	it("runs shared proof challenge vectors through the production parser", () => {
		for (const value of contract.vectors.proof_challenges.accepted)
			expect(parseRecordingChallenge(value)).toEqual(value);
		for (const value of contract.vectors.proof_challenges.rejected)
			expect(parseRecordingChallenge(value)).toBeNull();
	});

	it("runs shared configure vectors through the production parser", () => {
		for (const value of contract.vectors.renderer_configure.accepted)
			expect(parseConfigureMessage(value)).not.toBeNull();
		for (const value of contract.vectors.renderer_configure.rejected)
			expect(parseConfigureMessage(value)).toBeNull();
	});

	it("runs shared recorder stage vectors through the production parsers", () => {
		for (const value of contract.vectors.recorder_stage_snapshots.accepted)
			expect(parseRecorderStageSnapshot(value)).toEqual(value);
		for (const value of contract.vectors.recorder_stage_snapshots.rejected)
			expect(parseRecorderStageSnapshot(value)).toBeNull();
		for (const value of contract.vectors.recorder_stage_projection_events
			.accepted)
			expect(parseRecorderStageProjectionEvent(value)).toEqual(value);
		for (const value of contract.vectors.recorder_stage_projection_events
			.rejected)
			expect(parseRecorderStageProjectionEvent(value)).toBeNull();
		expect(
			contract.vectors.recorder_stage_projection_events.accepted.map(
				(value) => (value as { payload: { type: string } }).payload.type,
			),
		).toEqual(contract.vocabularies.recorder_stage_projection_payload_types);
	});

	it("runs shared capture command vectors through the production parsers", () => {
		for (const value of contract.vectors.renderer_prepare_capture.accepted)
			expect(parsePrepareCaptureMessage(value)).toEqual(value);
		for (const value of contract.vectors.renderer_prepare_capture.rejected)
			expect(parsePrepareCaptureMessage(value)).toBeNull();
		for (const value of contract.vectors.renderer_capture_started.accepted)
			expect(parseCaptureStartedMessage(value)).toEqual(value);
		for (const value of contract.vectors.renderer_capture_started.rejected)
			expect(parseCaptureStartedMessage(value)).toBeNull();
	});

	it("runs shared proof response vectors through the production parser", () => {
		for (const value of contract.vectors.proof_responses.accepted)
			expect(parseRecordingProofResponse(value)).toEqual(value);
		for (const value of contract.vectors.proof_responses.rejected)
			expect(parseRecordingProofResponse(value)).toBeNull();
	});
});
