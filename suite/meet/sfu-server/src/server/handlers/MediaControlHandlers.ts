import type { Socket } from 'socket.io';
import type { MediaControlAction } from '../../types';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { ensureParticipantOwner } from './utils';

function normalizeMediaControlAction(value: unknown): MediaControlAction {
	if (
		value === 'mute' ||
		value === 'unmute' ||
		value === 'video_off' ||
		value === 'video_on'
	)
		return value;
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		const { type, enabled } = value as { type?: unknown; enabled?: unknown };
		if (typeof enabled === 'boolean') {
			if (type === 'audio') return enabled ? 'unmute' : 'mute';
			if (type === 'video') return enabled ? 'video_on' : 'video_off';
		}
	}
	throw new Error('invalid media control action');
}

export function registerMediaControlHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('media_control', async (data) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { roomId, participantId } = ensureParticipantOwner(
					socket,
					deps.registry,
				);
				const action = normalizeMediaControlAction(data.action);

				try {
					deps.mediasoup.applyMediaControl(roomId, participantId, action);
				} catch (e) {
					loggers.socketHandler.warn(
						'Failed to apply media control on server: %s',
						(e as Error).message,
					);
				}

				if (
					action === 'unmute' &&
					deps.registry.hasRaisedHand(roomId, participantId)
				) {
					deps.registry.clearRaisedHand(roomId, participantId);
					deps.registry.emitRaisedHand(roomId, {
						participantId,
						raised: false,
						timestamp: new Date().toISOString(),
					});
				}

				deps.registry.emitMediaControlUpdate(roomId, {
					participantId,
					action,
					timestamp: new Date().toISOString(),
				});
			} catch (error) {
				loggers.socketHandler.warn(
					'media_control handling failed: %s',
					(error as Error).message,
				);
			}
		});
	};
}
