import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { findSocketsByParticipantId } from './utils';

export function registerHostControlHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('host_control', async (data, callback) => {
			const acknowledge =
				typeof callback === 'function' ? callback : () => undefined;
			const fail = (error: string) => {
				socket.emit('sfu_error', {
					error,
					timestamp: new Date().toISOString(),
				});
				acknowledge({ success: false, error });
			};

			try {
				deps.authManager.ensureFullAccess(socket);
				const { action, targetParticipantId } = data;
				const roomId = socket.roomId;

				if (!roomId || !socket.participantId) {
					fail('Not in a room');
					return;
				}

				if (!socket.isHost && !socket.isCohost) {
					fail('Only host or co-host can control participants');
					loggers.socketHandler.warn(
						'Non-host/co-host %s attempted host control in room %s',
						socket.participantId,
						roomId,
					);
					return;
				}

				let targetSockets: Socket[];
				if (action === 'ban_participant') {
					if (
						typeof targetParticipantId !== 'string' ||
						!targetParticipantId.startsWith('guest_') ||
						targetParticipantId.length === 'guest_'.length
					) {
						throw new Error('Only guests can be banned');
					}
					targetSockets = findSocketsByParticipantId(
						deps.io,
						roomId,
						targetParticipantId,
					);
					if (targetSockets.some((targetSocket) => !targetSocket.isGuest)) {
						throw new Error('Only guests can be banned');
					}
					deps.registry.revokeParticipant(roomId, targetParticipantId);
					if (targetSockets.length === 0) {
						acknowledge({ success: true });
						return;
					}
				} else {
					if (
						!deps.mediasoup.participantExistsInRoom(roomId, targetParticipantId)
					) {
						fail('Target participant not found');
						return;
					}

					targetSockets = findSocketsByParticipantId(
						deps.io,
						roomId,
						targetParticipantId,
					);
					if (targetSockets.length === 0) {
						fail('Target participant socket not found');
						return;
					}
				}

				switch (action) {
					case 'mute_participant':
						for (const targetSocket of targetSockets) {
							targetSocket.emit('host_control_update', {
								action,
								targetParticipantId,
								hostId: socket.participantId,
								timestamp: new Date().toISOString(),
							});
						}
						loggers.socketHandler.info(
							'Host %s sent mute command to participant %s in room %s',
							socket.participantId,
							targetParticipantId,
							roomId,
						);
						break;
					case 'kick_participant':
					case 'ban_participant': {
						const targetSenderIds = targetSockets
							.map((targetSocket) => targetSocket.senderId)
							.filter((senderId): senderId is number => senderId !== undefined);
						let participantDeparted = false;
						for (const targetSocket of targetSockets) {
							participantDeparted =
								deps.registry.releaseParticipant(
									targetSocket,
									roomId,
									targetParticipantId,
								) || participantDeparted;
						}
						if (participantDeparted) {
							deps.registry.emitParticipantEvent(
								roomId,
								'participant_left',
								targetParticipantId,
							);
							if (deps.registry.hasRaisedHand(roomId, targetParticipantId)) {
								deps.registry.clearRaisedHand(roomId, targetParticipantId);
								deps.registry.emitRaisedHand(roomId, {
									participantId: targetParticipantId,
									raised: false,
									timestamp: new Date().toISOString(),
								});
							}
							deps.roomLifecycle.scheduleCleanupIfHumanEmpty(roomId);
						}
						for (const targetSocket of targetSockets) {
							targetSocket.emit('host_control_update', {
								action,
								targetParticipantId,
								hostId: socket.participantId,
								timestamp: new Date().toISOString(),
							});
						}

						loggers.socketHandler.info(
							'Host %s removed participant %s (senderIds=%s) from room %s',
							socket.participantId,
							targetParticipantId,
							targetSenderIds.join(','),
							roomId,
						);
						setTimeout(() => {
							for (const targetSocket of targetSockets) {
								if (targetSocket.connected) targetSocket.disconnect(true);
							}
							loggers.socketHandler.info(
								'Forcefully disconnected removed participant %s',
								targetParticipantId,
							);
						}, 1000);

						if (
							targetSockets.some((targetSocket) => targetSocket.e2eeRequired) &&
							targetSenderIds.length > 0
						) {
							try {
								void deps.e2eeEpochRelay
									.requestCommitForRemoval(
										roomId,
										targetSenderIds,
										deps.e2eeEpochRelay.getCurrentEpochNumber(roomId),
									)
									.catch((error: unknown) => {
										logE2EERemovalFailure(targetParticipantId, error);
									});
							} catch (error) {
								logE2EERemovalFailure(targetParticipantId, error);
							}
						}
						break;
					}
					case 'lower_hand':
						if (!deps.registry.hasRaisedHand(roomId, targetParticipantId)) {
							fail('Participant does not have a raised hand');
							return;
						}
						deps.registry.clearRaisedHand(roomId, targetParticipantId);
						deps.registry.emitToFullAccessParticipants(roomId, 'hand_raised', {
							participantId: targetParticipantId,
							raised: false,
							timestamp: new Date().toISOString(),
						});
						loggers.socketHandler.info(
							'Host %s lowered hand of participant %s',
							socket.participantId,
							targetParticipantId,
						);
						break;
					default:
						fail('Invalid host control action');
						return;
				}
				acknowledge({ success: true });
			} catch (error) {
				const message = (error as Error).message;
				loggers.socketHandler.warn('host_control handling failed: %s', message);
				fail(message);
			}
		});
	};
}

function logE2EERemovalFailure(participantId: string, error: unknown): void {
	loggers.socketHandler.warn(
		'E2EE removal signaling failed for participant %s: %s',
		participantId,
		(error as Error).message,
	);
}
