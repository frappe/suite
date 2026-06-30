import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { getRoomId } from './utils';

export function registerProducerHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('create_producer', async (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { transportId, rtpParameters, kind, appData = {} } = data;
				const producer = await deps.mediasoup.createProducer(
					transportId,
					rtpParameters,
					kind,
					appData,
				);

				const isScreen =
					(producer.appData && producer.appData.type === 'screen') ||
					appData.type === 'screen';

				callback({ success: true, ...producer, isScreen });

				const roomId = getRoomId(socket);
				deps.registry.emitToFullAccessParticipants(roomId, 'producer_created', {
					roomId,
					participantId: socket.userId,
					producerId: producer.id,
					kind: producer.kind,
					paused: false,
					isScreen,
				});
			} catch (error) {
				loggers.socketHandler.error(
					'Error creating producer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('close_producer', async (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { producerId } = data;
				const result = deps.mediasoup.closeProducer(producerId);

				callback({ success: true, ...result });

				const roomId = getRoomId(socket);
				deps.registry.emitToFullAccessParticipants(roomId, 'producer_closed', {
					roomId,
					participantId: socket.userId,
					producerId,
					isScreen: !!result.isScreen,
				});

				try {
					for (const rc of result.removedConsumers) {
						const targetPeerSocket = Array.from(
							deps.io.sockets.sockets.values(),
						).find((s) => s.userId === rc.peerId && s.roomId === rc.roomId);
						if (targetPeerSocket) {
							targetPeerSocket.emit('consumer_closed', {
								consumerId: rc.consumerId,
							});
						} else {
							deps.registry.emitToFullAccessParticipants(
								roomId,
								'consumer_closed',
								{ consumerId: rc.consumerId, peerId: rc.peerId },
							);
						}
					}
				} catch (e) {
					loggers.socketHandler.warn(
						'Failed to emit consumer_closed notifications: %s',
						(e as Error).message,
					);
				}
			} catch (error) {
				loggers.socketHandler.error(
					'Error closing producer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('pause_producer', async (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { producerId } = data;
				const paused = await deps.mediasoup.pauseProducer(producerId);

				callback({ success: true, paused });
			} catch (error) {
				loggers.socketHandler.error(
					'Error pausing producer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('resume_producer', async (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { producerId } = data;
				const resumed = await deps.mediasoup.resumeProducer(producerId);

				callback({ success: true, resumed });
			} catch (error) {
				loggers.socketHandler.error(
					'Error resuming producer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});
	};
}
