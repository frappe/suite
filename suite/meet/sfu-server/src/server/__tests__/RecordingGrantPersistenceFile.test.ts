import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecordingGrantPersistenceFile } from '../RecordingGrantPersistenceFile';

let directory: string;
let path: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'recording-grant-persistence-'));
	path = join(directory, 'consumed.json');
});

afterEach(async () => {
	await chmod(directory, 0o700).catch(() => undefined);
	await rm(directory, { recursive: true, force: true });
});

describe('RecordingGrantPersistenceFile', () => {
	it('fails closed for missing and corrupt startup state', async () => {
		const missing = new RecordingGrantPersistenceFile(path);
		await expect(missing.initialize()).rejects.toThrow('failed to initialize');
		expect(missing.isReady()).toBe(false);

		await writeFile(path, '{broken');
		const corrupt = new RecordingGrantPersistenceFile(path);
		await expect(corrupt.initialize()).rejects.toThrow('failed to initialize');
		expect(corrupt.isReady()).toBe(false);
	});

	it.each([
		{ schemaVersion: 2, consumed: {} },
		{ schemaVersion: 1, consumed: [] },
		{ schemaVersion: 1, consumed: null },
		{ schemaVersion: 1, consumed: { '': 200 } },
		{ schemaVersion: 1, consumed: { grant: 0 } },
		{ schemaVersion: 1, consumed: { grant: 1.5 } },
		{ schemaVersion: 1, consumed: { grant: '200' } },
	])('rejects invalid persistence schema %#', async (shape) => {
		await writeFile(path, JSON.stringify(shape));
		const store = new RecordingGrantPersistenceFile(path);
		await expect(store.initialize()).rejects.toThrow('failed to initialize');
		expect(store.isReady()).toBe(false);
	});

	it('durably consumes IDs across restart and preserves unexpired IDs', async () => {
		await RecordingGrantPersistenceFile.bootstrap(path);
		const store = new RecordingGrantPersistenceFile(path);
		await store.initialize();
		await Promise.all([
			store.consume('first', 200, 100),
			store.consume('second', 300, 100),
		]);

		const restarted = new RecordingGrantPersistenceFile(path);
		await restarted.initialize();
		expect(restarted.isConsumed('first', 150)).toBe(true);
		expect(restarted.isConsumed('second', 150)).toBe(true);
		await restarted.cleanup(250);

		const cleaned = new RecordingGrantPersistenceFile(path);
		await cleaned.initialize();
		expect(cleaned.isConsumed('first', 150)).toBe(false);
		expect(cleaned.isConsumed('second', 250)).toBe(true);
	});

	it('atomically rejects replay without changing durable state', async () => {
		await RecordingGrantPersistenceFile.bootstrap(path);
		const store = new RecordingGrantPersistenceFile(path);
		await store.initialize();
		await store.consume('same', 200, 100);
		await expect(store.consume('same', 300, 100)).rejects.toThrow('consumed');
		expect(store.isReady()).toBe(true);
		const shape = JSON.parse(await readFile(path, 'utf8'));
		expect(shape.consumed.same).toBe(200);
	});

	it('atomically rejects one of two concurrent consumers for the same ID', async () => {
		await RecordingGrantPersistenceFile.bootstrap(path);
		const store = new RecordingGrantPersistenceFile(path);
		await store.initialize();
		const results = await Promise.allSettled([
			store.consume('same', 200, 100),
			store.consume('same', 300, 100),
		]);

		expect(
			results.filter((result) => result.status === 'fulfilled'),
		).toHaveLength(1);
		expect(
			results.filter((result) => result.status === 'rejected'),
		).toHaveLength(1);
		const restarted = new RecordingGrantPersistenceFile(path);
		await restarted.initialize();
		expect(restarted.isConsumed('same', 150)).toBe(true);
	});

	it('rejects saturation without evicting unexpired IDs', async () => {
		await RecordingGrantPersistenceFile.bootstrap(path);
		const store = new RecordingGrantPersistenceFile(path, 2);
		await store.initialize();
		await store.consume('first', 200, 100);
		await store.consume('second', 300, 100);
		await expect(store.consume('third', 400, 100)).rejects.toThrow(
			'at capacity',
		);
		expect(store.isReady()).toBe(true);

		const restarted = new RecordingGrantPersistenceFile(path, 2);
		await restarted.initialize();
		expect(restarted.isConsumed('first', 150)).toBe(true);
		expect(restarted.isConsumed('second', 150)).toBe(true);
		expect(restarted.isConsumed('third', 150)).toBe(false);
		await restarted.consume('third', 400, 250);
		expect(restarted.isConsumed('first', 250)).toBe(false);
		expect(restarted.isConsumed('third', 250)).toBe(true);
	});

	it('fails closed when startup state exceeds configured capacity', async () => {
		await writeFile(
			path,
			JSON.stringify({
				schemaVersion: 1,
				consumed: { first: 200, second: 300, third: 400 },
			}),
		);
		const store = new RecordingGrantPersistenceFile(path, 2);
		await expect(store.initialize()).rejects.toThrow('failed to initialize');
		expect(store.isReady()).toBe(false);
	});

	it.each([
		['', 200, 100],
		['grant', 100, 100],
		['grant', 100.5, 100],
	] as const)('rejects invalid consumption %#', async (jti, retainUntil, now) => {
		await RecordingGrantPersistenceFile.bootstrap(path);
		const store = new RecordingGrantPersistenceFile(path);
		await store.initialize();
		await expect(store.consume(jti, retainUntil, now)).rejects.toThrow(
			'Invalid recording grant consumption',
		);
		expect(store.isReady()).toBe(true);
	});

	it('becomes permanently unready after a durable write failure', async () => {
		await RecordingGrantPersistenceFile.bootstrap(path);
		const store = new RecordingGrantPersistenceFile(path);
		await store.initialize();
		await chmod(directory, 0o500);
		await expect(store.consume('blocked', 200, 100)).rejects.toThrow();
		expect(store.isReady()).toBe(false);
		await expect(store.consume('later', 200, 100)).rejects.toThrow('not ready');
	});
});
