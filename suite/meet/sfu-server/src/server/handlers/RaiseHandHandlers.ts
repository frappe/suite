import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { ensureParticipantOwner } from './utils';

export function registerRaiseHandHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('raise_hand', (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { roomId, participantId } = ensureParticipantOwner(
					socket,
					deps.registry,
				);
				const raised = typeof data?.raised === 'boolean' ? data.raised : false;

				deps.registry.emitRaisedHand(roomId, {
					participantId,
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
