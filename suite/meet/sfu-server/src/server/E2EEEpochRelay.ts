import type { Server, Socket } from 'socket.io';
import type {
	ClientToServerEvents,
	E2eeEpochEnvelope,
	ServerToClientEvents,
	SocketData,
} from '../types';
import { loggers } from '../utils/logger';
import type { RateLimiter } from '../utils/rateLimiter';
import {
	E2EE_COORDINATOR_TTL_MS,
	type E2eeCoordinatorPersistence,
	InMemoryE2eeCoordinatorPersistence,
	type PersistedE2eePendingCommitRequest,
} from './E2eeCoordinatorPersistence';
import type { E2eeRosterStore } from './E2eeRosterStore';
import { checkSocketRateLimits } from './handlers/utils';

type TypedSocket = Socket<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	SocketData
>;

type E2eeEpochPayload = {
	type?: unknown;
	epochNumber?: unknown;
	nextEpochNumber?: unknown;
	previousEpochNumber?: unknown;
	knownEpochNumber?: unknown;
	reason?: unknown;
	fromParticipantId?: unknown;
	fromSenderId?: unknown;
	toParticipantId?: unknown;
	toSenderId?: unknown;
	committerSenderId?: unknown;
	joiningSenderIds?: unknown;
	removedSenderIds?: unknown;
	membershipDeltaId?: unknown;
	membershipDeltaHash?: unknown;
	rosterHash?: unknown;
	keyPackage?: unknown;
	mlsCommit?: unknown;
	mlsWelcome?: unknown;
};

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const HASH_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_OPAQUE_MLS_BYTES = 64 * 1024;
const MAX_DELTA_ID_LENGTH = 128;
const SENDER_ID_MAX = 0xffffffff;
const RETAINED_EPOCHS = 3;
const COMMIT_REQUEST_BATCH_MS = 250;
const COMMITTER_TIMEOUT_MS = 10_000;
const MAX_REDESIGNATIONS = 3;
const E2EE_EPOCH_USER_LIMIT = 60;
const E2EE_EPOCH_IP_LIMIT = 240;
const E2EE_EPOCH_RATE_WINDOW_MS = 60 * 1000;

type RetainedEpochMaterial = {
	commit?: Extract<E2eeEpochEnvelope, { type: 'commit' }>;
	welcomes: Map<number, Extract<E2eeEpochEnvelope, { type: 'welcome' }>>;
	acks: Map<number, Set<number>>;
};

type CommitRequestBatch = {
	joiningSenderIds: number[];
	epochNumber: number;
	timer: ReturnType<typeof setTimeout>;
};

type PendingCommitRequest = {
	joiningSenderIds: number[];
	removedSenderIds: number[];
	epochNumber: number;
	membershipDeltaId: string;
	membershipDeltaHash: string;
	rosterHash: string;
	alreadyTried: number[];
	attempts: number;
	timer: ReturnType<typeof setTimeout>;
};

export class E2EEEpochRelay {
	private io: Server<ClientToServerEvents, ServerToClientEvents>;
	private fullAccessSockets: Map<string, Set<string>>;
	private participantToSender: Map<string, Map<string, number>>;
	private roster: E2eeRosterStore | null = null;
	private retainedMaterial = new Map<
		string,
		Map<number, RetainedEpochMaterial>
	>();
	private currentEpochByRoom = new Map<string, number>();
	private readonly commitRequestBatches = new Map<string, CommitRequestBatch>();
	private readonly pendingCommitRequests = new Map<
		string,
		PendingCommitRequest
	>();
	private hydratePromise: Promise<void> | null = null;

	constructor(
		io: Server<ClientToServerEvents, ServerToClientEvents>,
		fullAccessSockets: Map<string, Set<string>>,
		participantToSender: Map<string, Map<string, number>>,
		private readonly persistence: E2eeCoordinatorPersistence = new InMemoryE2eeCoordinatorPersistence(),
		private readonly rateLimiter: RateLimiter | null = null,
	) {
		this.io = io;
		this.fullAccessSockets = fullAccessSockets;
		this.participantToSender = participantToSender;
	}

	setRoster(roster: E2eeRosterStore): void {
		this.roster = roster;
	}

	setup(socket: Socket): void {
		socket.on('e2ee:epoch', (payload: E2eeEpochPayload) => {
			if (!this.isWithinRateLimit(socket)) return;
			void this.handle(socket, payload);
		});
	}

	private isWithinRateLimit(socket: Socket): boolean {
		if (!this.rateLimiter) return true;
		const allowed = checkSocketRateLimits(
			socket,
			this.rateLimiter,
			E2EE_EPOCH_USER_LIMIT,
			E2EE_EPOCH_IP_LIMIT,
			E2EE_EPOCH_RATE_WINDOW_MS,
		);
		if (!allowed) {
			socket.emit('sfu_error', {
				error: 'Too many encrypted epoch messages. Please try again later.',
				code: 'RATE_LIMITED',
				timestamp: new Date().toISOString(),
			});
		}
		return allowed;
	}

	requestKeyPackages(
		roomId: string,
		epochNumber: number,
		reason: 'enable' | 'join' | 'reconnect',
	): void {
		this.emitToFullAccessParticipants(roomId, {
			type: 'key-package-request',
			epochNumber,
			reason,
		});
	}

	requestKeyPackageFromParticipant(
		roomId: string,
		participantId: string,
		epochNumber: number,
		reason: 'join' | 'reconnect',
	): void {
		loggers.socketHandler.debug(
			'[DEBUG-e2ee] SFU: targeted key-package-request %o',
			{
				roomId,
				participantId,
				epochNumber,
				reason,
			},
		);
		this.emitToTarget(roomId, participantId, {
			type: 'key-package-request',
			epochNumber,
			reason,
		});
	}

	requestKeyPackagesExceptSender(
		roomId: string,
		excludedSenderId: number,
		epochNumber: number,
		reason: 'join' | 'reconnect',
	): void {
		const socketIds = this.fullAccessSockets.get(roomId);
		if (!socketIds) return;
		for (const socketId of socketIds) {
			const socket = this.io.sockets.sockets.get(socketId) as
				| TypedSocket
				| undefined;
			if (!socket?.participantId || socket.senderId === excludedSenderId)
				continue;
			this.emitToTarget(roomId, socket.participantId, {
				type: 'key-package-request',
				epochNumber,
				reason,
			});
		}
	}

	requestGenesisFromParticipant(roomId: string, participantId: string): void {
		this.emitToTarget(roomId, participantId, {
			type: 'genesis-request',
			epochNumber: 1,
			message: 'Starting encryption for this meeting.',
		});
	}

	notifyEncryptionHostNeeded(
		roomId: string,
		participantId: string,
		epochNumber: number,
	): void {
		this.emitToTarget(roomId, participantId, {
			type: 'join-status',
			status: 'pending',
			reason: 'waiting-for-host',
			epochNumber,
			message:
				'This encrypted meeting needs the host to join before others can enter.',
		});
	}

	getCurrentEpochNumber(roomId: string): number {
		return this.currentEpochByRoom.get(roomId) ?? 1;
	}

	async retryPendingCommitRequests(roomId: string): Promise<void> {
		await this.hydrate();
		const prefix = `${roomId}:`;
		for (const [key, pending] of this.pendingCommitRequests) {
			if (!key.startsWith(prefix)) continue;
			clearTimeout(pending.timer);
			pending.alreadyTried = [];
			pending.attempts = 0;
			await this.tryAssignAndEmit(roomId, pending);
		}
	}

	clearRoom(roomId: string): void {
		this.currentEpochByRoom.delete(roomId);
		this.retainedMaterial.delete(roomId);
		this.flushPendingCommitRequests(roomId);
		this.flushPendingCommitRequestsForRoom(roomId);
		void this.persistence.clearRoom(roomId).catch((error: unknown) => {
			loggers.socketHandler.warn(
				'e2ee coordinator clear failed: %s',
				(error as Error).message,
			);
		});
	}

	removePendingJoiner(roomId: string, senderId: number): void {
		const prefix = `${roomId}:`;
		for (const [key, batch] of this.commitRequestBatches) {
			if (!key.startsWith(prefix)) continue;
			batch.joiningSenderIds = batch.joiningSenderIds.filter(
				(id) => id !== senderId,
			);
			if (batch.joiningSenderIds.length === 0) {
				clearTimeout(batch.timer);
				this.commitRequestBatches.delete(key);
			}
		}

		for (const [key, pending] of this.pendingCommitRequests) {
			if (!key.startsWith(prefix)) continue;
			const beforeJoiners = pending.joiningSenderIds.length;
			pending.joiningSenderIds = pending.joiningSenderIds.filter(
				(id) => id !== senderId,
			);
			const removedJoiner = beforeJoiners !== pending.joiningSenderIds.length;
			const removedTriedCommitter = pending.alreadyTried.includes(senderId);
			pending.alreadyTried = pending.alreadyTried.filter(
				(id) => id !== senderId,
			);

			loggers.socketHandler.debug(
				'[DEBUG-e2ee] SFU: pending joiner removed %o',
				{
					roomId,
					senderId,
					stillRemainingJoiners: pending.joiningSenderIds.length,
				},
			);

			if (
				pending.joiningSenderIds.length === 0 &&
				pending.removedSenderIds.length === 0
			) {
				clearTimeout(pending.timer);
				this.pendingCommitRequests.delete(key);
				loggers.socketHandler.debug(
					'[DEBUG-e2ee] SFU: pending request dropped because last joiner left %o',
					{ roomId, senderId },
				);
				continue;
			}

			if (
				!removedJoiner &&
				removedTriedCommitter &&
				!this.hasMappedCommitterCandidate(roomId, pending, senderId)
			) {
				clearTimeout(pending.timer);
				this.pendingCommitRequests.delete(key);
				loggers.socketHandler.debug(
					'[DEBUG-e2ee] SFU: pending request dropped because committer left and no replacement is available %o',
					{ roomId, senderId },
				);
			}
		}
	}

	private async handle(
		socket: Socket,
		payload: E2eeEpochPayload,
	): Promise<void> {
		try {
			await this.hydrate();
			if (socket.scope !== 'full') return;
			const roomId = socket.roomId;
			const fromParticipantId = socket.participantId;
			const fromSenderId = socket.senderId;
			loggers.socketHandler.debug(
				'[DEBUG-e2ee] SFU: epoch envelope received %o',
				{
					type: payload.type,
					roomId,
					fromParticipantId,
					fromSenderId,
					isHost: socket.isHost,
				},
			);
			if (!roomId || !fromParticipantId || fromSenderId === undefined) return;

			switch (payload.type) {
				case 'key-package-request':
					this.relayKeyPackageRequest(roomId, payload);
					return;
				case 'key-package':
					await this.relayKeyPackage(
						roomId,
						fromParticipantId,
						fromSenderId,
						payload,
					);
					return;
				case 'commit-request':
					this.relayCommitRequest(roomId, payload);
					return;
				case 'commit':
					await this.relayCommit(
						roomId,
						fromParticipantId,
						fromSenderId,
						payload,
					);
					return;
				case 'welcome':
					await this.relayWelcome(
						roomId,
						fromParticipantId,
						fromSenderId,
						payload,
					);
					return;
				case 'ack':
					await this.recordAck(
						roomId,
						fromParticipantId,
						fromSenderId,
						payload,
						Boolean(socket.isHost),
					);
					return;
				case 'resync-request':
					await this.replayRetainedMaterial(roomId, fromSenderId, payload);
					return;
			}
		} catch (error) {
			loggers.socketHandler.warn(
				'e2ee:epoch relay failed: %s',
				(error as Error).message,
			);
			socket.emit('sfu_error', {
				error: 'Failed to process encrypted epoch message',
				code: 'E2EE_RELAY_ERROR',
				timestamp: new Date().toISOString(),
			});
		}
	}

	private relayKeyPackageRequest(
		roomId: string,
		payload: E2eeEpochPayload,
	): void {
		if (
			!this.isEpochNumber(payload.epochNumber) ||
			!this.isKeyPackageReason(payload.reason)
		) {
			return;
		}
		this.emitToFullAccessParticipants(roomId, {
			type: 'key-package-request',
			epochNumber: payload.epochNumber,
			reason: payload.reason,
		});
	}

	private async relayKeyPackage(
		roomId: string,
		fromParticipantId: string,
		fromSenderId: number,
		payload: E2eeEpochPayload,
	): Promise<void> {
		if (
			!this.isEpochNumber(payload.epochNumber) ||
			!this.isOpaqueMlsBytes(payload.keyPackage)
		) {
			loggers.socketHandler.debug(
				'[DEBUG-e2ee] SFU: key-package rejected by validation %o',
				{
					roomId,
					fromParticipantId,
					fromSenderId,
					epochNumber: payload.epochNumber,
				},
			);
			return;
		}
		loggers.socketHandler.debug(
			'[DEBUG-e2ee] SFU: relaying key-package and requesting host commit %o',
			{
				roomId,
				fromParticipantId,
				fromSenderId,
				epochNumber: payload.epochNumber,
			},
		);
		const keyPackageReason = this.isKeyPackageReason(payload.reason)
			? payload.reason
			: undefined;
		const isEnableCollection = keyPackageReason === 'enable';
		if (!isEnableCollection && (await this.roster?.get(roomId, fromSenderId))) {
			loggers.socketHandler.debug(
				'[DEBUG-e2ee] SFU: ignoring key-package from admitted sender %o',
				{ roomId, fromParticipantId, fromSenderId },
			);
			return;
		}
		if (isEnableCollection) {
			this.emitToFullAccessParticipants(roomId, {
				type: 'key-package',
				fromParticipantId,
				fromSenderId,
				epochNumber: payload.epochNumber,
				reason: keyPackageReason,
				keyPackage: payload.keyPackage,
			});
			return;
		}
		await this.persistence.retainKeyPackage(roomId, {
			type: 'key-package',
			fromParticipantId,
			fromSenderId,
			epochNumber: payload.epochNumber,
			keyPackage: payload.keyPackage,
			consumed: false,
			expiresAt: this.expiresAt(),
		});
		this.emitToFullAccessParticipants(roomId, {
			type: 'key-package',
			fromParticipantId,
			fromSenderId,
			epochNumber: payload.epochNumber,
			reason: keyPackageReason,
			keyPackage: payload.keyPackage,
		});
		await this.enqueueCommitRequest(
			roomId,
			[fromSenderId],
			payload.epochNumber,
		);
	}

	/**
	 * Dispatch a commit-request to a roster-picked committer, with a
	 * timeout-driven redesignation policy. If the committer doesn't
	 * respond with a `commit` envelope within COMMITTER_TIMEOUT_MS, the
	 * SFU picks another current member (excluding all previously-tried
	 * committers for this delta) and re-emits the request. After
	 * MAX_REDESIGNATIONS attempts, the SFU gives up and logs.
	 *
	 * Multiple calls for the same (roomId, membershipDeltaId) merge: the
	 * pending entry accumulates the joiners/removers and the committer is
	 * asked only once. The pending entry is cleared when a matching
	 * `commit` envelope arrives (see relayCommit's success branch).
	 */
	private async dispatchCommitRequest(input: {
		roomId: string;
		joiningSenderIds: number[];
		removedSenderIds: number[];
		epochNumber: number;
	}): Promise<void> {
		const { roomId, joiningSenderIds, removedSenderIds, epochNumber } = input;
		const key = `${roomId}:${epochNumber}`;
		const existing = this.pendingCommitRequests.get(key);

		// Compute the delta id + hash from the merged list. If two
		// callers race (e.g. an add and a remove for the same epoch), the
		// later caller wins for the delta id, but the joiners/removers
		// accumulate. In practice, the relay never has both for the same
		// epoch (an add advances the epoch; a remove targets a different
		// commit context). This is fine.
		const isAdd = joiningSenderIds.length > 0;
		const type = isAdd ? 'add' : 'remove';
		const senderIds = isAdd ? joiningSenderIds : removedSenderIds;
		const nextEpochNumber = epochNumber + 1;
		const membershipDeltaId = `${type}-${senderIds.join('-')}-to-${nextEpochNumber}`;
		const membershipDeltaHash = Buffer.from(
			JSON.stringify({ type, senderIds, nextEpochNumber }),
		).toString('base64');

		if (existing) {
			// Merge: clear the in-flight timer (the picker will set a new
			// one). The committer gets a fresh window.
			clearTimeout(existing.timer);
			for (const id of joiningSenderIds) {
				if (!existing.joiningSenderIds.includes(id)) {
					existing.joiningSenderIds.push(id);
				}
			}
			for (const id of removedSenderIds) {
				if (!existing.removedSenderIds.includes(id)) {
					existing.removedSenderIds.push(id);
				}
			}
			existing.epochNumber = epochNumber;
			existing.membershipDeltaId = membershipDeltaId;
			existing.membershipDeltaHash = membershipDeltaHash;
			existing.rosterHash = membershipDeltaHash;
			if (joiningSenderIds.length > 0) {
				existing.alreadyTried = [];
				existing.attempts = 0;
			}
			await this.persistPendingCommitRequest(roomId, existing);
			await this.tryAssignAndEmit(roomId, existing);
			return;
		}

		const pending: PendingCommitRequest = {
			joiningSenderIds: [...joiningSenderIds],
			removedSenderIds: [...removedSenderIds],
			epochNumber,
			membershipDeltaId,
			membershipDeltaHash,
			rosterHash: membershipDeltaHash,
			alreadyTried: [],
			attempts: 0,
			timer: setTimeout(() => undefined, 0), // placeholder; replaced below
		};
		this.pendingCommitRequests.set(key, pending);
		await this.persistPendingCommitRequest(roomId, pending);
		await this.tryAssignAndEmit(roomId, pending);
	}

	private async tryAssignAndEmit(
		roomId: string,
		pending: PendingCommitRequest,
	): Promise<void> {
		clearTimeout(pending.timer);
		const exclude = [
			...pending.joiningSenderIds,
			...pending.removedSenderIds,
			...pending.alreadyTried,
		];
		const picked = await this.pickReachableRosterCommitter(roomId, exclude);
		if (!picked) {
			loggers.socketHandler.debug(
				'[DEBUG-e2ee] SFU: no eligible committer; keeping request pending %o',
				{
					roomId,
					membershipDeltaId: pending.membershipDeltaId,
					joiningSenderIds: pending.joiningSenderIds,
					removedSenderIds: pending.removedSenderIds,
					exclude,
					attempts: pending.attempts,
					alreadyTried: pending.alreadyTried,
					debugState: await this.getCommitterDebugState(roomId, exclude),
				},
			);
			this.notifyPendingJoiners(roomId, pending);
			return;
		}
		pending.alreadyTried.push(picked.senderId);
		pending.attempts += 1;
		await this.persistPendingCommitRequest(roomId, pending);
		const nextEpochNumber = pending.epochNumber + 1;
		loggers.socketHandler.debug(
			'[DEBUG-e2ee] SFU: dispatching commit-request %o',
			{
				roomId,
				membershipDeltaId: pending.membershipDeltaId,
				committerSenderId: picked.senderId,
				attempts: pending.attempts,
			},
		);
		const emitted = this.emitToTarget(roomId, picked.participantId, {
			type: 'commit-request',
			epochNumber: pending.epochNumber,
			nextEpochNumber,
			membershipDeltaId: pending.membershipDeltaId,
			membershipDeltaHash: pending.membershipDeltaHash,
			rosterHash: pending.rosterHash,
			committerSenderId: picked.senderId,
			joiningSenderIds: pending.joiningSenderIds,
			removedSenderIds:
				pending.removedSenderIds.length > 0
					? pending.removedSenderIds
					: undefined,
		});
		loggers.socketHandler.debug(
			'[DEBUG-e2ee] SFU: commit-request emit result %o',
			{
				roomId,
				membershipDeltaId: pending.membershipDeltaId,
				committerParticipantId: picked.participantId,
				committerSenderId: picked.senderId,
				emitted,
			},
		);
		pending.timer = setTimeout(() => {
			void this.redesignate(roomId, pending.epochNumber);
		}, COMMITTER_TIMEOUT_MS);
	}

	private async redesignate(
		roomId: string,
		epochNumber: number,
	): Promise<void> {
		const key = `${roomId}:${epochNumber}`;
		const pending = this.pendingCommitRequests.get(key);
		if (!pending) {
			// Already cleared (e.g. the committer responded). Nothing to do.
			return;
		}
		if (pending.attempts >= MAX_REDESIGNATIONS) {
			loggers.socketHandler.debug(
				'[DEBUG-e2ee] SFU: redesignation exhausted, giving up %o',
				{
					roomId,
					membershipDeltaId: pending.membershipDeltaId,
					attempts: pending.attempts,
				},
			);
			this.notifyPendingJoiners(roomId, pending);
			return;
		}
		loggers.socketHandler.debug(
			'[DEBUG-e2ee] SFU: committer timed out, redesignating %o',
			{
				roomId,
				membershipDeltaId: pending.membershipDeltaId,
				attempts: pending.attempts,
				alreadyTried: pending.alreadyTried,
			},
		);
		await this.tryAssignAndEmit(roomId, pending);
	}

	private async clearPendingCommitRequest(
		roomId: string,
		epochNumber: number,
	): Promise<void> {
		const key = `${roomId}:${epochNumber}`;
		const pending = this.pendingCommitRequests.get(key);
		if (pending) {
			clearTimeout(pending.timer);
		}
		this.pendingCommitRequests.delete(key);
		await this.persistence.removePendingCommitRequest(roomId, epochNumber);
	}

	private notifyPendingJoiners(
		roomId: string,
		pending: PendingCommitRequest,
	): void {
		if (pending.joiningSenderIds.length === 0) return;
		for (const senderId of pending.joiningSenderIds) {
			const participantId = this.resolveParticipantBySenderId(roomId, senderId);
			if (!participantId) continue;
			this.emitToTarget(roomId, participantId, {
				type: 'join-status',
				status: 'pending',
				reason: 'waiting-for-admitter',
				epochNumber: pending.epochNumber,
				message:
					'Waiting for someone already in the encrypted meeting to let you in.',
			});
		}
	}

	private async requestCommitFromHost(
		roomId: string,
		joiningSenderIds: number[],
		epochNumber: number,
	): Promise<void> {
		if (joiningSenderIds.length === 0) {
			loggers.socketHandler.debug('[DEBUG-e2ee] SFU: no joiners to add %o', {
				roomId,
			});
			return;
		}
		await this.dispatchCommitRequest({
			roomId,
			joiningSenderIds: [...joiningSenderIds].sort((a, b) => a - b),
			removedSenderIds: [],
			epochNumber,
		});
	}

	/**
	 * Ask the roster to pick a committer to author a remove-only commit
	 * (e.g. host kicked a participant). The committer's tab runs the
	 * EpochProtocolProvider.removeMember path. Returns true if a committer
	 * was found and a commit-request was emitted.
	 */
	async requestCommitForRemoval(
		roomId: string,
		removedSenderIds: number[],
		epochNumber: number,
	): Promise<boolean> {
		if (removedSenderIds.length === 0) {
			loggers.socketHandler.debug(
				'[DEBUG-e2ee] SFU: no removals requested %o',
				{ roomId },
			);
			return false;
		}
		await this.dispatchCommitRequest({
			roomId,
			joiningSenderIds: [],
			removedSenderIds: [...removedSenderIds].sort((a, b) => a - b),
			epochNumber,
		});
		return true;
	}

	/**
	 * Buffer key-package events and emit a single commit-request per
	 * (roomId, epochNumber) batch within COMMIT_REQUEST_BATCH_MS. This
	 * collapses simultaneous joiners (or successive joiners within a
	 * short window) into a single add-member commit, instead of N
	 * separate commits.
	 *
	 * The committer still sees a single `commit-request` with all the
	 * accumulated joiningSenderIds, and uses the existing
	 * authorAddMemberCommit / addMultipleMembers path to author one
	 * commit. Removing this buffer would revert to the per-joiner
	 * commit-request behavior; the committer is already capable of
	 * handling a multi-joiner list (slice 9eeeed8).
	 */
	private enqueueCommitRequest(
		roomId: string,
		joiningSenderIds: number[],
		epochNumber: number,
	): void {
		const key = `${roomId}:${epochNumber}`;
		const existing = this.commitRequestBatches.get(key);
		if (existing) {
			clearTimeout(existing.timer);
			for (const id of joiningSenderIds) {
				if (!existing.joiningSenderIds.includes(id)) {
					existing.joiningSenderIds.push(id);
				}
			}
			existing.timer = setTimeout(() => {
				this.commitRequestBatches.delete(key);
				this.requestCommitFromHost(
					roomId,
					existing.joiningSenderIds,
					epochNumber,
				).catch((error: unknown) => {
					loggers.socketHandler.warn(
						'Batch commit request failed for room %s: %s',
						roomId,
						(error as Error).message,
					);
				});
			}, COMMIT_REQUEST_BATCH_MS);
			loggers.socketHandler.debug(
				'[DEBUG-e2ee] SFU: batching commit-request %o',
				{
					roomId,
					epochNumber,
					bufferedSenderIds: existing.joiningSenderIds,
				},
			);
			return;
		}
		const batch: CommitRequestBatch = {
			joiningSenderIds: [...joiningSenderIds],
			epochNumber,
			timer: setTimeout(() => {
				this.commitRequestBatches.delete(key);
				this.requestCommitFromHost(
					roomId,
					batch.joiningSenderIds,
					epochNumber,
				).catch((error: unknown) => {
					loggers.socketHandler.warn(
						'Batch commit request failed for room %s: %s',
						roomId,
						(error as Error).message,
					);
				});
			}, COMMIT_REQUEST_BATCH_MS),
		};
		this.commitRequestBatches.set(key, batch);
		loggers.socketHandler.debug(
			'[DEBUG-e2ee] SFU: starting commit-request batch %o',
			{
				roomId,
				epochNumber,
				joiningSenderIds,
			},
		);
	}

	private flushPendingCommitRequests(roomId: string): void {
		// Cancel any pending batch timers for this room so they don't fire
		// after the room is gone. The buffer map is also cleared.
		const prefix = `${roomId}:`;
		for (const [key, batch] of this.commitRequestBatches) {
			if (!key.startsWith(prefix)) continue;
			clearTimeout(batch.timer);
			this.commitRequestBatches.delete(key);
		}
	}

	private flushPendingCommitRequestsForRoom(roomId: string): void {
		// Cancel any pending committer redesignation timers for this room
		// so they don't fire after the room is gone.
		const prefix = `${roomId}:`;
		for (const [key, pending] of this.pendingCommitRequests) {
			if (!key.startsWith(prefix)) continue;
			clearTimeout(pending.timer);
			this.pendingCommitRequests.delete(key);
		}
	}

	private relayCommitRequest(roomId: string, payload: E2eeEpochPayload): void {
		if (
			!this.isEpochNumber(payload.epochNumber) ||
			!this.isEpochNumber(payload.nextEpochNumber) ||
			payload.nextEpochNumber !== payload.epochNumber + 1 ||
			!this.isDeltaId(payload.membershipDeltaId) ||
			!this.isHash(payload.membershipDeltaHash) ||
			!this.isHash(payload.rosterHash) ||
			!this.isSenderId(payload.committerSenderId) ||
			!this.isSenderIdArray(payload.joiningSenderIds) ||
			(payload.removedSenderIds !== undefined &&
				!this.isSenderIdArray(payload.removedSenderIds))
		) {
			return;
		}
		const committerParticipantId = this.resolveParticipantBySenderId(
			roomId,
			payload.committerSenderId,
		);
		if (!committerParticipantId) return;
		this.emitToTarget(roomId, committerParticipantId, {
			type: 'commit-request',
			epochNumber: payload.epochNumber,
			nextEpochNumber: payload.nextEpochNumber,
			membershipDeltaId: payload.membershipDeltaId,
			membershipDeltaHash: payload.membershipDeltaHash,
			rosterHash: payload.rosterHash,
			committerSenderId: payload.committerSenderId,
			joiningSenderIds: payload.joiningSenderIds,
		});
	}

	private async relayCommit(
		roomId: string,
		fromParticipantId: string,
		fromSenderId: number,
		payload: E2eeEpochPayload,
	): Promise<void> {
		if (
			!this.isEpochNumber(payload.previousEpochNumber) ||
			!this.isEpochNumber(payload.epochNumber) ||
			payload.epochNumber !== payload.previousEpochNumber + 1 ||
			!this.isDeltaId(payload.membershipDeltaId) ||
			!this.isHash(payload.membershipDeltaHash) ||
			!this.isHash(payload.rosterHash) ||
			!this.isOpaqueMlsBytes(payload.mlsCommit)
		) {
			return;
		}
		if (this.roster && !(await this.roster.get(roomId, fromSenderId))) {
			loggers.socketHandler.debug(
				'[DEBUG-e2ee] SFU: rejecting commit from non-roster senderId %o',
				{ roomId, fromSenderId },
			);
			return;
		}
		const commit = {
			type: 'commit' as const,
			fromParticipantId,
			fromSenderId,
			previousEpochNumber: payload.previousEpochNumber,
			epochNumber: payload.epochNumber,
			membershipDeltaId: payload.membershipDeltaId,
			membershipDeltaHash: payload.membershipDeltaHash,
			rosterHash: payload.rosterHash,
			mlsCommit: payload.mlsCommit,
		};
		const pending = this.pendingCommitRequests.get(
			`${roomId}:${payload.previousEpochNumber}`,
		);
		const hasMatchingPending =
			!!pending &&
			this.matchesPendingCommitRequest(pending, fromSenderId, payload);
		if (pending && !hasMatchingPending) {
			loggers.socketHandler.debug(
				'[DEBUG-e2ee] SFU: rejecting commit from non-designated committer %o',
				{
					roomId,
					fromSenderId,
					previousEpochNumber: payload.previousEpochNumber,
					membershipDeltaId: payload.membershipDeltaId,
					lastDesignatedSenderId:
						pending.alreadyTried[pending.alreadyTried.length - 1],
				},
			);
			return;
		}
		if (!pending) {
			loggers.socketHandler.debug(
				'[DEBUG-e2ee] SFU: accepting commit without matching pending request (host enable flow) %o',
				{
					roomId,
					fromSenderId,
					previousEpochNumber: payload.previousEpochNumber,
					membershipDeltaId: payload.membershipDeltaId,
				},
			);
		}
		await this.retainCommit(roomId, commit);
		this.emitToFullAccessParticipants(roomId, commit);
		if (hasMatchingPending) {
			await this.persistence.markKeyPackagesConsumed(
				roomId,
				payload.previousEpochNumber,
				this.parseJoiningSenderIds(payload.membershipDeltaId),
			);
			await this.clearPendingCommitRequest(roomId, payload.previousEpochNumber);
		}
	}

	private matchesPendingCommitRequest(
		pending: PendingCommitRequest,
		fromSenderId: number,
		payload: E2eeEpochPayload,
	): boolean {
		return (
			pending.alreadyTried[pending.alreadyTried.length - 1] === fromSenderId &&
			payload.previousEpochNumber === pending.epochNumber &&
			payload.epochNumber === pending.epochNumber + 1 &&
			payload.membershipDeltaId === pending.membershipDeltaId &&
			payload.membershipDeltaHash === pending.membershipDeltaHash &&
			payload.rosterHash === pending.rosterHash
		);
	}

	private async relayWelcome(
		roomId: string,
		fromParticipantId: string,
		fromSenderId: number,
		payload: E2eeEpochPayload,
	): Promise<void> {
		if (
			!this.isSenderId(payload.toSenderId) ||
			!this.isEpochNumber(payload.epochNumber) ||
			!this.isOpaqueMlsBytes(payload.mlsWelcome)
		) {
			return;
		}
		const toParticipantId = this.resolveParticipantBySenderId(
			roomId,
			payload.toSenderId,
		);
		if (!toParticipantId) return;
		const welcome = {
			type: 'welcome' as const,
			fromParticipantId,
			fromSenderId,
			toParticipantId,
			toSenderId: payload.toSenderId,
			epochNumber: payload.epochNumber,
			mlsWelcome: payload.mlsWelcome,
		};
		await this.retainWelcome(roomId, welcome);
		this.emitToTarget(roomId, toParticipantId, welcome);
	}

	private async recordAck(
		roomId: string,
		fromParticipantId: string,
		fromSenderId: number,
		payload: E2eeEpochPayload,
		isHost = false,
	): Promise<void> {
		if (!this.isEpochNumber(payload.epochNumber)) return;
		const existingRosterEntry = await this.roster?.get(roomId, fromSenderId);
		if (
			this.roster &&
			!existingRosterEntry &&
			!this.hasAckAdmissionProof(
				roomId,
				fromSenderId,
				payload.epochNumber,
				isHost,
			)
		) {
			loggers.socketHandler.debug(
				'[DEBUG-e2ee] SFU: rejecting ack without admission proof %o',
				{
					roomId,
					fromParticipantId,
					fromSenderId,
					epochNumber: payload.epochNumber,
				},
			);
			return;
		}
		const retained = this.getRetainedEpoch(roomId, payload.epochNumber);
		let epochAcks = retained.acks.get(payload.epochNumber);
		if (!epochAcks) {
			epochAcks = new Set();
			retained.acks.set(payload.epochNumber, epochAcks);
		}
		epochAcks.add(fromSenderId);
		await this.persistence.recordAck(
			roomId,
			{
				type: 'ack',
				fromParticipantId,
				fromSenderId,
				epochNumber: payload.epochNumber,
			},
			this.expiresAt(),
		);
		let promotedToRoster = false;
		if (this.roster && !existingRosterEntry) {
			await this.roster.add(roomId, {
				participantId: fromParticipantId,
				senderId: fromSenderId,
				isHost,
				joinedAt: Date.now(),
			});
			promotedToRoster = true;
		}
		if (promotedToRoster) {
			await this.retryPendingCommitRequests(roomId);
		}
		this.emitToFullAccessParticipants(roomId, {
			type: 'ack',
			fromParticipantId,
			fromSenderId,
			epochNumber: payload.epochNumber,
		});
	}

	private hasAckAdmissionProof(
		roomId: string,
		fromSenderId: number,
		epochNumber: number,
		isHost: boolean,
	): boolean {
		if (isHost && epochNumber === 1) return true;
		return (
			this.retainedMaterial
				.get(roomId)
				?.get(epochNumber)
				?.welcomes.get(fromSenderId)?.epochNumber === epochNumber
		);
	}

	private async replayRetainedMaterial(
		roomId: string,
		fromSenderId: number,
		payload: E2eeEpochPayload,
	): Promise<void> {
		await this.hydrate();
		if (
			payload.knownEpochNumber !== undefined &&
			!this.isEpochNumber(payload.knownEpochNumber)
		) {
			return;
		}
		const targetParticipantId = this.resolveParticipantBySenderId(
			roomId,
			fromSenderId,
		);
		if (!targetParticipantId) return;
		const retainedByEpoch = this.retainedMaterial.get(roomId);
		if (!retainedByEpoch) return;
		if (
			payload.knownEpochNumber !== undefined &&
			!this.hasContiguousRetainedEpochs(
				roomId,
				payload.knownEpochNumber,
				this.getCurrentEpochNumber(roomId),
			)
		) {
			this.requestFreshKeyPackageForResync(
				roomId,
				fromSenderId,
				targetParticipantId,
				payload.knownEpochNumber,
			);
			return;
		}
		let sentAny = false;
		for (const [epochNumber, retained] of retainedByEpoch.entries()) {
			if (
				payload.knownEpochNumber !== undefined &&
				epochNumber <= payload.knownEpochNumber
			) {
				continue;
			}
			if (retained.commit) {
				this.emitToTarget(roomId, targetParticipantId, retained.commit);
				sentAny = true;
			}
			const welcome = retained.welcomes.get(fromSenderId);
			if (welcome) {
				this.emitToTarget(roomId, targetParticipantId, welcome);
				sentAny = true;
			}
		}
		if (!sentAny) {
			this.requestFreshKeyPackageForResync(
				roomId,
				fromSenderId,
				targetParticipantId,
				payload.knownEpochNumber,
			);
		}
	}

	private async retainCommit(
		roomId: string,
		commit: Extract<E2eeEpochEnvelope, { type: 'commit' }>,
	): Promise<void> {
		const currentEpoch = this.getCurrentEpochNumber(roomId);
		if (commit.epochNumber > currentEpoch) {
			this.currentEpochByRoom.set(roomId, commit.epochNumber);
			await this.persistence.setCurrentEpoch(roomId, commit.epochNumber);
		}
		this.getRetainedEpoch(roomId, commit.epochNumber).commit = commit;
		this.pruneRetainedMaterial(roomId);
		await this.persistence.retainCommit(roomId, commit, this.expiresAt());
	}

	private async retainWelcome(
		roomId: string,
		welcome: Extract<E2eeEpochEnvelope, { type: 'welcome' }>,
	): Promise<void> {
		this.getRetainedEpoch(roomId, welcome.epochNumber).welcomes.set(
			welcome.toSenderId,
			welcome,
		);
		this.pruneRetainedMaterial(roomId);
		await this.persistence.retainWelcome(roomId, welcome, this.expiresAt());
	}

	private getRetainedEpoch(
		roomId: string,
		epochNumber: number,
	): RetainedEpochMaterial {
		let retainedByEpoch = this.retainedMaterial.get(roomId);
		if (!retainedByEpoch) {
			retainedByEpoch = new Map();
			this.retainedMaterial.set(roomId, retainedByEpoch);
		}
		let retained = retainedByEpoch.get(epochNumber);
		if (!retained) {
			retained = { welcomes: new Map(), acks: new Map() };
			retainedByEpoch.set(epochNumber, retained);
		}
		return retained;
	}

	private pruneRetainedMaterial(roomId: string): void {
		const retainedByEpoch = this.retainedMaterial.get(roomId);
		if (!retainedByEpoch) return;
		const retainedEpochs = [...retainedByEpoch.keys()].sort((a, b) => b - a);
		for (const staleEpoch of retainedEpochs.slice(RETAINED_EPOCHS)) {
			retainedByEpoch.delete(staleEpoch);
		}
	}

	private async hydrate(): Promise<void> {
		if (this.hydratePromise) return this.hydratePromise;
		this.hydratePromise = (async () => {
			const persisted = await this.persistence.loadAll();
			for (const [roomId, state] of persisted) {
				if (state.currentEpoch !== undefined) {
					this.currentEpochByRoom.set(roomId, state.currentEpoch);
				}
				for (const commit of state.commits) {
					const { expiresAt: _expiresAt, ...envelope } = commit;
					this.getRetainedEpoch(roomId, envelope.epochNumber).commit = envelope;
				}
				for (const welcome of state.welcomes) {
					const { expiresAt: _expiresAt, ...envelope } = welcome;
					this.getRetainedEpoch(roomId, envelope.epochNumber).welcomes.set(
						envelope.toSenderId,
						envelope,
					);
				}
				for (const ack of state.acks) {
					const { expiresAt: _expiresAt, ...envelope } = ack;
					let epochAcks = this.getRetainedEpoch(
						roomId,
						envelope.epochNumber,
					).acks.get(envelope.epochNumber);
					if (!epochAcks) {
						epochAcks = new Set();
						this.getRetainedEpoch(roomId, envelope.epochNumber).acks.set(
							envelope.epochNumber,
							epochAcks,
						);
					}
					epochAcks.add(envelope.fromSenderId);
				}
				for (const request of state.pendingCommitRequests) {
					const pending = this.pendingFromPersisted(request);
					this.pendingCommitRequests.set(
						`${roomId}:${pending.epochNumber}`,
						pending,
					);
				}
				this.pruneRetainedMaterial(roomId);
			}
		})().catch((error: unknown) => {
			this.hydratePromise = null;
			throw error;
		});
		return this.hydratePromise;
	}

	private async persistPendingCommitRequest(
		roomId: string,
		pending: PendingCommitRequest,
	): Promise<void> {
		await this.persistence.upsertPendingCommitRequest(roomId, {
			joiningSenderIds: [...pending.joiningSenderIds],
			removedSenderIds: [...pending.removedSenderIds],
			epochNumber: pending.epochNumber,
			membershipDeltaId: pending.membershipDeltaId,
			membershipDeltaHash: pending.membershipDeltaHash,
			rosterHash: pending.rosterHash,
			alreadyTried: [...pending.alreadyTried],
			attempts: pending.attempts,
			expiresAt: this.expiresAt(),
		});
	}

	private pendingFromPersisted(
		persisted: PersistedE2eePendingCommitRequest,
	): PendingCommitRequest {
		return {
			joiningSenderIds: [...persisted.joiningSenderIds],
			removedSenderIds: [...persisted.removedSenderIds],
			epochNumber: persisted.epochNumber,
			membershipDeltaId: persisted.membershipDeltaId,
			membershipDeltaHash: persisted.membershipDeltaHash,
			rosterHash: persisted.rosterHash,
			alreadyTried: [...persisted.alreadyTried],
			attempts: persisted.attempts,
			timer: setTimeout(() => undefined, 0),
		};
	}

	private expiresAt(): number {
		return Date.now() + E2EE_COORDINATOR_TTL_MS;
	}

	private parseJoiningSenderIds(membershipDeltaId: string): number[] {
		if (!membershipDeltaId.startsWith('add-')) return [];
		const body = membershipDeltaId.slice('add-'.length).split('-to-')[0];
		if (!body) return [];
		return body
			.split('-')
			.map((id) => Number.parseInt(id, 10))
			.filter((id) => this.isSenderId(id));
	}

	private hasContiguousRetainedEpochs(
		roomId: string,
		knownEpochNumber: number,
		currentEpochNumber: number,
	): boolean {
		if (knownEpochNumber >= currentEpochNumber) return true;
		const retainedByEpoch = this.retainedMaterial.get(roomId);
		if (!retainedByEpoch) return false;
		for (
			let epoch = knownEpochNumber + 1;
			epoch <= currentEpochNumber;
			epoch++
		) {
			if (!retainedByEpoch.get(epoch)?.commit) return false;
		}
		return true;
	}

	private requestFreshKeyPackageForResync(
		roomId: string,
		fromSenderId: number,
		targetParticipantId: string,
		knownEpochNumber: unknown,
	): void {
		loggers.socketHandler.debug(
			'[DEBUG-e2ee] SFU: resync-request cannot be replayed; requesting fresh key package %o',
			{
				roomId,
				fromSenderId,
				knownEpochNumber: knownEpochNumber ?? null,
			},
		);
		this.emitToTarget(roomId, targetParticipantId, {
			type: 'key-package-request',
			epochNumber: this.getCurrentEpochNumber(roomId),
			reason: 'reconnect',
		});
	}

	private async pickReachableRosterCommitter(
		roomId: string,
		excludeSenderIds: number[],
	): Promise<{
		participantId: string;
		senderId: number;
		isHost: boolean;
	} | null> {
		const excluded = new Set(excludeSenderIds);
		while (true) {
			const picked =
				(await this.roster?.pickCommitter(roomId, [...excluded])) ?? null;
			if (!picked) return null;
			if (this.canEmitToTarget(roomId, picked.participantId)) return picked;

			loggers.socketHandler.debug(
				'[DEBUG-e2ee] SFU: pruning unreachable roster committer %o',
				{
					roomId,
					participantId: picked.participantId,
					senderId: picked.senderId,
					isHost: picked.isHost,
				},
			);
			try {
				await this.roster?.remove(roomId, picked.senderId);
			} catch (error) {
				loggers.socketHandler.warn(
					'Failed to remove unreachable roster entry for senderId %d: %s',
					picked.senderId,
					(error as Error).message,
				);
			}
			excluded.add(picked.senderId);
		}
	}

	private async getCommitterDebugState(
		roomId: string,
		excludeSenderIds: number[],
	): Promise<Record<string, unknown>> {
		const rosterEntries = (await this.roster?.list(roomId)) ?? [];
		const fullAccessSocketIds = Array.from(
			this.fullAccessSockets.get(roomId) ?? [],
		);
		const roomSocketIds = Array.from(
			this.io.sockets.adapter.rooms.get(roomId) ?? [],
		);
		return {
			excludeSenderIds,
			rosterEntries: rosterEntries.map((entry) => ({
				participantId: entry.participantId,
				senderId: entry.senderId,
				isHost: entry.isHost,
				joinedAt: entry.joinedAt,
				reachable: Boolean(this.canEmitToTarget(roomId, entry.participantId)),
			})),
			fullAccessSocketIds,
			participantToSender: Array.from(
				this.participantToSender.get(roomId)?.entries() ?? [],
			),
			roomSockets: roomSocketIds.map((socketId) => {
				const socket = this.io.sockets.sockets.get(socketId) as
					| TypedSocket
					| undefined;
				return {
					socketId,
					participantId: socket?.participantId ?? null,
					senderId: socket?.senderId ?? null,
					isHost: socket?.isHost ?? null,
					scope: socket?.scope ?? null,
					fullAccess: fullAccessSocketIds.includes(socketId),
				};
			}),
		};
	}

	private isEpochNumber(value: unknown): value is number {
		return typeof value === 'number' && Number.isInteger(value) && value >= 1;
	}

	private isSenderId(value: unknown): value is number {
		return (
			typeof value === 'number' &&
			Number.isInteger(value) &&
			value >= 0 &&
			value <= SENDER_ID_MAX
		);
	}

	private isSenderIdArray(value: unknown): value is number[] {
		return (
			Array.isArray(value) &&
			value.length > 0 &&
			value.every((id) => this.isSenderId(id))
		);
	}

	private isDeltaId(value: unknown): value is string {
		return (
			typeof value === 'string' &&
			value.length > 0 &&
			value.length <= MAX_DELTA_ID_LENGTH
		);
	}

	private isHash(value: unknown): value is string {
		return (
			typeof value === 'string' &&
			value.length > 0 &&
			value.length <= 256 &&
			HASH_PATTERN.test(value)
		);
	}

	private isOpaqueMlsBytes(value: unknown): value is string {
		return (
			typeof value === 'string' &&
			value.length > 0 &&
			value.length <= MAX_OPAQUE_MLS_BYTES &&
			BASE64_PATTERN.test(value)
		);
	}

	private isKeyPackageReason(
		value: unknown,
	): value is 'enable' | 'join' | 'reconnect' {
		return value === 'enable' || value === 'join' || value === 'reconnect';
	}

	private findSocketByParticipantId(
		roomId: string,
		participantId: string,
	): TypedSocket | null {
		const socketsInRoom = this.io.sockets.adapter.rooms.get(roomId);
		if (!socketsInRoom) return null;

		for (const socketId of socketsInRoom) {
			const socket = this.io.sockets.sockets.get(socketId) as
				| TypedSocket
				| undefined;
			if (socket && socket.participantId === participantId) {
				return socket;
			}
		}
		return null;
	}

	private resolveParticipantBySenderId(
		roomId: string,
		senderId: number,
	): string | undefined {
		const map = this.participantToSender.get(roomId);
		if (!map) return undefined;
		for (const [participantId, sid] of map.entries()) {
			if (sid === senderId) return participantId;
		}
		return undefined;
	}

	private hasMappedCommitterCandidate(
		roomId: string,
		pending: PendingCommitRequest,
		leavingSenderId: number,
	): boolean {
		const map = this.participantToSender.get(roomId);
		if (!map) return false;
		const excluded = new Set([
			leavingSenderId,
			...pending.joiningSenderIds,
			...pending.removedSenderIds,
			...pending.alreadyTried,
		]);
		for (const senderId of map.values()) {
			if (!excluded.has(senderId)) return true;
		}
		return false;
	}

	private emitToTarget(
		roomId: string,
		participantId: string,
		data: E2eeEpochEnvelope,
	): boolean {
		const socket = this.canEmitToTarget(roomId, participantId);
		if (!socket) {
			loggers.socketHandler.debug(
				'[DEBUG-e2ee] SFU: targeted epoch emit skipped %o',
				{
					roomId,
					participantId,
					type: data.type,
					hasRoom: this.io.sockets.adapter.rooms.has(roomId),
					fullAccessSocketIds: Array.from(
						this.fullAccessSockets.get(roomId) ?? [],
					),
				},
			);
			return false;
		}
		socket.emit('e2ee:epoch', data);
		return true;
	}

	private canEmitToTarget(
		roomId: string,
		participantId: string,
	): TypedSocket | null {
		const socket = this.findSocketByParticipantId(roomId, participantId);
		if (!socket) return null;
		if (!this.fullAccessSockets.get(roomId)?.has(socket.id)) return null;
		return socket;
	}

	private emitToFullAccessParticipants(
		roomId: string,
		data: E2eeEpochEnvelope,
	): void {
		const socketIds = this.fullAccessSockets.get(roomId);
		if (!socketIds) return;
		for (const socketId of socketIds) {
			const socket = this.io.sockets.sockets.get(socketId);
			if (socket) {
				// biome-ignore lint/suspicious/noExplicitAny: typed-socket emit with narrowed payload
				(socket as any).emit('e2ee:epoch', data);
			}
		}
	}
}
