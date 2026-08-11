import { EventEmitter } from 'node:events';
import { rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ProcessSpawner, ProcessSupervisor } from './ProcessSupervisor.js';

const paths: string[] = [];

afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(paths.splice(0).map((path) => rm(path, { force: true })));
});

describe('ProcessSupervisor', () => {
	it('shares stop, signals the process group, and escalates after timeout', async () => {
		const child = new EventEmitter() as EventEmitter & {
			pid: number;
			stdout: PassThrough;
			stderr: PassThrough;
		};
		child.pid = 42;
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		const kill = vi.fn((_pid: number, signal?: NodeJS.Signals | number) => {
			if (signal === 'SIGKILL') child.emit('exit', null, 'SIGKILL');
			return true;
		});
		const logPath = join(tmpdir(), `supervisor-${crypto.randomUUID()}.log`);
		paths.push(logPath);
		const supervisor = new ProcessSupervisor(
			vi.fn(() => child) as unknown as ProcessSpawner,
			{ kill: kill as typeof process.kill, maxLogBytes: 4 },
		);
		const managed = await supervisor.start('command', [], { logPath });
		child.stdout.write('123456789');
		const first = managed.stop(1);
		const second = managed.stop(1);
		expect(first).toBe(second);
		await first;
		expect(kill.mock.calls).toEqual([
			[-42, 'SIGTERM'],
			[-42, 'SIGKILL'],
		]);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect((await stat(logPath)).size).toBeLessThanOrEqual(4);
	});

	it('propagates signal errors other than ESRCH', async () => {
		const child = new EventEmitter() as EventEmitter & { pid: number };
		child.pid = 7;
		const error = Object.assign(new Error('denied'), { code: 'EPERM' });
		const supervisor = new ProcessSupervisor(
			vi.fn(() => child) as unknown as ProcessSpawner,
			{
				kill: (() => {
					throw error;
				}) as typeof process.kill,
			},
		);
		const logPath = join(tmpdir(), `supervisor-${crypto.randomUUID()}.log`);
		paths.push(logPath);
		const managed = await supervisor.start('command', [], { logPath });
		await expect(managed.stop()).rejects.toThrow('denied');
	});
});
