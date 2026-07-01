import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { E2eeEpochEnvelope } from '../types';
import {
	type E2eeCoordinatorPersistence,
	InMemoryE2eeCoordinatorPersistence,
	type PersistedE2eeKeyPackage,
	type PersistedE2eePendingCommitRequest,
	type PersistedE2eeRoomCoordinatorState,
} from './E2eeCoordinatorPersistence';

const SCHEMA_VERSION = 1;

type FileShape = {
	schemaVersion: number;
	rooms: Record<string, PersistedE2eeRoomCoordinatorState>;
};

export class FileE2eeCoordinatorPersistence
	implements E2eeCoordinatorPersistence
{
	private cache = new InMemoryE2eeCoordinatorPersistence();
	private loaded = false;

	constructor(private readonly filePath: string) {}

	async loadAll(
		now?: number,
	): Promise<Map<string, PersistedE2eeRoomCoordinatorState>> {
		await this.ensureLoaded();
		const state = await this.cache.loadAll(now);
		await this.flushToDisk(state);
		return state;
	}

	async setCurrentEpoch(roomId: string, epochNumber: number): Promise<void> {
		await this.ensureLoaded();
		await this.cache.setCurrentEpoch(roomId, epochNumber);
		await this.flushCurrentCache();
	}

	async retainCommit(
		roomId: string,
		commit: Extract<E2eeEpochEnvelope, { type: 'commit' }>,
		expiresAt: number,
	): Promise<void> {
		await this.ensureLoaded();
		await this.cache.retainCommit(roomId, commit, expiresAt);
		await this.flushCurrentCache();
	}

	async retainWelcome(
		roomId: string,
		welcome: Extract<E2eeEpochEnvelope, { type: 'welcome' }>,
		expiresAt: number,
	): Promise<void> {
		await this.ensureLoaded();
		await this.cache.retainWelcome(roomId, welcome, expiresAt);
		await this.flushCurrentCache();
	}

	async recordAck(
		roomId: string,
		ack: Extract<E2eeEpochEnvelope, { type: 'ack' }>,
		expiresAt: number,
	): Promise<void> {
		await this.ensureLoaded();
		await this.cache.recordAck(roomId, ack, expiresAt);
		await this.flushCurrentCache();
	}

	async upsertPendingCommitRequest(
		roomId: string,
		request: PersistedE2eePendingCommitRequest,
	): Promise<void> {
		await this.ensureLoaded();
		await this.cache.upsertPendingCommitRequest(roomId, request);
		await this.flushCurrentCache();
	}

	async removePendingCommitRequest(
		roomId: string,
		epochNumber: number,
	): Promise<void> {
		await this.ensureLoaded();
		await this.cache.removePendingCommitRequest(roomId, epochNumber);
		await this.flushCurrentCache();
	}

	async retainKeyPackage(
		roomId: string,
		keyPackage: PersistedE2eeKeyPackage,
	): Promise<void> {
		await this.ensureLoaded();
		await this.cache.retainKeyPackage(roomId, keyPackage);
		await this.flushCurrentCache();
	}

	async markKeyPackagesConsumed(
		roomId: string,
		epochNumber: number,
		senderIds: number[],
	): Promise<void> {
		await this.ensureLoaded();
		await this.cache.markKeyPackagesConsumed(roomId, epochNumber, senderIds);
		await this.flushCurrentCache();
	}

	async clearRoom(roomId: string): Promise<void> {
		await this.ensureLoaded();
		await this.cache.clearRoom(roomId);
		await this.flushCurrentCache();
	}

	private async ensureLoaded(): Promise<void> {
		if (this.loaded) return;
		this.cache = new InMemoryE2eeCoordinatorPersistence();
		if (existsSync(this.filePath)) {
			const raw = await readFile(this.filePath, 'utf8');
			const parsed = JSON.parse(raw) as Partial<FileShape>;
			if (parsed.schemaVersion !== SCHEMA_VERSION) {
				throw new Error(
					`FileE2eeCoordinatorPersistence: unsupported schemaVersion=${parsed.schemaVersion} at ${this.filePath}`,
				);
			}
			for (const [roomId, state] of Object.entries(parsed.rooms ?? {})) {
				await this.hydrateRoom(roomId, state);
			}
		}
		this.loaded = true;
	}

	private async hydrateRoom(
		roomId: string,
		state: PersistedE2eeRoomCoordinatorState,
	): Promise<void> {
		if (typeof state.currentEpoch === 'number') {
			await this.cache.setCurrentEpoch(roomId, state.currentEpoch);
		}
		for (const commit of state.commits ?? []) {
			await this.cache.retainCommit(roomId, commit, commit.expiresAt);
		}
		for (const welcome of state.welcomes ?? []) {
			await this.cache.retainWelcome(roomId, welcome, welcome.expiresAt);
		}
		for (const ack of state.acks ?? []) {
			await this.cache.recordAck(roomId, ack, ack.expiresAt);
		}
		for (const request of state.pendingCommitRequests ?? []) {
			await this.cache.upsertPendingCommitRequest(roomId, request);
		}
		for (const keyPackage of state.keyPackages ?? []) {
			await this.cache.retainKeyPackage(roomId, keyPackage);
		}
	}

	private async flushCurrentCache(): Promise<void> {
		await this.flushToDisk(await this.cache.loadAll());
	}

	private async flushToDisk(
		state: Map<string, PersistedE2eeRoomCoordinatorState>,
	): Promise<void> {
		const shape: FileShape = {
			schemaVersion: SCHEMA_VERSION,
			rooms: Object.fromEntries(state.entries()),
		};
		await mkdir(dirname(this.filePath), { recursive: true });
		const tmp = `${this.filePath}.tmp`;
		await writeFile(tmp, JSON.stringify(shape));
		await rename(tmp, this.filePath);
	}
}
