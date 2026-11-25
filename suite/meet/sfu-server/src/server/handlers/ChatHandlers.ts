import { randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io';
import {
	CHAT_TOO_LONG_ERROR,
	E2EE_CHAT_PREFIX,
	MAX_CHAT_TEXT_BYTES,
	MAX_ENCRYPTED_CHAT_LENGTH,
} from '../../../../types/chatLimits';
import { isChatReaction } from '../../../../types/chatReactions';
import type { ChatMessage, PinnedChatMessage } from '../../types';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { ensureParticipantOwner } from './utils';

function isChatTooLong(text: string): boolean {
	const limit = text.startsWith(E2EE_CHAT_PREFIX)
		? MAX_ENCRYPTED_CHAT_LENGTH
		: MAX_CHAT_TEXT_BYTES;
	return Buffer.byteLength(text, 'utf8') > limit;
}

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
		replyTo: message.replyTo,
	};
}

export function registerChatHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('chat:toggle_restriction', (data) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { roomId } = ensureParticipantOwner(socket, deps.registry);

				if (!socket.isHost && !socket.isCohost) return;
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
				const { roomId, participantId } = ensureParticipantOwner(
					socket,
					deps.registry,
				);
				const text = typeof data?.message === 'string' ? data.message : '';
				if (isChatTooLong(text)) {
					callback?.({ success: false, error: CHAT_TOO_LONG_ERROR });
					return;
				}

				if (!text.trim() || !socket.userName) {
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

				const replyToId = data.replyToId;
				const original = typeof replyToId === 'string'
					? deps.registry.getChatReplyTarget(roomId, participantId, replyToId)
					: undefined;
				if (replyToId !== undefined && !original) {
					callback?.({
						success: false,
						error: 'Message is no longer available to reply to',
					});
					return;
				}

				const payload: ChatMessage = {
					roomId,
					messageId: randomUUID(),
					message: text,
					fromUser: participantId,
					fromName: socket.userName,
					timestamp: new Date().toISOString(),
				};
				if (original) {
					payload.replyTo = {
						messageId: original.messageId,
						fromName: original.fromName,
						message: original.message,
					};
				}
				if (data.clientId) payload.clientId = String(data.clientId);
				callback?.({
					success: true,
					timestamp: payload.timestamp,
					messageId: payload.messageId,
				});

				const evictedMessageId = deps.registry.recordChatMessage(roomId, payload);
				if (evictedMessageId) {
					deps.registry.emitToFullAccessParticipants(roomId, 'chat:message_evicted', {
						messageId: evictedMessageId,
					});
				}
				deps.registry.emitPublicChat(roomId, payload);
			} catch (e) {
				callback?.({
					success: false,
					error: (e instanceof Error ? e.message : String(e)) || String(e),
				});
				loggers.socketHandler.warn(
					'chat:send handling failed: %s',
					(e instanceof Error ? e.message : String(e)) || e,
				);
			}
		});

		socket.on('chat:react', (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { roomId, participantId } = ensureParticipantOwner(
					socket,
					deps.registry,
				);
				if (
					typeof data?.messageId !== 'string' ||
					!isChatReaction(data.emoji) ||
					typeof data.active !== 'boolean'
				) {
					callback?.({ success: false, error: 'Invalid chat reaction' });
					return;
				}
				if (
					data.active &&
					deps.registry.isHostOnlyChat(roomId) &&
					!socket.isHost &&
					!socket.isCohost
				) {
					callback?.({
						success: false,
						error: 'Only hosts and co-hosts can add reactions right now.',
					});
					return;
				}

				const update = deps.registry.setChatReaction(
					roomId,
					participantId,
					data,
				);
				if (!update) {
					callback?.({
						success: false,
						error: 'Message is no longer available to react to',
					});
					return;
				}
				deps.registry.emitToFullAccessParticipants(
					roomId,
					'chat:reactions_updated',
					update,
				);
				callback?.({ success: true });
			} catch (error) {
				callback?.({
					success: false,
					error: error instanceof Error ? error.message : String(error),
				});
				loggers.socketHandler.warn('chat:react failed', error);
			}
		});

		socket.on('chat:pin', (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { roomId } = ensureParticipantOwner(socket, deps.registry);

				if (!socket.isHost && !socket.isCohost) {
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
				if (isChatTooLong(encryptedMessage)) {
					callback?.({ success: false, error: CHAT_TOO_LONG_ERROR });
					return;
				}
				const pinned = toPinnedChatMessage(message, encryptedMessage);
				deps.registry.setPinnedChatMessage(roomId, pinned);
				deps.registry.emitToFullAccessParticipants(roomId, 'chat:pin_updated', {
					pinned,
				});
				callback?.({ success: true });
			} catch (e) {
				callback?.({
					success: false,
					error: (e instanceof Error ? e.message : String(e)) || String(e),
				});
				loggers.socketHandler.warn(
					'chat:pin handling failed: %s',
					(e instanceof Error ? e.message : String(e)) || e,
				);
			}
		});
	};
}
