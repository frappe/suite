// E2EE roster persistence — file-backed implementation.
//
// Writes the full roster to `<filePath>` on every change. Hydrates from
// the same file on construction. Intended for single-process SFU
// deployments; concurrent writes from multiple SFU processes are not
// supported (the file would corrupt).
//
// File format: a single JSON document of the shape
//   { "rooms": { "<roomId>": [RosterEntry, ...] } }
//
// Errors are surfaced through the rejected promise. The store awaits
// each write, so a write failure propagates to the SFU's e2ee:epoch
// handler. The SFU's existing try/catch logs the failure and continues.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RosterEntry, RosterPersistence } from './E2eeRosterPersistence';

const SCHEMA_VERSION = 1;

type FileShape = {
	schemaVersion: number;
	rooms: Record<string, RosterEntry[]>;
};

export class FileRosterPersistence implements RosterPersistence {
	private cache: Map<string, RosterEntry[]>;

	constructor(private readonly filePath: string) {
		this.cache = new Map();
	}

	private async loadFromDisk(): Promise<Map<string, RosterEntry[]>> {
		if (!existsSync(this.filePath)) {
			return new Map();
		}
		const raw = await readFile(this.filePath, 'utf8');
		const parsed = JSON.parse(raw) as Partial<FileShape>;
		if (typeof parsed !== 'object' || parsed === null) {
			throw new Error(
				`FileRosterPersistence: corrupt file at ${this.filePath}`,
			);
		}
		if (parsed.schemaVersion !== SCHEMA_VERSION) {
			throw new Error(
				`FileRosterPersistence: unsupported schemaVersion=${parsed.schemaVersion} at ${this.filePath}`,
			);
		}
		const out = new Map<string, RosterEntry[]>();
		for (const [roomId, entries] of Object.entries(parsed.rooms ?? {})) {
			if (!Array.isArray(entries)) continue;
			out.set(
				roomId,
				entries
					.filter((e): e is RosterEntry => {
						return (
							typeof e === 'object' &&
							e !== null &&
							typeof e.senderId === 'number' &&
							typeof e.participantId === 'string' &&
							typeof e.isHost === 'boolean' &&
							typeof e.joinedAt === 'number'
						);
					})
					.map((e) => ({ ...e })),
			);
		}
		return out;
	}

	private async flushToDisk(): Promise<void> {
		const shape: FileShape = {
			schemaVersion: SCHEMA_VERSION,
			rooms: Object.fromEntries(
				Array.from(this.cache.entries()).map(([roomId, entries]) => [
					roomId,
					entries.map((e) => ({ ...e })),
				]),
			),
		};
		const json = JSON.stringify(shape);
		await mkdir(dirname(this.filePath), { recursive: true });
		// Atomic write: write to a temp file, then rename. Survives crashes
		// mid-write without leaving a half-written file.
		const tmp = `${this.filePath}.tmp`;
		await writeFile(tmp, json);
		await rename(tmp, this.filePath);
	}

	async loadAll(): Promise<Map<string, RosterEntry[]>> {
		const fromDisk = await this.loadFromDisk();
		this.cache = new Map(
			Array.from(fromDisk.entries()).map(([roomId, entries]) => [
				roomId,
				entries.map((e) => ({ ...e })),
			]),
		);
		return new Map(
			Array.from(this.cache.entries()).map(([roomId, entries]) => [
				roomId,
				entries.map((e) => ({ ...e })),
			]),
		);
	}

	async addEntry(roomId: string, entry: RosterEntry): Promise<void> {
		let entries = this.cache.get(roomId);
		if (!entries) {
			entries = [];
			this.cache.set(roomId, entries);
		}
		const idx = entries.findIndex((e) => e.senderId === entry.senderId);
		if (idx >= 0) entries[idx] = entry;
		else entries.push(entry);
		await this.flushToDisk();
	}

	async removeEntry(roomId: string, senderId: number): Promise<void> {
		const entries = this.cache.get(roomId);
		if (!entries) return;
		const idx = entries.findIndex((e) => e.senderId === senderId);
		if (idx >= 0) entries.splice(idx, 1);
		await this.flushToDisk();
	}

	async clearRoom(roomId: string): Promise<void> {
		this.cache.delete(roomId);
		await this.flushToDisk();
	}
}
