import type { Socket } from 'socket.io';
import type { MediasoupManager } from '../mediasoup/MediasoupManager';
import { loggers } from '../utils/logger';
import type { E2EEEpochRelay } from './E2EEEpochRelay';
import type { E2eeRosterStore } from './E2eeRosterStore';
import { isRealParticipant } from './handlers/utils';
import type { RoomLifecycleCoordinator } from './RoomLifecycleCoordinator';
import type { RoomRegistry } from './RoomRegistry';

export class ParticipantConnectionLifecycle {
	constructor(
		private readonly registry: RoomRegistry,
		private readonly roomLifecycle: RoomLifecycleCoordinator,
		private readonly mediasoup: MediasoupManager,
		private readonly e2eeEpochRelay: E2EEEpochRelay,
		private readonly e2eeRoster: E2eeRosterStore,
	) {}

	async rollbackFailedAdmission(
		socket: Socket,
		roomId: string,
		participantId: string,
		peerId: string,
		firstConnection: boolean,
	): Promise<void> {
		try {
			const participantDeparted = this.registry.releaseParticipant(
				socket,
				roomId,
				participantId,
			);
			await this.runToCompletion([
				() => {
					if (!firstConnection)
						this.publishDeparture(roomId, participantId, participantDeparted);
				},
				() => this.registry.leaveScope(socket, roomId, 'full'),
				() => this.removeRosterMember(socket, roomId),
				() => this.removePendingJoiner(socket, roomId),
				() => this.registry.removeSender(roomId, peerId),
				() => this.mediasoup.removePeer(roomId, peerId),
				() => socket.leave(roomId),
				() => {
					socket.roomId = undefined;
					socket.participantId = undefined;
				},
			]);
		} catch (error) {
			loggers.socketHandler.warn(
				'Join rollback failed for user %s: %s',
				participantId,
				(error as Error).message,
			);
		} finally {
			this.roomLifecycle.scheduleCleanupIfHumanEmpty(roomId);
		}
	}

	async leave(
		socket: Socket,
		roomId: string,
		participantId: string,
	): Promise<void> {
		const peerId = socket.peerId ?? participantId;
		const participantDeparted = this.registry.releaseParticipant(
			socket,
			roomId,
			participantId,
		);
		await this.runToCompletion([
			() => this.removeRosterMember(socket, roomId),
			() => this.removePendingJoiner(socket, roomId),
			() => this.registry.removeSender(roomId, peerId),
			() => this.mediasoup.removePeer(roomId, peerId),
			() => this.publishDeparture(roomId, participantId, participantDeparted),
			() => this.roomLifecycle.scheduleCleanupIfHumanEmpty(roomId),
			() => socket.leave(roomId),
			() => this.registry.leaveScope(socket, roomId, 'full'),
			() => this.registry.leaveScope(socket, roomId, 'presence-preview'),
			() => {
				socket.roomId = undefined;
				socket.peerId = undefined;
			},
			() =>
				loggers.socketHandler.info('%s left room %s', participantId, roomId),
		]);
	}

	async disconnect(
		socket: Socket,
		roomId: string,
		participantId: string,
		peerId: string,
	): Promise<void> {
		this.registry.leaveScope(socket, roomId, 'full');
		this.registry.leaveScope(socket, roomId, 'presence-preview');
		const participantDeparted = this.registry.releaseParticipant(
			socket,
			roomId,
			participantId,
		);
		await this.runToCompletion([
			() => this.removeRosterMember(socket, roomId),
			() => this.removePendingJoiner(socket, roomId),
			() => this.registry.removeSender(roomId, peerId),
			() => this.mediasoup.removePeer(roomId, peerId),
			() => this.publishDeparture(roomId, participantId, participantDeparted),
			() => {
				if (participantDeparted) {
					loggers.socketHandler.info(
						'Cleaned up user %s from room %s',
						participantId,
						roomId,
					);
				}
			},
			() => this.roomLifecycle.scheduleCleanupIfHumanEmpty(roomId),
		]);
	}

	private removeRosterMember(
		socket: Socket,
		roomId: string,
	): Promise<void> | undefined {
		if (socket.senderId !== undefined)
			return this.e2eeRoster.remove(roomId, socket.senderId);
	}

	private removePendingJoiner(socket: Socket, roomId: string): void {
		if (socket.senderId !== undefined)
			this.e2eeEpochRelay.removePendingJoiner(roomId, socket.senderId);
	}

	private publishDeparture(
		roomId: string,
		participantId: string,
		participantDeparted: boolean,
	): void {
		if (
			!participantDeparted ||
			this.registry.getParticipantSocketIds(roomId, participantId).length > 0
		)
			return;
		if (isRealParticipant(participantId)) {
			this.registry.emitParticipantEvent(
				roomId,
				'participant_left',
				participantId,
			);
		}
		if (!this.registry.hasRaisedHand(roomId, participantId)) return;
		this.registry.clearRaisedHand(roomId, participantId);
		this.registry.emitRaisedHand(roomId, {
			participantId,
			raised: false,
			timestamp: new Date().toISOString(),
		});
	}

	private async runToCompletion(
		steps: Array<() => void | Promise<void>>,
	): Promise<void> {
		let firstError: unknown;
		for (const step of steps) {
			try {
				await step();
			} catch (error) {
				firstError ??= error;
			}
		}
		if (firstError) throw firstError;
	}
}
