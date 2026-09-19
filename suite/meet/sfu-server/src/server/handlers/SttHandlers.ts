import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps, TypedSocket } from './Handler';

/** Registers per-socket caption subscription controls. */
export function registerSttHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('stt:toggle', async (data, callback) => {
			if (typeof callback !== 'function') {
				loggers.socketHandler.warn(
					'Ignoring stt:toggle without acknowledgement',
				);
				return;
			}
			try {
				deps.authManager.ensureFullAccess(socket);
				if (!deps.sttManager) {
					callback({ success: false, error: 'STT is not configured' });
					return;
				}

				const typedSocket = socket as TypedSocket;
				const roomId = typedSocket.roomId;
				if (typeof data?.enabled !== 'boolean') {
					callback({ success: false, error: 'enabled must be a boolean' });
					return;
				}
				const enabled = data.enabled;

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
					const wasFirst = deps.sttManager.beginSession(roomId, socket.id);
					callback({ success: true, enabled });
					if (wasFirst) {
						void deps.mediasoup
							.startSttForExistingProducers(roomId)
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
