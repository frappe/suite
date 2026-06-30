import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';

export function registerErrorHandlers(_deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('error', (error) => {
			loggers.socketHandler.error('Socket error for %s: %s', socket.id, error);
			socket.emit('sfu_error', {
				error: (error as Error).message,
				timestamp: new Date().toISOString(),
			});
		});
	};
}
