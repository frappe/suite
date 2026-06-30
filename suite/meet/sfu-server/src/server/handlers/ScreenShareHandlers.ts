import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';

export function registerScreenShareHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('screen_share', (data) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { action, shareData } = data;
				const roomId = socket.roomId;

				if (!roomId) return;

				if (action === 'start_share') {
					deps.registry.emitToFullAccessParticipants(
						roomId,
						'screen_share_started',
						{
							participantId: socket.participantId,
							shareData,
							timestamp: new Date().toISOString(),
						},
					);
				} else if (action === 'stop_share') {
					deps.registry.emitToFullAccessParticipants(
						roomId,
						'screen_share_stopped',
						{
							participantId: socket.participantId,
							timestamp: new Date().toISOString(),
						},
					);
				}
			} catch (error) {
				loggers.socketHandler.warn(
					'screen_share handling failed: %s',
					(error as Error).message,
				);
			}
		});
	};
}
