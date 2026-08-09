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
				const participantId = socket.participantId;

				if (!roomId || !participantId) return;

				if (action === 'start_share') {
					loggers.socketHandler.info(
						'screen_share action=start_share peer=%s producer=%s',
						socket.participantId || socket.userId,
						shareData?.producerId || 'unspecified',
					);
					deps.registry.emitScreenShare(roomId, 'screen_share_started', {
						participantId,
						shareData: {
							...(typeof shareData?.producerId === 'string'
								? { producerId: shareData.producerId }
								: {}),
							...(typeof shareData?.streamId === 'string'
								? { streamId: shareData.streamId }
								: {}),
							...(shareData?.kind === 'video' ? { kind: shareData.kind } : {}),
							...(typeof shareData?.isScreen === 'boolean'
								? { isScreen: shareData.isScreen }
								: {}),
							...(typeof shareData?.startedAt === 'number' &&
							Number.isFinite(shareData.startedAt)
								? { startedAt: shareData.startedAt }
								: {}),
						},
						timestamp: new Date().toISOString(),
					});
				} else if (action === 'stop_share') {
					loggers.socketHandler.info(
						'screen_share action=stop_share peer=%s producer=%s reason=%s source=%s',
						socket.participantId || socket.userId,
						shareData?.producerId || 'unspecified',
						shareData?.reason || 'unspecified',
						shareData?.source || 'unspecified',
					);
					deps.registry.emitScreenShare(roomId, 'screen_share_stopped', {
						participantId,
						reason: shareData?.reason,
						timestamp: new Date().toISOString(),
					});
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
