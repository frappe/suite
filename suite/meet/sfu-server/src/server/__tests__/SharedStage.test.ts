import { afterEach, describe, expect, it, vi } from 'vitest';
import { SharedStage } from '../SharedStage';

const participants = ['a', 'b', 'c', 'd'].map((id) => ({
	participant_id: id,
	name: id,
	audio_enabled: true,
	video_enabled: true,
}));
afterEach(() => vi.useRealTimers());
function room() {
	vi.useFakeTimers();
	vi.setSystemTime(10000);
	const publish = vi.fn();
	const stage = new SharedStage(publish);
	stage.inventory([...participants].reverse(), {});
	return { stage, publish };
}
describe('canonical Shared Stage', () => {
	it('ignores brief sounds, promotes sustained turns and retains recency through silence for late snapshots', () => {
		const { stage } = room();
		expect(stage.snapshot.participantIds).toEqual(['a', 'b', 'c', 'd']);
		stage.activity(['d']);
		vi.advanceTimersByTime(400);
		stage.activity([]);
		expect(stage.snapshot.participantIds).toEqual(['a', 'b', 'c', 'd']);
		stage.activity(['c']);
		vi.advanceTimersByTime(800);
		stage.activity(['c']);
		vi.advanceTimersByTime(200);
		expect(stage.snapshot.activeSpeakerIds).toEqual(['c']);
		stage.activity([]);
		expect(stage.snapshot.activeSpeakerIds).toEqual([]);
		expect(stage.snapshot.participantIds).toEqual(['c', 'a', 'b', 'd']);
		stage.activity(['d']);
		vi.advanceTimersByTime(1000);
		stage.activity([]);
		expect(stage.snapshot.participantIds).toEqual(['d', 'c', 'a', 'b']);
		vi.advanceTimersByTime(120000);
		expect(stage.snapshot.participantIds).toEqual(['a', 'b', 'c', 'd']);
		stage.close();
	});
	it('orders simultaneous activity deterministically, respects hand queue, removes departures and cancels timers', () => {
		const { stage, publish } = room();
		stage.activity(['d', 'c']);
		vi.advanceTimersByTime(1000);
		expect(stage.snapshot.participantIds).toEqual(['c', 'd', 'a', 'b']);
		stage.activity([]);
		stage.inventory(participants, {
			b: '2026-01-01T00:00:01Z',
			a: '2026-01-01T00:00:00Z',
		});
		expect(stage.snapshot.participantIds).toEqual(['a', 'b', 'c', 'd']);
		stage.inventory(
			participants.filter((p) => p.participant_id !== 'c'),
			{},
		);
		expect(stage.snapshot.participantIds).toEqual(['d', 'a', 'b']);
		const count = publish.mock.calls.length;
		stage.close();
		vi.advanceTimersByTime(200000);
		expect(publish).toHaveBeenCalledTimes(count);
		expect(vi.getTimerCount()).toBe(0);
	});
	it('expires raw activity even when the SFU stops sending samples', () => {
		const { stage } = room();
		stage.activity(['d']);
		vi.advanceTimersByTime(1000);
		const version = stage.snapshot.version;
		vi.advanceTimersByTime(600);
		expect(stage.snapshot.activeSpeakerIds).toEqual([]);
		expect(stage.snapshot.participantIds[0]).toBe('d');
		expect(stage.snapshot.version).toBeGreaterThan(version);
		stage.close();
	});
});

describe('shared presentation slots', () => {
	it('keeps visible speakers, hands and camera changes in their slots while ranking changes', () => {
		const { stage } = room();
		stage.activity(['d', 'b']);
		vi.advanceTimersByTime(1000);
		expect(stage.snapshot.participantIds).toEqual(['b', 'd', 'a', 'c']);
		expect(stage.snapshot.presentationOrders?.[4]).toEqual([
			'a',
			'b',
			'c',
			'd',
		]);
		stage.inventory(
			participants.map((p) => ({
				...p,
				video_enabled: p.participant_id !== 'b',
			})),
			{ c: '2026-01-01' },
		);
		expect(stage.snapshot.presentationOrders?.[4]).toEqual([
			'a',
			'b',
			'c',
			'd',
		]);
		stage.activity([]);
		stage.inventory(participants, {});
		vi.advanceTimersByTime(120000);
		expect(stage.snapshot.presentationOrders?.[4]).toEqual([
			'a',
			'b',
			'c',
			'd',
		]);
		stage.close();
	});
	it('replaces only the exiting slot on overflow promotion and expiry', () => {
		const { stage } = room();
		expect(stage.snapshot.presentationOrders?.[3]).toEqual(['a', 'b', 'c']);
		stage.activity(['d']);
		vi.advanceTimersByTime(1000);
		expect(stage.snapshot.presentationOrders?.[3]).toEqual(['a', 'b', 'd']);
		stage.activity(['b', 'd']);
		vi.advanceTimersByTime(1000);
		expect(stage.snapshot.presentationOrders?.[3]).toEqual(['a', 'b', 'd']);
		stage.activity([]);
		vi.advanceTimersByTime(120000);
		expect(stage.snapshot.presentationOrders?.[3]).toEqual(['a', 'b', 'c']);
		stage.close();
	});
	it('fills departure vacancies and appends joins without evicting equal priority incumbents', () => {
		const { stage } = room();
		const newcomer = { ...participants[0], participant_id: '0' };
		stage.inventory([newcomer, ...participants], {});
		expect(stage.snapshot.presentationOrders?.[3]).toEqual(['a', 'b', 'c']);
		expect(stage.snapshot.presentationOrders?.[5]).toEqual([
			'a',
			'b',
			'c',
			'd',
			'0',
		]);
		stage.inventory(
			[newcomer, ...participants.filter((p) => p.participant_id !== 'b')],
			{},
		);
		expect(stage.snapshot.presentationOrders?.[3]).toEqual(['a', 'd', 'c']);
		expect(stage.snapshot.presentationOrders?.[4]).toEqual([
			'a',
			'0',
			'c',
			'd',
		]);
		stage.close();
	});
	it('snapshots contain independent complete slot history for late join and reconnect', () => {
		const { stage } = room();
		stage.activity(['d']);
		vi.advanceTimersByTime(1000);
		const late = stage.snapshot;
		expect(late.presentationOrders?.[3]).toEqual(['a', 'b', 'd']);
		late.presentationOrders![3][0] = 'corrupted';
		expect(stage.snapshot.presentationOrders?.[3]).toEqual(['a', 'b', 'd']);
		stage.close();
	});
});

it('compacts only tail survivors when departures reduce the population below capacity', () => {
	const { stage } = room();
	stage.inventory(participants.filter(p => ['c', 'd'].includes(p.participant_id)), {});
	expect(stage.snapshot.presentationOrders?.[4]).toEqual(['c', 'd']);
	stage.inventory(participants, {});
	expect(stage.snapshot.presentationOrders?.[4]).toEqual(['c', 'd', 'a', 'b']);
	stage.close();
});

it('keeps remote slots when local self enters and exits the ranked prefix', () => {
	const { stage } = room();
	stage.activity(['d']); vi.advanceTimersByTime(1000); stage.activity([]);
	stage.activity(['b']); vi.advanceTimersByTime(1000); stage.activity([]);
	const before = stage.snapshotFor('a');
	expect(before.presentationOrders?.[2]).toEqual(['b', 'd']);
	stage.activity(['a']); vi.advanceTimersByTime(1000);
	expect(stage.snapshotFor('a').participantIds[0]).toBe('a');
	expect(stage.snapshotFor('a').presentationOrders?.[2]).toEqual(['b', 'd']);
	stage.activity([]); vi.advanceTimersByTime(120000);
	expect(stage.snapshotFor('a').presentationOrders?.[2]).toEqual(['b', 'c']);
	expect(stage.snapshotFor('a').excludedParticipantId).toBe('a');
	stage.close();
});

it('gives equal hidden-self viewers and a late viewer the same remote slots', () => {
	const { stage } = room();
	const viewers = ['viewer-one', 'viewer-two'].map(id => ({ ...participants[0], participant_id: id, video_enabled: false }));
	stage.inventory([...participants, ...viewers], {});
	stage.activity(['d']); vi.advanceTimersByTime(1000);
	expect(stage.snapshotFor('viewer-one').presentationOrders?.[3]).toEqual(['a', 'b', 'd']);
	expect(stage.snapshotFor('viewer-two').presentationOrders?.[3]).toEqual(['a', 'b', 'd']);
	stage.inventory([...participants, ...viewers, { ...viewers[0], participant_id: 'late-viewer' }], {});
	expect(stage.snapshotFor('late-viewer').presentationOrders?.[3]).toEqual(['a', 'b', 'd']);
	const reconnect = stage.snapshotFor('viewer-one');
	expect(reconnect.presentationOrders?.[3]).toEqual(['a', 'b', 'd']);
	stage.close();
});

it('discards a departed self projection and seeds a rejoin from current canonical slots', () => {
	const { stage } = room();
	stage.activity(['d']);
	vi.advanceTimersByTime(1000);
	stage.activity([]);
	stage.inventory(
		participants.filter((p) => p.participant_id !== 'a'),
		{},
	);
	expect(stage.snapshot.presentationOrders?.[2]).toEqual(['b', 'd']);
	stage.inventory(participants, {});
	expect(stage.snapshotFor('a').presentationOrders?.[2]).toEqual(['b', 'd']);
	expect(stage.snapshotFor('a').participantIds).toEqual(['d', 'b', 'c', 'a']);
	stage.close();
});

it('discards departed projections after identity churn', () => {
	const { stage } = room();
	for (let i = 0; i < 100; i++) {
		stage.inventory(
			[...participants, { ...participants[0], participant_id: `guest-${i}` }],
			{},
		);
	}
	stage.inventory(participants, {});
	expect(stage.snapshotFor('guest-5').presentationOrders?.[2]).toEqual(['a', 'b']);
	stage.inventory([...participants, { ...participants[0], participant_id: 'guest-5' }], {});
	expect(stage.snapshotFor('guest-5').presentationOrders?.[4]).toEqual(['a', 'b', 'c', 'd']);
	expect(stage.snapshotFor('a').presentationOrders?.[2]).toEqual(['b', 'c']);
	stage.close();
});

it('publishes activity changes even when ranking and presentation remain unchanged', () => {
	vi.useFakeTimers();
	const updates: import('../../types').SharedStageState[] = [];
	const stage = new SharedStage(state => updates.push(state));
	stage.inventory(participants, {});
	stage.activity(['a']);
	vi.advanceTimersByTime(1000);
	expect(stage.snapshot.participantIds).toEqual(['a', 'b', 'c', 'd']);
	expect(updates.at(-1)?.activeSpeakerIds).toEqual(['a']);
	expect(stage.snapshotFor('a').presentationOrders?.[2]).toEqual(['b', 'c']);
	stage.activity([]);
	expect(updates.at(-1)?.activeSpeakerIds).toEqual([]);
	expect(stage.snapshotFor('a').presentationOrders?.[2]).toEqual(['b', 'c']);
	stage.close();
});
