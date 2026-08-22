import { randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io';
import type { ChatMessage, PinnedChatMessage } from '../../types';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';

function toPinnedChatMessage(
	message: ChatMessage,
	content = message.message,
): PinnedChatMessage {
	return {
		messageId: message.messageId,
		message: content,
		fromUser: message.fromUser,
		fromName: message.fromName,
		timestamp: message.timestamp,
	};
}

export function registerChatHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('chat:toggle_restriction', (data) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const roomId = socket.roomId;

				if (!roomId || (!socket.isHost && !socket.isCohost)) return;
				const isRestricted = Boolean(data.enabled);
				deps.registry.setHostOnlyChat(roomId, isRestricted);

				deps.registry.emitToFullAccessParticipants(
					roomId,
					'chat:restriction_updated',
					{ enabled: isRestricted },
				);
			} catch (error) {
				loggers.socketHandler.warn('chat:toggle failed', error);
			}
		});

		socket.on('chat:send', (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const roomId = socket.roomId;
				const text = (
					typeof data.message === 'string' ? data.message : ''
				).slice(0, 2000);

				if (
					!roomId ||
					!text.trim() ||
					!socket.participantId ||
					!socket.userName
				) {
					callback?.({ success: false, error: 'Invalid chat message' });
					return;
				}

				if (
					deps.registry.isHostOnlyChat(roomId) &&
					!socket.isHost &&
					!socket.isCohost
				) {
					socket.emit('sfu_error', {
						error: 'Only hosts and co-hosts can send messages right now.',
						code: 'HOST_ONLY_CHAT',
						timestamp: new Date().toISOString(),
					});
					callback?.({
						success: false,
						error: 'Only hosts and co-hosts can send messages right now.',
					});
					return;
				}

				const payload: ChatMessage = {
					roomId,
					messageId: randomUUID(),
					message: text,
					fromUser: socket.participantId,
					fromName: socket.userName,
					timestamp: new Date().toISOString(),
				};
				if (data.clientId) payload.clientId = String(data.clientId);
				callback?.({
					success: true,
					timestamp: payload.timestamp,
					messageId: payload.messageId,
				});

				deps.registry.recordChatMessage(roomId, payload);
				deps.registry.emitPublicChat(roomId, payload);
			} catch (e) {
				callback?.({
					success: false,
					error: (e as Error).message || String(e),
				});
				loggers.socketHandler.warn(
					'chat:send handling failed: %s',
					(e as Error).message || e,
				);
			}
		});

		socket.on('chat:pin', (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const roomId = socket.roomId;

				if (!roomId || (!socket.isHost && !socket.isCohost)) {
					callback?.({
						success: false,
						error: 'Only hosts and co-hosts can pin messages',
					});
					return;
				}

				const messageId =
					typeof data?.messageId === 'string' ? data.messageId : '';
				const action = data?.action;
				if (!messageId || (action !== 'pin' && action !== 'unpin')) {
					callback?.({ success: false, error: 'Invalid chat message' });
					return;
				}

				const existing = deps.registry.getPinnedChatMessage(roomId);
				if (action === 'unpin') {
					if (existing?.messageId !== messageId) {
						callback?.({ success: true });
						return;
					}
					deps.registry.setPinnedChatMessage(roomId, null);
					deps.registry.emitToFullAccessParticipants(
						roomId,
						'chat:pin_updated',
						{
							pinned: null,
						},
					);
					callback?.({ success: true });
					return;
				}
				if (
					existing?.messageId === messageId &&
					typeof data.encryptedMessage !== 'string'
				) {
					callback?.({ success: true });
					return;
				}

				const message = deps.registry.getRecentChatMessage(roomId, messageId);
				if (!message) {
					callback?.({
						success: false,
						error: 'Message is no longer available to pin',
					});
					return;
				}

				const encryptedMessage =
					typeof data.encryptedMessage === 'string'
						? data.encryptedMessage
						: message.message;
				const pinned = toPinnedChatMessage(message, encryptedMessage);
				deps.registry.setPinnedChatMessage(roomId, pinned);
				deps.registry.emitToFullAccessParticipants(roomId, 'chat:pin_updated', {
					pinned,
				});
				callback?.({ success: true });
			} catch (e) {
				callback?.({
					success: false,
					error: (e as Error).message || String(e),
				});
				loggers.socketHandler.warn(
					'chat:pin handling failed: %s',
					(e as Error).message || e,
				);
			}
		});
	};
}
