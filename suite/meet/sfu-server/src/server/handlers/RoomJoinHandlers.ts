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
			connectionId: string;
			conflictId?: string;
			userData: UserData;
			e2ee?: { enabled?: boolean; capability?: { supported?: boolean } };
		},
	): Promise<void> {
		const { roomId, participantId, connectionId, conflictId, userData, e2ee } =
			data;
		const startedAt = performance.now();
		const scope = socket.scope ?? 'unknown';
		let participantClaimed = false;
		let firstConnection = false;
		if (socket.scope === 'full' && !socket.peerId) socket.peerId = socket.id;
		const peerId = socket.peerId ?? participantId;
		const rejoin = Boolean(
			deps.mediasoup.getRoomPeers?.(getRoomId(socket))?.get(peerId),
		);

		try {
			if (socket.meetingId && socket.meetingId !== roomId) {
				throw new Error(
					`Room ID mismatch: token has ${socket.meetingId}, trying to join ${roomId}`,
				);
			}

			const scopedRoomId = getRoomId(socket);
			if (socket.scope === 'full') {
				if (
					socket.isGuest &&
					deps.registry.isParticipantRevoked(scopedRoomId, participantId)
				) {
					throw new Error('Guest is banned from this room');
				}
				enforceE2EEJoinPolicy(socket, e2ee);
				await deps.roomLifecycle.humanJoined(scopedRoomId);
				const acquisition = deps.registry.acquireParticipant(
					socket,
					scopedRoomId,
					participantId,
					connectionId,
					conflictId,
				);
				if (acquisition.status === 'conflict') {
					throw new ParticipantConnectionConflictError(acquisition.conflictId);
				}
				participantClaimed = true;
				firstConnection = acquisition.status === 'acquired';
				if (acquisition.replacedSocket) {
					acquisition.replacedSocket.emit('participant_connection_replaced', {
						reason: acquisition.status,
					});
					acquisition.replacedSocket.disconnect(true);
				}
			}

			if (socket.scope === 'full') {
				await deps.mediasoup.createRoom(
					scopedRoomId,
					(roomIdInner, peerIds) => {
						deps.registry.emitActiveSpeaker(
							roomIdInner,
							participantIdsForPeers(deps, roomIdInner, peerIds),
						);
					},
				);
				assertParticipantOwnership(deps, socket, scopedRoomId, participantId);
			}

			socket.join(scopedRoomId);

			socket.roomId = scopedRoomId;
			socket.participantId = participantId;

			if (socket.scope === 'full') {
				deps.registry.joinScope(socket, scopedRoomId, 'full');
				const senderId = deps.registry.assignSenderId(scopedRoomId, peerId);
				socket.senderId = senderId;
				if (!socket.e2eeRequired) {
					await deps.e2eeRoster.add(scopedRoomId, {
						participantId: peerId,
						senderId,
						isHost: Boolean(socket.isHost),
						joinedAt: Date.now(),
					});
					assertParticipantOwnership(deps, socket, scopedRoomId, participantId);
				}
				await deps.e2eeEpochRelay.retryPendingCommitRequests(scopedRoomId);
				assertParticipantOwnership(deps, socket, scopedRoomId, participantId);

				const existingPeer = deps.mediasoup
					.getRoomPeers?.(scopedRoomId)
					?.get(peerId);
				if (existingPeer) {
					loggers.socketHandler.info(
						'Peer %s already in room %s — clearing stale transports/producers before rejoin',
						peerId,
						scopedRoomId,
					);
					await deps.mediasoup.removePeer(scopedRoomId, peerId);
				}
				deps.mediasoup.addPeer(scopedRoomId, peerId, {
					...userData,
					senderId: socket.senderId,
					isHost: Boolean(socket.isHost),
				});

				if (firstConnection && isRealParticipant(userData.userId)) {
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

			if (socket.scope === 'full') {
				const pinned = deps.registry.getPinnedChatMessage(scopedRoomId);
				if (pinned) {
					socket.emit('existing_pinned_message', { pinned });
				}
			}

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
				if (participantClaimed) {
					const participantDeparted = deps.registry.releaseParticipant(
						socket,
						getRoomId(socket),
						participantId,
					);
					if (
						participantDeparted &&
						!firstConnection &&
						isRealParticipant(participantId)
					) {
						deps.registry.emitParticipantEvent(
							getRoomId(socket),
							'participant_left',
							participantId,
						);
					}
					try {
						deps.registry.leaveScope(socket, getRoomId(socket), 'full');
						if (socket.senderId !== undefined) {
							await deps.e2eeRoster.remove(getRoomId(socket), socket.senderId);
							deps.e2eeEpochRelay.removePendingJoiner(
								getRoomId(socket),
								socket.senderId,
							);
						}
						deps.registry.removeSender(getRoomId(socket), peerId);
						await deps.mediasoup.removePeer(getRoomId(socket), peerId);
						socket.leave(getRoomId(socket));
						socket.roomId = undefined;
						socket.participantId = undefined;
					} catch (cleanupError) {
						loggers.socketHandler.warn(
							'Join rollback failed for user %s: %s',
							participantId,
							(cleanupError as Error).message,
						);
					}
				}
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
				await deps.mediasoup.createRoom(roomId, (roomIdInner, peerIds) => {
					deps.registry.emitActiveSpeaker(
						roomIdInner,
						participantIdsForPeers(deps, roomIdInner, peerIds),
					);
				});
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
					connectionId: data.connectionId ?? socket.id,
					conflictId: data.conflictId,
					userData: {
						name: userData.name,
						userId: socket.userId,
						avatar: userData.avatar,
						audio_enabled: mediaState.audio_enabled,
						video_enabled: mediaState.video_enabled,
						is_guest: Boolean(socket.isGuest),
					},
					e2ee,
				});
				callback({ success: true, senderId: socket.senderId });
				void requestEpochKeyPackageAfterJoin(
					socket,
					deps,
					getRoomId(socket),
					socket.peerId ?? socket.userId,
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
				if (error instanceof ParticipantConnectionConflictError) {
					callback({
						success: false,
						error: 'Another device is already connected',
						code: 'PARTICIPANT_CONNECTION_CONFLICT',
						details: { conflictId: error.conflictId },
					});
					return;
				}
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
					const participantDeparted = deps.registry.releaseParticipant(
						socket,
						roomId,
						participantId,
					);
					const peerId = socket.peerId ?? participantId;
					if (socket.scope === 'full') {
						if (socket.senderId !== undefined) {
							await deps.e2eeRoster.remove(roomId, socket.senderId);
							deps.e2eeEpochRelay.removePendingJoiner(roomId, socket.senderId);
						}
						deps.registry.removeSender(roomId, peerId);
						await deps.mediasoup.removePeer(roomId, peerId);
					}

					if (participantDeparted) {
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
					socket.peerId = undefined;
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

class ParticipantConnectionConflictError extends Error {
	constructor(readonly conflictId: string) {
		super('Another device is already connected');
	}
}

function assertParticipantOwnership(
	deps: HandlerDeps,
	socket: Socket,
	roomId: string,
	participantId: string,
): void {
	if (!deps.registry.isParticipantOwner(socket, roomId, participantId)) {
		throw new Error('Participant connection was replaced');
	}
}

function participantIdsForPeers(
	deps: HandlerDeps,
	roomId: string,
	peerIds: string[],
): string[] {
	const peers = deps.mediasoup.getRoomPeers?.(roomId);
	return Array.from(
		new Set(
			peerIds
				.map((peerId) => peers?.get(peerId)?.info.userId)
				.filter((participantId): participantId is string =>
					Boolean(participantId),
				),
		),
	);
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
