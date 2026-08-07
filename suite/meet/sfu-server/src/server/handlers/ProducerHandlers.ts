import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { getRoomId } from './utils';

export function registerProducerHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('create_producer', async (data, callback) => {
			const startedAt = performance.now();
			const media =
				data.kind === 'audio' || data.kind === 'video' ? data.kind : 'unknown';
			const source = data.appData?.type === 'screen' ? 'screen' : 'camera';
			let outcome: 'success' | 'failure' = 'failure';
			try {
				deps.authManager.ensureFullAccess(socket);
				enforceE2EEMediaPolicy(socket);
				const { transportId, rtpParameters, kind, appData = {} } = data;
				const startPaused = !!appData.e2eeStartPaused;
				const roomId = getRoomId(socket);
				const producer = await deps.mediasoup.createProducer(
					transportId,
					roomId,
					socket.userId,
					rtpParameters,
					kind,
					appData,
					socket.senderId ?? 0,
					startPaused,
				);

				const isScreen =
					(producer.appData && producer.appData.type === 'screen') ||
					appData.type === 'screen';

				callback({ success: true, ...producer, isScreen });
				outcome = 'success';

				deps.registry.emitProducerCreated(roomId, {
					participantId: socket.userId,
					producerId: producer.id,
					kind: producer.kind,
					paused: startPaused,
					isScreen,
				});
			} catch (error) {
				loggers.socketHandler.error(
					'Error creating producer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			} finally {
				deps.telemetry.recordMediaOperation(
					{
						operation: 'create_producer',
						direction: 'send',
						media,
						source,
						outcome,
					},
					(performance.now() - startedAt) / 1000,
				);
			}
		});

		socket.on('close_producer', async (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { producerId, reason, source, details } = data;
				deps.mediasoup.assertProducerAccess(
					producerId,
					getRoomId(socket),
					socket.userId,
				);
				const result = deps.mediasoup.closeProducer(producerId);

				loggers.socketHandler.info(
					'close_producer peer=%s producer=%s isScreen=%s reason=%s source=%s details=%o',
					socket.participantId || socket.userId,
					producerId,
					!!result.isScreen,
					reason || 'unspecified',
					source || 'unspecified',
					details || {},
				);

				callback({ success: true, ...result });

				const roomId = getRoomId(socket);
				deps.registry.emitProducerClosed(roomId, {
					participantId: socket.userId,
					producerId,
					isScreen: !!result.isScreen,
					reason,
					source,
					details,
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
				deps.mediasoup.assertProducerAccess(
					producerId,
					getRoomId(socket),
					socket.userId,
				);
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
				deps.mediasoup.assertProducerAccess(
					producerId,
					getRoomId(socket),
					socket.userId,
				);
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

function enforceE2EEMediaPolicy(socket: Socket): void {
	if (!socket.e2eeRequired) return;
	if (!socket.e2eeReady) {
		throw new Error('E2EE join handshake not completed');
	}
}
