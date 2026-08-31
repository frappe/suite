import { describe, expect, it } from "vitest";
import {
	parseRecordingChallenge,
	parseRecordingProofResponse,
} from "./protocol";

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
