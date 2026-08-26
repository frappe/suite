import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { findSocketsByParticipantId } from './utils';

export function registerHostControlHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('host_control', async (data) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { action, targetParticipantId } = data;
				const roomId = socket.roomId;

				if (!roomId || !socket.participantId) {
					socket.emit('sfu_error', {
						error: 'Not in a room',
						timestamp: new Date().toISOString(),
					});
					return;
				}

				if (!socket.isHost && !socket.isCohost) {
					socket.emit('sfu_error', {
						error: 'Only host or co-host can control participants',
						timestamp: new Date().toISOString(),
					});
					loggers.socketHandler.warn(
						'Non-host/co-host %s attempted host control in room %s',
						socket.participantId,
						roomId,
					);
					return;
				}

				if (
					!deps.mediasoup.participantExistsInRoom(roomId, targetParticipantId)
				) {
					socket.emit('sfu_error', {
						error: 'Target participant not found',
						timestamp: new Date().toISOString(),
					});
					return;
				}

				const targetSockets = findSocketsByParticipantId(
					deps.io,
					roomId,
					targetParticipantId,
				);

				if (targetSockets.length === 0) {
					socket.emit('sfu_error', {
						error: 'Target participant socket not found',
						timestamp: new Date().toISOString(),
					});
					return;
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
					case 'kick_participant': {
						const targetSenderIds = targetSockets
							.map((targetSocket) => targetSocket.senderId)
							.filter((senderId): senderId is number => senderId !== undefined);
						for (const targetSocket of targetSockets) {
							targetSocket.emit('host_control_update', {
								action,
								targetParticipantId,
								hostId: socket.participantId,
								timestamp: new Date().toISOString(),
							});
						}

						loggers.socketHandler.info(
							'Host %s kicked participant %s (senderIds=%s) from room %s',
							socket.participantId,
							targetParticipantId,
							targetSenderIds.join(','),
							roomId,
						);
						if (
							targetSockets.some((targetSocket) => targetSocket.e2eeRequired) &&
							targetSenderIds.length > 0
						) {
							await deps.e2eeEpochRelay.requestCommitForRemoval(
								roomId,
								targetSenderIds,
								deps.e2eeEpochRelay.getCurrentEpochNumber(roomId),
							);
						}

						setTimeout(() => {
							for (const targetSocket of targetSockets) {
								if (targetSocket.connected) targetSocket.disconnect(true);
							}
							loggers.socketHandler.info(
								'Forcefully disconnected kicked participant %s',
								targetParticipantId,
							);
						}, 1000);
						break;
					}
					case 'lower_hand':
						if (deps.registry.hasRaisedHand(roomId, targetParticipantId)) {
							deps.registry.clearRaisedHand(roomId, targetParticipantId);
							deps.registry.emitToFullAccessParticipants(
								roomId,
								'hand_raised',
								{
									participantId: targetParticipantId,
									raised: false,
									timestamp: new Date().toISOString(),
								},
							);
							loggers.socketHandler.info(
								'Host %s lowered hand of participant %s',
								socket.participantId,
								targetParticipantId,
							);
						} else {
							socket.emit('sfu_error', {
								error: 'Participant does not have a raised hand',
								timestamp: new Date().toISOString(),
							});
						}
						break;
					default:
						socket.emit('sfu_error', {
							error: 'Invalid host control action',
							timestamp: new Date().toISOString(),
						});
						break;
				}
			} catch (error) {
				loggers.socketHandler.warn(
					'host_control handling failed: %s',
					(error as Error).message,
				);
				socket.emit('sfu_error', {
					error: (error as Error).message,
					timestamp: new Date().toISOString(),
				});
			}
		});
	};
}
