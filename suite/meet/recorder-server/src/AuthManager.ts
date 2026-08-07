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
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		!exactKeys(value, LIMIT_KEYS)
	)
		return false;
	const limits = value as Record<string, unknown>;
	if (
		!Number.isSafeInteger(limits.budget_bytes) ||
		(limits.budget_bytes as number) <= 0
	)
		return false;
	if (!validUtcTimestamp(limits.max_ends_at)) return false;
	const output = limits.output;
	if (
		!output ||
		typeof output !== 'object' ||
		Array.isArray(output) ||
		!exactKeys(output, OUTPUT_KEYS)
	)
		return false;
	const out = output as Record<string, unknown>;
	return (
		out.width === 1920 &&
		out.height === 1080 &&
		out.fps === 30 &&
		out.video === 'h264' &&
		out.audio === 'aac'
	);
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
		const claims = decoded as unknown as CommandClaims;
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
		if (!validLimits(claims.limits)) throw new AuthError('invalid limits');
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
