import type { JsonWebKey } from 'node:crypto';
import {
	createHash,
	createPublicKey,
	randomBytes,
	verify as verifySignature,
} from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import type { RecordingGrantPersistenceFile } from './RecordingGrantPersistenceFile';

const GRANT_TYPE = 'meet-recording-grant+jwt';
const GRANT_AUDIENCE = 'meet-sfu-recorder';
const MAX_AUTHORIZATION_SECONDS = 4 * 60 * 60;
const CHALLENGE_SECONDS = 10;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export type RecordingGrantClaims = {
	iss: string;
	aud: typeof GRANT_AUDIENCE;
	scope: 'recording';
	jti: string;
	site: string;
	meeting_id: string;
	recording_id: string;
	recorder_job_id: string;
	cnf: { jwk: JsonWebKey; jkt: string };
	iat: number;
	exp: number;
	authorization_expires_at: number;
};

export type RecordingProofChallenge = {
	version: 1;
	jti: string;
	socket_id: string;
	nonce: string;
	issued_at: number;
	expires_at: number;
};

export class RecordingGrantManager {
	constructor(
		private readonly secret: string,
		private readonly persistence: RecordingGrantPersistenceFile,
		private readonly clockSkewSeconds = 5,
	) {}

	verifyGrant(token: string, now = unixNow()): RecordingGrantClaims {
		if (!this.persistence.isReady()) {
			throw new Error('Recording authorization is not ready');
		}
		const decoded: unknown = jwt.verify(token, this.secret, {
			algorithms: ['HS256'],
			audience: GRANT_AUDIENCE,
			clockTimestamp: now,
			clockTolerance: this.clockSkewSeconds,
			complete: true,
		});
		if (
			!decoded ||
			typeof decoded !== 'object' ||
			Array.isArray(decoded) ||
			!('header' in decoded) ||
			!decoded.header ||
			typeof decoded.header !== 'object' ||
			Array.isArray(decoded.header) ||
			Object.keys(decoded.header).length !== 2 ||
			!('alg' in decoded.header) ||
			decoded.header.alg !== 'HS256' ||
			!('typ' in decoded.header) ||
			decoded.header.typ !== GRANT_TYPE ||
			!('payload' in decoded)
		) {
			throw new Error('Invalid recording grant header');
		}
		const claims = parseClaims(decoded.payload);
		if (claims.iss !== `frappe-site:${claims.site}`) {
			throw new Error('Invalid recording grant issuer');
		}
		if (
			claims.authorization_expires_at >
			claims.iat + MAX_AUTHORIZATION_SECONDS
		) {
			throw new Error('Recording authorization exceeds session maximum');
		}
		if (
			claims.iat > now + this.clockSkewSeconds ||
			claims.exp <= claims.iat ||
			claims.exp > claims.authorization_expires_at ||
			claims.authorization_expires_at <= claims.iat
		) {
			throw new Error('Invalid recording grant timestamps');
		}
		if (claims.authorization_expires_at <= now - this.clockSkewSeconds) {
			throw new Error('Recording authorization has expired');
		}
		validatePublicJwk(claims.cnf.jwk);
		if (claims.cnf.jkt !== jwkThumbprint(claims.cnf.jwk)) {
			throw new Error('Recording grant JWK thumbprint mismatch');
		}
		if (this.persistence.isConsumed(claims.jti, now)) {
			throw new Error('Recording grant has already been consumed');
		}
		return claims;
	}

	createChallenge(
		claims: RecordingGrantClaims,
		socketId: string,
		now = unixNow(),
	): RecordingProofChallenge {
		if (!socketId) throw new Error('Socket ID is required');
		return {
			version: 1,
			jti: claims.jti,
			socket_id: socketId,
			nonce: randomBytes(32).toString('base64url'),
			issued_at: now,
			expires_at: now + CHALLENGE_SECONDS,
		};
	}

	async verifyProofAndConsume(
		claims: RecordingGrantClaims,
		challenge: RecordingProofChallenge,
		signature: string,
		socketId: string,
		now = unixNow(),
	): Promise<number> {
		if (claims.exp <= now || claims.authorization_expires_at <= now) {
			throw new Error('Recording grant has expired before proof completion');
		}
		validateChallenge(challenge, claims.jti, socketId, now);
		const signatureBytes = decodeBase64Url(signature, 64, 'proof signature');
		const valid = verifySignature(
			'sha256',
			canonicalChallengeBytes(challenge),
			{
				key: createPublicKey({ key: claims.cnf.jwk, format: 'jwk' }),
				dsaEncoding: 'ieee-p1363',
			},
			signatureBytes,
		);
		if (!valid) throw new Error('Invalid recording proof signature');
		await this.persistence.consume(
			claims.jti,
			claims.exp + this.clockSkewSeconds,
			now,
		);
		return claims.authorization_expires_at;
	}
}

export function canonicalChallengeBytes(
	challenge: RecordingProofChallenge,
): Buffer {
	return Buffer.from(
		`meet-recording-proof-v1\n${challenge.jti}\n${challenge.socket_id}\n${challenge.nonce}\n${challenge.issued_at}\n${challenge.expires_at}`,
		'utf8',
	);
}

export function jwkThumbprint(jwk: JsonWebKey): string {
	validatePublicJwk(jwk);
	const canonical = JSON.stringify({
		crv: 'P-256',
		kty: 'EC',
		x: jwk.x,
		y: jwk.y,
	});
	return createHash('sha256').update(canonical).digest('base64url');
}

function parseClaims(payload: unknown): RecordingGrantClaims {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		throw new Error('Invalid recording grant claims');
	}
	if (
		!('aud' in payload) ||
		payload.aud !== GRANT_AUDIENCE ||
		!('scope' in payload) ||
		payload.scope !== 'recording'
	) {
		throw new Error('Invalid recording grant audience or scope');
	}
	return {
		iss: requiredClaimString(property(payload, 'iss'), 'iss'),
		aud: GRANT_AUDIENCE,
		scope: 'recording',
		jti: requiredClaimString(property(payload, 'jti'), 'jti'),
		site: requiredClaimString(property(payload, 'site'), 'site'),
		meeting_id: requiredClaimString(
			property(payload, 'meeting_id'),
			'meeting_id',
		),
		recording_id: requiredClaimString(
			property(payload, 'recording_id'),
			'recording_id',
		),
		recorder_job_id: requiredClaimString(
			property(payload, 'recorder_job_id'),
			'recorder_job_id',
		),
		cnf: parseConfirmation(property(payload, 'cnf')),
		iat: requiredClaimInteger(property(payload, 'iat'), 'iat'),
		exp: requiredClaimInteger(property(payload, 'exp'), 'exp'),
		authorization_expires_at: requiredClaimInteger(
			property(payload, 'authorization_expires_at'),
			'authorization_expires_at',
		),
	};
}

function property(value: object, key: string): unknown {
	return key in value ? value[key as keyof typeof value] : undefined;
}

function requiredClaimString(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`Missing recording grant claim: ${name}`);
	}
	return value;
}

function requiredClaimInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
		throw new Error(`Missing recording grant claim: ${name}`);
	}
	return value;
}

function parseConfirmation(value: unknown): { jwk: JsonWebKey; jkt: string } {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Missing recording grant claim: cnf');
	}
	if (!('jwk' in value) || !('jkt' in value) || typeof value.jkt !== 'string') {
		throw new Error('Invalid recording grant cnf');
	}
	return { jwk: parsePublicJwk(value.jwk), jkt: value.jkt };
}

function parsePublicJwk(value: unknown): JsonWebKey {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Invalid recording grant public JWK');
	}
	if (
		!('kty' in value) ||
		value.kty !== 'EC' ||
		!('crv' in value) ||
		value.crv !== 'P-256' ||
		'd' in value ||
		!('x' in value) ||
		typeof value.x !== 'string' ||
		!('y' in value) ||
		typeof value.y !== 'string'
	) {
		throw new Error('Invalid recording grant public JWK');
	}
	decodeBase64Url(value.x, 32, 'JWK x');
	decodeBase64Url(value.y, 32, 'JWK y');
	return { kty: 'EC', crv: 'P-256', x: value.x, y: value.y };
}

function validatePublicJwk(jwk: JsonWebKey): void {
	if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || 'd' in jwk) {
		throw new Error('Invalid recording grant public JWK');
	}
	decodeBase64Url(jwk.x, 32, 'JWK x');
	decodeBase64Url(jwk.y, 32, 'JWK y');
}

function validateChallenge(
	challenge: RecordingProofChallenge,
	jti: string,
	socketId: string,
	now: number,
): void {
	if (
		challenge.version !== 1 ||
		challenge.jti !== jti ||
		challenge.socket_id !== socketId ||
		!Number.isSafeInteger(challenge.issued_at) ||
		!Number.isSafeInteger(challenge.expires_at) ||
		challenge.expires_at - challenge.issued_at !== CHALLENGE_SECONDS ||
		now < challenge.issued_at ||
		now > challenge.expires_at
	) {
		throw new Error('Invalid or expired recording proof challenge');
	}
	decodeBase64Url(challenge.nonce, 32, 'challenge nonce');
}

function decodeBase64Url(value: unknown, length: number, name: string): Buffer {
	if (typeof value !== 'string' || !BASE64URL.test(value)) {
		throw new Error(`Invalid ${name}`);
	}
	const decoded = Buffer.from(value, 'base64url');
	if (decoded.length !== length || decoded.toString('base64url') !== value) {
		throw new Error(`Invalid ${name}`);
	}
	return decoded;
}

function unixNow(): number {
	return Math.floor(Date.now() / 1000);
}
