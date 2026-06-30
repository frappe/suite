import type { Server, Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { RateLimiter } from '../../utils/rateLimiter';
import type { TypedSocket } from './Handler';

export function isRealParticipant(participantId: string): boolean {
	return !participantId.startsWith('preview-');
}

export function getRoomId(socket: Socket): string {
	const meetingId = socket.meetingId;
	const site = socket.site;
	if (!site) {
		return meetingId;
	}
	return `${site}::${meetingId}`;
}

function isDevOrCiEnvironment(): boolean {
	const devEnv = process.env.NODE_ENV === 'development';
	const inCi = process.env.CI === 'true' || !!process.env.GITHUB_ACTIONS;
	return devEnv || inCi;
}

export function checkSocketRateLimits(
	socket: Socket,
	rateLimiter: RateLimiter,
	userLimit: number,
	ipLimit: number,
	windowMs: number,
): boolean {
	if (isDevOrCiEnvironment()) {
		return true;
	}
	const forwardedFor = socket.handshake.headers['x-forwarded-for'];
	const forwarded = socket.handshake.headers.forwarded;

	const getFirstIp = (val?: string | string[]) =>
		(Array.isArray(val) ? val[0] : val)?.split(',')[0]?.trim();

	const clientIp =
		getFirstIp(forwardedFor) ||
		getFirstIp(forwarded) ||
		socket.handshake.address;

	const userKey = `user:${socket.userId}`;
	const ipKey = `ip:${clientIp}`;

	const userAllowed = rateLimiter.checkRateLimit(userKey, userLimit, windowMs);
	const ipAllowed = rateLimiter.checkRateLimit(ipKey, ipLimit, windowMs);

	if (!userAllowed || !ipAllowed) {
		loggers.socketHandler.warn(
			'Rate limit exceeded: user=%s (allowed=%s), ip=%s (allowed=%s)',
			socket.userId,
			userAllowed,
			clientIp,
			ipAllowed,
		);
	}

	return userAllowed && ipAllowed;
}

export function findSocketByParticipantId(
	io: Server,
	roomId: string,
	participantId: string,
): TypedSocket | null {
	const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
	if (!socketsInRoom) return null;

	for (const socketId of socketsInRoom) {
		const socket = io.sockets.sockets.get(socketId) as TypedSocket | undefined;
		if (socket && socket.participantId === participantId) {
			return socket;
		}
	}

	return null;
}
