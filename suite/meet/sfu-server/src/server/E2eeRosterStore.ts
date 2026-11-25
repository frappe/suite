import type { RosterEntry, RosterPersistence } from './E2eeRosterPersistence';

export class E2eeRosterStore {
	private readonly entriesByRoom = new Map<string, Map<number, RosterEntry>>();
	private hydrated = false;
	private hydrationPromise: Promise<void> | null = null;

	constructor(private readonly persistence: RosterPersistence) {}

	private async hydrate(): Promise<void> {
		if (this.hydrated) return;
		if (this.hydrationPromise) return this.hydrationPromise;
		this.hydrationPromise = (async () => {
			const all = await this.persistence.loadAll();
			for (const [roomId, entries] of all) {
				const map = new Map<number, RosterEntry>();
				for (const e of entries) map.set(e.senderId, e);
				this.entriesByRoom.set(roomId, map);
			}
			this.hydrated = true;
		})().catch((error: unknown) => {
			this.hydrationPromise = null;
			throw error;
		});
		return this.hydrationPromise;
	}

	async add(roomId: string, entry: RosterEntry): Promise<void> {
		await this.hydrate();
		let entries = this.entriesByRoom.get(roomId);
		if (!entries) {
			entries = new Map();
			this.entriesByRoom.set(roomId, entries);
		}
		entries.set(entry.senderId, entry);
		await this.persistence.addEntry(roomId, entry);
	}

	async remove(roomId: string, senderId: number): Promise<void> {
		await this.hydrate();
		const entries = this.entriesByRoom.get(roomId);
		if (!entries) return;
		entries.delete(senderId);
		if (entries.size === 0) {
			this.entriesByRoom.delete(roomId);
		}
		await this.persistence.removeEntry(roomId, senderId);
	}

	async clearRoom(roomId: string): Promise<void> {
		await this.hydrate();
		this.entriesByRoom.delete(roomId);
		await this.persistence.clearRoom(roomId);
	}

	async get(
		roomId: string,
		senderId: number,
	): Promise<RosterEntry | undefined> {
		await this.hydrate();
		return this.entriesByRoom.get(roomId)?.get(senderId);
	}

	async list(roomId: string): Promise<RosterEntry[]> {
		await this.hydrate();
		const entries = this.entriesByRoom.get(roomId);
		if (!entries) return [];
		return Array.from(entries.values());
	}

	async pickCommitter(
		roomId: string,
		excludeSenderIds: number[],
	): Promise<RosterEntry | null> {
		const entries = await this.list(roomId);
		const excluded = new Set(excludeSenderIds);
		const eligible = entries.filter((e) => !excluded.has(e.senderId));
		if (eligible.length === 0) return null;
		const host = eligible.find((e) => e.isHost);
		if (host) return host;
		eligible.sort((a, b) => a.joinedAt - b.joinedAt);
		return eligible[0];
	}
}
