import type { JsonWebKey } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	canonicalChallengeBytes,
	jwkThumbprint,
	type RecordingGrantClaims,
	RecordingGrantManager,
	type RecordingProofChallenge,
} from '../RecordingGrantManager';
import { RecordingGrantPersistenceFile } from '../RecordingGrantPersistenceFile';

const SECRET = 'recording-grant-test-secret';
const NOW = 1_700_000_000;
const privateJwk: JsonWebKey = {
	kty: 'EC',
	crv: 'P-256',
	x: 'dekZC7nsWz9JfUnSQDU0HAyC2rFohnQ1xG1oiGPCASs',
	y: 'uQYwl6W7tkTphKATetD73cCx6_QObRdD9VqsCTA0mlE',
	d: 'hcTM8lgoTvFtU6JLCotLuNqqH06WNDQVyEYwa0pZ5Ew',
};
const publicJwk: JsonWebKey = {
	kty: 'EC',
	crv: 'P-256',
	x: privateJwk.x,
	y: privateJwk.y,
};
const vectorChallenge: RecordingProofChallenge = {
	version: 1,
	jti: 'jti-vector',
	socket_id: 'socket-vector',
	nonce: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
	issued_at: NOW,
	expires_at: NOW + 10,
};
const vectorSignature =
	'_QdFybPIp38vcVIhDYHkvEOCMnd-2GOw1SXR8g7JzBQUvAGgwY7VtNTKMlAR_JNU0m21tsjZJ_z3x2K5BNNTQQ';

let directory: string;
let persistence: RecordingGrantPersistenceFile;
let manager: RecordingGrantManager;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'recording-grant-manager-'));
	const path = join(directory, 'consumed.json');
	await RecordingGrantPersistenceFile.bootstrap(path);
	persistence = new RecordingGrantPersistenceFile(path);
	await persistence.initialize();
	manager = new RecordingGrantManager(SECRET, persistence);
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe('RecordingGrantManager', () => {
	it('accepts the exact grant contract and computes the RFC 7638 thumbprint', () => {
		const claims = manager.verifyGrant(makeToken(), NOW);
		expect(claims.jti).toBe('jti-vector');
		expect(jwkThumbprint(publicJwk)).toBe(
			'5_dTnFp8YLZgTpIYA00V-_KwFyfTvqnxBPQECGyfOlU',
		);
	});

	it('rejects non-exact headers, mandatory claim errors, and private JWKs', () => {
		expect(() =>
			manager.verifyGrant(makeToken({}, { kid: 'unexpected' }), NOW),
		).toThrow('header');
		expect(() =>
			manager.verifyGrant(makeToken({ scope: 'full' }), NOW),
		).toThrow();
		expect(() =>
			manager.verifyGrant(makeToken({ iss: 'frappe-site:other' }), NOW),
		).toThrow('issuer');
		expect(() =>
			manager.verifyGrant(
				makeToken({ cnf: { jwk: privateJwk, jkt: jwkThumbprint(publicJwk) } }),
				NOW,
			),
		).toThrow('public JWK');
	});

	it('uses fixed canonical bytes verified by Node and browser WebCrypto', async () => {
		expect(canonicalChallengeBytes(vectorChallenge).toString()).toBe(
			'meet-recording-proof-v1\njti-vector\nsocket-vector\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n1700000000\n1700000010',
		);
		const key = await crypto.subtle.importKey(
			'jwk',
			publicJwk,
			{ name: 'ECDSA', namedCurve: 'P-256' },
			false,
			['verify'],
		);
		expect(
			await crypto.subtle.verify(
				{ name: 'ECDSA', hash: 'SHA-256' },
				key,
				Buffer.from(vectorSignature, 'base64url'),
				canonicalChallengeBytes(vectorChallenge),
			),
		).toBe(true);

		const authorizationExpiry = await manager.verifyProofAndConsume(
			manager.verifyGrant(makeToken(), NOW),
			vectorChallenge,
			vectorSignature,
			'socket-vector',
			NOW + 1,
		);
		expect(authorizationExpiry).toBe(NOW + 3_600);
		expect(() => manager.verifyGrant(makeToken(), NOW + 2)).toThrow('consumed');
	});

	it('rejects malformed, wrong-socket, expired, and invalid proofs', async () => {
		const claims = manager.verifyGrant(makeToken(), NOW);
		await expect(
			manager.verifyProofAndConsume(
				claims,
				vectorChallenge,
				vectorSignature,
				'other-socket',
				NOW,
			),
		).rejects.toThrow('challenge');
		await expect(
			manager.verifyProofAndConsume(
				claims,
				vectorChallenge,
				'A'.repeat(86),
				'socket-vector',
				NOW,
			),
		).rejects.toThrow('signature');
		await expect(
			manager.verifyProofAndConsume(
				claims,
				vectorChallenge,
				vectorSignature,
				'socket-vector',
				NOW + 11,
			),
		).rejects.toThrow('challenge');
	});

	it('creates a 32-byte, ten-second challenge', () => {
		const challenge = manager.createChallenge(
			manager.verifyGrant(makeToken(), NOW),
			'socket-1',
			NOW,
		);
		expect(Buffer.from(challenge.nonce, 'base64url')).toHaveLength(32);
		expect(challenge.expires_at).toBe(NOW + 10);
	});
});

function makeToken(
	overrides: {
		scope?: string;
		iss?: string;
		cnf?: RecordingGrantClaims['cnf'];
	} = {},
	header: Record<string, string> = {},
): string {
	const claims: RecordingGrantClaims = {
		iss: 'frappe-site:test.local',
		aud: 'meet-sfu-recorder',
		scope: 'recording',
		jti: 'jti-vector',
		site: 'test.local',
		meeting_id: 'room-1',
		recording_id: 'recording-1',
		recorder_job_id: 'job-1',
		cnf: { jwk: publicJwk, jkt: jwkThumbprint(publicJwk) },
		iat: NOW,
		exp: NOW + 60,
		authorization_expires_at: NOW + 3_600,
	};
	return jwt.sign({ ...claims, ...overrides }, SECRET, {
		algorithm: 'HS256',
		header: { typ: 'meet-recording-grant+jwt', ...header },
	});
}
