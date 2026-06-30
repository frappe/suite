import type { Socket } from 'socket.io';
import type { ParticipantInfo, PreviewParticipantInfo } from '../../types';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { checkSocketRateLimits, getRoomId } from './utils';

export function registerRoomQueryHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('get_router_rtp_capabilities', async (_data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const roomId = getRoomId(socket);

				loggers.socketHandler.debug(
					'Getting RTP capabilities for room: %s, user: %s',
					roomId,
					socket.userId,
				);

				const rtpCapabilities = deps.mediasoup.getRouterRtpCapabilities(roomId);

				callback({ success: true, rtpCapabilities });
			} catch (error) {
				loggers.socketHandler.error(
					'Error getting RTP capabilities: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('get_existing_producers', async (_data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const roomId = getRoomId(socket);
				const userId = socket.userId;

				loggers.socketHandler.debug(
					'Getting existing producers for room: %s, user: %s',
					roomId,
					userId,
				);

				const producers = await deps.mediasoup.getExistingProducers(
					roomId,
					userId,
				);

				callback({ success: true, producers });

				for (const producer of producers) {
					socket.emit('producer_created', {
						roomId: producer.roomId,
						producerId: producer.id,
						participantId: producer.user_id,
						kind: producer.kind,
						paused: producer.paused,
						isScreen: producer.isScreen,
					});
				}

				loggers.socketHandler.info(
					'Sent %d existing producers to %s',
					producers.length,
					userId,
				);
			} catch (error) {
				loggers.socketHandler.error(
					'Error getting existing producers: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('get_room_participants', async (_data, callback) => {
			try {
				deps.authManager.ensurePresenceAccess(socket);

				if (
					!checkSocketRateLimits(socket, deps.rateLimiter, 10, 10, 60 * 1000)
				) {
					callback({
						success: false,
						error: 'Too many requests. Please try again later.',
					});
					return;
				}

				const roomId = getRoomId(socket);
				loggers.socketHandler.debug(
					'Getting room participants for room %s, user %s, scope %s',
					roomId,
					socket.userId,
					socket.scope,
				);
				const participants = deps.mediasoup.getRoomParticipants(roomId);

				let responseParticipants: ParticipantInfo[] | PreviewParticipantInfo[] =
					participants;
				if (socket.scope === 'presence-preview') {
					responseParticipants = participants.map((p) => ({
						id: p.id,
						info: {
							name: p.info.name,
							avatar: p.info.avatar,
							is_guest: p.info.is_guest || false,
						},
					}));
				}

				loggers.socketHandler.debug(
					'Found %d participants for room %s',
					responseParticipants.length,
					roomId,
				);
				callback({ success: true, participants: responseParticipants });
			} catch (error) {
				loggers.socketHandler.error(
					'Error getting room participants: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});
	};
}
