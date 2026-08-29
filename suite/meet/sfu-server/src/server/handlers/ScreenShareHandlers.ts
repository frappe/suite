import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { getPeerId } from './utils';

export function registerScreenShareHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('screen_share', (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { action, shareData } = data;
				const roomId = socket.roomId;
				const participantId = socket.participantId;

				if (!roomId || !participantId) {
					throw new Error('Screen share requires an active room participant');
				}

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
					const producerId = shareData?.producerId;
					if (typeof producerId !== 'string' || !producerId) {
						loggers.socketHandler.warn(
							'screen_share action=stop_share peer=%s missing producer identity',
							socket.participantId || socket.userId,
						);
						throw new Error('Screen share stop requires a producer identity');
					}
					const producer = deps.mediasoup.assertProducerAccess(
						producerId,
						roomId,
						getPeerId(socket),
					);
					if (
						producer.producer.kind !== 'video' ||
						producer.producer.appData?.type !== 'screen'
					) {
						throw new Error(`Producer ${producerId} is not a screen producer`);
					}
					loggers.socketHandler.info(
						'screen_share action=stop_share peer=%s producer=%s reason=%s source=%s',
						socket.participantId || socket.userId,
						shareData?.producerId || 'unspecified',
						shareData?.reason || 'unspecified',
						shareData?.source || 'unspecified',
					);
					deps.registry.emitScreenShare(roomId, 'screen_share_stopped', {
						participantId,
						producerId,
						reason: shareData?.reason,
						timestamp: new Date().toISOString(),
					});
				}
				callback?.({ success: true });
			} catch (error) {
				loggers.socketHandler.warn(
					'screen_share handling failed: %s',
					(error as Error).message,
				);
				callback?.({ success: false, error: (error as Error).message });
			}
		});
	};
}
