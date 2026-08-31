import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	parseRecordingChallenge,
	parseRecordingProofResponse,
} from "./protocol";
import { parseConfigureMessage } from "./rendererBridge";

const contract = JSON.parse(
	readFileSync(
		resolve(process.cwd(), "../suite/meet/recording/contracts/v1.json"),
		"utf8",
	),
) as {
	vectors: {
		proof_challenges: {
			accepted: unknown[];
			rejected: unknown[];
		};
		proof_responses: { accepted: unknown[]; rejected: unknown[] };
		renderer_configure: { accepted: unknown[]; rejected: unknown[] };
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

	it("runs shared proof response vectors through the production parser", () => {
		for (const value of contract.vectors.proof_responses.accepted)
			expect(parseRecordingProofResponse(value)).toEqual(value);
		for (const value of contract.vectors.proof_responses.rejected)
			expect(parseRecordingProofResponse(value)).toBeNull();
	});
});
