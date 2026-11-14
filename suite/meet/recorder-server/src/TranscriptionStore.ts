import { createHash } from 'node:crypto';
import {
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	rm,
	statfs,
} from 'node:fs/promises';
import path from 'node:path';

export interface SourceSegment {
	source_id: string;
	speaker_id: string;
	speaker_name: string;
	start_ms: number;
	end_ms: number;
	size: number;
	sha256: string;
	sample_rate: 24000;
}
export interface SourceManifest {
	speech_context?: { vocabulary_version: string; title: string };
	participant_names?: string[];
	capture: string;
	site: string;
	room: string;
	started_at: string;
	capture_started_at?: string;
	ended_at?: string;
	state: 'capturing' | 'complete' | 'partial' | 'failed';
	max_bytes: number;
	max_duration_ms: number;
	segments: SourceSegment[];
	gaps: Array<{ start_ms: number; end_ms: number; reason: string }>;
	audio_seconds: number;
}
function participantNames(value: unknown): string[] {
	if (
		!Array.isArray(value) ||
		value.length > 100 ||
		value.some(
			(name: unknown) =>
				typeof name !== 'string' ||
				!name ||
				name.length > 80 ||
				/[\p{C}]/u.test(name) ||
				name.includes('<|') ||
				name.includes('|>'),
		)
	)
		throw new Error('invalid_participant_hints');
	return [
		...new Set<string>(
			value.map((name: string) => name.normalize('NFKC').trim()),
		),
	]
		.filter(Boolean)
		.slice(0, 100);
}
function speechContext(value: unknown): {
	vocabulary_version: string;
	title: string;
} {
	if (
		!value ||
		typeof value !== 'object' ||
		!('vocabulary_version' in value) ||
		typeof value.vocabulary_version !== 'string' ||
		!/^[a-z0-9-]{1,40}$/.test(value.vocabulary_version) ||
		!('title' in value) ||
		typeof value.title !== 'string' ||
		value.title.length > 160 ||
		/[\p{C}]/u.test(value.title) ||
		value.title.includes('<|') ||
		value.title.includes('|>')
	)
		throw new Error('invalid_speech_context');
	return { vocabulary_version: value.vocabulary_version, title: value.title };
}
export function sourceId(value: string): string {
	if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))
		throw new Error('invalid_source_id');
	return value;
}

/** Private durable audio, deliberately outside the video cleanup tree. */
export class TranscriptionStore {
	private pending: Promise<unknown> = Promise.resolve();
	private faulted = new Set<string>();
	private available = false;
	get ready(): boolean {
		return this.available;
	}
	constructor(
		readonly root: string,
		private readonly minimumFreeBytes = 1024 ** 3,
		private readonly maxConcurrent = 16,
		private readonly maxTotalBytes = 10 * 1024 ** 3,
	) {
		if (
			!Number.isSafeInteger(maxConcurrent) ||
			maxConcurrent < 1 ||
			maxConcurrent > 1024 ||
			!Number.isSafeInteger(maxTotalBytes) ||
			maxTotalBytes < 48000
		)
			throw new Error('invalid_source_configuration');
	}
	private directory(site: string, capture: string): string {
		return path.join(
			this.root,
			createHash('sha256').update(site).digest('hex'),
			sourceId(capture),
		);
	}
	private serialize<T>(work: () => Promise<T>): Promise<T> {
		const next = this.pending.then(work, work);
		this.pending = next.catch(() => {});
		return next;
	}
	private async save(
		directory: string,
		manifest: SourceManifest,
	): Promise<void> {
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const temporary = path.join(directory, 'manifest.tmp');
		const file = await open(temporary, 'w', 0o600);
		try {
			await file.writeFile(JSON.stringify(manifest));
			await file.sync();
		} finally {
			await file.close();
		}
		await rename(temporary, path.join(directory, 'manifest.json'));
		const folder = await open(directory, 'r');
		try {
			await folder.sync();
		} finally {
			await folder.close();
		}
	}

	private async directories(): Promise<string[]> {
		const directories: string[] = [];
		for (const site of await readdir(this.root, { withFileTypes: true })) {
			if (!site.isDirectory() || !/^[a-f0-9]{64}$/.test(site.name)) continue;
			const sitePath = path.join(this.root, site.name);
			for (const capture of await readdir(sitePath, { withFileTypes: true })) {
				if (
					capture.isDirectory() &&
					/^[a-zA-Z0-9_-]{1,128}$/.test(capture.name)
				)
					directories.push(path.join(sitePath, capture.name));
			}
		}
		return directories;
	}
	private async load(directory: string): Promise<SourceManifest> {
		const m: SourceManifest = JSON.parse(
			await readFile(path.join(directory, 'manifest.json'), 'utf8'),
		);
		if (
			!m ||
			typeof m.site !== 'string' ||
			typeof m.capture !== 'string' ||
			typeof m.room !== 'string' ||
			path.basename(directory) !== m.capture ||
			path.basename(path.dirname(directory)) !==
				createHash('sha256').update(m.site).digest('hex') ||
			!['capturing', 'complete', 'partial', 'failed'].includes(m.state) ||
			!Array.isArray(m.segments) ||
			m.segments.length > 10000 ||
			!Array.isArray(m.gaps) ||
			!Number.isSafeInteger(m.max_duration_ms) ||
			m.max_duration_ms < 1000 ||
			m.max_duration_ms > 14400000 ||
			!Number.isSafeInteger(m.max_bytes) ||
			m.max_bytes < 48000 ||
			!Number.isFinite(Date.parse(m.started_at))
		)
			throw new Error('invalid_source_manifest');

		if (m.participant_names !== undefined)
			participantNames(m.participant_names);
		if (m.speech_context !== undefined) speechContext(m.speech_context);
		const ids = new Set<string>();
		let bytes = 0;
		for (const source of m.segments) {
			if (
				!source ||
				sourceId(source.source_id) !== source.source_id ||
				ids.has(source.source_id) ||
				source.sample_rate !== 24000 ||
				typeof source.speaker_id !== 'string' ||
				!source.speaker_id ||
				source.speaker_id.length > 200 ||
				typeof source.speaker_name !== 'string' ||
				!source.speaker_name.trim() ||
				source.speaker_name.length > 200 ||
				!Number.isSafeInteger(source.start_ms) ||
				!Number.isSafeInteger(source.end_ms) ||
				source.start_ms < 0 ||
				source.end_ms <= source.start_ms ||
				source.end_ms > m.max_duration_ms ||
				source.end_ms - source.start_ms > 30000 ||
				!Number.isSafeInteger(source.size) ||
				source.size <= 0 ||
				source.size % 2 ||
				Math.abs(source.size / 48 - (source.end_ms - source.start_ms)) > 1 ||
				typeof source.sha256 !== 'string' ||
				!/^[a-f0-9]{64}$/.test(source.sha256)
			)
				throw new Error('invalid_source_manifest');
			ids.add(source.source_id);
			bytes += source.size;
		}
		if (
			bytes > m.max_bytes ||
			!Number.isFinite(m.audio_seconds) ||
			Math.abs(m.audio_seconds - bytes / 48000) > 0.000001 ||
			m.gaps.length > 10000 ||
			m.gaps.some(
				(g) =>
					!g ||
					!Number.isSafeInteger(g.start_ms) ||
					!Number.isSafeInteger(g.end_ms) ||
					g.start_ms < 0 ||
					g.end_ms <= g.start_ms ||
					g.end_ms > m.max_duration_ms ||
					typeof g.reason !== 'string' ||
					!/^[a-z_]{1,64}$/.test(g.reason),
			) ||
			(m.state !== 'capturing' &&
				(!m.ended_at || !Number.isFinite(Date.parse(m.ended_at))))
		)
			throw new Error('invalid_source_manifest');
		return m;
	}
	async initialize(): Promise<void> {
		this.available = false;
		this.faulted.clear();
		await mkdir(this.root, { recursive: true, mode: 0o700 });
		for (const directory of await this.directories()) {
			try {
				const manifest = await this.load(directory);
				if (manifest.state === 'capturing') {
					manifest.ended_at = new Date(
						Math.min(
							Date.now(),
							Date.parse(manifest.started_at) + manifest.max_duration_ms,
						),
					).toISOString();
					manifest.state = 'partial';
					const last = Math.max(0, ...manifest.segments.map((s) => s.end_ms));
					const end = Math.min(
						manifest.max_duration_ms,
						Math.max(last + 1, Date.now() - Date.parse(manifest.started_at)),
					);
					manifest.gaps.push({
						// A later saved segment from one speaker is not an
						// acknowledgment of another speaker's buffered audio.
						start_ms: 0,
						end_ms: end,
						reason: 'service_restart',
					});
					await this.save(directory, manifest);
				}
			} catch {
				// A crash between mkdir and the first manifest commit must not disable video
				// or healthy captures. Preserve uncommitted/corrupt files for bounded cleanup.
				this.faulted.add(directory);
			}
		}
		this.available = true;
	}
	async manifest(site: string, capture: string): Promise<SourceManifest> {
		const directory = this.directory(site, capture);
		if (this.faulted.has(directory))
			throw new Error('source_manifest_unavailable');
		try {
			return await this.load(directory);
		} catch (error) {
			if (!(await lstat(directory).catch(() => null))) throw error;
			this.faulted.add(directory);
			throw new Error('source_manifest_unavailable');
		}
	}
	async failedManifest(
		site: string,
		room: string,
		capture: string,
	): Promise<SourceManifest> {
		const directory = this.directory(site, capture);
		if (!this.faulted.has(directory)) throw new Error('source_missing');
		const info = await lstat(directory),
			ended = new Date().toISOString();
		const started = new Date(
			Math.min(info.birthtimeMs || info.ctimeMs, Date.now() - 1),
		).toISOString();
		return {
			site,
			room,
			capture,
			started_at: started,
			ended_at: ended,
			state: 'failed',
			max_bytes: 0,
			max_duration_ms: 14400000,
			segments: [],
			audio_seconds: 0,
			gaps: [
				{
					start_ms: 0,
					end_ms: Math.min(
						14400000,
						Math.max(1, Date.parse(ended) - Date.parse(started)),
					),
					reason: 'source_manifest_unavailable',
				},
			],
		};
	}
	private async actualBytes(directory: string): Promise<number> {
		let bytes = 0;
		for (const entry of await readdir(directory, { withFileTypes: true }))
			if (entry.isFile())
				bytes += (await lstat(path.join(directory, entry.name))).size;
		return bytes;
	}

	async reserve(
		site: string,
		room: string,
		capture: string,
		maxBytes: number,
		maxDuration: number,
	): Promise<SourceManifest> {
		return this.serialize(async () => {
			const directory = this.directory(site, capture);
			try {
				const existing = await this.manifest(site, capture);
				if (
					existing.room !== room ||
					existing.max_bytes !== maxBytes ||
					existing.max_duration_ms !== maxDuration
				)
					throw new Error('capture_conflict');
				return existing;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			}
			if (
				!Number.isSafeInteger(maxBytes) ||
				maxBytes < 48000 ||
				!Number.isSafeInteger(maxDuration) ||
				maxDuration < 1000 ||
				maxDuration > 14400000
			)
				throw new Error('invalid_limits');
			let active = 0,
				reserved = 0;
			let allocated = 0;

			for (const directory of await this.directories()) {
				if (this.faulted.has(directory)) {
					allocated += await this.actualBytes(directory);
					continue;
				}
				let m: SourceManifest;
				try {
					m = await this.load(directory);
				} catch {
					this.faulted.add(directory);
					allocated += await this.actualBytes(directory);
					continue;
				}
				allocated +=
					m.state === 'capturing'
						? m.max_bytes
						: m.segments.reduce((sum, s) => sum + s.size, 0);
				if (m.state === 'capturing') {
					active++;
					reserved +=
						m.max_bytes - m.segments.reduce((sum, s) => sum + s.size, 0);
				}
			}

			if (active >= this.maxConcurrent) throw new Error('capacity');
			if (allocated + maxBytes > this.maxTotalBytes) throw new Error('storage');
			const disk = await statfs(this.root);
			if (
				disk.bavail * disk.bsize <
				this.minimumFreeBytes + reserved + maxBytes
			)
				throw new Error('storage');
			const manifest: SourceManifest = {
				capture,
				site,
				room,
				started_at: new Date().toISOString(),
				state: 'capturing',
				max_bytes: maxBytes,
				max_duration_ms: maxDuration,
				participant_names: [],
				segments: [],
				gaps: [],
				audio_seconds: 0,
			};
			await this.save(directory, manifest);
			return manifest;
		});
	}
	async begin(
		site: string,
		capture: string,
		startedAt: string,
		context?: unknown,
	): Promise<void> {
		await this.serialize(async () => {
			const directory = this.directory(site, capture),
				manifest = await this.manifest(site, capture);
			if (manifest.capture_started_at) {
				if (
					manifest.capture_started_at !== startedAt ||
					(context !== undefined &&
						JSON.stringify(speechContext(context)) !==
							JSON.stringify(manifest.speech_context))
				)
					throw new Error('capture_conflict');
				return;
			}
			if (
				manifest.state !== 'capturing' ||
				typeof startedAt !== 'string' ||
				!Number.isFinite(Date.parse(startedAt)) ||
				new Date(startedAt).toISOString() !== startedAt ||
				manifest.segments.length
			)
				throw new Error('capture_closed');
			if (context !== undefined)
				manifest.speech_context = speechContext(context);
			manifest.started_at = startedAt;
			manifest.capture_started_at = startedAt;
			await this.save(directory, manifest);
		});
	}

	async updateParticipants(
		site: string,
		capture: string,
		names: unknown,
	): Promise<void> {
		const incoming = participantNames(names);
		await this.serialize(async () => {
			const directory = this.directory(site, capture);
			const manifest = await this.manifest(site, capture);
			if (manifest.state !== 'capturing') throw new Error('capture_closed');
			manifest.participant_names = participantNames(
				[...(manifest.participant_names ?? []), ...incoming].slice(0, 100),
			);
			await this.save(directory, manifest);
		});
	}

	async append(
		site: string,
		capture: string,
		segment: SourceSegment,
		audio: Buffer,
	): Promise<void> {
		await this.serialize(async () => {
			const directory = this.directory(site, capture),
				manifest = await this.manifest(site, capture);
			sourceId(segment.source_id);
			if (
				segment.sample_rate !== 24000 ||
				audio.length === 0 ||
				audio.length > 24000 * 2 * 30 ||
				audio.length % 2 ||
				segment.size !== audio.length ||
				segment.sha256 !== createHash('sha256').update(audio).digest('hex') ||
				!segment.speaker_id ||
				segment.speaker_id.length > 200 ||
				!segment.speaker_name.trim() ||
				segment.speaker_name.length > 200 ||
				!Number.isSafeInteger(segment.start_ms) ||
				!Number.isSafeInteger(segment.end_ms) ||
				segment.end_ms <= segment.start_ms ||
				segment.end_ms - segment.start_ms > 30000 ||
				segment.start_ms < 0 ||
				segment.end_ms > manifest.max_duration_ms ||
				Math.abs(segment.end_ms - segment.start_ms - audio.length / 48) > 1
			)
				throw new Error('invalid_segment');
			const previous = manifest.segments.find(
				(s) => s.source_id === segment.source_id,
			);
			if (previous) {
				if (JSON.stringify(previous) !== JSON.stringify(segment))
					throw new Error('segment_conflict');
				return;
			}
			if (manifest.state !== 'capturing' || !manifest.capture_started_at)
				throw new Error('capture_closed');
			if (manifest.segments.length >= 10000) throw new Error('capacity');
			if (
				manifest.segments.reduce((n, s) => n + s.size, 0) + audio.length >
				manifest.max_bytes
			)
				throw new Error('storage');
			const disk = await statfs(this.root);
			if (disk.bavail * disk.bsize < this.minimumFreeBytes + audio.length)
				throw new Error('storage');
			const filename = path.join(directory, `${segment.source_id}.pcm`);
			// An interrupted write is harmless: the segment is not visible until the synced manifest commits.
			const file = await open(filename, 'w', 0o600);
			try {
				await file.writeFile(audio);
				await file.sync();
			} finally {
				await file.close();
			}
			manifest.segments.push(segment);
			manifest.audio_seconds += audio.length / 48000;
			await this.save(directory, manifest);
		});
	}
	async complete(
		site: string,
		capture: string,
		gaps: SourceManifest['gaps'],
	): Promise<SourceManifest> {
		return this.serialize(async () => {
			const directory = this.directory(site, capture),
				manifest = await this.manifest(site, capture);
			if (manifest.state !== 'capturing') return manifest;
			if (
				!Array.isArray(gaps) ||
				gaps.length > 10000 ||
				gaps.some(
					(g) =>
						!Number.isSafeInteger(g.start_ms) ||
						!Number.isSafeInteger(g.end_ms) ||
						g.start_ms < 0 ||
						g.end_ms <= g.start_ms ||
						g.end_ms > manifest.max_duration_ms ||
						![
							'source_interrupted',
							'upload_failed',
							'duration_limit',
							'room_empty',
							'service_shutdown',
						].includes(g.reason),
				)
			)
				throw new Error('invalid_gaps');
			manifest.gaps = gaps;
			manifest.state = gaps.length ? 'partial' : 'complete';
			manifest.ended_at = new Date().toISOString();
			await this.save(directory, manifest);
			return manifest;
		});
	}
	/** Node-local retention remains bounded even while the owning site is offline. */
	async sweep(now = Date.now()): Promise<number> {
		return this.serialize(async () => {
			let removed = 0;
			for (const directory of await this.directories()) {
				let manifest: SourceManifest;
				try {
					manifest = await this.load(directory);
				} catch {
					this.faulted.add(directory);
					const info = await lstat(directory);
					if (
						now - (info.birthtimeMs || info.ctimeMs) >=
						14400000 + 7 * 86400000
					) {
						await rm(directory, { recursive: true, force: true });
						this.faulted.delete(directory);
						removed++;
					}
					continue;
				}
				if (
					manifest.state === 'capturing' &&
					now - Date.parse(manifest.started_at) >= manifest.max_duration_ms
				) {
					manifest.state = 'partial';
					manifest.ended_at = new Date(
						Date.parse(manifest.started_at) + manifest.max_duration_ms,
					).toISOString();
					const last = Math.max(
						0,
						...manifest.segments.map((source) => source.end_ms),
					);
					manifest.gaps.push({
						start_ms: Math.min(last, manifest.max_duration_ms - 1),
						end_ms: manifest.max_duration_ms,
						reason: 'duration_limit',
					});
					await this.save(directory, manifest);
				}
				if (
					manifest.state !== 'capturing' &&
					manifest.ended_at &&
					now - Date.parse(manifest.ended_at) >= 7 * 86400000
				) {
					await rm(directory, { recursive: true, force: true });
					this.faulted.delete(directory);
					removed++;
				}
			}
			return removed;
		});
	}

	async audio(site: string, capture: string, id: string): Promise<string> {
		const manifest = await this.manifest(site, capture);
		const deadline =
			Date.parse(manifest.ended_at ?? manifest.started_at) +
			(manifest.state === 'capturing' ? manifest.max_duration_ms : 0) +
			7 * 86400000;
		if (Date.now() >= deadline) {
			await this.delete(site, capture);
			throw new Error('source_missing');
		}
		if (!manifest.segments.some((s) => s.source_id === sourceId(id)))
			throw new Error('source_missing');
		return path.join(this.directory(site, capture), `${id}.pcm`);
	}
	async delete(site: string, capture: string): Promise<void> {
		await this.serialize(async () => {
			const directory = this.directory(site, capture);
			await rm(directory, { recursive: true, force: true });
			this.faulted.delete(directory);
		});
	}
}
