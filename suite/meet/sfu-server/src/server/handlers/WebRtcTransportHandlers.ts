import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { getRoomId } from './utils';

export function registerWebRtcTransportHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		const encryptedWebRtcTransportIds = new Set<string>();

		socket.on('create_webrtc_transport', async (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { direction, encryptionEnabled } = data;
				enforceE2EETransportPolicy(socket, encryptionEnabled);
				const roomId = getRoomId(socket);
				const userId = socket.userId;

				const transportParams = await deps.mediasoup.createWebRtcTransport(
					roomId,
					userId,
					direction,
				);
				if (socket.e2eeRequired && encryptionEnabled) {
					encryptedWebRtcTransportIds.add(transportParams.id);
				}

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
				if (
					socket.e2eeRequired &&
					!encryptedWebRtcTransportIds.has(transportId)
				) {
					throw new Error(
						'Plain transport is not allowed when E2EE is required',
					);
				}
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

function enforceE2EETransportPolicy(
	socket: Socket,
	encryptionEnabled?: boolean,
): void {
	if (!socket.e2eeRequired) return;
	if (!socket.e2eeReady) {
		throw new Error('E2EE join handshake not completed');
	}
	if (!encryptionEnabled) {
		throw new Error('Encrypted transport is required for this room');
	}
}
