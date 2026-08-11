import type { MediasoupManager } from '../mediasoup/MediasoupManager';
import { loggers } from '../utils/logger';
import type { E2EEEpochRelay } from './E2EEEpochRelay';
import type { E2eeRosterStore } from './E2eeRosterStore';
import type { RoomRegistry } from './RoomRegistry';

const HUMAN_EMPTY_GRACE_MS = 60_000;

export class RoomLifecycleCoordinator {
	private readonly cleanupTimers = new Map<string, NodeJS.Timeout>();
	private readonly cleanups = new Map<string, Promise<void>>();

	constructor(
		private readonly registry: RoomRegistry,
		private readonly e2eeEpochRelay: E2EEEpochRelay,
		private readonly e2eeRoster: E2eeRosterStore,
		private readonly mediasoup: MediasoupManager,
		private readonly graceMs = HUMAN_EMPTY_GRACE_MS,
	) {}

	async humanJoined(roomId: string): Promise<void> {
		this.cancelCleanup(roomId);
		await this.cleanups.get(roomId);
	}

	scheduleCleanupIfHumanEmpty(roomId: string): void {
		if (
			this.registry.hasHumanParticipants(roomId) ||
			this.cleanupTimers.has(roomId) ||
			this.cleanups.has(roomId)
		)
			return;
		const timer = setTimeout(() => {
			this.cleanupTimers.delete(roomId);
			if (this.registry.hasHumanParticipants(roomId)) return;
			const cleanup = this.cleanupRoom(roomId)
				.catch((error: unknown) => {
					loggers.roomManager.error(
						'Human-empty cleanup failed for room %s: %s',
						roomId,
						(error as Error).message,
					);
				})
				.finally(() => {
					if (this.cleanups.get(roomId) === cleanup)
						this.cleanups.delete(roomId);
				});
			this.cleanups.set(roomId, cleanup);
		}, this.graceMs);
		timer.unref();
		this.cleanupTimers.set(roomId, timer);
	}

	stop(): void {
		for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
		this.cleanupTimers.clear();
	}

	private cancelCleanup(roomId: string): void {
		const timer = this.cleanupTimers.get(roomId);
		if (timer) clearTimeout(timer);
		this.cleanupTimers.delete(roomId);
	}

	private async cleanupRoom(roomId: string): Promise<void> {
		for (const socket of this.registry.getRecorderSockets(roomId)) {
			socket.disconnect(true);
		}
		this.registry.cleanupMediaRoom(roomId);
		this.e2eeEpochRelay.clearRoom(roomId);
		await Promise.all([
			this.e2eeRoster.clearRoom(roomId),
			this.mediasoup.closeRoom(roomId),
		]);
	}
}
