import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { ensureParticipantOwner } from './utils';

export function registerMediaControlHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('media_control', async (data) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { roomId, participantId } = ensureParticipantOwner(
					socket,
					deps.registry,
				);
				const { action } = data;

				try {
					deps.mediasoup.applyMediaControl(roomId, participantId, action);
				} catch (e) {
					loggers.socketHandler.warn(
						'Failed to apply media control on server: %s',
						(e as Error).message,
					);
				}

				if (
					action === 'unmute' &&
					deps.registry.hasRaisedHand(roomId, participantId)
				) {
					deps.registry.clearRaisedHand(roomId, participantId);
					deps.registry.emitRaisedHand(roomId, {
						participantId,
						raised: false,
						timestamp: new Date().toISOString(),
					});
				}

				deps.registry.emitMediaControlUpdate(roomId, {
					participantId,
					action,
					timestamp: new Date().toISOString(),
				});
			} catch (error) {
				loggers.socketHandler.warn(
					'media_control handling failed: %s',
					(error as Error).message,
				);
			}
		});
	};
}
