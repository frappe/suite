import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps, TypedSocket } from './Handler';

/** Registers per-socket caption subscription controls. */
export function registerSttHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('stt:toggle', async (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				if (!deps.sttManager) {
					callback({ success: false, error: 'STT is not configured' });
					return;
				}

				const typedSocket = socket as TypedSocket;
				const roomId = typedSocket.roomId;
				const enabled =
					typeof data?.enabled === 'boolean' ? data.enabled : false;

				if (!roomId) {
					callback({ success: false, error: 'Not in a room' });
					return;
				}
				if (enabled && typedSocket.e2eeRequired) {
					callback({
						success: false,
						error: 'Captions are unavailable when E2EE is required',
					});
					return;
				}

				if (enabled) {
					const wasFirst = deps.sttManager.addSubscriber(roomId, socket.id);
					callback({ success: true, enabled });
					if (wasFirst) {
						void deps.mediasoup
							.startSttForExistingProducers(roomId, deps.sttManager)
							.catch((error) => {
								loggers.socketHandler.warn(
									'Failed to start STT for room %s: %s',
									roomId,
									(error as Error).message,
								);
							});
					}
				} else {
					const wasLast = deps.sttManager.removeSubscriber(roomId, socket.id);
					callback({ success: true, enabled });
					if (wasLast) {
						void deps.sttManager.stopRoom(roomId, true).catch((error) => {
							loggers.socketHandler.warn(
								'Failed to stop STT for room %s: %s',
								roomId,
								(error as Error).message,
							);
						});
					}
				}
			} catch (error) {
				loggers.socketHandler.warn(
					'stt:toggle failed: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});
	};
}
