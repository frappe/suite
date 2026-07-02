import type { Socket } from 'socket.io';
import type { UserData } from '../../types';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { getRoomId, isRealParticipant } from './utils';

export function registerRoomJoinHandlers(deps: HandlerDeps) {
	async function handleJoinRoom(
		socket: Socket,
		data: {
			roomId: string;
			participantId: string;
			userData: UserData;
			e2ee?: { enabled?: boolean; capability?: { supported?: boolean } };
		},
	): Promise<void> {
		const { roomId, participantId, userData, e2ee } = data;

		try {
			if (socket.meetingId && socket.meetingId !== roomId) {
				throw new Error(
					`Room ID mismatch: token has ${socket.meetingId}, trying to join ${roomId}`,
				);
			}

			const scopedRoomId = getRoomId(socket);
			if (socket.scope === 'full') {
				enforceE2EEJoinPolicy(socket, e2ee);
			}

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
				deps.registry.claimParticipant(socket, scopedRoomId, participantId);
				const senderId = deps.registry.assignSenderId(
					scopedRoomId,
					participantId,
				);
				socket.senderId = senderId;
				if (!socket.e2eeRequired) {
					await deps.e2eeRoster.add(scopedRoomId, {
						participantId,
						senderId,
						isHost: Boolean(socket.isHost),
						joinedAt: Date.now(),
					});
				}
				await deps.e2eeEpochRelay.retryPendingCommitRequests(scopedRoomId);

				const existingPeer = deps.mediasoup
					.getRoomPeers?.(scopedRoomId)
					?.get(participantId);
				if (existingPeer) {
					loggers.socketHandler.info(
						'Peer %s already in room %s — clearing stale transports/producers before rejoin',
						participantId,
						scopedRoomId,
					);
					await deps.mediasoup.removePeer(scopedRoomId, participantId);
				}
				deps.mediasoup.addPeer(scopedRoomId, participantId, {
					...userData,
					senderId: socket.senderId,
					isHost: Boolean(socket.isHost),
				});

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

				const { roomId, userData, mediaState, e2ee } = data;
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
					e2ee,
				});
				callback({ success: true, senderId: socket.senderId });
				void requestEpochKeyPackageAfterJoin(
					socket,
					deps,
					getRoomId(socket),
					socket.userId,
				).catch((error: unknown) => {
					loggers.socketHandler.error(
						'e2ee admission request failed for user %s in room %s: %s',
						socket.userId,
						getRoomId(socket),
						(error as Error).message,
					);
					socket.emit('e2ee:epoch', {
						type: 'join-status',
						status: 'failed',
						epochNumber: deps.e2eeEpochRelay.getCurrentEpochNumber(
							getRoomId(socket),
						),
						message:
							'Could not set up encryption for this meeting. Please leave and try again.',
					});
				});
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
					const shouldCleanupPeer = deps.registry.releaseParticipant(
						socket,
						roomId,
						participantId,
					);
					if (shouldCleanupPeer) {
						if (socket.senderId !== undefined) {
							await deps.e2eeRoster.remove(roomId, socket.senderId);
							deps.e2eeEpochRelay.removePendingJoiner(roomId, socket.senderId);
						}
						deps.registry.removeSender(roomId, participantId);
						await deps.mediasoup.removePeer(roomId, participantId);

						if (isRealParticipant(participantId)) {
							socket
								.to(roomId)
								.emit('participant_left', { roomId, participantId });
						}

						if (deps.registry.hasRaisedHand(roomId, participantId)) {
							deps.registry.clearRaisedHand(roomId, participantId);
							deps.registry.emitToFullAccessParticipants(
								roomId,
								'hand_raised',
								{
									participantId,
									raised: false,
									timestamp: new Date().toISOString(),
								},
							);
						}
					}

					socket.leave(roomId);
					deps.registry.leaveScope(socket, roomId, 'full');
					deps.registry.leaveScope(socket, roomId, 'presence-preview');
					socket.roomId = undefined;
					if (deps.registry.isEmpty(roomId)) {
						deps.registry.cleanupRoom(roomId);
						deps.e2eeEpochRelay.clearRoom(roomId);
						await deps.e2eeRoster.clearRoom(roomId);
						deps.mediasoup.closeRoom(roomId);
					}
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

function enforceE2EEJoinPolicy(
	socket: Socket,
	e2ee?: { enabled?: boolean; capability?: { supported?: boolean } },
): void {
	if (!socket.e2eeRequired) {
		socket.e2eeReady = true;
		return;
	}

	if (!e2ee?.enabled) {
		throw new Error('E2EE is required for this room');
	}

	if (!e2ee.capability?.supported) {
		throw new Error('Client does not support required E2EE capabilities');
	}

	socket.e2eeReady = true;
}

async function requestEpochKeyPackageAfterJoin(
	socket: Socket,
	deps: HandlerDeps,
	roomId: string,
	participantId: string,
): Promise<void> {
	if (socket.scope !== 'full' || !socket.e2eeRequired) return;
	const epochNumber = deps.e2eeEpochRelay.getCurrentEpochNumber(roomId);
	const admittedMembers = await deps.e2eeRoster.list(roomId);
	loggers.socketHandler.debug(
		'[DEBUG-e2ee] SFU: requestEpochKeyPackageAfterJoin (post-ack) %o',
		{
			roomId,
			participantId,
			isHost: socket.isHost,
			assignedSenderId: socket.senderId,
			epochNumber,
			admittedMemberCount: admittedMembers.length,
		},
	);
	if (admittedMembers.length === 0) {
		if (!socket.isHost) {
			deps.e2eeEpochRelay.notifyEncryptionHostNeeded(
				roomId,
				participantId,
				epochNumber,
			);
			return;
		}
		deps.e2eeEpochRelay.requestGenesisFromParticipant(roomId, participantId);
		if (socket.senderId !== undefined) {
			deps.e2eeEpochRelay.requestKeyPackagesExceptSender(
				roomId,
				socket.senderId,
				epochNumber,
				'join',
			);
		}
		return;
	}
	deps.e2eeEpochRelay.requestKeyPackageFromParticipant(
		roomId,
		participantId,
		epochNumber,
		'join',
	);
}
