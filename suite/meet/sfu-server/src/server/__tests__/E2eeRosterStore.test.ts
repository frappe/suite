import { describe, it } from 'vitest';
import {
	InMemoryRosterPersistence,
	type RosterEntry,
} from '../E2eeRosterPersistence';
import { E2eeRosterStore } from '../E2eeRosterStore';

const roomId = 'meeting-1';

function makeEntry(
	senderId: number,
	opts: { participantId?: string; isHost?: boolean; joinedAt?: number } = {},
): RosterEntry {
	return {
		senderId,
		participantId: opts.participantId ?? `user-${senderId}`,
		isHost: opts.isHost ?? false,
		joinedAt: opts.joinedAt ?? Date.now(),
	};
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`assertion failed: ${message}`);
}

async function main(): Promise<void> {
	const store = new E2eeRosterStore(new InMemoryRosterPersistence());

	await store.add(roomId, makeEntry(1));
	await store.add(roomId, makeEntry(2, { isHost: true, joinedAt: 100 }));
	await store.add(roomId, makeEntry(3, { joinedAt: 200 }));

	const list1 = await store.list(roomId);
	assert(list1.length === 3, `expected 3 entries, got ${list1.length}`);
	assert(
		(await store.get(roomId, 1))?.participantId === 'user-1',
		'expected participantId for sender 1',
	);
	assert(
		(await store.get(roomId, 2))?.isHost === true,
		'sender 2 should be host',
	);

	await store.remove(roomId, 1);
	const list2 = await store.list(roomId);
	assert(
		list2.length === 2,
		`expected 2 entries after remove, got ${list2.length}`,
	);
	assert((await store.get(roomId, 1)) === undefined, 'sender 1 should be gone');

	const pickedHost = await store.pickCommitter(roomId, []);
	assert(
		pickedHost?.senderId === 2,
		`host should be picked first, got senderId=${pickedHost?.senderId}`,
	);

	const pickedNext = await store.pickCommitter(roomId, [2]);
	assert(
		pickedNext?.senderId === 3,
		`should fall back to non-host; got senderId=${pickedNext?.senderId}`,
	);

	const store2 = new E2eeRosterStore(new InMemoryRosterPersistence());
	assert(
		(await store2.pickCommitter('empty-room', [])) === null,
		'empty room should return null',
	);

	await store.clearRoom(roomId);
	const list3 = await store.list(roomId);
	assert(list3.length === 0, 'clearRoom should remove all entries');

	await store.remove('nonexistent', 99);

	const store3 = new E2eeRosterStore(new InMemoryRosterPersistence());
	await store3.add(roomId, makeEntry(11, { isHost: true, joinedAt: 50 }));
	await store3.add(roomId, makeEntry(13, { joinedAt: 100 }));
	await store3.add(roomId, makeEntry(15, { joinedAt: 200 }));

	const pickedReconnect = await store3.pickCommitter(roomId, [15]);
	assert(
		pickedReconnect?.senderId === 11,
		`rejoin should not pick the joiner; got senderId=${pickedReconnect?.senderId}`,
	);

	const store4 = new E2eeRosterStore(new InMemoryRosterPersistence());
	await store4.add(roomId, makeEntry(15, { joinedAt: 200 }));
	const pickedLone = await store4.pickCommitter(roomId, [15]);
	assert(
		pickedLone === null,
		'pickCommitter must skip the joiner even when they are the only roster entry',
	);

	const persistence = new InMemoryRosterPersistence();
	const writer = new E2eeRosterStore(persistence);
	await writer.add(roomId, makeEntry(101, { isHost: true, joinedAt: 5 }));
	await writer.add(roomId, makeEntry(102, { joinedAt: 6 }));
	await writer.clearRoom('other-room');

	const reader = new E2eeRosterStore(persistence);
	const rehydrated = await reader.list(roomId);
	assert(
		rehydrated.length === 2,
		`rehydrated list should have 2 entries, got ${rehydrated.length}`,
	);
	const rehydratedHost = await reader.get(roomId, 101);
	assert(
		rehydratedHost?.isHost === true,
		'rehydrated host entry should have isHost=true',
	);

	console.log('E2eeRosterStore tests passed');
}

describe('E2eeRosterStore', () => {
	it('stores, picks, clears, and hydrates roster entries', async () => {
		await main();
	});
});
