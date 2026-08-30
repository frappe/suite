import * as jwt from 'jsonwebtoken';
import type { Socket } from 'socket.io';
import type { JWTPayload } from '../types';
import { loggers } from '../utils/logger';
import type { RecordingGrantManager } from './RecordingGrantManager';

const TOKEN_EXPIRY_GRACE_MS = 5000;

export class AuthManager {
	private jwtSecret: string;

	constructor(
		jwtSecret: string,
		private readonly recordingGrantManager?: RecordingGrantManager,
	) {
		this.jwtSecret = jwtSecret;
	}

	authenticateSocket(socket: Socket): boolean {
		try {
			const candidate: unknown =
				socket.handshake.auth.token || socket.handshake.query.token;

			if (typeof candidate !== 'string' || !candidate) {
				loggers.authManager.error('No authentication token provided');
				return false;
			}
			const token = candidate;

			const header = jwt.decode(token, { complete: true })?.header;
			if (header?.typ === 'meet-recording-grant+jwt') {
				if (!this.recordingGrantManager) return false;
				const claims = this.recordingGrantManager.verifyGrant(token);
				socket.userId = `recorder:${claims.recording_id}`;
				socket.userName = 'Recorder';
				socket.meetingId = claims.meeting_id;
				socket.site = claims.site;
				socket.isHost = false;
				socket.isCohost = false;
				socket.isGuest = false;
				socket.guestGeneration = undefined;
				socket.scope = 'recording';
				socket.e2eeRequired = false;
				socket.e2eeReady = false;
				socket.currentToken = token;
				socket.tokenExpiresAt = claims.exp * 1000;
				socket.recordingClaims = claims;
				socket.recordingProofComplete = false;
				return true;
			}

			const decoded = parseParticipantClaims(jwt.verify(token, this.jwtSecret));

			// Attach user info to socket
			socket.userId = decoded.user_id;
			socket.userName = decoded.user_name;
			socket.meetingId = decoded.meeting_id;
			socket.site = decoded.site;
			socket.isHost = decoded.is_host || false;
			socket.isCohost = decoded.is_cohost || false;
			socket.scope = decoded.scope || 'presence-preview';
			socket.e2eeRequired = Boolean(decoded.e2ee_required);
			socket.e2eeReady = !socket.e2eeRequired;
			socket.currentToken = token;
			socket.tokenExpiresAt = decoded.exp ? decoded.exp * 1000 : undefined;
			socket.isGuest = decoded.is_guest || false;
			socket.guestGeneration = decoded.guest_generation;

			loggers.authManager.info(
				'Authenticated user: %s for meeting: %s (site: %s)',
				socket.userId,
				socket.meetingId,
				socket.site ?? '<unspecified>',
			);
			return true;
		} catch (error) {
			loggers.authManager.error(
				'Authentication failed: %s',
				(error as Error).message,
			);
			return false;
		}
	}

	updateSocketToken(socket: Socket, token: string): void {
		if (socket.scope === 'recording') {
			throw new Error('Recording authorization cannot be refreshed');
		}
		const decoded = parseParticipantClaims(jwt.verify(token, this.jwtSecret));
		const wasE2EERequired = socket.e2eeRequired === true;
		const wasE2EEReady = socket.e2eeReady === true;

		if (!decoded.meeting_id || decoded.meeting_id !== socket.meetingId) {
			throw new Error('Token meeting mismatch');
		}

		if (!decoded.user_id || decoded.user_id !== socket.userId) {
			throw new Error('Token user mismatch');
		}

		if ((decoded.site ?? undefined) !== (socket.site ?? undefined)) {
			throw new Error('Token site mismatch');
		}

		if (
			(decoded.scope ?? 'presence-preview') !== socket.scope ||
			Boolean(decoded.is_guest) !== Boolean(socket.isGuest) ||
			(socket.isGuest && decoded.guest_generation !== socket.guestGeneration)
		) {
			throw new Error('Token identity mismatch');
		}

		this.clearTokenExpiryTimer(socket);
		socket.currentToken = token;
		socket.tokenExpiresAt = decoded.exp ? decoded.exp * 1000 : undefined;
		socket.isHost = decoded.is_host || false;
		socket.isCohost = decoded.is_cohost || false;
		socket.userName = decoded.user_name;
		socket.scope = decoded.scope ?? 'presence-preview';
		socket.isGuest = decoded.is_guest || false;
		socket.guestGeneration = decoded.guest_generation;
		socket.e2eeRequired = Boolean(decoded.e2ee_required);
		socket.e2eeReady = socket.e2eeRequired
			? wasE2EERequired && wasE2EEReady
			: true;

		if (socket.handshake?.auth) {
			socket.handshake.auth.token = token;
		}

		loggers.authManager.info(
			'Updated token for socket %s (user %s)',
			socket.id,
			socket.userId,
		);
	}

	isTokenExpired(socket: Socket): boolean {
		if (!socket.tokenExpiresAt) {
			return false;
		}

		return Date.now() >= socket.tokenExpiresAt;
	}

	triggerTokenExpiry(socket: Socket, reason: string): void {
		if (socket.disconnected || socket.tokenExpiryTimer) {
			return;
		}

		const timestamp = new Date().toISOString();

		loggers.authManager.warn(
			'Token expired for socket %s (user %s); awaiting refresh (%s)',
			socket.id,
			socket.userId,
			reason,
		);

		try {
			socket.emit('auth:expired', {
				timestamp,
				reason,
			});
			socket.emit('sfu_error', {
				error: 'Authentication token expired',
				timestamp,
			});
		} catch (emitError) {
			loggers.authManager.warn(
				'Failed to emit auth:expired for socket %s: %s',
				socket.id,
				(emitError as Error).message,
			);
		}

		socket.tokenExpiryTimer = setTimeout(() => {
			socket.tokenExpiryTimer = undefined;
			if (!socket.disconnected && this.isTokenExpired(socket)) {
				socket.disconnect(true);
			}
		}, TOKEN_EXPIRY_GRACE_MS);
		socket.tokenExpiryTimer.unref();
	}

	cleanupSocket(socket: Socket): void {
		this.clearTokenExpiryTimer(socket);
		socket.currentToken = undefined;
		socket.tokenExpiresAt = undefined;
		socket.e2eeReady = undefined;
		socket.e2eeRequired = undefined;
		socket.guestGeneration = undefined;
	}

	ensurePresenceAccess(socket: Socket): void {
		if (socket.scope !== 'presence-preview' && socket.scope !== 'full') {
			throw new Error('Insufficient scope for presence access');
		}

		// Validate that the socket's meeting ID matches the token's meeting ID
		// This prevents token reuse across different meetings
		const token = socket.currentToken;
		if (!token) {
			throw new Error('No token available for validation');
		}

		try {
			const decoded = parseParticipantClaims(jwt.verify(token, this.jwtSecret));
			if (decoded.meeting_id !== socket.meetingId) {
				loggers.authManager.warn(
					'Meeting ID mismatch for user %s: token has %s, socket has %s',
					socket.userId,
					decoded.meeting_id,
					socket.meetingId,
				);
				throw new Error('Token meeting ID does not match socket meeting ID');
			}
		} catch (error) {
			if (error instanceof jwt.JsonWebTokenError) {
				throw new Error('Invalid token for presence access validation');
			}
			throw error;
		}
	}

	ensureFullAccess(socket: Socket): void {
		if (socket.scope !== 'full') {
			throw new Error('Insufficient scope for full access');
		}
	}

	ensureMediaConsumerAccess(socket: Socket): void {
		if (socket.scope === 'full') return;
		this.ensureRecorderAccess(socket);
	}

	ensureRecorderAccess(socket: Socket): void {
		if (
			socket.scope !== 'recording' ||
			!socket.recordingProofComplete ||
			!socket.recordingClaims ||
			socket.recordingClaims.meeting_id !== socket.meetingId ||
			socket.recordingClaims.site !== socket.site
		) {
			throw new Error('Recording proof required');
		}
	}

	ensureNotGuest(socket: Socket): void {
		if (socket.isGuest) {
			throw new Error('Guests are not permitted to perform this action.');
		}
	}

	private clearTokenExpiryTimer(socket: Socket): void {
		if (socket.tokenExpiryTimer) clearTimeout(socket.tokenExpiryTimer);
		socket.tokenExpiryTimer = undefined;
	}
}

function parseParticipantClaims(value: unknown): JWTPayload {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Invalid participant claims');
	}
	const userId = claimString(value, 'user_id');
	const userName = claimString(value, 'user_name');
	const meetingId = claimString(value, 'meeting_id');
	if (!('is_host' in value) || typeof value.is_host !== 'boolean') {
		throw new Error('Invalid participant claims');
	}
	const scope = optionalString(value, 'scope');
	if (scope !== undefined && scope !== 'full' && scope !== 'presence-preview') {
		throw new Error('Invalid participant scope');
	}
	const site = optionalString(value, 'site');
	const userAvatar = optionalNullableString(value, 'user_avatar');
	const sessionId = optionalString(value, 'session_id');
	const isCohost = optionalBoolean(value, 'is_cohost');
	const isGuest = optionalBoolean(value, 'is_guest');
	const guestGeneration = isGuest
		? optionalInteger(value, 'guest_generation')
		: undefined;
	if (isGuest && (guestGeneration === undefined || guestGeneration < 1)) {
		throw new Error('Invalid participant claims');
	}
	const e2eeRequired = optionalBoolean(value, 'e2ee_required');
	const exp = optionalInteger(value, 'exp');
	const iat = optionalInteger(value, 'iat');
	return {
		user_id: userId,
		user_name: userName,
		meeting_id: meetingId,
		is_host: value.is_host,
		...(site !== undefined ? { site } : {}),
		...(userAvatar !== undefined ? { user_avatar: userAvatar } : {}),
		...(isCohost !== undefined ? { is_cohost: isCohost } : {}),
		...(isGuest !== undefined ? { is_guest: isGuest } : {}),
		...(guestGeneration !== undefined
			? { guest_generation: guestGeneration }
			: {}),
		...(scope !== undefined ? { scope } : {}),
		...(e2eeRequired !== undefined ? { e2ee_required: e2eeRequired } : {}),
		...(sessionId !== undefined ? { session_id: sessionId } : {}),
		...(exp !== undefined ? { exp } : {}),
		...(iat !== undefined ? { iat } : {}),
	};
}

function claimString(value: object, key: string): string {
	if (!(key in value)) throw new Error('Invalid participant claims');
	const claim = value[key as keyof typeof value];
	if (typeof claim !== 'string' || !claim) {
		throw new Error('Invalid participant claims');
	}
	return claim;
}

function optionalString(value: object, key: string): string | undefined {
	if (!(key in value) || value[key as keyof typeof value] === undefined) {
		return undefined;
	}
	const claim = value[key as keyof typeof value];
	if (typeof claim !== 'string') throw new Error('Invalid participant claims');
	return claim;
}

function optionalNullableString(
	value: object,
	key: string,
): string | undefined {
	if (
		!(key in value) ||
		value[key as keyof typeof value] === undefined ||
		value[key as keyof typeof value] === null
	) {
		return undefined;
	}
	return optionalString(value, key);
}

function optionalBoolean(value: object, key: string): boolean | undefined {
	if (!(key in value) || value[key as keyof typeof value] === undefined) {
		return undefined;
	}
	const claim = value[key as keyof typeof value];
	if (typeof claim !== 'boolean') throw new Error('Invalid participant claims');
	return claim;
}

function optionalInteger(value: object, key: string): number | undefined {
	if (!(key in value) || value[key as keyof typeof value] === undefined) {
		return undefined;
	}
	const claim = value[key as keyof typeof value];
	if (typeof claim !== 'number' || !Number.isSafeInteger(claim)) {
		throw new Error('Invalid participant claims');
	}
	return claim;
}
