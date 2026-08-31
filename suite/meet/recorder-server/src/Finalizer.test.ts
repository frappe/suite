import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FfmpegMediaTools } from './Finalizer.js';

afterEach(() => vi.useRealTimers());

describe('FfmpegMediaTools', () => {
	it('kills and rejects timed-out validation without waiting for exit', async () => {
		vi.useFakeTimers();
		const ffmpeg = fakeChild();
		const ffprobe = fakeChild();
		const children = [ffmpeg, ffprobe];
		const spawner = vi.fn(() => {
			const child = children.shift();
			if (!child) throw new Error('unexpected command');
			if (child === ffmpeg) setTimeout(() => child.emit('exit', 0, null), 60);
			return child;
		}) as unknown as typeof spawn;
		let resolved = false;
		const validation = new FfmpegMediaTools('ffmpeg', 'ffprobe', 100, spawner)
			.validate('/tmp/unused-media')
			.then((value) => {
				resolved = true;
				return value;
			});
		const rejected = expect(validation).rejects.toThrow(
			'media command timed out',
		);
		await vi.advanceTimersByTimeAsync(60);
		expect(spawner).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(39);
		expect(ffprobe.kill).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(ffprobe.kill).toHaveBeenCalledWith('SIGKILL');
		await rejected;
		ffprobe.emit('exit', 0, null);
		await Promise.resolve();
		expect(resolved).toBe(false);
	});

	it('requires a positive validation timeout', () => {
		expect(() => new FfmpegMediaTools('ffmpeg', 'ffprobe', 0)).toThrow(
			'media validation timeout must be positive',
		);
	});

	it('bounds concatenation and kills a hung command', async () => {
		vi.useFakeTimers();
		const ffmpeg = fakeChild();
		const spawner = vi.fn(() => ffmpeg) as unknown as typeof spawn;
		const concatenation = new FfmpegMediaTools(
			'ffmpeg',
			'ffprobe',
			100,
			spawner,
		).concat('/tmp/concat.txt', '/tmp/output.mp4', 200);
		const rejected = expect(concatenation).rejects.toThrow(
			'media command timed out',
		);

		await vi.advanceTimersByTimeAsync(199);
		expect(ffmpeg.kill).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(ffmpeg.kill).toHaveBeenCalledWith('SIGKILL');
		await rejected;
	});

	it('allows final artifact validation to override the segment deadline', async () => {
		vi.useFakeTimers();
		const ffmpeg = fakeChild();
		const spawner = vi.fn(() => ffmpeg) as unknown as typeof spawn;
		const validation = new FfmpegMediaTools(
			'ffmpeg',
			'ffprobe',
			100,
			spawner,
		).validate('/tmp/recording.mp4', 200);

		await vi.advanceTimersByTimeAsync(100);
		expect(ffmpeg.kill).not.toHaveBeenCalled();
		ffmpeg.emit('error', new Error('validation stopped'));
		await expect(validation).rejects.toThrow('validation stopped');
	});
});

function fakeChild(): EventEmitter & {
	stdout: PassThrough;
	stderr: PassThrough;
	kill: ReturnType<typeof vi.fn>;
} {
	const child = new EventEmitter() as EventEmitter & {
		stdout: PassThrough;
		stderr: PassThrough;
		kill: ReturnType<typeof vi.fn>;
	};
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.kill = vi.fn(() => true);
	return child;
}
