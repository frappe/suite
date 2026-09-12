import type { Socket } from 'socket.io';
import { normalizeDisconnectReason } from '../../telemetry/Telemetry';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';

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
			const peerId = socket.peerId ?? participantId;
			if (socket.scope === 'recording') {
				deps.registry.deactivateRecorder(socket);
			}

			if (roomId && participantId && peerId) {
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
					if (socket.scope === 'full') {
						await deps.participantConnections.disconnect(
							socket,
							roomId,
							participantId,
							peerId,
						);
					} else {
						deps.registry.leaveScope(socket, roomId, 'full');
						deps.registry.leaveScope(socket, roomId, 'presence-preview');
					}
				} catch (error) {
					loggers.socketHandler.error('Error handling disconnect: %s', error);
				}
			}
		});
	};
}
