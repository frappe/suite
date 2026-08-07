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
