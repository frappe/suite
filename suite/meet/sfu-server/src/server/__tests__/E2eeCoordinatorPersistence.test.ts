import { describe, expect, it } from 'vitest';
import { E2EEEpochRelay } from '../E2EEEpochRelay';
import { InMemoryE2eeCoordinatorPersistence } from '../E2eeCoordinatorPersistence';
import { InMemoryRosterPersistence } from '../E2eeRosterPersistence';
import { E2eeRosterStore } from '../E2eeRosterStore';

type EmittedEnvelope = {
	type: string;
	epochNumber?: number;
	nextEpochNumber?: number;
	membershipDeltaId?: string;
	membershipDeltaHash?: string;
	rosterHash?: string;
	toSenderId?: number;
	reason?: string;
};

type TestRelay = {
	requestCommitFromHost: (
		roomId: string,
		joiningSenderIds: number[],
		epochNumber: number,
	) => Promise<void>;
	relayCommit: (
		roomId: string,
		fromParticipantId: string,
		fromSenderId: number,
		payload: {
			type: 'commit';
			previousEpochNumber: number;
			epochNumber: number;
			membershipDeltaId: string;
			membershipDeltaHash: string;
			rosterHash: string;
			mlsCommit: string;
		},
	) => Promise<void>;
	relayWelcome: (
		roomId: string,
		fromParticipantId: string,
		fromSenderId: number,
		payload: {
			type: 'welcome';
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
			type: 'key-package';
			epochNumber: number;
			keyPackage: string;
		},
	) => Promise<void>;
	replayRetainedMaterial: (
		roomId: string,
		fromSenderId: number,
		payload: { type: 'resync-request'; knownEpochNumber?: number },
	) => Promise<void>;
	emitToTarget: (
		roomId: string,
		participantId: string,
		envelope: EmittedEnvelope,
	) => void;
};

async function makeRelay(
	persistence: InMemoryE2eeCoordinatorPersistence,
	sent: Array<{ participantId: string; envelope: EmittedEnvelope }> = [],
): Promise<E2EEEpochRelay> {
	const hostSocket = {
		id: 'socket-1',
		participantId: 'host',
		emit: (_event: string, envelope: EmittedEnvelope) => {
			sent.push({ participantId: 'host', envelope });
		},
	};
	const fakeIo = {
		sockets: {
			adapter: {
				rooms: new Map<string, Set<string>>([
					['meeting-1', new Set(['socket-1'])],
				]),
			},
			sockets: new Map<string, typeof hostSocket>([['socket-1', hostSocket]]),
		},
	} as never;
	const relay = new E2EEEpochRelay(
		fakeIo,
		new Map<string, Set<string>>([['meeting-1', new Set(['socket-1'])]]),
		new Map<string, Map<string, number>>([
			[
				'meeting-1',
				new Map<string, number>([
					['host', 1],
					['joiner', 9],
					['other', 11],
				]),
			],
		]),
		persistence,
	);
	const roster = new E2eeRosterStore(new InMemoryRosterPersistence());
	await roster.add('meeting-1', {
		participantId: 'host',
		senderId: 1,
		isHost: true,
		joinedAt: 1,
	});
	relay.setRoster(roster);
	const testRelay = relay as unknown as TestRelay;
	testRelay.emitToTarget = (
		_roomId: string,
		participantId: string,
		envelope: EmittedEnvelope,
	) => {
		sent.push({ participantId, envelope });
	};
	return relay;
}

describe('E2EE coordinator persistence', () => {
	it('hydrates retained commit and targeted welcome for resync replay', async () => {
		const persistence = new InMemoryE2eeCoordinatorPersistence();
		const writerSent: Array<{
			participantId: string;
			envelope: EmittedEnvelope;
		}> = [];
		const writer = (await makeRelay(
			persistence,
			writerSent,
		)) as unknown as TestRelay;
		await writer.requestCommitFromHost('meeting-1', [9], 1);
		const request = writerSent.find(
			(entry) => entry.envelope.type === 'commit-request',
		)?.envelope;
		expect(request).toBeDefined();
		await writer.relayCommit('meeting-1', 'host', 1, {
			type: 'commit',
			previousEpochNumber: request?.epochNumber ?? 1,
			epochNumber: request?.nextEpochNumber ?? 2,
			membershipDeltaId: request?.membershipDeltaId ?? '',
			membershipDeltaHash: request?.membershipDeltaHash ?? '',
			rosterHash: request?.rosterHash ?? '',
			mlsCommit: 'Y29tbWl0',
		});
		await writer.relayWelcome('meeting-1', 'host', 1, {
			type: 'welcome',
			toSenderId: 9,
			epochNumber: 2,
			mlsWelcome: 'd2VsY29tZQ==',
		});

		const sent: Array<{ participantId: string; envelope: EmittedEnvelope }> =
			[];
		const reader = (await makeRelay(persistence, sent)) as unknown as TestRelay;
		await reader.replayRetainedMaterial('meeting-1', 9, {
			type: 'resync-request',
			knownEpochNumber: 1,
		});

		expect(sent).toEqual([
			{
				participantId: 'joiner',
				envelope: expect.objectContaining({ type: 'commit', epochNumber: 2 }),
			},
			{
				participantId: 'joiner',
				envelope: expect.objectContaining({
					type: 'welcome',
					epochNumber: 2,
					toSenderId: 9,
				}),
			},
		]);
	});

	it('does not replay a welcome to a different sender', async () => {
		const persistence = new InMemoryE2eeCoordinatorPersistence();
		const writerSent: Array<{
			participantId: string;
			envelope: EmittedEnvelope;
		}> = [];
		const writer = (await makeRelay(
			persistence,
			writerSent,
		)) as unknown as TestRelay;
		await writer.requestCommitFromHost('meeting-1', [9], 1);
		const request = writerSent.find(
			(entry) => entry.envelope.type === 'commit-request',
		)?.envelope;
		expect(request).toBeDefined();
		await writer.relayCommit('meeting-1', 'host', 1, {
			type: 'commit',
			previousEpochNumber: request?.epochNumber ?? 1,
			epochNumber: request?.nextEpochNumber ?? 2,
			membershipDeltaId: request?.membershipDeltaId ?? '',
			membershipDeltaHash: request?.membershipDeltaHash ?? '',
			rosterHash: request?.rosterHash ?? '',
			mlsCommit: 'Y29tbWl0',
		});
		await writer.relayWelcome('meeting-1', 'host', 1, {
			type: 'welcome',
			toSenderId: 9,
			epochNumber: 2,
			mlsWelcome: 'd2VsY29tZQ==',
		});

		const sent: Array<{ participantId: string; envelope: EmittedEnvelope }> =
			[];
		const reader = (await makeRelay(persistence, sent)) as unknown as TestRelay;
		await reader.replayRetainedMaterial('meeting-1', 11, {
			type: 'resync-request',
			knownEpochNumber: 1,
		});

		expect(sent).toEqual([
			{
				participantId: 'other',
				envelope: expect.objectContaining({ type: 'commit', epochNumber: 2 }),
			},
		]);
	});

	it('requests a fresh key package when retained replay has an epoch gap', async () => {
		const persistence = new InMemoryE2eeCoordinatorPersistence();
		await persistence.setCurrentEpoch('meeting-1', 3);
		await persistence.retainCommit(
			'meeting-1',
			{
				type: 'commit',
				fromParticipantId: 'host',
				fromSenderId: 1,
				previousEpochNumber: 2,
				epochNumber: 3,
				membershipDeltaId: 'add-11-to-3',
				membershipDeltaHash: 'YWJj',
				rosterHash: 'YWJj',
				mlsCommit: 'Y29tbWl0',
			},
			Date.now() + 60_000,
		);

		const sent: Array<{ participantId: string; envelope: EmittedEnvelope }> =
			[];
		const reader = (await makeRelay(persistence, sent)) as unknown as TestRelay;
		await reader.replayRetainedMaterial('meeting-1', 9, {
			type: 'resync-request',
			knownEpochNumber: 1,
		});

		expect(sent).toEqual([
			{
				participantId: 'joiner',
				envelope: expect.objectContaining({
					type: 'key-package-request',
					epochNumber: 3,
					reason: 'reconnect',
				}),
			},
		]);
	});

	it('marks admitted key packages consumed after matching commit', async () => {
		const persistence = new InMemoryE2eeCoordinatorPersistence();
		const sent: Array<{ participantId: string; envelope: EmittedEnvelope }> =
			[];
		const relay = (await makeRelay(persistence, sent)) as unknown as TestRelay;
		await relay.relayKeyPackage('meeting-1', 'joiner', 9, {
			type: 'key-package',
			epochNumber: 1,
			keyPackage: 'a2V5LXBhY2thZ2U=',
		});
		await new Promise((resolve) => setTimeout(resolve, 400));
		const request = sent.find(
			(entry) => entry.envelope.type === 'commit-request',
		)?.envelope;
		expect(request).toBeDefined();
		await relay.relayCommit('meeting-1', 'host', 1, {
			type: 'commit',
			previousEpochNumber: request?.epochNumber ?? 1,
			epochNumber: request?.nextEpochNumber ?? 2,
			membershipDeltaId: request?.membershipDeltaId ?? '',
			membershipDeltaHash: request?.membershipDeltaHash ?? '',
			rosterHash: request?.rosterHash ?? '',
			mlsCommit: 'Y29tbWl0',
		});

		const state = await persistence.loadAll();
		expect(state.get('meeting-1')?.keyPackages).toEqual([
			expect.objectContaining({
				fromSenderId: 9,
				epochNumber: 1,
				consumed: true,
			}),
		]);
	});
});
