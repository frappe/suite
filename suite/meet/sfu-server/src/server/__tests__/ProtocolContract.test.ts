import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RecordingProofChallenge } from '../../types';
import { parseClaims, validateChallenge } from '../RecordingGrantManager';
import { isRecordingProofRequest } from '../SocketHandlerManager';

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };

const contract = JSON.parse(
	readFileSync(
		resolve(process.cwd(), '../recording/contracts/v1.json'),
		'utf8',
	),
) as {
	vectors: {
		proof_challenges: {
			accepted: RecordingProofChallenge[];
			rejected: RecordingProofChallenge[];
		};
		recording_grant_claims: {
			accepted: JsonObject[];
			rejected: JsonObject[];
		};
		proof_requests: { accepted: JsonObject[]; rejected: JsonObject[] };
	};
};

describe('recording protocol contract v1', () => {
	it('runs shared proof challenge vectors through the production validator', () => {
		for (const value of contract.vectors.proof_challenges.accepted)
			expect(() =>
				validateChallenge(
					value,
					value.jti,
					value.socket_id,
					value.issued_at + 1,
				),
			).not.toThrow();
		for (const value of contract.vectors.proof_challenges.rejected)
			expect(() =>
				validateChallenge(
					value,
					value.jti,
					value.socket_id,
					value.issued_at + 1,
				),
			).toThrow();
	});

	it('runs shared Recording Grant claim vectors through the production parser', () => {
		for (const value of contract.vectors.recording_grant_claims.accepted)
			expect(parseClaims(value)).toBeDefined();
		for (const value of contract.vectors.recording_grant_claims.rejected)
			expect(() => parseClaims(value)).toThrow();
	});

	it('runs shared proof request vectors through the production parser', () => {
		for (const value of contract.vectors.proof_requests.accepted)
			expect(isRecordingProofRequest(value)).toBe(true);
		for (const value of contract.vectors.proof_requests.rejected)
			expect(isRecordingProofRequest(value)).toBe(false);
	});
});
