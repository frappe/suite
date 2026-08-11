import { mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MediaProbe } from './captureTypes.js';
import { Finalizer } from './Finalizer.js';
import { ManifestStore, safeJobDirectory } from './ManifestStore.js';
import { SegmentWatcher } from './SegmentWatcher.js';

const roots: string[] = [];
const probe: MediaProbe = {
	duration_ms: 1_000,
	video: { codec: 'h264', width: 1920, height: 1080, fps: 30 },
	audio: { codec: 'aac', sample_rate: 48000, channels: 2 },
};

async function store(): Promise<ManifestStore> {
	const root = join(tmpdir(), `capture-${crypto.randomUUID()}`);
	roots.push(root);
	const value = new ManifestStore(root, '../../unsafe/job');
	await value.initialize();
	return value;
}

async function watcherStore(): Promise<ManifestStore> {
	const manifest = await store();
	await manifest.update((m) => {
		m.epochs = 1;
	});
	return manifest;
}

afterEach(async () => {
	const { rm } = await import('node:fs/promises');
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe('capture pipeline', () => {
	it('uses a stable hashed job directory and atomically revisions valid manifests', async () => {
		const manifest = await store();
		expect(manifest.directory).toBe(
			safeJobDirectory(join(manifest.directory, '..'), '../../unsafe/job'),
		);
		await Promise.all([
			manifest.update((m) =>
				m.gaps.push({ started_at: '2026-01-01T00:00:00.000Z', reason: 'one' }),
			),
			manifest.update((m) =>
				m.gaps.push({ started_at: '2026-01-01T00:00:01.000Z', reason: 'two' }),
			),
		]);
		const disk = JSON.parse(await readFile(manifest.path, 'utf8')) as {
			revision: number;
			gaps: unknown[];
		};
		expect(disk).toMatchObject({ revision: 2 });
		expect(disk.gaps).toHaveLength(2);
	});

	it('recovers its write queue after a rejected update without publishing it', async () => {
		const manifest = await store();
		await expect(
			manifest.update((m) => {
				m.state = 'complete';
			}),
		).rejects.toThrow('invalid capture manifest update');
		expect(manifest.get()).toMatchObject({ revision: 0, state: 'capturing' });
		await manifest.update((m) => {
			m.reason = 'recovered';
		});
		expect(manifest.get()).toMatchObject({ revision: 1, reason: 'recovered' });
	});

	it('recovers a corrupt current manifest from its valid predecessor', async () => {
		const manifest = await store();
		await manifest.update((m) => {
			m.reason = 'predecessor';
		});
		await manifest.update((m) => {
			m.reason = 'current';
		});
		await writeFile(manifest.path, '{corrupt');
		const recovered = new ManifestStore(
			join(manifest.directory, '..'),
			'../../unsafe/job',
		);
		expect(await recovered.initialize()).toMatchObject({
			reason: 'predecessor',
		});
	});

	it('fails closed when an initialized manifest and predecessor are unavailable', async () => {
		const manifest = await store();
		await unlink(manifest.path);
		await expect(
			new ManifestStore(
				join(manifest.directory, '..'),
				'../../unsafe/job',
			).initialize(),
		).rejects.toThrow('established capture manifest unavailable');
	});

	it('adopts a segment only after its successor exists, then adopts the final segment on stop', async () => {
		const manifest = await watcherStore();
		await writeFile(
			join(manifest.directory, 'epoch-000-segment-000000.ts'),
			'first',
		);
		const watcher = new SegmentWatcher(
			manifest,
			{ validate: async () => probe },
			0,
		);
		await watcher.scan(false);
		expect(manifest.get().segments).toHaveLength(0);
		await writeFile(
			join(manifest.directory, 'epoch-000-segment-000001.ts'),
			'second',
		);
		await watcher.scan(false);
		expect(manifest.get().segments.map((s) => s.file)).toEqual([
			'epoch-000-segment-000000.ts',
		]);
		await watcher.stopAndAdoptFinal();
		expect(manifest.get().segments.map((s) => s.index)).toEqual([0, 1]);
	});

	it('keeps valid closed segments when the trailing segment is corrupt', async () => {
		const manifest = await watcherStore();
		await writeFile(
			join(manifest.directory, 'epoch-000-segment-000000.ts'),
			'valid',
		);
		await writeFile(
			join(manifest.directory, 'epoch-000-segment-000001.ts'),
			'corrupt',
		);
		const watcher = new SegmentWatcher(
			manifest,
			{
				validate: async (path) => {
					if (path.endsWith('000001.ts')) throw new Error('truncated segment');
					return probe;
				},
			},
			0,
		);
		await watcher.stopAndAdoptFinal();
		expect(manifest.get().segments.map((segment) => segment.file)).toEqual([
			'epoch-000-segment-000000.ts',
		]);
	});

	it('serializes overlapping scans and adopts each successor-gated segment once', async () => {
		const manifest = await watcherStore();
		await Promise.all(
			['000000', '000001'].map((index) =>
				writeFile(
					join(manifest.directory, `epoch-000-segment-${index}.ts`),
					index,
				),
			),
		);
		let active = 0;
		let maximum = 0;
		const watcher = new SegmentWatcher(
			manifest,
			{
				validate: async () => {
					maximum = Math.max(maximum, ++active);
					await new Promise((resolve) => setTimeout(resolve, 10));
					active--;
					return probe;
				},
			},
			0,
		);
		await Promise.all([watcher.scan(false), watcher.scan(false)]);
		expect(maximum).toBe(1);
		expect(manifest.get().segments).toHaveLength(1);
	});

	it('rejects traversal manifests and symlink segment escapes', async () => {
		const manifest = await watcherStore();
		const disk = JSON.parse(await readFile(manifest.path, 'utf8'));
		disk.segments = [
			{
				epoch: 0,
				index: 0,
				file: '../outside.ts',
				bytes: 1,
				sha256: 'a'.repeat(64),
				duration_ms: 1,
				started_at: '2026-01-01T00:00:00.000Z',
			},
		];
		await writeFile(manifest.path, JSON.stringify(disk));
		await writeFile(
			join(manifest.directory, 'manifest.previous.json'),
			JSON.stringify(disk),
		);
		await expect(
			new ManifestStore(
				join(manifest.directory, '..'),
				'../../unsafe/job',
			).initialize(),
		).rejects.toThrow('established capture manifest unavailable');

		const outside = join(manifest.directory, '..', 'outside.ts');
		await writeFile(outside, 'outside');
		const link = join(manifest.directory, 'epoch-000-segment-000000.ts');
		await symlink(outside, link);
		await expect(
			manifest.resolveFile('epoch-000-segment-000000.ts'),
		).rejects.toThrow('manifest path escapes capture directory');
	});

	it('fails finalization when persisted segment integrity is tampered', async () => {
		const captured = await watcherStore();
		const path = join(captured.directory, 'epoch-000-segment-000000.ts');
		await writeFile(path, 'original');
		const tools = {
			validate: async () => probe,
			concat: async (_list: string, output: string) => writeFile(output, 'mp4'),
		};
		await new SegmentWatcher(captured, tools, 0).stopAndAdoptFinal();
		await writeFile(path, 'tampered');
		expect(await new Finalizer(captured, tools).finalize()).toBe('failed');
		expect(captured.get().reason).toContain('segment integrity mismatch');
	});

	it('classifies no-media as failed and known-gap media as partial', async () => {
		const empty = await store();
		const tools = {
			validate: async () => probe,
			concat: async (_list: string, output: string) => writeFile(output, 'mp4'),
		};
		expect(await new Finalizer(empty, tools).finalize()).toBe('failed');
		const captured = await watcherStore();
		await mkdir(captured.directory, { recursive: true });
		await writeFile(
			join(captured.directory, 'epoch-000-segment-000000.ts'),
			'segment',
		);
		const watcher = new SegmentWatcher(captured, tools, 0);
		await watcher.stopAndAdoptFinal();
		await captured.update((m) =>
			m.gaps.push({
				started_at: '2026-01-01T00:00:00.000Z',
				reason: 'ffmpeg_exited',
			}),
		);
		expect(await new Finalizer(captured, tools).finalize()).toBe('partial');
		expect(captured.get().artifact?.sha256).toMatch(/^[a-f0-9]{64}$/);
	});

	it('quarantines a malformed final segment and preserves prior media as partial', async () => {
		const captured = await watcherStore();
		await writeFile(
			join(captured.directory, 'epoch-000-segment-000000.ts'),
			'valid',
		);
		await writeFile(
			join(captured.directory, 'epoch-000-segment-000001.ts'),
			'bad',
		);
		const tools = {
			validate: async (path: string) => {
				if (path.endsWith('000001.ts')) throw new Error('malformed media');
				return probe;
			},
			concat: async (_list: string, output: string) => writeFile(output, 'mp4'),
		};
		const watcher = new SegmentWatcher(captured, tools, 0);
		await watcher.scan(false);
		expect(await watcher.stopAndAdoptFinal()).toBe('quarantined');
		expect(await new Finalizer(captured, tools).finalize()).toBe('partial');
		expect(captured.get().gaps[0]?.reason).toContain('invalid_final_segment');
	});

	it('streams hashing for a large artifact and removes finalization temp files', async () => {
		const captured = await watcherStore();
		await writeFile(
			join(captured.directory, 'epoch-000-segment-000000.ts'),
			'segment',
		);
		const tools = {
			validate: async () => probe,
			concat: async (_list: string, output: string) =>
				writeFile(output, Buffer.alloc(8 * 1024 * 1024, 7)),
		};
		await new SegmentWatcher(captured, tools, 0).stopAndAdoptFinal();
		expect(await new Finalizer(captured, tools).finalize()).toBe('complete');
		expect(captured.get().artifact?.bytes).toBe(8 * 1024 * 1024);
		await expect(
			readFile(join(captured.directory, 'concat.txt')),
		).rejects.toThrow();
	});
});
