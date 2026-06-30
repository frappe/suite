import type { Socket } from 'socket.io';
import type { ReactionMessage } from '../../types';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';

export function registerReactionHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('reaction:send', (data = {}) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const roomId = socket.roomId;
				const reaction =
					typeof data.reaction === 'string' ? data.reaction : null;

				if (!roomId || !reaction || !socket.participantId) {
					return;
				}

				const payload: ReactionMessage = {
					roomId,
					reaction,
					fromUser: socket.participantId,
					fromName: socket.userName,
					timestamp: new Date().toISOString(),
				};

				deps.registry.emitToFullAccessParticipants(
					roomId,
					'reaction:message',
					payload,
				);
			} catch (e) {
				loggers.socketHandler.warn(
					'reaction:send handling failed: %s',
					(e as Error).message || e,
				);
			}
		});
	};
}
