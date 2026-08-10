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
		const startedAt = performance.now();
		const scope = socket.scope ?? 'unknown';
		const rejoin = Boolean(
			deps.mediasoup.getRoomPeers?.(getRoomId(socket))?.get(participantId),
		);

		try {
			if (socket.meetingId && socket.meetingId !== roomId) {
				throw new Error(
					`Room ID mismatch: token has ${socket.meetingId}, trying to join ${roomId}`,
				);
			}

			const scopedRoomId = getRoomId(socket);
			if (socket.scope === 'full') {
				enforceE2EEJoinPolicy(socket, e2ee);
				await deps.roomLifecycle.humanJoined(scopedRoomId);
			}

			if (socket.scope === 'full') {
				await deps.mediasoup.createRoom(
					scopedRoomId,
					(roomIdInner, participantIds) => {
						deps.registry.emitActiveSpeaker(roomIdInner, participantIds);
					},
				);
			}

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
				hands: deps.registry.getRaisedHands(scopedRoomId),
			});

			if (socket.scope === 'full' && !socket.e2eeRequired) {
				const roomPolls = deps.registry.getActivePolls(scopedRoomId);
				if (roomPolls && roomPolls.size > 0) {
					const personalizedPolls = Array.from(roomPolls.values()).map(
						(poll) => {
							const userVoted = poll.votedUsers.has(participantId);
							return {
								pollId: poll.pollId,
								createdBy: poll.createdBy,
								createdByName: poll.createdByName,
								question: poll.question,
								options: poll.options,
								isActive: poll.isActive,
								hasVoted: userVoted,
								createdAt: poll.createdAt,
							};
						},
					);

					socket.emit('existing_polls', {
						polls: personalizedPolls,
					});
				}
			}
			deps.telemetry.recordRoomJoin(
				{ scope, rejoin, outcome: 'success' },
				(performance.now() - startedAt) / 1000,
			);
		} catch (error) {
			if (socket.scope === 'full') {
				deps.roomLifecycle.scheduleCleanupIfHumanEmpty(getRoomId(socket));
			}
			deps.telemetry.recordRoomJoin(
				{ scope, rejoin, outcome: 'failure' },
				(performance.now() - startedAt) / 1000,
			);
			loggers.socketHandler.error(
				'Error in handleJoinRoom for user %s: %s',
				participantId,
				(error as Error).message,
			);
			throw error;
		}
	}

	return (socket: Socket) => {
		socket.on('recording:join', async (data, callback) => {
			try {
				deps.authManager.ensureRecorderAccess(socket);
				if (data?.roomId !== socket.meetingId)
					throw new Error('Room ID mismatch');
				const roomId = getRoomId(socket);
				const peerId = socket.userId;
				await deps.mediasoup.createRoom(
					roomId,
					(roomIdInner, participantIds) => {
						deps.registry.emitActiveSpeaker(roomIdInner, participantIds);
					},
				);
				socket.join(roomId);
				socket.roomId = roomId;
				socket.participantId = peerId;
				deps.registry.joinRecorder(socket, roomId, peerId);
				deps.mediasoup.addPeer(roomId, peerId, {
					name: 'Recorder',
					userId: peerId,
					audio_enabled: false,
					video_enabled: false,
				});
				deps.roomLifecycle.scheduleCleanupIfHumanEmpty(roomId);
				socket.emit('existing_raised_hands', {
					hands: deps.registry.getRaisedHands(roomId),
				});
				callback({ success: true });
			} catch (error) {
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('join_room', async (data, callback) => {
			try {
				if (socket.scope === 'recording')
					throw new Error('Recorder must use recording:join');
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
					deps.telemetry.recordE2EEEvent('join-status', 'failure');
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
					if (socket.scope === 'recording') {
						const ownsPeer = deps.registry.leaveRecorder(
							socket,
							roomId,
							participantId,
						);
						if (ownsPeer) {
							await deps.mediasoup.removePeer(roomId, participantId);
						}
					}
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
							deps.registry.emitParticipantEvent(
								roomId,
								'participant_left',
								participantId,
							);
						}

						if (deps.registry.hasRaisedHand(roomId, participantId)) {
							deps.registry.clearRaisedHand(roomId, participantId);
							deps.registry.emitRaisedHand(roomId, {
								participantId,
								raised: false,
								timestamp: new Date().toISOString(),
							});
						}
					}
					if (socket.scope === 'full') {
						deps.roomLifecycle.scheduleCleanupIfHumanEmpty(roomId);
					}

					socket.leave(roomId);
					deps.registry.leaveScope(socket, roomId, 'full');
					deps.registry.leaveScope(socket, roomId, 'presence-preview');
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
