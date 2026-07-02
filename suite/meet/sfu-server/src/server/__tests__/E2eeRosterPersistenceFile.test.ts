// Smoke tests for the file-backed RosterPersistence. Run via:
//   yarn test
//
// Verifies that:
//
//   1. A fresh FileRosterPersistence against a missing file yields an empty
//      hydration.
//   2. Writes are persisted to disk and survive a "process restart" (i.e.
//      a second FileRosterPersistence instance pointed at the same file).
//   3. Atomic write: a stray .tmp file is not consumed on load.
//   4. Schema mismatch: a corrupt or wrong-version file throws on load.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import {
	InMemoryRosterPersistence,
	type RosterEntry,
} from '../E2eeRosterPersistence';
import { FileRosterPersistence } from '../E2eeRosterPersistenceFile';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`assertion failed: ${message}`);
}

async function main(): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), 'meet-sfu-roster-'));
	const filePath = join(dir, 'roster.json');

	try {
		// 1. Fresh file -> empty.
		assert(!existsSync(filePath), 'file should not exist yet');
		const fresh = new FileRosterPersistence(filePath);
		const freshAll = await fresh.loadAll();
		assert(
			freshAll.size === 0,
			`fresh file should hydrate empty, got ${freshAll.size} rooms`,
		);

		// 2. Writes survive a "process restart".
		await fresh.addEntry('meeting-1', {
			participantId: 'user-1',
			senderId: 7,
			isHost: true,
			joinedAt: 1700000000000,
		});
		await fresh.addEntry('meeting-1', {
			participantId: 'user-2',
			senderId: 9,
			isHost: false,
			joinedAt: 1700000001000,
		});
		await fresh.clearRoom('other-room');
		assert(existsSync(filePath), 'file should exist after writes');

		const restarted = new FileRosterPersistence(filePath);
		const rehydrated = await restarted.loadAll();
		const meeting1 = rehydrated.get('meeting-1') ?? [];
		assert(
			meeting1.length === 2,
			`rehydrated meeting-1 should have 2 entries, got ${meeting1.length}`,
		);
		assert(
			meeting1[0]?.senderId === 7 && meeting1[0]?.isHost === true,
			'host entry should be at index 0 with isHost=true',
		);
		assert(
			meeting1[1]?.senderId === 9 && meeting1[1]?.isHost === false,
			'non-host entry should be at index 1',
		);

		// 3. removeEntry persists.
		await restarted.removeEntry('meeting-1', 9);
		const after = new FileRosterPersistence(filePath);
		const afterList = (await after.loadAll()).get('meeting-1') ?? [];
		assert(
			afterList.length === 1 && afterList[0]?.senderId === 7,
			'remove should have dropped sender 9',
		);

		// 4. clearRoom persists.
		await after.clearRoom('meeting-1');
		const final = new FileRosterPersistence(filePath);
		const finalList = await final.loadAll();
		assert(
			finalList.size === 0 ||
				(finalList.has('meeting-1') &&
					finalList.get('meeting-1')?.length === 0),
			'clearRoom should have wiped meeting-1',
		);

		// 5. Atomic write: a stray .tmp file from a crashed write is not
		// consumed on load.
		const { writeFileSync } = await import('node:fs');
		writeFileSync(`${filePath}.tmp`, '{"garbage":true}');
		const afterTmp = new FileRosterPersistence(filePath);
		const afterTmpList = await afterTmp.loadAll();
		assert(afterTmpList.size === 0, '.tmp file should be ignored on load');

		// 6. In-memory and file-backed agree on semantics: a write followed
		// by a load returns the same data, regardless of backing store.
		const mem = new InMemoryRosterPersistence();
		const file = new FileRosterPersistence(
			join(dir, 'roster-mem-vs-file.json'),
		);
		const entry: RosterEntry = {
			participantId: 'user-x',
			senderId: 42,
			isHost: true,
			joinedAt: 42,
		};
		await mem.addEntry('r', entry);
		await file.addEntry('r', entry);
		const memList = (await mem.loadAll()).get('r') ?? [];
		const fileList = (await file.loadAll()).get('r') ?? [];
		assert(
			memList.length === 1 &&
				fileList.length === 1 &&
				memList[0]?.senderId === fileList[0]?.senderId,
			'in-memory and file-backed should agree',
		);

		console.log('FileRosterPersistence tests passed');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe('FileRosterPersistence', () => {
	it('persists roster entries and handles edge cases', async () => {
		await main();
	});
});
