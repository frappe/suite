import { createHash } from 'node:crypto';
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	type SourceSegment,
	TranscriptionStore,
} from './TranscriptionStore.js';

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'meet-sources-'));
});
afterEach(async () => {
	vi.useRealTimers();
	await rm(root, { recursive: true, force: true });
});
function segment(audio: Buffer, source_id = 'source'): SourceSegment {
	return {
		source_id,
		speaker_id: 'speaker',
		speaker_name: 'A speaker',
		start_ms: 1000,
		end_ms: 1000 + audio.length / 48,
		size: audio.length,
		sha256: createHash('sha256').update(audio).digest('hex'),
		sample_rate: 24000,
	};
}
describe('durable transcription source store', () => {
	it('persists silent and late participant hints through restart and freezes closed captures', async () => {
		const store = new TranscriptionStore(root, 0);
		await store.initialize();
		await store.reserve('site-a', 'room-a', 'capture-a', 48000, 10000);
		await store.begin('site-a', 'capture-a', new Date().toISOString(), {
			vocabulary_version: 'frappe-v1',
			title: 'Atlas signup',
		});
		await store.updateParticipants('site-a', 'capture-a', ['Silent observer']);
		await store.updateParticipants('site-a', 'capture-a', ['Late participant']);
		await expect(store.manifest('site-b', 'capture-a')).rejects.toThrow();
		const restored = new TranscriptionStore(root, 0);
		await restored.initialize();
		const manifest = await restored.manifest('site-a', 'capture-a');
		expect(manifest.participant_names).toEqual([
			'Silent observer',
			'Late participant',
		]);
		expect(manifest.speech_context).toEqual({
			vocabulary_version: 'frappe-v1',
			title: 'Atlas signup',
		});
		expect(manifest.segments).toEqual([]);
		await expect(
			restored.updateParticipants('site-a', 'capture-a', ['After capture']),
		).rejects.toThrow('capture_closed');
	});

	it('rejects a rounded interval exceeding the source duration limit before persistence', async () => {
		const store = new TranscriptionStore(root, 0);
		await store.initialize();
		const audio = Buffer.alloc(30 * 48000);
		await store.reserve('one', 'room', 'capture', audio.length, 60000);
		await store.begin('one', 'capture', new Date().toISOString());
		const valid = segment(audio);
		await expect(
			store.append(
				'one',
				'capture',
				{ ...valid, end_ms: valid.end_ms + 1 },
				audio,
			),
		).rejects.toThrow('invalid_segment');
		expect((await store.manifest('one', 'capture')).segments).toEqual([]);
		await store.append('one', 'capture', valid, audio);
		expect((await store.manifest('one', 'capture')).segments).toEqual([valid]);
	});
	it('marks conservative possible loss across speakers after a restart', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const started = Date.parse('2026-10-20T00:00:00Z');
		vi.setSystemTime(started);
		const store = new TranscriptionStore(root, 0);
		await store.initialize();
		await store.reserve('one', 'room', 'capture', 96000, 120000);
		await store.begin('one', 'capture', new Date().toISOString());
		const audio = Buffer.alloc(48000, 7);
		await store.append(
			'one',
			'capture',
			{
				...segment(audio, 'a'),
				speaker_id: 'a',
				start_ms: 99000,
				end_ms: 100000,
			},
			audio,
		);
		await store.append(
			'one',
			'capture',
			{
				...segment(audio, 'b'),
				speaker_id: 'b',
				start_ms: 108000,
				end_ms: 109000,
			},
			audio,
		);
		vi.setSystemTime(started + 110000);
		const restored = new TranscriptionStore(root, 0);
		await restored.initialize();
		const manifest = await restored.manifest('one', 'capture');
		expect(manifest.gaps).toEqual([
			{ start_ms: 0, end_ms: 110000, reason: 'service_restart' },
		]);
		expect(manifest.segments).toHaveLength(2);
	});
	it('retains sample bytes and speaker timing across restart, marking interrupted capture partial', async () => {
		const store = new TranscriptionStore(root, 0);
		await store.initialize();
		await store.reserve('one', 'room', 'capture', 96000, 10000);
		await store.begin('one', 'capture', new Date().toISOString());
		const audio = Buffer.alloc(48000, 7);
		await store.append('one', 'capture', segment(audio), audio);
		const restored = new TranscriptionStore(root, 0);
		await restored.initialize();
		const manifest = await restored.manifest('one', 'capture');
		expect(manifest.state).toBe('partial');
		expect(manifest.segments).toEqual([segment(audio)]);
		expect(manifest.audio_seconds).toBe(1);
		expect(manifest.gaps[0]?.reason).toBe('service_restart');
		expect(
			await readFile(await restored.audio('one', 'capture', 'source')),
		).toEqual(audio);
	});
	it('isolates identical capture IDs by site, allows identical retries and rejects changed content', async () => {
		const store = new TranscriptionStore(root, 0);
		await store.initialize();
		await store.reserve('one', 'room', 'capture', 96000, 10000);
		await store.begin('one', 'capture', new Date().toISOString());
		await store.reserve('two', 'room', 'capture', 96000, 10000);
		const audio = Buffer.alloc(48000, 7);
		await store.append('one', 'capture', segment(audio), audio);
		await store.append('one', 'capture', segment(audio), audio);
		expect((await store.manifest('one', 'capture')).segments).toHaveLength(1);
		expect((await store.manifest('two', 'capture')).segments).toEqual([]);
		await expect(
			store.append(
				'one',
				'capture',
				segment(Buffer.alloc(48000, 9)),
				Buffer.alloc(48000, 9),
			),
		).rejects.toThrow('segment_conflict');
		await expect(store.audio('two', 'capture', 'source')).rejects.toThrow(
			'source_missing',
		);
		await store.delete('one', 'capture');
		expect((await store.manifest('two', 'capture')).state).toBe('capturing');
	});
	it('enforces durable source allowance and closes capture before accepting more speech', async () => {
		const store = new TranscriptionStore(root, 0, 1);
		await store.initialize();
		await store.reserve('one', 'room', 'capture', 48000, 10000);
		await store.begin('one', 'capture', new Date().toISOString());
		await expect(
			store.reserve('two', 'room', 'other', 48000, 10000),
		).rejects.toThrow('capacity');
		const audio = Buffer.alloc(48000);
		await store.append('one', 'capture', segment(audio), audio);
		await expect(
			store.append('one', 'capture', segment(audio, 'second'), audio),
		).rejects.toThrow('storage');
		await store.complete('one', 'capture', []);
		await expect(
			store.append('one', 'capture', segment(audio, 'second'), audio),
		).rejects.toThrow('capture_closed');
		await expect(store.audio('one', 'capture', '../source')).rejects.toThrow(
			'invalid_source_id',
		);
	});
	it('accounts pending reservations and retained bytes separately from capture concurrency', async () => {
		const store = new TranscriptionStore(root, 0, 16, 96000);
		await store.initialize();
		await store.reserve('one', 'room', 'capture', 96000, 10000);
		const audio = Buffer.alloc(48000);
		await expect(
			store.append('one', 'capture', segment(audio), audio),
		).rejects.toThrow('capture_closed');
		await store.begin('one', 'capture', '2026-10-19T00:00:00.000Z');
		await expect(
			store.begin('one', 'capture', '2026-10-19T00:00:01.000Z'),
		).rejects.toThrow('capture_conflict');
		await expect(
			store.reserve('two', 'room', 'second', 48000, 10000),
		).rejects.toThrow('storage');
		await store.append('one', 'capture', segment(audio), audio);
		await store.complete('one', 'capture', []);
		await store.reserve('two', 'room', 'second', 48000, 10000);
		expect((await store.manifest('one', 'capture')).started_at).toBe(
			'2026-10-19T00:00:00.000Z',
		);
		await expect(
			store.reserve('three', 'room', 'third', 48000, 10000),
		).rejects.toThrow('storage');
		await store.delete('one', 'capture');
		await store.reserve('three', 'room', 'third', 48000, 10000);
	});

	it('isolates crash-orphan and malformed manifests without losing their cleanup obligation or blocking healthy captures', async () => {
		const siteDirectory = join(
			root,
			createHash('sha256').update('one').digest('hex'),
		);
		const orphan = join(siteDirectory, 'orphan');
		await mkdir(orphan, { recursive: true });
		await writeFile(join(orphan, 'unacknowledged.pcm'), Buffer.alloc(48, 9));
		const broken = join(siteDirectory, 'broken');
		await mkdir(broken);
		await writeFile(join(broken, 'manifest.json'), '{partial write');
		await writeFile(join(root, 'unrelated-file'), 'ignored');
		const store = new TranscriptionStore(root, 0);
		await store.initialize();
		expect(store.ready).toBe(true);
		await expect(store.manifest('one', 'orphan')).rejects.toThrow(
			'source_manifest_unavailable',
		);
		expect(await readFile(join(orphan, 'unacknowledged.pcm'))).toEqual(
			Buffer.alloc(48, 9),
		);
		expect((await store.failedManifest('one', 'room', 'orphan')).state).toBe(
			'failed',
		);
		await expect(store.manifest('one', 'broken')).rejects.toThrow(
			'source_manifest_unavailable',
		);
		await store.reserve('two', 'room', 'healthy', 48000, 10000);
		await store.delete('one', 'orphan');
		await expect(stat(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
	});
	it('enforces node-local seven-day retention while preserving active captures until their maximum duration', async () => {
		const store = new TranscriptionStore(root, 0);
		await store.initialize();
		await store.reserve('one', 'room', 'capture', 96000, 10000);
		const began = new Date().toISOString();
		await store.begin('one', 'capture', began);
		const audio = Buffer.alloc(48000);
		await store.append('one', 'capture', segment(audio), audio);
		await store.sweep(Date.parse(began) + 9999);
		expect((await store.manifest('one', 'capture')).state).toBe('capturing');
		await store.sweep(Date.parse(began) + 10000);
		expect((await store.manifest('one', 'capture')).state).toBe('partial');
		await store.sweep(Date.parse(began) + 10000 + 7 * 86400000 - 1);
		expect(
			await readFile(await store.audio('one', 'capture', 'source')),
		).toEqual(audio);
		await store.sweep(Date.parse(began) + 10000 + 7 * 86400000);
		await expect(store.manifest('one', 'capture')).rejects.toMatchObject({
			code: 'ENOENT',
		});
	});

	it('refuses expired source retrieval even before the next scheduled sweep', async () => {
		const store = new TranscriptionStore(root, 0);
		await store.initialize();
		await store.reserve('one', 'room', 'capture', 96000, 10000);
		await store.begin('one', 'capture', new Date().toISOString());
		const audio = Buffer.alloc(48000);
		await store.append('one', 'capture', segment(audio), audio);
		await store.complete('one', 'capture', []);
		const ended = (await store.manifest('one', 'capture')).ended_at;
		if (!ended) throw new Error('capture_not_ended');
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.parse(ended) + 7 * 86400000);
		await expect(store.audio('one', 'capture', 'source')).rejects.toThrow(
			'source_missing',
		);
		await expect(store.manifest('one', 'capture')).rejects.toMatchObject({
			code: 'ENOENT',
		});
	});
});
