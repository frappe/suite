import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';

export function registerAuthHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('auth:update_token', (data, callback) => {
			try {
				if (socket.scope === 'recording') {
					callback({
						success: false,
						error: 'Token refresh is unavailable for recording',
					});
					return;
				}
				const token = typeof data?.token === 'string' ? data.token : null;
				if (!token) {
					deps.telemetry.authEvents.inc({
						stage: 'refresh',
						reason: 'missing_token',
						outcome: 'failure',
					});
					callback({ success: false, error: 'Missing token' });
					return;
				}

				deps.authManager.updateSocketToken(socket, token);
				deps.telemetry.authEvents.inc({
					stage: 'refresh',
					reason: 'valid',
					outcome: 'success',
				});
				callback({ success: true });
			} catch (error) {
				deps.telemetry.authEvents.inc({
					stage: 'refresh',
					reason: 'invalid_token',
					outcome: 'failure',
				});
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
