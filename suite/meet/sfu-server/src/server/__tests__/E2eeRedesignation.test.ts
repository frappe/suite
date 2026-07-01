// Smoke tests for the committer redesignation timer. Run via:
//   yarn test
//
// Verifies that:
//
//   1. When the designated committer doesn't respond with a commit within
//      COMMITTER_TIMEOUT_MS, the SFU emits a second commit-request to a
//      different committer.
//   2. When a commit envelope arrives for the matching delta, the
//      redesignation timer is cleared and no further commit-requests are
//      emitted.
//   3. After MAX_REDESIGNATIONS attempts, the SFU gives up and stops
//      emitting commit-requests.

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
	membershipDeltaHash?: string;
	rosterHash?: string;
	joiningSenderIds?: number[];
};

type CommitEnvelope = {
	type: string;
	fromParticipantId: string;
	fromSenderId: number;
	previousEpochNumber: number;
	epochNumber: number;
	membershipDeltaId: string;
	membershipDeltaHash: string;
	rosterHash: string;
	mlsCommit: string;
};

type TestRelay = {
	requestCommitFromHost: (
		roomId: string,
		joiningSenderIds: number[],
		epochNumber: number,
	) => Promise<void>;
	redesignate: (roomId: string, epochNumber: number) => Promise<void>;
	relayCommit: (
		roomId: string,
		fromParticipantId: string,
		fromSenderId: number,
		payload: CommitEnvelope,
	) => Promise<void>;
	relayWelcome: (
		roomId: string,
		fromParticipantId: string,
		fromSenderId: number,
		payload: {
			type: string;
			toSenderId: number;
			epochNumber: number;
			mlsWelcome: string;
		},
	) => Promise<void>;
	relayKeyPackage: (
		roomId: string,
		fromParticipantId: string,
		fromSenderId: number,
		payload: {
			type: string;
			epochNumber: number;
			keyPackage: string;
		},
	) => Promise<void>;
	recordAck: (
		roomId: string,
		fromParticipantId: string,
		fromSenderId: number,
		payload: { type: string; epochNumber: number },
		isHost?: boolean,
	) => Promise<void>;
};

async function main(): Promise<void> {
	const sent: Array<{
		room: string;
		target: string;
		committerSenderId: number;
		epochNumber: number;
		nextEpochNumber: number;
		membershipDeltaId: string;
		membershipDeltaHash: string;
		rosterHash: string;
		joiningSenderIds: number[];
	}> = [];
	const sentBySocket: Array<{
		socketId: string;
		envelope: CommitRequestEnvelope;
	}> = [];
	const makeSocket = (
		id: string,
		participantId: string,
		overrides: Record<string, unknown> = {},
	) => ({
		id,
		participantId,
		...overrides,
		emit: (_event: string, envelope: CommitRequestEnvelope) => {
			sentBySocket.push({ socketId: id, envelope });
			if (envelope.type === 'commit-request') {
				sent.push({
					room: 'meeting-1',
					target: participantId,
					committerSenderId: envelope.committerSenderId ?? -1,
					epochNumber: envelope.epochNumber ?? 0,
					nextEpochNumber: envelope.nextEpochNumber ?? 0,
					membershipDeltaId: envelope.membershipDeltaId ?? '',
					membershipDeltaHash: envelope.membershipDeltaHash ?? '',
					rosterHash: envelope.rosterHash ?? '',
					joiningSenderIds: envelope.joiningSenderIds ?? [],
				});
			}
		},
	});
	const fakeIo = {
		sockets: {
			adapter: {
				rooms: new Map<string, Set<string>>([
					['meeting-1', new Set(['host-socket', 'alice-socket', 'bob-socket'])],
					['meeting-empty', new Set(['host-empty-socket'])],
				]),
			},
			sockets: new Map<string, unknown>([
				[
					'host-socket',
					makeSocket('host-socket', 'host-1', { isHost: true, senderId: 7 }),
				],
				['alice-socket', makeSocket('alice-socket', 'alice-1')],
				['bob-socket', makeSocket('bob-socket', 'bob-1')],
				[
					'host-empty-socket',
					makeSocket('host-empty-socket', 'host-empty', {
						isHost: true,
						senderId: 7,
					}),
				],
			]),
		},
	} as never;

	const relay = new E2EEEpochRelay(
		fakeIo,
		new Map<string, Set<string>>([
			['meeting-1', new Set(['host-socket', 'alice-socket', 'bob-socket'])],
			['meeting-empty', new Set(['host-empty-socket'])],
		]),
		new Map<string, Map<string, number>>([
			[
				'meeting-1',
				new Map<string, number>([
					['host-1', 7],
					['alice-1', 9],
					['bob-1', 11],
					['joiner-19', 19],
				]),
			],
		]),
	);
	const roster = new E2eeRosterStore(new InMemoryRosterPersistence());
	await roster.add(
		'meeting-1',
		makeEntry(7, { participantId: 'host-1', isHost: true, joinedAt: 1 }),
	);
	await roster.add(
		'meeting-1',
		makeEntry(9, { participantId: 'alice-1', joinedAt: 2 }),
	);
	await roster.add(
		'meeting-1',
		makeEntry(11, { participantId: 'bob-1', joinedAt: 3 }),
	);
	relay.setRoster(roster);
	const testRelay = relay as unknown as TestRelay;

	// -------- Test 0: host genesis ack admits the host and retries pending joins --------
	await testRelay.requestCommitFromHost('meeting-empty', [13], 1);
	assert(
		(sent as { length: number }).length === 0,
		`expected pending request to wait before host ack, got ${(sent as { length: number }).length}`,
	);
	await testRelay.recordAck(
		'meeting-empty',
		'host-empty',
		7,
		{ type: 'ack', epochNumber: 1 },
		true,
	);
	assert(
		(sent as { length: number }).length === 1,
		`expected admitted host to receive pending commit-request, got ${(sent as { length: number }).length}`,
	);
	assert(
		sent[0].target === 'host-empty',
		`expected admitted host-empty to receive commit-request, got ${sent[0].target}`,
	);
	assert(
		(await roster.get('meeting-empty', 7))?.participantId === 'host-empty',
		'expected host ack to add host to roster',
	);
	assert(
		(await roster.get('meeting-empty', 7))?.isHost === true,
		'expected host ack to preserve host committer priority',
	);
	relay.clearRoom('meeting-empty');
	sent.splice(0, sent.length);

	// -------- Test 1: admitted member key-package is not treated as a joiner --------
	await testRelay.relayKeyPackage('meeting-1', 'host-1', 7, {
		type: 'key-package',
		epochNumber: 1,
		keyPackage: Buffer.from([1, 2, 3]).toString('base64'),
	});
	await new Promise((resolve) => setTimeout(resolve, 400));
	assert(
		(sent as { length: number }).length === 0,
		`expected admitted host key-package to be ignored, got ${(sent as { length: number }).length}`,
	);
	await testRelay.relayKeyPackage('meeting-1', 'joiner-13', 13, {
		type: 'key-package',
		epochNumber: 1,
		keyPackage: Buffer.from([4, 5, 6]).toString('base64'),
	});
	await new Promise((resolve) => setTimeout(resolve, 400));
	assert(
		(sent as { length: number }).length === 1,
		`expected real joiner key-package to dispatch one commit-request, got ${(sent as { length: number }).length}`,
	);
	assert(
		sent[0].joiningSenderIds.length === 1 && sent[0].joiningSenderIds[0] === 13,
		`expected real joiner request to include only [13], got ${JSON.stringify(sent[0].joiningSenderIds)}`,
	);
	relay.clearRoom('meeting-1');
	await roster.add(
		'meeting-1',
		makeEntry(7, { participantId: 'host-1', isHost: true, joinedAt: 1 }),
	);
	await roster.add(
		'meeting-1',
		makeEntry(9, { participantId: 'alice-1', joinedAt: 2 }),
	);
	await roster.add(
		'meeting-1',
		makeEntry(11, { participantId: 'bob-1', joinedAt: 3 }),
	);
	sent.splice(0, sent.length);

	// -------- Test 2: redesignation after timeout --------
	await testRelay.requestCommitFromHost('meeting-1', [13], 1);
	assert(
		(sent as { length: number }).length === 1,
		`expected first commit-request immediately, got ${(sent as { length: number }).length}`,
	);
	assert(
		sent[0].committerSenderId === 7,
		`first attempt should target host (7), got ${sent[0].committerSenderId}`,
	);
	assert(
		sent[0].joiningSenderIds.length === 1 && sent[0].joiningSenderIds[0] === 13,
		`first attempt should include joiner [13], got ${JSON.stringify(sent[0].joiningSenderIds)}`,
	);

	// Trigger redesignation directly (avoid waiting COMMITTER_TIMEOUT_MS).
	await testRelay.redesignate('meeting-1', 1);
	assert(
		(sent as { length: number }).length === 2,
		`expected second commit-request after redesignate, got ${(sent as { length: number }).length}`,
	);
	const second = sent[1] ?? {};
	assert(
		second.committerSenderId !== sent[0].committerSenderId,
		`second attempt should target a different committer; first=${sent[0].committerSenderId}, second=${second.committerSenderId}`,
	);
	assert(
		second.committerSenderId === 9,
		`second attempt should target oldest non-host (alice, 9), got ${second.committerSenderId}`,
	);

	await testRelay.redesignate('meeting-1', 1);
	assert(
		(sent as { length: number }).length === 3,
		`expected third commit-request after second redesignate, got ${(sent as { length: number }).length}`,
	);
	const third = sent[2] ?? {};
	assert(
		third.committerSenderId === 11,
		`third attempt should target bob (11), got ${third.committerSenderId}`,
	);

	await testRelay.redesignate('meeting-1', 1);
	assert(
		(sent as { length: number }).length === 3,
		`expected no further commit-requests after MAX_REDESIGNATIONS, got ${(sent as { length: number }).length}`,
	);

	await testRelay.relayKeyPackage('meeting-1', 'joiner-13', 13, {
		type: 'key-package',
		epochNumber: 1,
		keyPackage: Buffer.from([4, 5, 6]).toString('base64'),
	});
	await new Promise((resolve) => setTimeout(resolve, 400));
	assert(
		(sent as { length: number }).length === 4,
		`expected fresh key-package to restart admission after exhausted retries, got ${(sent as { length: number }).length}`,
	);
	assert(
		sent[3].committerSenderId === 7,
		`fresh key-package should make host eligible again, got ${sent[3].committerSenderId}`,
	);
	sent.splice(0, sent.length);
	await roster.add(
		'meeting-1',
		makeEntry(17, {
			participantId: 'stale-host',
			isHost: true,
			joinedAt: 0,
		}),
	);
	await testRelay.requestCommitFromHost('meeting-1', [19], 1);
	assert(
		(sent as { length: number }).length === 1,
		`expected stale roster host to be pruned and live host to receive commit-request, got ${(sent as { length: number }).length}`,
	);
	assert(
		sent[0].target === 'host-1',
		`expected commit-request to target live host-1 after pruning stale-host, got ${sent[0].target}`,
	);
	assert(
		(await roster.get('meeting-1', 19)) === undefined,
		'pending joiner should not be in roster before ack',
	);
	await testRelay.recordAck('meeting-1', 'joiner-21', 21, {
		type: 'ack',
		epochNumber: 2,
	});
	assert(
		(await roster.get('meeting-1', 21)) === undefined,
		'joiner ack without retained welcome should not be promoted into roster',
	);
	await testRelay.relayWelcome('meeting-1', 'host-1', 7, {
		type: 'welcome',
		toSenderId: 19,
		epochNumber: 2,
		mlsWelcome: Buffer.from([9, 9, 9]).toString('base64'),
	});
	await testRelay.recordAck('meeting-1', 'joiner-19', 19, {
		type: 'ack',
		epochNumber: 2,
	});
	assert(
		(await roster.get('meeting-1', 19))?.participantId === 'joiner-19',
		'acked joiner should be promoted into roster',
	);
	relay.clearRoom('meeting-1');

	// -------- Test 2: relay commit clears pending --------
	sent.splice(0, sent.length);
	await testRelay.requestCommitFromHost('meeting-1', [15], 2);
	assert(
		(sent as { length: number }).length === 1,
		`expected one commit-request after fresh request, got ${(sent as { length: number }).length}`,
	);
	const first = sent[0];
	const commitCountBefore = sentBySocket.filter(
		(entry) => entry.envelope.type === 'commit',
	).length;
	await testRelay.relayCommit('meeting-1', 'alice-1', 9, {
		type: 'commit',
		fromParticipantId: 'alice-1',
		fromSenderId: 9,
		previousEpochNumber: first.epochNumber,
		epochNumber: first.nextEpochNumber,
		membershipDeltaId: first.membershipDeltaId,
		membershipDeltaHash: first.membershipDeltaHash,
		rosterHash: first.rosterHash,
		mlsCommit: Buffer.from([9, 9, 9]).toString('base64'),
	});
	assert(
		sentBySocket.filter((entry) => entry.envelope.type === 'commit').length ===
			commitCountBefore,
		'non-designated committer should not have its commit broadcast',
	);

	await testRelay.relayCommit('meeting-1', 'host-1', 7, {
		type: 'commit',
		fromParticipantId: 'host-1',
		fromSenderId: 7,
		previousEpochNumber: first.epochNumber,
		epochNumber: first.nextEpochNumber,
		membershipDeltaId: first.membershipDeltaId,
		membershipDeltaHash: first.membershipDeltaHash,
		rosterHash: first.rosterHash,
		mlsCommit: Buffer.from([1, 2, 3]).toString('base64'),
	});

	await testRelay.redesignate('meeting-1', first.epochNumber);
	assert(
		(sent as { length: number }).length === 1,
		`expected no further commit-requests after commit cleared pending, got ${(sent as { length: number }).length}`,
	);

	console.log('Committer redesignation tests passed');
}

describe('E2EE committer redesignation', () => {
	it('redesignates committers and clears pending requests', async () => {
		await main();
	});
});
