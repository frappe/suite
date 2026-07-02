import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { isRealParticipant } from './utils';

export function registerDisconnectHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('disconnect', async () => {
			deps.authManager.cleanupSocket(socket);

			loggers.socketHandler.info(
				'Disconnected: %s (User: %s, Scope: %s)',
				socket.id,
				socket.participantId,
				socket.scope,
			);

			const roomId = socket.roomId;
			const participantId = socket.participantId;

			if (roomId && participantId) {
				try {
					deps.registry.leaveScope(socket, roomId, 'full');
					deps.registry.leaveScope(socket, roomId, 'presence-preview');

					if (socket.scope === 'full') {
						const shouldCleanupPeer = deps.registry.releaseParticipant(
							socket,
							roomId,
							participantId,
						);
						if (shouldCleanupPeer) {
							if (socket.senderId !== undefined) {
								await deps.e2eeRoster.remove(roomId, socket.senderId);
								deps.e2eeEpochRelay.removePendingJoiner(
									roomId,
									socket.senderId,
								);
							}
							deps.registry.removeSender(roomId, participantId);
							await deps.mediasoup.removePeer(roomId, participantId);

							if (isRealParticipant(participantId)) {
								deps.registry.emitParticipantEvent(
									roomId,
									'participant_left',
									participantId,
								);
							}

							if (deps.registry.hasRaisedHand(roomId, participantId)) {
								deps.registry.clearRaisedHand(roomId, participantId);
								deps.registry.emitToFullAccessParticipants(
									roomId,
									'hand_raised',
									{
										participantId,
										raised: false,
										timestamp: new Date().toISOString(),
									},
								);
							}

							loggers.socketHandler.info(
								'Cleaned up user %s from room %s',
								participantId,
								roomId,
							);
						}
					}

					if (deps.registry.isEmpty(roomId)) {
						deps.registry.cleanupRoom(roomId);
						deps.e2eeEpochRelay.clearRoom(roomId);
						await deps.e2eeRoster.clearRoom(roomId);
						deps.mediasoup.closeRoom(roomId);
					}
				} catch (error) {
					loggers.socketHandler.error('Error handling disconnect: %s', error);
				}
			}
		});
	};
}
