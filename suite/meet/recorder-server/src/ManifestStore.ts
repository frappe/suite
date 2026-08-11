import { createHash } from 'node:crypto';
import {
	copyFile,
	type FileHandle,
	lstat,
	mkdir,
	open,
	readFile,
	realpath,
	rename,
	unlink,
	writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { CaptureManifest } from './captureTypes.js';

export function safeJobDirectory(root: string, job: string): string {
	return join(root, createHash('sha256').update(job).digest('hex'));
}

const timestamp = (value: unknown): value is string =>
	typeof value === 'string' &&
	!Number.isNaN(Date.parse(value)) &&
	new Date(value).toISOString() === value;

export function safeManifestFile(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		!isAbsolute(value) &&
		/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
	);
}

function positiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

export function validManifest(value: unknown): value is CaptureManifest {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const m = value as CaptureManifest;
	return (
		m.version === 1 &&
		Number.isSafeInteger(m.revision) &&
		m.revision >= 0 &&
		typeof m.job === 'string' &&
		['capturing', 'sealing', 'complete', 'partial', 'failed'].includes(
			m.state,
		) &&
		Number.isSafeInteger(m.epochs) &&
		m.epochs >= 0 &&
		Array.isArray(m.segments) &&
		Array.isArray(m.gaps) &&
		(m.reason === undefined ||
			(typeof m.reason === 'string' && m.reason.length > 0)) &&
		m.segments.every(
			(s, i) =>
				s.index === i &&
				Number.isSafeInteger(s.epoch) &&
				s.epoch >= 0 &&
				s.epoch < m.epochs &&
				safeManifestFile(s.file) &&
				s.file.startsWith(
					`epoch-${String(s.epoch).padStart(3, '0')}-segment-`,
				) &&
				positiveInteger(s.bytes) &&
				typeof s.sha256 === 'string' &&
				/^[a-f0-9]{64}$/.test(s.sha256) &&
				positiveInteger(s.duration_ms) &&
				timestamp(s.started_at),
		) &&
		m.gaps.every(
			(g) =>
				timestamp(g.started_at) &&
				(g.ended_at === undefined ||
					(timestamp(g.ended_at) && g.ended_at >= g.started_at)) &&
				typeof g.reason === 'string' &&
				g.reason.length > 0,
		) &&
		(m.artifact === undefined ||
			(safeManifestFile(m.artifact.file) &&
				positiveInteger(m.artifact.bytes) &&
				/^[a-f0-9]{64}$/.test(m.artifact.sha256) &&
				positiveInteger(m.artifact.duration_ms))) &&
		(['complete', 'partial'].includes(m.state)
			? m.artifact !== undefined
			: m.artifact === undefined)
	);
}

export class ManifestStore {
	readonly directory: string;
	readonly path: string;
	private readonly previousPath: string;
	private readonly initializedPath: string;
	private current?: CaptureManifest;
	private writes = Promise.resolve();

	constructor(
		root: string,
		private readonly job: string,
	) {
		this.directory = safeJobDirectory(root, job);
		this.path = join(this.directory, 'manifest.json');
		this.previousPath = join(this.directory, 'manifest.previous.json');
		this.initializedPath = join(this.directory, '.initialized');
	}

	async initialize(): Promise<CaptureManifest> {
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		const established = await lstat(this.initializedPath)
			.then(() => true)
			.catch((error: NodeJS.ErrnoException) => {
				if (error.code === 'ENOENT') return false;
				throw error;
			});
		let currentError: unknown;
		for (const path of [this.path, this.previousPath]) {
			try {
				const value: unknown = JSON.parse(await readFile(path, 'utf8'));
				if (!validManifest(value) || value.job !== this.job)
					throw new Error('invalid capture manifest');
				this.current = value;
				break;
			} catch (error) {
				currentError ??= error;
			}
		}
		if (!this.current) {
			if (established)
				throw new Error('established capture manifest unavailable', {
					cause: currentError,
				});
			this.current = {
				version: 1,
				revision: 0,
				job: this.job,
				state: 'capturing',
				epochs: 0,
				segments: [],
				gaps: [],
			};
			await this.persist(this.current);
			await writeFile(this.initializedPath, '', { flag: 'wx', mode: 0o600 });
		}
		return structuredClone(this.current);
	}

	get(): CaptureManifest {
		if (!this.current) throw new Error('manifest not initialized');
		return structuredClone(this.current);
	}

	async update(
		change: (manifest: CaptureManifest) => void,
	): Promise<CaptureManifest> {
		let result!: CaptureManifest;
		const write = this.writes
			.catch(() => undefined)
			.then(async () => {
				const next = this.get();
				change(next);
				next.revision++;
				if (!validManifest(next))
					throw new Error('invalid capture manifest update');
				await this.persist(next);
				this.current = next;
				result = structuredClone(next);
			});
		this.writes = write;
		await write;
		return result;
	}

	async resolveFile(file: string, mustExist = true): Promise<string> {
		if (!safeManifestFile(file)) throw new Error('unsafe manifest path');
		const path = join(this.directory, file);
		if (!mustExist) return path;
		const [root, target, info] = await Promise.all([
			realpath(this.directory),
			realpath(path),
			lstat(path),
		]);
		if (info.isSymbolicLink() || relative(root, target).startsWith('..'))
			throw new Error('manifest path escapes capture directory');
		return target;
	}

	private async persist(value: CaptureManifest): Promise<void> {
		const temp = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
		let file: FileHandle | undefined;
		try {
			file = await open(temp, 'wx', 0o600);
			await file.writeFile(`${JSON.stringify(value)}\n`);
			await file.sync();
			await file.close();
			file = undefined;
			await copyFile(this.path, this.previousPath).catch(
				(error: NodeJS.ErrnoException) => {
					if (error.code !== 'ENOENT') throw error;
				},
			);
			await rename(temp, this.path);
			const parent = await open(dirname(this.path), 'r');
			try {
				await parent.sync();
			} finally {
				await parent.close();
			}
		} finally {
			if (file) await file.close().catch(() => undefined);
			await unlink(temp).catch(() => undefined);
		}
	}
}
