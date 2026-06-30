import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';

export function registerRaiseHandHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('raise_hand', (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const roomId = socket.roomId;
				const raised = typeof data?.raised === 'boolean' ? data.raised : false;

				if (!roomId || !socket.participantId) {
					callback({ success: false, error: 'Invalid room or participant' });
					return;
				}

				if (raised) {
					deps.registry.setRaisedHand(
						roomId,
						socket.participantId,
						new Date().toISOString(),
					);
				} else {
					deps.registry.clearRaisedHand(roomId, socket.participantId);
				}

				deps.registry.emitToFullAccessParticipants(roomId, 'hand_raised', {
					participantId: socket.participantId,
					raised,
					timestamp: new Date().toISOString(),
				});

				callback({ success: true });
			} catch (e) {
				loggers.socketHandler.warn(
					'raise_hand handling failed: %s',
					(e as Error).message || e,
				);
				callback({ success: false, error: 'Internal error' });
			}
		});
	};
}
