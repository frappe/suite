// Smoke tests for stale pending E2EE join cleanup on disconnect. Run via:
//   yarn test

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
	committerSenderId?: number;
	epochNumber?: number;
	nextEpochNumber?: number;
	membershipDeltaId?: string;
	joiningSenderIds?: number[];
	removedSenderIds?: number[];
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

type TestRelay = {
	enqueueCommitRequest: (
		roomId: string,
		joiningSenderIds: number[],
		epochNumber: number,
	) => void;
	requestCommitFromHost: (
		roomId: string,
		joiningSenderIds: number[],
		epochNumber: number,
	) => Promise<void>;
	redesignate: (roomId: string, epochNumber: number) => Promise<void>;
	commitRequestBatches: Map<unknown, unknown>;
	pendingCommitRequests: Map<string, PendingCommitRequest>;
	participantToSender: Map<string, Map<string, number>>;
};

function makeRelay(): {
	relay: E2EEEpochRelay;
	testRelay: TestRelay;
	roster: E2eeRosterStore;
	sent: Array<{
		room: string;
		target: string;
		committerSenderId: number;
		joiningSenderIds: number[];
	}>;
} {
	const sent: Array<{
		room: string;
		target: string;
		committerSenderId: number;
		joiningSenderIds: number[];
	}> = [];
	const makeSocket = (id: string, participantId: string) => ({
		id,
		participantId,
		emit: (_event: string, envelope: CommitRequestEnvelope) => {
			if (envelope.type === 'commit-request') {
				sent.push({
					room: 'meeting-1',
					target: participantId,
					committerSenderId: envelope.committerSenderId ?? -1,
					joiningSenderIds: envelope.joiningSenderIds ?? [],
				});
			}
		},
	});
	const fakeIo = {
		sockets: {
			adapter: {
				rooms: new Map<string, Set<string>>([
					['meeting-1', new Set(['host-socket', 'alice-socket'])],
				]),
			},
			sockets: new Map<string, unknown>([
				['host-socket', makeSocket('host-socket', 'host-1')],
				['alice-socket', makeSocket('alice-socket', 'alice-1')],
			]),
		},
	} as never;
	const relay = new E2EEEpochRelay(
		fakeIo,
		new Map<string, Set<string>>([
			['meeting-1', new Set(['host-socket', 'alice-socket'])],
		]),
		new Map<string, Map<string, number>>([
			[
				'meeting-1',
				new Map<string, number>([
					['host-1', 7],
					['alice-1', 9],
					['joiner-13', 13],
					['joiner-15', 15],
				]),
			],
		]),
	);
	const roster = new E2eeRosterStore(new InMemoryRosterPersistence());
	relay.setRoster(roster);
	const testRelay = relay as unknown as TestRelay;
	return { relay, testRelay, roster, sent };
}

async function main(): Promise<void> {
	// -------- Test 1: batched joiner disconnects before window fires --------
	{
		const { relay, testRelay, roster, sent } = makeRelay();
		await roster.add(
			'meeting-1',
			makeEntry(7, { participantId: 'host-1', isHost: true }),
		);
		testRelay.enqueueCommitRequest('meeting-1', [13], 1);
		relay.removePendingJoiner('meeting-1', 13);
		await new Promise((resolve) => setTimeout(resolve, 400));
		assert(sent.length === 0, `expected no commit-request, got ${sent.length}`);
		assert(
			testRelay.commitRequestBatches.size === 0,
			`expected no pending batches, got ${testRelay.commitRequestBatches.size}`,
		);
		relay.clearRoom('meeting-1');
	}

	// -------- Test 2: pending commit request loses its last joiner --------
	{
		const { relay, testRelay, roster, sent } = makeRelay();
		await roster.add(
			'meeting-1',
			makeEntry(7, { participantId: 'host-1', isHost: true }),
		);
		await testRelay.requestCommitFromHost('meeting-1', [13], 1);
		relay.removePendingJoiner('meeting-1', 13);
		await testRelay.redesignate('meeting-1', 1);
		assert(
			sent.length === 1,
			`expected one initial request, got ${sent.length}`,
		);
		assert(
			!testRelay.pendingCommitRequests.has('meeting-1:1'),
			'expected pending commit request to be removed',
		);
		relay.clearRoom('meeting-1');
	}

	// -------- Test 3: multiple joiners, one disconnects --------
	{
		const { relay, testRelay, roster, sent } = makeRelay();
		await roster.add(
			'meeting-1',
			makeEntry(7, { participantId: 'host-1', isHost: true, joinedAt: 1 }),
		);
		await roster.add(
			'meeting-1',
			makeEntry(9, { participantId: 'alice-1', joinedAt: 2 }),
		);
		await testRelay.requestCommitFromHost('meeting-1', [13, 15], 1);
		relay.removePendingJoiner('meeting-1', 13);
		await testRelay.redesignate('meeting-1', 1);
		assert(sent.length === 2, `expected second request, got ${sent.length}`);
		assert(
			JSON.stringify(sent[1].joiningSenderIds) === JSON.stringify([15]),
			`expected remaining joiner [15], got ${JSON.stringify(sent[1].joiningSenderIds)}`,
		);
		relay.clearRoom('meeting-1');
	}

	// -------- Test 4: current committer disconnects with no replacement --------
	{
		const { relay, testRelay, roster, sent } = makeRelay();
		await roster.add(
			'meeting-1',
			makeEntry(7, { participantId: 'host-1', isHost: true }),
		);
		testRelay.participantToSender.set(
			'meeting-1',
			new Map<string, number>([
				['host-1', 7],
				['joiner-13', 13],
			]),
		);
		await testRelay.requestCommitFromHost('meeting-1', [13], 1);
		await roster.remove('meeting-1', 7);
		relay.removePendingJoiner('meeting-1', 7);
		await testRelay.redesignate('meeting-1', 1);
		assert(sent.length === 1, `expected no redesignation, got ${sent.length}`);
		assert(
			!testRelay.pendingCommitRequests.has('meeting-1:1'),
			'expected pending commit request to be dropped',
		);
		relay.clearRoom('meeting-1');
	}

	// -------- Test 5: removed senderId stays in removedSenderIds --------
	{
		const { relay, testRelay } = makeRelay();
		const pending: PendingCommitRequest = {
			joiningSenderIds: [],
			removedSenderIds: [13],
			epochNumber: 1,
			membershipDeltaId: 'remove-13-to-2',
			membershipDeltaHash: 'YWFhYWE=',
			rosterHash: 'YWFhYWE=',
			alreadyTried: [],
			attempts: 0,
			timer: setTimeout(() => undefined, 10_000),
		};
		testRelay.pendingCommitRequests.set('meeting-1:1', pending);
		relay.removePendingJoiner('meeting-1', 13);
		assert(
			testRelay.pendingCommitRequests.has('meeting-1:1'),
			'expected remove-only pending request to remain',
		);
		clearTimeout(pending.timer);
		relay.clearRoom('meeting-1');
	}

	console.log('Pending joiner disconnect tests passed');
}

describe('E2EE pending joiner disconnect cleanup', () => {
	it('drops stale pending joiners and preserves remove-only requests', async () => {
		await main();
	});
});
