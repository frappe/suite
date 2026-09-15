import type { E2eeEpochEnvelope } from '../types';

export const E2EE_COORDINATOR_TTL_MS = 30 * 60 * 1000;

export type PersistedE2eePendingCommitRequest = {
	joiningSenderIds: number[];
	removedSenderIds: number[];
	epochNumber: number;
	membershipDeltaId: string;
	membershipDeltaHash: string;
	rosterHash: string;
	alreadyTried: number[];
	attempts: number;
	expiresAt: number;
};

export type PersistedE2eeRoomCoordinatorState = {
	currentEpoch?: number;
	commits: Array<
		Extract<E2eeEpochEnvelope, { type: 'commit' }> & { expiresAt: number }
	>;
	welcomes: Array<
		Extract<E2eeEpochEnvelope, { type: 'welcome' }> & { expiresAt: number }
	>;
	acks: Array<
		Extract<E2eeEpochEnvelope, { type: 'ack' }> & { expiresAt: number }
	>;
	pendingCommitRequests: PersistedE2eePendingCommitRequest[];
};

export interface E2eeCoordinatorPersistence {
	loadAll(
		now?: number,
	): Promise<Map<string, PersistedE2eeRoomCoordinatorState>>;
	setCurrentEpoch(roomId: string, epochNumber: number): Promise<void>;
	retainCommit(
		roomId: string,
		commit: Extract<E2eeEpochEnvelope, { type: 'commit' }>,
		expiresAt: number,
	): Promise<void>;
	retainWelcome(
		roomId: string,
		welcome: Extract<E2eeEpochEnvelope, { type: 'welcome' }>,
		expiresAt: number,
	): Promise<void>;
	recordAck(
		roomId: string,
		ack: Extract<E2eeEpochEnvelope, { type: 'ack' }>,
		expiresAt: number,
	): Promise<void>;
	upsertPendingCommitRequest(
		roomId: string,
		request: PersistedE2eePendingCommitRequest,
	): Promise<void>;
	removePendingCommitRequest(
		roomId: string,
		epochNumber: number,
	): Promise<void>;
	clearRoom(roomId: string): Promise<void>;
}

function emptyRoomState(): PersistedE2eeRoomCoordinatorState {
	return {
		commits: [],
		welcomes: [],
		acks: [],
		pendingCommitRequests: [],
	};
}

export class InMemoryE2eeCoordinatorPersistence
	implements E2eeCoordinatorPersistence
{
	private readonly rooms = new Map<string, PersistedE2eeRoomCoordinatorState>();

	async loadAll(
		now: number = Date.now(),
	): Promise<Map<string, PersistedE2eeRoomCoordinatorState>> {
		this.pruneExpired(now);
		return structuredClone(this.rooms);
	}

	async setCurrentEpoch(roomId: string, epochNumber: number): Promise<void> {
		this.getRoom(roomId).currentEpoch = epochNumber;
	}

	async retainCommit(
		roomId: string,
		commit: Extract<E2eeEpochEnvelope, { type: 'commit' }>,
		expiresAt: number,
	): Promise<void> {
		const room = this.getRoom(roomId);
		room.commits = room.commits.filter(
			(existing) => existing.epochNumber !== commit.epochNumber,
		);
		room.commits.push({ ...commit, expiresAt });
	}

	async retainWelcome(
		roomId: string,
		welcome: Extract<E2eeEpochEnvelope, { type: 'welcome' }>,
		expiresAt: number,
	): Promise<void> {
		const room = this.getRoom(roomId);
		room.welcomes = room.welcomes.filter(
			(existing) =>
				existing.epochNumber !== welcome.epochNumber ||
				existing.toSenderId !== welcome.toSenderId,
		);
		room.welcomes.push({ ...welcome, expiresAt });
	}

	async recordAck(
		roomId: string,
		ack: Extract<E2eeEpochEnvelope, { type: 'ack' }>,
		expiresAt: number,
	): Promise<void> {
		const room = this.getRoom(roomId);
		room.acks = room.acks.filter(
			(existing) =>
				existing.epochNumber !== ack.epochNumber ||
				existing.fromSenderId !== ack.fromSenderId,
		);
		room.acks.push({ ...ack, expiresAt });
	}

	async upsertPendingCommitRequest(
		roomId: string,
		request: PersistedE2eePendingCommitRequest,
	): Promise<void> {
		const room = this.getRoom(roomId);
		room.pendingCommitRequests = room.pendingCommitRequests.filter(
			(existing) => existing.epochNumber !== request.epochNumber,
		);
		room.pendingCommitRequests.push(structuredClone(request));
	}

	async removePendingCommitRequest(
		roomId: string,
		epochNumber: number,
	): Promise<void> {
		const room = this.rooms.get(roomId);
		if (!room) return;
		room.pendingCommitRequests = room.pendingCommitRequests.filter(
			(request) => request.epochNumber !== epochNumber,
		);
	}

	async clearRoom(roomId: string): Promise<void> {
		this.rooms.delete(roomId);
	}

	private getRoom(roomId: string): PersistedE2eeRoomCoordinatorState {
		let room = this.rooms.get(roomId);
		if (!room) {
			room = emptyRoomState();
			this.rooms.set(roomId, room);
		}
		return room;
	}

	private pruneExpired(now: number): void {
		for (const [roomId, room] of this.rooms) {
			room.commits = room.commits.filter((entry) => entry.expiresAt > now);
			room.welcomes = room.welcomes.filter((entry) => entry.expiresAt > now);
			room.acks = room.acks.filter((entry) => entry.expiresAt > now);
			room.pendingCommitRequests = room.pendingCommitRequests.filter(
				(entry) => entry.expiresAt > now,
			);
			if (
				room.currentEpoch === undefined &&
				room.commits.length === 0 &&
				room.welcomes.length === 0 &&
				room.acks.length === 0 &&
				room.pendingCommitRequests.length === 0
			) {
				this.rooms.delete(roomId);
			}
		}
	}
}
