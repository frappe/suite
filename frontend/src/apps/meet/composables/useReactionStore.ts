import { defineStore } from "pinia";
import { ref } from "vue";

interface ReactionEntry {
	emoji: string;
	expiresAt: number;
	timeoutId: number;
}

export interface ReactionStore {
	reactions: Record<string, ReactionEntry>;
	showReactionForUser: (
		userId: string,
		emoji: string,
		duration?: number,
	) => void;
	removeReaction: (userId: string) => void;
	$reset: () => void;
}

export const useReactionStore = defineStore("meet-reaction", () => {
	const reactions = ref<Record<string, ReactionEntry>>({});

	function showReactionForUser(userId: string, emoji: string, duration = 5000) {
		const now = Date.now();
		const expiresAt = now + duration;

		const existing = reactions.value[userId];
		if (existing?.timeoutId) {
			clearTimeout(existing.timeoutId);
		}

		const timeoutId = window.setTimeout(() => {
			if (reactions.value[userId]) {
				const updated = { ...reactions.value };
				delete updated[userId];
				reactions.value = updated;
			}
		}, duration);

		reactions.value = {
			...reactions.value,
			[userId]: { emoji, expiresAt, timeoutId },
		};
	}

	function removeReaction(userId: string) {
		const existing = reactions.value[userId];
		if (existing?.timeoutId) {
			clearTimeout(existing.timeoutId);
		}
		const updated = { ...reactions.value };
		delete updated[userId];
		reactions.value = updated;
	}

	function $reset() {
		for (const entry of Object.values(reactions.value)) {
			if (entry?.timeoutId) {
				clearTimeout(entry.timeoutId);
			}
		}
		reactions.value = {};
	}

	return {
		reactions,
		showReactionForUser,
		removeReaction,
		$reset,
	};
});
