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

function rate(value: unknown): number {
	if (
		typeof value !== 'string' ||
		!/^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(value)
	) {
		return Number.NaN;
	}
	const [numerator, denominator] = value.split('/').map(Number);
	return denominator ? (numerator ?? 0) / denominator : Number.NaN;
}

function decimal(value: unknown): number {
	if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) {
		return Number.NaN;
	}
	return Number(value);
}

function validateFfprobeOutput(value: unknown): MediaProbe {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		!('streams' in value) ||
		!Array.isArray(value.streams) ||
		value.streams.length !== 2 ||
		!('format' in value) ||
		!value.format ||
		typeof value.format !== 'object' ||
		Array.isArray(value.format)
	) {
		throw new Error('invalid ffprobe output');
	}
	const video = value.streams.find(
		(stream) =>
			stream &&
			typeof stream === 'object' &&
			!Array.isArray(stream) &&
			'codec_type' in stream &&
			stream.codec_type === 'video',
	);
	const audio = value.streams.find(
		(stream) =>
			stream &&
			typeof stream === 'object' &&
			!Array.isArray(stream) &&
			'codec_type' in stream &&
			stream.codec_type === 'audio',
	);
	if (!video || !audio) throw new Error('invalid stream types');
	const videoStart =
		'start_time' in video ? decimal(video.start_time) : Number.NaN;
	const frameRate =
		'avg_frame_rate' in video ? rate(video.avg_frame_rate) : Number.NaN;
	if (
		!('codec_name' in video) ||
		video.codec_name !== 'h264' ||
		!('profile' in video) ||
		video.profile !== 'High' ||
		!('width' in video) ||
		video.width !== 1920 ||
		!('height' in video) ||
		video.height !== 1080 ||
		!('pix_fmt' in video) ||
		video.pix_fmt !== 'yuv420p' ||
		!Number.isFinite(frameRate) ||
		Math.abs(frameRate - 30) > 1 ||
		!Number.isFinite(videoStart) ||
		videoStart < 0
	) {
		throw new Error('invalid video invariant');
	}
	const audioStart =
		'start_time' in audio ? decimal(audio.start_time) : Number.NaN;
	if (
		!('codec_name' in audio) ||
		audio.codec_name !== 'aac' ||
		!('profile' in audio) ||
		audio.profile !== 'LC' ||
		!('sample_rate' in audio) ||
		decimal(audio.sample_rate) !== 48000 ||
		!('channels' in audio) ||
		audio.channels !== 2 ||
		!Number.isFinite(audioStart) ||
		audioStart < 0 ||
		Math.abs(videoStart - audioStart) > 0.1
	) {
		throw new Error('invalid audio invariant');
	}
	const duration =
		'duration' in value.format ? decimal(value.format.duration) : Number.NaN;
	if (!Number.isFinite(duration) || duration <= 0) {
		throw new Error('invalid media duration');
	}
	return {
		duration_ms: Math.round(duration * 1000),
		video: { codec: 'h264', width: 1920, height: 1080, fps: 30 },
		audio: { codec: 'aac', sample_rate: 48000, channels: 2 },
	};
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
		const parsed: unknown = JSON.parse(
			await command(this.ffprobe, [
				'-v',
				'error',
				'-show_streams',
				'-show_format',
				'-of',
				'json',
				path,
			]),
		);
		return validateFfprobeOutput(parsed);
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
