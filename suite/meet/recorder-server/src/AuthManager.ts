import { timingSafeEqual } from 'node:crypto';
import jwt, { type JwtHeader } from 'jsonwebtoken';
import type { JobStore } from './JobStore.js';
import {
	COMMAND_AUDIENCE,
	COMMAND_TYPE,
	type CommandClaims,
	type RecordingLimits,
} from './types.js';

const CLAIM_KEYS = [
	'aud',
	'exp',
	'iat',
	'iss',
	'job',
	'jti',
	'limits',
	'operation',
	'origin',
	'recording',
	'room',
	'site',
];
const LIMIT_KEYS = ['budget_bytes', 'max_ends_at', 'output'];
const OUTPUT_KEYS = ['audio', 'fps', 'height', 'video', 'width'];

export class AuthError extends Error {}

function exactKeys(value: object, expected: string[]): boolean {
	return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}

function nonempty(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

export function validUtcTimestamp(value: unknown): value is string {
	if (
		typeof value !== 'string' ||
		!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
	)
		return false;
	const parsed = Date.parse(value);
	if (Number.isNaN(parsed)) return false;
	const normalized = value.includes('.')
		? value.replace(
				/\.(\d{1,2})Z$/,
				(_match, digits: string) => `.${digits.padEnd(3, '0')}Z`,
			)
		: value.replace('Z', '.000Z');
	return new Date(parsed).toISOString() === normalized;
}

export function validLimits(value: unknown): value is RecordingLimits {
	return parseLimits(value) !== null;
}

function parseLimits(value: unknown): RecordingLimits | null {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		!exactKeys(value, LIMIT_KEYS)
	)
		return null;
	if (
		!('budget_bytes' in value) ||
		typeof value.budget_bytes !== 'number' ||
		!Number.isSafeInteger(value.budget_bytes) ||
		value.budget_bytes <= 0 ||
		!('max_ends_at' in value) ||
		!validUtcTimestamp(value.max_ends_at) ||
		!('output' in value)
	)
		return null;
	const output = value.output;
	if (
		!output ||
		typeof output !== 'object' ||
		Array.isArray(output) ||
		!exactKeys(output, OUTPUT_KEYS)
	)
		return null;
	if (
		!('width' in output) ||
		output.width !== 1920 ||
		!('height' in output) ||
		output.height !== 1080 ||
		!('fps' in output) ||
		output.fps !== 30 ||
		!('video' in output) ||
		output.video !== 'h264' ||
		!('audio' in output) ||
		output.audio !== 'aac'
	)
		return null;
	return {
		budget_bytes: value.budget_bytes,
		max_ends_at: value.max_ends_at,
		output: { width: 1920, height: 1080, fps: 30, video: 'h264', audio: 'aac' },
	};
}

export class AuthManager {
	constructor(
		private readonly secret: string,
		private readonly site: string,
		private readonly origin: string,
		private readonly store: JobStore,
	) {}

	async consume(claims: CommandClaims): Promise<void> {
		if (!(await this.store.consumeJti(claims.jti, claims.exp)))
			throw new AuthError('replayed command');
	}

	authenticate(
		authorization: string | undefined,
		expectedOperation: CommandClaims['operation'],
		now = Math.floor(Date.now() / 1000),
	): CommandClaims {
		if (!authorization?.startsWith('Bearer ') || authorization.length === 7)
			throw new AuthError('missing bearer token');
		const token = authorization.slice(7);
		let header: JwtHeader | undefined;
		try {
			header = jwt.decode(token, { complete: true })?.header;
		} catch {
			throw new AuthError('invalid token');
		}
		if (
			!header ||
			!exactKeys(header, ['alg', 'typ']) ||
			header.alg !== 'HS256' ||
			header.typ !== COMMAND_TYPE
		)
			throw new AuthError('invalid header');
		let decoded: unknown;
		try {
			decoded = jwt.verify(token, this.secret, {
				algorithms: ['HS256'],
				audience: COMMAND_AUDIENCE,
				issuer: `frappe-site:${this.site}`,
				clockTimestamp: now,
			});
		} catch {
			throw new AuthError('invalid signature or registered claims');
		}
		if (
			!decoded ||
			typeof decoded !== 'object' ||
			Array.isArray(decoded) ||
			!exactKeys(decoded, CLAIM_KEYS)
		)
			throw new AuthError('invalid claims');
		const claims = parseCommandClaims(decoded);
		if (
			claims.aud !== COMMAND_AUDIENCE ||
			claims.operation !== expectedOperation ||
			claims.site !== this.site ||
			claims.origin !== this.origin ||
			claims.iss !== `frappe-site:${claims.site}`
		)
			throw new AuthError('wrong command scope');
		if (
			![claims.room, claims.recording, claims.job, claims.jti].every(nonempty)
		)
			throw new AuthError('invalid binding');
		if (
			!Number.isInteger(claims.iat) ||
			!Number.isInteger(claims.exp) ||
			claims.exp - claims.iat !== 30 ||
			claims.iat > now + 5 ||
			claims.iat < now - 35
		)
			throw new AuthError('invalid command lifetime');
		return claims;
	}

	authenticateMetrics(
		authorization: string | undefined,
		token: string,
	): boolean {
		if (!authorization?.startsWith('Bearer ')) return false;
		const actual = Buffer.from(authorization.slice(7));
		const expected = Buffer.from(token);
		return (
			actual.length === expected.length && timingSafeEqual(actual, expected)
		);
	}
}

function parseCommandClaims(value: unknown): CommandClaims {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		!exactKeys(value, CLAIM_KEYS)
	) {
		throw new AuthError('invalid claims');
	}
	if (
		!('aud' in value) ||
		value.aud !== COMMAND_AUDIENCE ||
		!('operation' in value) ||
		(value.operation !== 'reserve' &&
			value.operation !== 'query' &&
			value.operation !== 'grant' &&
			value.operation !== 'stop') ||
		!('iat' in value) ||
		typeof value.iat !== 'number' ||
		!Number.isSafeInteger(value.iat) ||
		!('exp' in value) ||
		typeof value.exp !== 'number' ||
		!Number.isSafeInteger(value.exp) ||
		!('limits' in value)
	) {
		throw new AuthError('invalid claims');
	}
	const limits = parseLimits(value.limits);
	if (!limits) throw new AuthError('invalid limits');
	return {
		iss: claimString(value, 'iss'),
		aud: COMMAND_AUDIENCE,
		site: claimString(value, 'site'),
		origin: claimString(value, 'origin'),
		room: claimString(value, 'room'),
		recording: claimString(value, 'recording'),
		job: claimString(value, 'job'),
		operation: value.operation,
		limits,
		jti: claimString(value, 'jti'),
		iat: value.iat,
		exp: value.exp,
	};
}

function claimString(value: object, key: string): string {
	if (!(key in value)) throw new AuthError('invalid claims');
	const claim = value[key as keyof typeof value];
	if (typeof claim !== 'string') throw new AuthError('invalid claims');
	return claim;
}
