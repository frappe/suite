import { describe, expect, it } from 'vitest';
import { E2EEEpochRelay } from '../E2EEEpochRelay';
import {
	InMemoryE2eeCoordinatorPersistence,
	type PersistedE2eeRoomCoordinatorState,
} from '../E2eeCoordinatorPersistence';
import {
	InMemoryRosterPersistence,
	type RosterEntry,
} from '../E2eeRosterPersistence';
import { E2eeRosterStore } from '../E2eeRosterStore';

class FlakyRosterPersistence extends InMemoryRosterPersistence {
	loadCalls = 0;

	override async loadAll(): Promise<Map<string, RosterEntry[]>> {
		this.loadCalls += 1;
		if (this.loadCalls === 1) throw new Error('transient roster load failure');
		return super.loadAll();
	}
}

class FlakyCoordinatorPersistence extends InMemoryE2eeCoordinatorPersistence {
	loadCalls = 0;

	override async loadAll(
		now?: number,
	): Promise<Map<string, PersistedE2eeRoomCoordinatorState>> {
		this.loadCalls += 1;
		if (this.loadCalls === 1) {
			throw new Error('transient coordinator load failure');
		}
		return super.loadAll(now);
	}
}

describe('E2EE hydration retry', () => {
	it('retries roster hydration after a transient load failure', async () => {
		const persistence = new FlakyRosterPersistence();
		await persistence.addEntry('meeting-1', {
			participantId: 'host-1',
			senderId: 7,
			isHost: true,
			joinedAt: 1,
		});
		const store = new E2eeRosterStore(persistence);

		await expect(store.list('meeting-1')).rejects.toThrow(
			'transient roster load failure',
		);
		await expect(store.list('meeting-1')).resolves.toHaveLength(1);
		expect(persistence.loadCalls).toBe(2);
	});

	it('retries coordinator hydration after a transient load failure', async () => {
		const persistence = new FlakyCoordinatorPersistence();
		const relay = new E2EEEpochRelay(
			{} as never,
			new Map(),
			new Map(),
			persistence,
		);

		await expect(relay.retryPendingCommitRequests('meeting-1')).rejects.toThrow(
			'transient coordinator load failure',
		);
		await expect(
			relay.retryPendingCommitRequests('meeting-1'),
		).resolves.toBeUndefined();
		expect(persistence.loadCalls).toBe(2);
	});
});
