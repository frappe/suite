import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CaptureState, MediaProbe, MediaTools } from './captureTypes.js';
import type { ManifestStore } from './ManifestStore.js';

async function command(program: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(program, args, {
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let out = '';
		let error = '';
		child.stdout.on('data', (x) => {
			if (out.length < 1024 * 1024)
				out += String(x).slice(0, 1024 * 1024 - out.length);
		});
		child.stderr.on('data', (x) => {
			if (error.length < 1024 * 1024)
				error += String(x).slice(0, 1024 * 1024 - error.length);
		});
		child.once('error', reject);
		child.once('exit', (code) =>
			code === 0
				? resolve(out)
				: reject(new Error(error.slice(-1024) || `${program} exited ${code}`)),
		);
	});
}

function rate(value: string): number {
	const [a = 0, b = 1] = value.split('/').map(Number);
	return a / b;
}

async function fileDigest(
	path: string,
): Promise<{ bytes: number; sha256: string }> {
	const info = await stat(path);
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return { bytes: info.size, sha256: hash.digest('hex') };
}

export class FfmpegMediaTools implements MediaTools {
	constructor(
		private readonly ffmpeg = 'ffmpeg',
		private readonly ffprobe = 'ffprobe',
	) {}
	async validate(path: string): Promise<MediaProbe> {
		await command(this.ffmpeg, ['-v', 'error', '-i', path, '-f', 'null', '-']);
		const parsed = JSON.parse(
			await command(this.ffprobe, [
				'-v',
				'error',
				'-show_streams',
				'-show_format',
				'-of',
				'json',
				path,
			]),
		) as {
			streams: Array<Record<string, unknown>>;
			format: Record<string, unknown>;
		};
		if (parsed.streams.length !== 2) throw new Error('invalid stream count');
		const video = parsed.streams.find((s) => s.codec_type === 'video');
		const audio = parsed.streams.find((s) => s.codec_type === 'audio');
		const videoStart = Number(video?.start_time);
		const audioStart = Number(audio?.start_time);
		if (
			video?.codec_name !== 'h264' ||
			video.profile !== 'High' ||
			video.width !== 1920 ||
			video.height !== 1080 ||
			video.pix_fmt !== 'yuv420p' ||
			Math.abs(rate(String(video.avg_frame_rate)) - 30) > 1 ||
			!Number.isFinite(videoStart) ||
			videoStart < 0
		)
			throw new Error('invalid video invariant');
		if (
			audio?.codec_name !== 'aac' ||
			audio.profile !== 'LC' ||
			Number(audio.sample_rate) !== 48000 ||
			audio.channels !== 2 ||
			!Number.isFinite(audioStart) ||
			audioStart < 0 ||
			Math.abs(videoStart - audioStart) > 0.1
		)
			throw new Error('invalid audio invariant');
		const duration = Number(parsed.format.duration);
		if (!Number.isFinite(duration) || duration <= 0)
			throw new Error('invalid media duration');
		return {
			duration_ms: Math.round(duration * 1000),
			video: { codec: 'h264', width: 1920, height: 1080, fps: 30 },
			audio: { codec: 'aac', sample_rate: 48000, channels: 2 },
		};
	}
	async concat(list: string, output: string): Promise<void> {
		await command(this.ffmpeg, [
			'-v',
			'error',
			'-y',
			'-protocol_whitelist',
			'file,concatf',
			'-i',
			`concatf:${list}`,
			'-c',
			'copy',
			'-movflags',
			'+faststart',
			output,
		]);
	}
}

export class Finalizer {
	constructor(
		private readonly store: ManifestStore,
		private readonly tools: MediaTools & {
			concat(list: string, output: string): Promise<void>;
		},
	) {}
	async finalize(forcePartial = false, reason?: string): Promise<CaptureState> {
		await this.store.update((m) => {
			m.state = 'sealing';
			if (reason) m.reason = reason;
		});
		const manifest = this.store.get();
		if (!manifest.segments.length) {
			await this.store.update((m) => {
				m.state = 'failed';
			});
			return 'failed';
		}
		const list = join(this.store.directory, 'concat.txt');
		const temp = join(
			this.store.directory,
			`artifact.${crypto.randomUUID()}.tmp.mp4`,
		);
		const output = join(this.store.directory, 'recording.mp4');
		try {
			const paths: string[] = [];
			for (const segment of manifest.segments) {
				const path = await this.store.resolveFile(segment.file);
				const digest = await fileDigest(path);
				if (digest.bytes !== segment.bytes || digest.sha256 !== segment.sha256)
					throw new Error(`segment integrity mismatch: ${segment.file}`);
				paths.push(path);
			}
			await writeFile(
				list,
				`${paths.map((path) => pathToFileURL(path).href).join('\n')}\n`,
				{ mode: 0o600 },
			);
			await this.tools.concat(list, temp);
			const probe = await this.tools.validate(temp);
			const expectedDuration = manifest.segments.reduce(
				(total, segment) => total + segment.duration_ms,
				0,
			);
			if (
				Math.abs(probe.duration_ms - expectedDuration) >
				Math.max(1_000, expectedDuration * 0.05)
			)
				throw new Error('artifact duration does not match manifest');
			const digest = await fileDigest(temp);
			const handle = await open(temp, 'r');
			try {
				await handle.sync();
			} finally {
				await handle.close();
			}
			await rename(temp, output);
			const directory = await open(this.store.directory, 'r');
			try {
				await directory.sync();
			} finally {
				await directory.close();
			}
			const state: CaptureState =
				forcePartial || manifest.gaps.length ? 'partial' : 'complete';
			await this.store.update((m) => {
				m.state = state;
				m.artifact = {
					file: 'recording.mp4',
					bytes: digest.bytes,
					sha256: digest.sha256,
					duration_ms: probe.duration_ms,
				};
			});
			return state;
		} catch (error) {
			await this.store.update((m) => {
				m.state = 'failed';
				m.reason =
					error instanceof Error
						? error.message.slice(0, 256)
						: 'finalization_failed';
			});
			return 'failed';
		} finally {
			await unlink(list).catch(() => undefined);
			await unlink(temp).catch(() => undefined);
		}
	}
}
