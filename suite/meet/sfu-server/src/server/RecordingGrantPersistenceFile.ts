import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import {
	access,
	mkdir,
	open,
	readFile,
	rename,
	unlink,
} from 'node:fs/promises';
import { dirname } from 'node:path';

const SCHEMA_VERSION = 1;

type FileShape = {
	schemaVersion: 1;
	consumed: Record<string, number>;
};

export class RecordingGrantPersistenceFile {
	private consumed = new Map<string, number>();
	private ready = false;
	private writes = Promise.resolve();

	constructor(private readonly filePath: string) {}

	static async bootstrap(filePath: string): Promise<void> {
		await access(filePath, constants.F_OK).catch(async () => {
			await RecordingGrantPersistenceFile.writeDurably(filePath, {
				schemaVersion: SCHEMA_VERSION,
				consumed: {},
			});
		});
	}

	async initialize(): Promise<void> {
		try {
			const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
			if (!isFileShape(parsed)) {
				throw new Error('invalid recording grant persistence schema');
			}
			this.consumed = new Map(Object.entries(parsed.consumed));
			this.ready = true;
		} catch {
			this.ready = false;
			throw new Error('Recording grant persistence failed to initialize');
		}
	}

	isReady(): boolean {
		return this.ready;
	}

	isConsumed(jti: string, now: number): boolean {
		this.assertReady();
		return (this.consumed.get(jti) ?? 0) > now;
	}

	consume(jti: string, retainUntil: number, now: number): Promise<void> {
		return this.serialize(async () => {
			if ((this.consumed.get(jti) ?? 0) > now) {
				throw new Error('Recording grant has already been consumed');
			}
			const next = new Map(
				[...this.consumed].filter(([, expiresAt]) => expiresAt > now),
			);
			next.set(jti, retainUntil);
			await this.persist(next);
			this.consumed = next;
		});
	}

	cleanup(now: number): Promise<void> {
		return this.serialize(async () => {
			const next = new Map(
				[...this.consumed].filter(([, expiresAt]) => expiresAt > now),
			);
			if (next.size === this.consumed.size) return;
			await this.persist(next);
			this.consumed = next;
		});
	}

	private serialize(operation: () => Promise<void>): Promise<void> {
		const result = this.writes.then(() => {
			this.assertReady();
			return operation();
		});
		this.writes = result.catch(() => undefined);
		return result;
	}

	private async persist(consumed: Map<string, number>): Promise<void> {
		try {
			await RecordingGrantPersistenceFile.writeDurably(this.filePath, {
				schemaVersion: SCHEMA_VERSION,
				consumed: Object.fromEntries(consumed),
			});
		} catch (error) {
			this.ready = false;
			throw error;
		}
	}

	private static async writeDurably(
		filePath: string,
		shape: FileShape,
	): Promise<void> {
		const directory = dirname(filePath);
		const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
		await mkdir(directory, { recursive: true });
		let file: FileHandle | undefined;
		try {
			file = await open(temporaryPath, 'wx', 0o600);
			await file.writeFile(JSON.stringify(shape));
			await file.sync();
			await file.close();
			file = undefined;
			await rename(temporaryPath, filePath);
			const parent = await open(directory, 'r');
			try {
				await parent.sync();
			} finally {
				await parent.close();
			}
		} finally {
			await file?.close().catch(() => undefined);
			await unlink(temporaryPath).catch(() => undefined);
		}
	}

	private assertReady(): void {
		if (!this.ready)
			throw new Error('Recording grant persistence is not ready');
	}
}

function isFileShape(value: unknown): value is FileShape {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<FileShape>;
	if (candidate.schemaVersion !== SCHEMA_VERSION) return false;
	if (!candidate.consumed || typeof candidate.consumed !== 'object')
		return false;
	return Object.entries(candidate.consumed).every(
		([jti, expiresAt]) =>
			jti.length > 0 && Number.isSafeInteger(expiresAt) && expiresAt > 0,
	);
}
