import type { Socket } from 'socket.io';
import { direction } from '../../telemetry/Telemetry';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { getPeerId, getRoomId } from './utils';

export function registerWebRtcTransportHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		const encryptedWebRtcTransportIds = new Set<string>();
		const transportDirections = new Map<string, ReturnType<typeof direction>>();

		socket.on('create_webrtc_transport', async (data, callback) => {
			const startedAt = performance.now();
			const transportDirection = direction(data.direction);
			try {
				deps.authManager.ensureMediaConsumerAccess(socket);
				const { direction, encryptionEnabled } = data;
				if (socket.scope === 'recording' && direction !== 'recv')
					throw new Error('Recorder send transports are not permitted');
				enforceE2EETransportPolicy(socket, encryptionEnabled);
				const roomId = getRoomId(socket);
				const peerId = getPeerId(socket);

				const transportParams = await deps.mediasoup.createWebRtcTransport(
					roomId,
					peerId,
					direction,
				);
				if (socket.e2eeRequired && encryptionEnabled) {
					encryptedWebRtcTransportIds.add(transportParams.id);
				}
				transportDirections.set(transportParams.id, transportDirection);

				callback({ success: true, ...transportParams });
				deps.telemetry.recordTransportOperation(
					{
						operation: 'create',
						direction: transportDirection,
						outcome: 'success',
					},
					(performance.now() - startedAt) / 1000,
				);
			} catch (error) {
				deps.telemetry.recordTransportOperation(
					{
						operation: 'create',
						direction: transportDirection,
						outcome: 'failure',
					},
					(performance.now() - startedAt) / 1000,
				);
				loggers.socketHandler.error(
					'Error creating WebRTC transport: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('connect_webrtc_transport', async (data, callback) => {
			const startedAt = performance.now();
			const transportDirection =
				transportDirections.get(data.transportId) ?? 'unknown';
			try {
				deps.authManager.ensureMediaConsumerAccess(socket);
				const { transportId, dtlsParameters } = data;
				if (socket.scope === 'recording' && transportDirection !== 'recv') {
					throw new Error('Recorder may connect only its receive transport');
				}
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
					getRoomId(socket),
					getPeerId(socket),
					socket.scope === 'recording' ? 'recv' : undefined,
				);

				callback({ success: true });
				deps.telemetry.recordTransportOperation(
					{
						operation: 'connect',
						direction: transportDirection,
						outcome: 'success',
					},
					(performance.now() - startedAt) / 1000,
				);
			} catch (error) {
				deps.telemetry.recordTransportOperation(
					{
						operation: 'connect',
						direction: transportDirection,
						outcome: 'failure',
					},
					(performance.now() - startedAt) / 1000,
				);
				loggers.socketHandler.error(
					'Error connecting WebRTC transport: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('restart_webrtc_transport_ice', async (data, callback) => {
			const startedAt = performance.now();
			const transportDirection =
				transportDirections.get(data.transportId) ?? 'unknown';
			try {
				deps.authManager.ensureMediaConsumerAccess(socket);
				const { transportId } = data;
				if (socket.scope === 'recording' && transportDirection !== 'recv') {
					throw new Error('Recorder may restart only its receive transport');
				}
				const iceParameters = await deps.mediasoup.restartWebRtcTransportIce(
					transportId,
					getRoomId(socket),
					getPeerId(socket),
					socket.scope === 'recording' ? 'recv' : undefined,
				);

				callback({ success: true, iceParameters });
				deps.telemetry.recordTransportOperation(
					{
						operation: 'restart_ice',
						direction: transportDirection,
						outcome: 'success',
					},
					(performance.now() - startedAt) / 1000,
				);
			} catch (error) {
				deps.telemetry.recordTransportOperation(
					{
						operation: 'restart_ice',
						direction: transportDirection,
						outcome: 'failure',
					},
					(performance.now() - startedAt) / 1000,
				);
				loggers.socketHandler.error(
					'Error restarting WebRTC transport ICE: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('create_plain_transport', async (_data, callback) => {
			try {
				if (!deps.runtime.allowPlainTransport) {
					throw new Error(
						'PlainTransport creation is not allowed in this environment',
					);
				}

				deps.authManager.ensureFullAccess(socket);

				const roomId = getRoomId(socket);
				const peerId = getPeerId(socket);

				const transportParams = await deps.mediasoup.createPlainTransport(
					roomId,
					peerId,
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
