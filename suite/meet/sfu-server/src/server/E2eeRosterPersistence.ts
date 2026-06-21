// E2EE roster persistence — pluggable backing store for the tier-1 roster.
//
// The roster holds `senderId → { participantId, isHost, joinedAt }` per room.
// Persistence lets the SFU survive a restart so the committer picker keeps
// working across crashes. MLS path secrets and meeting secrets stay
// client-side; the persistence layer is server-state only.
//
// The interface is intentionally small. Implementations:
//   - InMemoryRosterPersistence: the default; non-durable. Used in tests
//     and when E2EE_PERSISTENCE_DIR is unset.
//   - FileRosterPersistence (slice B): writes a single JSON file. Used
//     when E2EE_PERSISTENCE_DIR is set.
//
// Failure model: write errors are surfaced through the promise. The store
// awaits each persistence call before returning from its mutator. This is
// fine for a low-write-load structure (the roster changes on join/leave).
// If a write fails, the in-memory map is still updated — the SFU can
// continue serving the in-memory state and a future write can recover.

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
		// Deep-clone so callers can't mutate the underlying arrays.
		const out = new Map<string, RosterEntry[]>();
		for (const [roomId, entries] of this.rooms) {
			out.set(
				roomId,
				entries.map((e) => ({ ...e })),
			);
		}
		return out;
	}

	async addEntry(roomId: string, entry: RosterEntry): Promise<void> {
		let entries = this.rooms.get(roomId);
		if (!entries) {
			entries = [];
			this.rooms.set(roomId, entries);
		}
		const idx = entries.findIndex((e) => e.senderId === entry.senderId);
		if (idx >= 0) {
			entries[idx] = entry;
		} else {
			entries.push(entry);
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
