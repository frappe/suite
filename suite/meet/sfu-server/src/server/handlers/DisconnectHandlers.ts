import type { Socket } from 'socket.io';
import { normalizeDisconnectReason } from '../../telemetry/Telemetry';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { isRealParticipant } from './utils';

export function registerDisconnectHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('disconnect', async (reason) => {
			const normalizedReason = normalizeDisconnectReason(reason);
			deps.telemetry.socketDisconnects.inc({ reason: normalizedReason });
			loggers.telemetry.event('socket_disconnect', {
				reason: normalizedReason,
				scope: socket.scope ?? 'unassigned',
			});
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
					if (socket.scope === 'recording') {
						const ownsPeer = deps.registry.leaveRecorder(
							socket,
							roomId,
							participantId,
						);
						if (ownsPeer) {
							await deps.mediasoup.removePeer(roomId, participantId);
						}
					}
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
								deps.registry.emitRaisedHand(roomId, {
									participantId,
									raised: false,
									timestamp: new Date().toISOString(),
								});
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
