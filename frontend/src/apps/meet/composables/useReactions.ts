import type { SFUClient } from "../utils/SFUClient";
import type { CurrentUser } from "./useCurrentUser";
import type { ReactionStore } from "./useReactionStore";
import { isUnknownRecord } from "../types";

interface ReactionsAPI {
	setupReactionEvents: () => void;
	onSendReaction: (reactionType: string) => void;
	showReactionForUser: (
		userId: string,
		emoji: string,
		duration?: number,
	) => void;
}

export function useReactions(deps: {
	reactionStore: ReactionStore;
	currentUser: CurrentUser;
	sfuClient: SFUClient;
}): ReactionsAPI {
	const { reactionStore, currentUser, sfuClient } = deps;

	const setupReactionEvents = () => {
		sfuClient.on("reaction:message", (value: unknown) => {
			if (!isUnknownRecord(value) || typeof value.fromUser !== "string") return;
			const userId = value.fromUser;
			const emoji =
				typeof value.message === "string"
					? value.message
					: typeof value.reaction === "string"
						? value.reaction
						: "";
			const duration =
				typeof value.duration === "number" && value.duration > 0
					? value.duration
					: 5000;

			if (userId && emoji) {
				reactionStore.showReactionForUser(userId, emoji, duration);
			}
		});
	};

	const onSendReaction = (reactionType: string) => {
		try {
			const userId = currentUser.currentUser.value?.user_id as string;
			if (userId) {
				reactionStore.showReactionForUser(userId, reactionType, 5000);
			}

			if (sfuClient.isConnected()) {
				sfuClient.sendReaction(reactionType);
			}
		} catch (error) {
			console.error("Failed to send reaction message:", error);
		}
	};

	return {
		setupReactionEvents,
		onSendReaction,
		showReactionForUser: reactionStore.showReactionForUser,
	};
}
