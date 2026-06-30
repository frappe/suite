import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';

export function registerMediaControlHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('media_control', async (data) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { action } = data;
				const roomId = socket.roomId;

				if (!roomId || !socket.participantId) return;

				try {
					deps.mediasoup.applyMediaControl(
						roomId,
						socket.participantId,
						action,
					);
				} catch (e) {
					loggers.socketHandler.warn(
						'Failed to apply media control on server: %s',
						(e as Error).message,
					);
				}

				if (
					action === 'unmute' &&
					deps.registry.hasRaisedHand(roomId, socket.participantId)
				) {
					deps.registry.clearRaisedHand(roomId, socket.participantId);
					deps.registry.emitToFullAccessParticipants(roomId, 'hand_raised', {
						participantId: socket.participantId,
						raised: false,
						timestamp: new Date().toISOString(),
					});
				}

				deps.registry.emitToFullAccessParticipants(
					roomId,
					'media_control_update',
					{
						participantId: socket.participantId,
						action,
						timestamp: new Date().toISOString(),
					},
				);
			} catch (error) {
				loggers.socketHandler.warn(
					'media_control handling failed: %s',
					(error as Error).message,
				);
			}
		});
	};
}
