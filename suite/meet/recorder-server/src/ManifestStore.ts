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
import type {
	CaptureArtifact,
	CaptureEpoch,
	CaptureGap,
	CaptureManifest,
	CaptureSegment,
} from './captureTypes.js';

export function safeJobDirectory(root: string, job: string): string {
	return join(root, createHash('sha256').update(job).digest('hex'));
}

const timestamp = (value: unknown): value is string =>
	typeof value === 'string' &&
	!Number.isNaN(Date.parse(value)) &&
	new Date(value).toISOString() === value;

function safeManifestFile<Value>(value: Value): value is Value & string {
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

type CaptureFields = Partial<
	Record<
		| keyof CaptureManifest
		| keyof CaptureSegment
		| keyof CaptureGap
		| keyof CaptureArtifact
		| keyof CaptureEpoch,
		unknown
	>
>;

function isRecord(value: unknown): value is CaptureFields {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function validManifest(value: unknown): value is CaptureManifest {
	if (!isRecord(value)) return false;
	const m = value;
	if (
		(m.version !== 1 && m.version !== 2) ||
		typeof m.revision !== 'number' ||
		!Number.isSafeInteger(m.revision) ||
		m.revision < 0 ||
		typeof m.job !== 'string' ||
		typeof m.state !== 'string' ||
		!['capturing', 'sealing', 'complete', 'partial', 'failed'].includes(
			m.state,
		) ||
		typeof m.epochs !== 'number' ||
		!Number.isSafeInteger(m.epochs) ||
		m.epochs < 0 ||
		!Array.isArray(m.segments) ||
		!Array.isArray(m.gaps) ||
		(m.reason !== undefined &&
			(typeof m.reason !== 'string' || m.reason.length === 0))
	)
		return false;
	const epochs = m.epochs;
	const captureEpochs = m.capture_epochs;
	const captureEpochsValid =
		(m.version === 1 && captureEpochs === undefined) ||
		(Array.isArray(captureEpochs) &&
			captureEpochs.every(
				(record, index) =>
					isRecord(record) &&
					Object.keys(record).length === 2 &&
					Object.hasOwn(record, 'epoch') &&
					Object.hasOwn(record, 'capture_started_at') &&
					typeof record.epoch === 'number' &&
					Number.isSafeInteger(record.epoch) &&
					record.epoch >= 0 &&
					record.epoch < epochs &&
					timestamp(record.capture_started_at) &&
					(index === 0 ||
						(record.epoch > (captureEpochs[index - 1]?.epoch ?? -1) &&
							record.capture_started_at >=
								(captureEpochs[index - 1]?.capture_started_at ?? ''))),
			));
	if (!captureEpochsValid) return false;
	return (
		m.segments.every(
			(segment, index) =>
				isRecord(segment) &&
				segment.index === index &&
				typeof segment.epoch === 'number' &&
				Number.isSafeInteger(segment.epoch) &&
				segment.epoch >= 0 &&
				segment.epoch < epochs &&
				safeManifestFile(segment.file) &&
				segment.file.startsWith(
					`epoch-${String(segment.epoch).padStart(3, '0')}-segment-`,
				) &&
				positiveInteger(segment.bytes) &&
				typeof segment.sha256 === 'string' &&
				/^[a-f0-9]{64}$/.test(segment.sha256) &&
				positiveInteger(segment.duration_ms) &&
				timestamp(segment.started_at) &&
				(m.version === 1 ||
					(Array.isArray(captureEpochs) &&
						captureEpochs.some((record) => record.epoch === segment.epoch))),
		) &&
		m.gaps.every(
			(gap) =>
				isRecord(gap) &&
				timestamp(gap.started_at) &&
				(gap.ended_at === undefined ||
					(timestamp(gap.ended_at) && gap.ended_at >= gap.started_at)) &&
				typeof gap.reason === 'string' &&
				gap.reason.length > 0,
		) &&
		(m.artifact === undefined ||
			(isRecord(m.artifact) &&
				safeManifestFile(m.artifact.file) &&
				positiveInteger(m.artifact.bytes) &&
				typeof m.artifact.sha256 === 'string' &&
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
				version: 2,
				revision: 0,
				job: this.job,
				state: 'capturing',
				epochs: 0,
				capture_epochs: [],
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
