import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';

export function registerAuthHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('auth:update_token', (data, callback) => {
			try {
				const token = typeof data?.token === 'string' ? data.token : null;
				if (!token) {
					callback({ success: false, error: 'Missing token' });
					return;
				}

				deps.authManager.updateSocketToken(socket, token);
				callback({ success: true });
			} catch (error) {
				const message = (error as Error).message || 'Token update failed';
				loggers.socketHandler.warn(
					'auth:update_token failed for socket %s: %s',
					socket.id,
					message,
				);
				callback({ success: false, error: message });
				deps.authManager.triggerTokenExpiry(socket, 'invalid_refresh_token');
			}
		});
	};
}
