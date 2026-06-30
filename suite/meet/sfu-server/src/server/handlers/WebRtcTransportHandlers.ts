import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { getRoomId } from './utils';

export function registerWebRtcTransportHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('create_webrtc_transport', async (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { direction } = data;
				const roomId = getRoomId(socket);
				const userId = socket.userId;

				const transportParams = await deps.mediasoup.createWebRtcTransport(
					roomId,
					userId,
					direction,
				);

				callback({ success: true, ...transportParams });
			} catch (error) {
				loggers.socketHandler.error(
					'Error creating WebRTC transport: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('connect_webrtc_transport', async (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { transportId, dtlsParameters } = data;
				await deps.mediasoup.connectWebRtcTransport(
					transportId,
					dtlsParameters,
				);

				callback({ success: true });
			} catch (error) {
				loggers.socketHandler.error(
					'Error connecting WebRTC transport: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('restart_webrtc_transport_ice', async (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { transportId } = data;
				const iceParameters =
					await deps.mediasoup.restartWebRtcTransportIce(transportId);

				callback({ success: true, iceParameters });
			} catch (error) {
				loggers.socketHandler.error(
					'Error restarting WebRTC transport ICE: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('create_plain_transport', async (_data, callback) => {
			try {
				const isDev = process.env.NODE_ENV === 'development';
				if (!isDev) {
					throw new Error(
						'PlainTransport creation is not allowed in this environment',
					);
				}

				deps.authManager.ensureFullAccess(socket);

				const roomId = getRoomId(socket);
				const userId = socket.userId;

				const transportParams = await deps.mediasoup.createPlainTransport(
					roomId,
					userId,
				);

				callback({ success: true, ...transportParams });
			} catch (error) {
				loggers.socketHandler.error(
					'Error creating PlainTransport: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});
	};
}
