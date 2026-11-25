export type RosterEntry = {
	participantId: string;
	senderId: number;
	isHost: boolean;
	joinedAt: number;
};

export interface RosterPersistence {
	loadAll(): Promise<Map<string, RosterEntry[]>>;
	addEntry(roomId: string, entry: RosterEntry): Promise<void>;
	removeEntry(roomId: string, senderId: number): Promise<void>;
	clearRoom(roomId: string): Promise<void>;
}

export class InMemoryRosterPersistence implements RosterPersistence {
	private readonly rooms = new Map<string, RosterEntry[]>();

	async loadAll(): Promise<Map<string, RosterEntry[]>> {
		return structuredClone(this.rooms);
	}

	async addEntry(roomId: string, entry: RosterEntry): Promise<void> {
		let entries = this.rooms.get(roomId);
		if (!entries) {
			entries = [];
			this.rooms.set(roomId, entries);
		}
		const idx = entries.findIndex((e) => e.senderId === entry.senderId);
		const storedEntry = structuredClone(entry);
		if (idx >= 0) {
			entries[idx] = storedEntry;
		} else {
			entries.push(storedEntry);
		}
	}

	async removeEntry(roomId: string, senderId: number): Promise<void> {
		const entries = this.rooms.get(roomId);
		if (!entries) return;
		const idx = entries.findIndex((e) => e.senderId === senderId);
		if (idx >= 0) entries.splice(idx, 1);
	}

	async clearRoom(roomId: string): Promise<void> {
		this.rooms.delete(roomId);
	}
}
