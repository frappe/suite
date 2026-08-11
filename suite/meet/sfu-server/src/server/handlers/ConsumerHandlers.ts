import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { getRoomId } from './utils';

export function registerConsumerHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('create_consumer', async (data, callback) => {
			const startedAt = performance.now();
			let media: 'audio' | 'video' | 'unknown' = 'unknown';
			let source: 'camera' | 'screen' | 'unknown' = 'unknown';
			let outcome: 'success' | 'failure' = 'failure';
			try {
				deps.authManager.ensureMediaConsumerAccess(socket);
				enforceE2EEMediaPolicy(socket);
				const { transportId, producerId, rtpCapabilities } = data;
				const roomId = getRoomId(socket);
				const producer = deps.mediasoup.getProducer(producerId);
				if (producer) {
					source = producer.appData?.type === 'screen' ? 'screen' : 'camera';
				}
				const consumer = await deps.mediasoup.createConsumer(
					transportId,
					producerId,
					roomId,
					socket.userId,
					rtpCapabilities,
				);
				media =
					consumer.kind === 'audio' || consumer.kind === 'video'
						? consumer.kind
						: 'unknown';

				callback({ success: true, ...consumer });
				outcome = 'success';
			} catch (error) {
				loggers.socketHandler.error(
					'Error creating consumer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			} finally {
				deps.telemetry.recordMediaOperation(
					{
						operation: 'create_consumer',
						direction: 'recv',
						media,
						source,
						outcome,
					},
					(performance.now() - startedAt) / 1000,
				);
			}
		});

		socket.on('close_consumer', async (data, callback) => {
			try {
				deps.authManager.ensureMediaConsumerAccess(socket);
				const { consumerId } = data;
				deps.mediasoup.assertConsumerAccess(
					consumerId,
					getRoomId(socket),
					socket.userId,
				);
				await deps.mediasoup.closeConsumer(consumerId);

				callback({ success: true });
			} catch (error) {
				loggers.socketHandler.error(
					'Error closing consumer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('consumer:update_preferences', async (data, callback) => {
			try {
				deps.authManager.ensureMediaConsumerAccess(socket);
				const consumerId = data?.consumerId;
				if (!consumerId) {
					callback({ success: false, error: 'Missing consumerId' });
					return;
				}
				deps.mediasoup.assertConsumerAccess(
					consumerId,
					getRoomId(socket),
					socket.userId,
				);

				const visible = Boolean(data.visible);
				const width = Math.round(data.width);
				const height = Math.round(data.height);

				const result = await deps.mediasoup.updateConsumerPreferences({
					consumerId,
					visible,
					width,
					height,
				});

				callback({ success: true, ...result, visible });
			} catch (error) {
				loggers.socketHandler.warn(
					'Error updating consumer preferences: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('request_consumer_keyframe', async (data, callback) => {
			try {
				deps.authManager.ensureMediaConsumerAccess(socket);
				const { consumerId } = data;
				deps.mediasoup.assertConsumerAccess(
					consumerId,
					getRoomId(socket),
					socket.userId,
				);
				const requested =
					await deps.mediasoup.requestConsumerKeyFrame(consumerId);
				callback({ success: true, requested });
			} catch (error) {
				loggers.socketHandler.error(
					'Error requesting consumer key frame: %s',
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
