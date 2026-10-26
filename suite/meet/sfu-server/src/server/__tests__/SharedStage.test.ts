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
