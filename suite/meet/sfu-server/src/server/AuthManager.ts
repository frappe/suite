import * as jwt from 'jsonwebtoken';
import type { Socket } from 'socket.io';
import type { JWTPayload } from '../types';
import { loggers } from '../utils/logger';

export class AuthManager {
	private jwtSecret: string;

	constructor(jwtSecret: string) {
		this.jwtSecret = jwtSecret;
	}

	authenticateSocket(socket: Socket): boolean {
		try {
			const token = socket.handshake.auth.token || socket.handshake.query.token;

			if (!token) {
				loggers.authManager.error('No authentication token provided');
				return false;
			}

			const decoded = jwt.verify(token, this.jwtSecret) as JWTPayload;

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
		const decoded = jwt.verify(token, this.jwtSecret) as JWTPayload;
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

		socket.currentToken = token;
		socket.tokenExpiresAt = decoded.exp ? decoded.exp * 1000 : undefined;
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
		if (socket.disconnected) {
			return;
		}

		const timestamp = new Date().toISOString();

		loggers.authManager.warn(
			'Disconnecting socket %s (user %s) due to expired token (%s)',
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

		setImmediate(() => {
			if (!socket.disconnected) {
				socket.disconnect(true);
			}
		});
	}

	cleanupSocket(socket: Socket): void {
		socket.currentToken = undefined;
		socket.tokenExpiresAt = undefined;
		socket.e2eeReady = undefined;
		socket.e2eeRequired = undefined;
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
			const decoded = jwt.verify(token, this.jwtSecret) as JWTPayload;
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
}
