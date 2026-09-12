import { defineStore } from "pinia";

interface ReactionEntry {
	emoji: string;
	expiresAt: number;
	timeoutId: number;
}

export const useReactionStore = defineStore("meet-reaction", {
	state: () => ({ reactions: {} as Record<string, ReactionEntry> }),
	actions: {
		showReactionForUser(userId: string, emoji: string, duration = 5000) {
			const expiresAt = Date.now() + duration;
			const existing = this.reactions[userId];
			if (existing?.timeoutId) clearTimeout(existing.timeoutId);

			const timeoutId = window.setTimeout(() => {
				if (this.reactions[userId]) this.removeReaction(userId);
			}, duration);
			this.reactions = {
				...this.reactions,
				[userId]: { emoji, expiresAt, timeoutId },
			};
		},
		removeReaction(userId: string) {
			const existing = this.reactions[userId];
			if (existing?.timeoutId) clearTimeout(existing.timeoutId);
			const updated = { ...this.reactions };
			delete updated[userId];
			this.reactions = updated;
		},
		$reset() {
			for (const entry of Object.values(this.reactions)) {
				if (entry?.timeoutId) clearTimeout(entry.timeoutId);
			}
			this.reactions = {};
		},
	},
});

export type ReactionStore = ReturnType<typeof useReactionStore>;
