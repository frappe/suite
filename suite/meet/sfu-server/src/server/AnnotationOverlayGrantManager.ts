import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';

const AUDIENCE = 'meet-annotation-overlay';
const ISSUER = 'meet-sfu';
const TOKEN_TYPE = 'meet-annotation-overlay-grant+jwt';
const GRANT_TTL_SECONDS = 60;

export interface AnnotationOverlayGrantClaims {
	iss: typeof ISSUER;
	aud: typeof AUDIENCE;
	scope: 'annotation-overlay';
	jti: string;
	meeting_id: string;
	site?: string;
	presenter_id: string;
	producer_id: string;
	iat: number;
	exp: number;
}

interface GrantInput {
	meetingId: string;
	site?: string;
	presenterId: string;
	producerId: string;
}

export class AnnotationOverlayGrantManager {
	private readonly consumed = new Map<string, number>();

	constructor(private readonly jwtSecret: string) {}

	issue(input: GrantInput): { grant: string; expiresAt: number } {
		const issuedAt = Math.floor(Date.now() / 1000);
		const expiresAt = issuedAt + GRANT_TTL_SECONDS;
		const claims = {
			scope: 'annotation-overlay' as const,
			meeting_id: input.meetingId,
			...(input.site ? { site: input.site } : {}),
			presenter_id: input.presenterId,
			producer_id: input.producerId,
		};
		const grant = jwt.sign(claims, this.jwtSecret, {
			algorithm: 'HS256',
			audience: AUDIENCE,
			issuer: ISSUER,
			jwtid: randomUUID(),
			expiresIn: GRANT_TTL_SECONDS,
			header: { alg: 'HS256', typ: TOKEN_TYPE },
		});
		return { grant, expiresAt: expiresAt * 1000 };
	}

	verifyAndConsume(token: string): AnnotationOverlayGrantClaims {
		const header = jwt.decode(token, { complete: true })?.header;
		if (header?.typ !== TOKEN_TYPE)
			throw new Error('Invalid overlay grant type');
		const claims = parseClaims(
			jwt.verify(token, this.jwtSecret, {
				audience: AUDIENCE,
				issuer: ISSUER,
			}),
		);
		this.removeExpired(claims.iat);
		if (this.consumed.has(claims.jti)) {
			throw new Error('Overlay grant was already used');
		}
		this.consumed.set(claims.jti, claims.exp);
		return claims;
	}

	private removeExpired(now: number): void {
		for (const [id, expiresAt] of this.consumed) {
			if (expiresAt <= now) this.consumed.delete(id);
		}
	}
}

function parseClaims(value: unknown): AnnotationOverlayGrantClaims {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Invalid overlay grant claims');
	}
	const claims = value as jwt.JwtPayload;
	if (
		claims.iss !== ISSUER ||
		claims.aud !== AUDIENCE ||
		claims.scope !== 'annotation-overlay' ||
		typeof claims.jti !== 'string' ||
		typeof claims.meeting_id !== 'string' ||
		typeof claims.presenter_id !== 'string' ||
		typeof claims.producer_id !== 'string' ||
		typeof claims.iat !== 'number' ||
		typeof claims.exp !== 'number' ||
		(claims.site !== undefined && typeof claims.site !== 'string')
	) {
		throw new Error('Invalid overlay grant claims');
	}
	return claims as AnnotationOverlayGrantClaims;
}
