import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { getRoomId } from './utils';

export function registerProducerHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('create_producer', async (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				enforceE2EEMediaPolicy(socket);
				const { transportId, rtpParameters, kind, appData = {} } = data;
				const startPaused = !!appData.e2eeStartPaused;
				const producer = await deps.mediasoup.createProducer(
					transportId,
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

				const roomId = getRoomId(socket);
				deps.registry.emitToFullAccessParticipants(roomId, 'producer_created', {
					roomId,
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
			}
		});

		socket.on('close_producer', async (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { producerId, reason, source, details } = data;
				const ownerCheck = assertProducerOwnership(
					deps,
					producerId,
					socket.userId,
				);
				if (!ownerCheck.ok) {
					callback({ success: false, error: ownerCheck.error });
					return;
				}
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
				deps.registry.emitToFullAccessParticipants(roomId, 'producer_closed', {
					roomId,
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
				const ownerCheck = assertProducerOwnership(
					deps,
					producerId,
					socket.userId,
				);
				if (!ownerCheck.ok) {
					callback({ success: false, error: ownerCheck.error });
					return;
				}
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
				const ownerCheck = assertProducerOwnership(
					deps,
					producerId,
					socket.userId,
				);
				if (!ownerCheck.ok) {
					callback({ success: false, error: ownerCheck.error });
					return;
				}
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

function assertProducerOwnership(
	deps: HandlerDeps,
	producerId: string,
	userId: string,
): { ok: true } | { ok: false; error: string } {
	const producerData = deps.mediasoup.getProducerData(producerId);
	if (!producerData) return { ok: false, error: 'Producer not found' };
	if (producerData.peerId !== userId) {
		loggers.socketHandler.warn(
			'Producer ownership mismatch: user %s attempted to operate producer %s owned by %s',
			userId,
			producerId,
			producerData.peerId,
		);
		return { ok: false, error: 'Not the owner of this producer' };
	}
	return { ok: true };
}
