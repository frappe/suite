import type { Socket } from 'socket.io';
import type { UserData } from '../../types';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { getRoomId, isRealParticipant } from './utils';

export function registerRoomJoinHandlers(deps: HandlerDeps) {
	async function handleJoinRoom(
		socket: Socket,
		data: { roomId: string; participantId: string; userData: UserData },
	): Promise<void> {
		const { roomId, participantId, userData } = data;

		try {
			if (socket.meetingId && socket.meetingId !== roomId) {
				throw new Error(
					`Room ID mismatch: token has ${socket.meetingId}, trying to join ${roomId}`,
				);
			}

			const scopedRoomId = getRoomId(socket);

			await deps.mediasoup.createRoom(
				scopedRoomId,
				(roomIdInner, participantIds) => {
					deps.registry.emitToFullAccessParticipants(
						roomIdInner,
						'active_speaker',
						{ participantIds },
					);
				},
			);

			socket.join(scopedRoomId);

			socket.roomId = scopedRoomId;
			socket.participantId = participantId;

			if (socket.scope === 'full') {
				deps.registry.joinScope(socket, scopedRoomId, 'full');
				deps.mediasoup.addPeer(scopedRoomId, participantId, userData);

				if (isRealParticipant(userData.userId)) {
					deps.registry.emitParticipantEvent(
						scopedRoomId,
						'participant_joined',
						participantId,
						userData,
					);
				}

				loggers.socketHandler.info(
					'User %s joined room %s with media state: audio=%s, video=%s',
					participantId,
					scopedRoomId,
					userData.audio_enabled,
					userData.video_enabled,
				);
			} else if (socket.scope === 'presence-preview') {
				deps.registry.joinScope(socket, scopedRoomId, 'presence-preview');

				loggers.socketHandler.info(
					'Preview user %s observing room %s (not added as peer)',
					participantId,
					scopedRoomId,
				);
			}

			socket.emit('existing_raised_hands', {
				hands: deps.registry.getRaisedHands(scopedRoomId) as unknown as Record<
					string,
					boolean
				>,
			});
		} catch (error) {
			loggers.socketHandler.error(
				'Error in handleJoinRoom for user %s: %s',
				participantId,
				(error as Error).message,
			);
			throw error;
		}
	}

	return (socket: Socket) => {
		socket.on('join_room', async (data, callback) => {
			try {
				if (!socket.userId || !socket.meetingId) {
					callback({ success: false, error: 'Authentication required' });
					return;
				}

				const { roomId, userData, mediaState } = data;
				await handleJoinRoom(socket, {
					roomId,
					participantId: socket.userId,
					userData: {
						name: userData.name,
						userId: userData.userId,
						avatar: userData.avatar,
						audio_enabled: mediaState.audio_enabled,
						video_enabled: mediaState.video_enabled,
						is_guest: userData.is_guest,
					},
				});
				callback({ success: true });
			} catch (error) {
				loggers.socketHandler.error(
					'Error joining room: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('leave_room', async (data = {}) => {
			const roomId =
				socket.roomId || (data.roomId ? getRoomId(socket) : undefined);
			const participantId = socket.participantId;
			if (roomId && participantId) {
				try {
					await deps.mediasoup.removePeer(roomId, participantId);

					if (isRealParticipant(participantId)) {
						socket
							.to(roomId)
							.emit('participant_left', { roomId, participantId });
					}

					if (deps.registry.hasRaisedHand(roomId, participantId)) {
						deps.registry.clearRaisedHand(roomId, participantId);
						deps.registry.emitToFullAccessParticipants(roomId, 'hand_raised', {
							participantId,
							raised: false,
							timestamp: new Date().toISOString(),
						});
					}

					socket.leave(roomId);
					socket.roomId = undefined;
					loggers.socketHandler.info('%s left room %s', participantId, roomId);
				} catch (e) {
					loggers.socketHandler.warn(
						'leave_room cleanup failed: %s',
						(e as Error).message,
					);
				}
			}
		});
	};
}
