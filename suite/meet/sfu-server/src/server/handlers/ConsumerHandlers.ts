import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';

export function registerConsumerHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('create_consumer', async (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				enforceE2EEMediaPolicy(socket);
				const { transportId, producerId, rtpCapabilities } = data;
				const consumer = await deps.mediasoup.createConsumer(
					transportId,
					producerId,
					rtpCapabilities,
				);

				callback({ success: true, ...consumer });
			} catch (error) {
				loggers.socketHandler.error(
					'Error creating consumer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('close_consumer', async (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { consumerId } = data;
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
				const consumerId = data?.consumerId;
				if (!consumerId) {
					callback({ success: false, error: 'Missing consumerId' });
					return;
				}

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
				deps.authManager.ensureFullAccess(socket);
				const { consumerId } = data;
				const consumerData = deps.mediasoup.getConsumerData(consumerId);
				if (!consumerData) {
					callback({ success: false, error: 'Consumer not found' });
					return;
				}
				if (consumerData.peerId !== socket.userId) {
					callback({ success: false, error: 'Consumer ownership mismatch' });
					return;
				}
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
