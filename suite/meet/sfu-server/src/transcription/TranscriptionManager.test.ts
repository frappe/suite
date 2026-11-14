import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '../types';
import { TranscriptionManager } from './TranscriptionManager';

function room(): Room {
	return {
		peers: new Map([
			[
				'human',
				{
					id: 'human',
					info: { userId: 'person', name: 'Person' },
					producers: new Map(),
				},
			],
		]),
	} as Room;
}
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
describe('transcription capture lifecycle', () => {
	it('keeps a speechless room capturing without caption subscriptions and stops when the final human leaves', async () => {
		vi.useFakeTimers();
		const current = room();
		const notify = vi.fn();
		const fetcher = vi.fn(
			async (url: string, _init?: RequestInit) =>
				new Response(
					url.endsWith('/capture-state') ? '{"state":"capturing"}' : '{}',
					{ status: 200 },
				),
		);
		vi.stubGlobal('fetch', fetcher);
		const manager = new TranscriptionManager(
			{ getTranscriptionRoom: () => current },
			notify,
		);
		await manager.start(
			'site',
			'room',
			'capture',
			'https://recorder.test',
			'private-source-token',
			14400000,
		);
		await vi.advanceTimersByTimeAsync(5000);
		expect(manager.query('site', 'capture')?.state).toBe('capturing');
		expect(
			fetcher.mock.calls.filter(([url]) =>
				String(url).endsWith('/participants'),
			),
		).toHaveLength(1);
		const metadata = fetcher.mock.calls.find(([url]) =>
			String(url).endsWith('/participants'),
		);
		expect(JSON.parse(String(metadata?.[1]?.body)).names).toContain('Person');
		current.peers.clear();
		await vi.advanceTimersByTimeAsync(500);
		expect(manager.query('site', 'capture')?.state).toBe('complete');
		expect(fetcher).toHaveBeenLastCalledWith(
			'https://recorder.test/v1/transcriptions/capture/complete',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ gaps: [] }),
			}),
		);
		expect(manager.query('other', 'capture')).toBeUndefined();
	});
	it('marks the whole uncertain interval after an abrupt interruption', async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn(
			async (_url: string, _init?: RequestInit) =>
				new Response('{}', { status: 200 }),
		);
		vi.stubGlobal('fetch', fetcher);
		const manager = new TranscriptionManager(
			{ getTranscriptionRoom: () => room() },
			vi.fn(),
		);
		await manager.start(
			'site',
			'room',
			'capture',
			'https://recorder.test',
			'token',
			14400000,
		);
		await vi.advanceTimersByTimeAsync(5000);
		await manager.stop('site', 'capture', 'source_interrupted');
		const request = fetcher.mock.calls.find(([url]) =>
			url.endsWith('/complete'),
		);
		expect(request).toBeDefined();
		expect(JSON.parse(String(request![1]?.body))).toEqual({
			gaps: [
				{
					start_ms: 0,
					end_ms: expect.any(Number),
					reason: 'source_interrupted',
				},
			],
		});
		expect(manager.query('site', 'capture')?.state).toBe('partial');
	});
	it('enforces one active capture per room, fixed configuration and a four-hour ceiling', async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 200 })),
		);
		const manager = new TranscriptionManager(
			{ getTranscriptionRoom: () => room() },
			vi.fn(),
		);
		await manager.start(
			'site',
			'room',
			'capture',
			'https://recorder.test',
			'token',
			1000,
		);
		await expect(
			manager.start(
				'site',
				'room',
				'second',
				'https://recorder.test',
				'token',
				1000,
			),
		).rejects.toThrow('capture_conflict');
		await expect(
			manager.start(
				'site',
				'other',
				'capture',
				'https://recorder.test',
				'token',
				1000,
			),
		).rejects.toThrow('capture_conflict');
		await expect(
			manager.start(
				'site',
				'other',
				'long',
				'https://recorder.test',
				'token',
				14400001,
			),
		).rejects.toThrow('invalid_duration');
		await vi.advanceTimersByTimeAsync(1000);
		expect(manager.query('site', 'capture')?.state).toBe('complete');
		await manager.start(
			'site',
			'room',
			'second',
			'https://recorder.test',
			'token',
			1000,
		);
		expect(manager.query('site', 'second')?.state).toBe('capturing');
		await manager.close();
	});
});
