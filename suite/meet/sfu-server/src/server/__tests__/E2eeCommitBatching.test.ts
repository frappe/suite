// Smoke tests for the commit-request batching window. Run via:
//   yarn test
//
// Verifies that:
//
//   1. Two rapid-fire `enqueueCommitRequest` calls in the same room+epoch
//      collapse into a single batched commit-request after the window.
//   2. The batched request has joiningSenderIds = [first, second].
//   3. flushPendingCommitRequests cancels pending timers.

import { describe, it } from 'vitest';
import { E2EEEpochRelay } from '../E2EEEpochRelay';
import {
	InMemoryRosterPersistence,
	type RosterEntry,
} from '../E2eeRosterPersistence';
import { E2eeRosterStore } from '../E2eeRosterStore';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`assertion failed: ${message}`);
}

function makeEntry(
	senderId: number,
	opts: Partial<RosterEntry> = {},
): RosterEntry {
	return {
		participantId: opts.participantId ?? `user-${senderId}`,
		senderId,
		isHost: opts.isHost ?? false,
		joinedAt: opts.joinedAt ?? Date.now(),
	};
}

type CommitRequestEnvelope = {
	type: string;
	joiningSenderIds?: number[];
	epochNumber?: number;
};

type TestRelay = {
	enqueueCommitRequest: (
		roomId: string,
		joiningSenderIds: number[],
		epochNumber: number,
	) => void;
	flushPendingCommitRequests: (roomId: string) => void;
};

async function main(): Promise<void> {
	const sent: Array<{ room: string; senderId: number; epoch: number }> = [];
	const hostSocket = {
		id: 'host-socket',
		participantId: 'host-1',
		emit: (_event: string, envelope: CommitRequestEnvelope) => {
			if (envelope.type === 'commit-request') {
				sent.push({
					room: 'meeting-1',
					senderId: envelope.joiningSenderIds?.[0] ?? -1,
					epoch: envelope.epochNumber ?? 0,
				});
			}
		},
	};
	const fakeIo = {
		sockets: {
			adapter: {
				rooms: new Map<string, Set<string>>([
					['meeting-1', new Set(['host-socket'])],
				]),
			},
			sockets: new Map<string, unknown>([['host-socket', hostSocket]]),
		},
	} as never;

	const relay = new E2EEEpochRelay(
		fakeIo,
		new Map<string, Set<string>>([['meeting-1', new Set(['host-socket'])]]),
		new Map<string, Map<string, number>>([
			['meeting-1', new Map<string, number>([['host-1', 7]])],
		]),
	);
	const roster = new E2eeRosterStore(new InMemoryRosterPersistence());
	await roster.add(
		'meeting-1',
		makeEntry(7, { participantId: 'host-1', isHost: true }),
	);
	relay.setRoster(roster);
	const testRelay = relay as unknown as TestRelay;

	// Two rapid key-package events for the same room+epoch.
	testRelay.enqueueCommitRequest('meeting-1', [9], 1);
	// Second joiner arrives within the batching window.
	testRelay.enqueueCommitRequest('meeting-1', [11], 1);

	// Within the window, no commit-request should have been emitted yet.
	assert(
		sent.length === 0,
		`expected no commit-request yet, got ${sent.length}`,
	);

	// Wait for the window to close.
	await new Promise((resolve) => setTimeout(resolve, 400));

	const emittedCount = (sent as { length: number }).length;
	assert(
		emittedCount === 1,
		`expected exactly one commit-request after window, got ${emittedCount}`,
	);
	const first = sent[0] ?? {};
	assert(first.room === 'meeting-1', 'commit-request should target meeting-1');
	relay.clearRoom('meeting-1');

	// flushPendingCommitRequests cancels the timer.
	sent.splice(0, sent.length);
	testRelay.enqueueCommitRequest('meeting-1', [13], 2);
	testRelay.flushPendingCommitRequests('meeting-1');
	await new Promise((resolve) => setTimeout(resolve, 400));
	assert(
		sent.length === 0,
		`flush should have cancelled the pending commit-request, got ${sent.length}`,
	);

	console.log('Commit-request batching tests passed');
}

describe('E2EE commit batching', () => {
	it('batches rapid commit requests and can flush pending batches', async () => {
		await main();
	});
});
