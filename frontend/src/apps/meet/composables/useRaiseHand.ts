import audioNotificationManager from "../utils/audioNotifications";
import type { SFUClient } from "../utils/SFUClient";
import type { CurrentUser } from "./useCurrentUser";
import type { RaiseHandStore } from "./useRaiseHandStore";
import { isUnknownRecord } from "../types";

interface RaiseHandAPI {
	setupRaiseHandEvents: () => void;
	toggleRaiseHand: () => Promise<void>;
}

export function useRaiseHand(deps: {
	raiseHandStore: RaiseHandStore;
	currentUser: CurrentUser;
	sfuClient: SFUClient;
}): RaiseHandAPI {
	const { raiseHandStore, currentUser, sfuClient } = deps;

	const setupRaiseHandEvents = () => {
		sfuClient.on("hand_raised", (value: unknown) => {
			if (
				!isUnknownRecord(value) ||
				typeof value.participantId !== "string" ||
				typeof value.raised !== "boolean"
			) return;
			const participantId = value.participantId;
			const raised = value.raised;

			if (raised) {
				raiseHandStore.raiseHand(
					participantId,
					typeof value.timestamp === "string"
						? value.timestamp
						: new Date().toISOString(),
				);
				audioNotificationManager.playRaiseHandNotification();
			} else {
				raiseHandStore.lowerHand(participantId);
			}
		});

		sfuClient.on("existing_raised_hands", (value: unknown) => {
			if (!isUnknownRecord(value) || !isUnknownRecord(value.hands)) return;
			const hands: Record<string, string> = {};
			for (const [participantId, timestamp] of Object.entries(value.hands)) {
				if (typeof timestamp === "string") hands[participantId] = timestamp;
			}
			raiseHandStore.setHands(hands);
		});
	};

	const toggleRaiseHand = async () => {
		try {
			const currentUserId = currentUser.currentUser.value?.user_id as string;
			if (!currentUserId) return;

			const isCurrentlyRaised = !!raiseHandStore.raisedHands?.[currentUserId];
			const newRaisedState = !isCurrentlyRaised;

			if (newRaisedState) {
				raiseHandStore.raiseHand(currentUserId, new Date().toISOString());
			} else {
				raiseHandStore.lowerHand(currentUserId);
			}

			if (sfuClient.isConnected()) {
				try {
					await sfuClient.sendRaiseHand(newRaisedState);
				} catch (serverError) {
					if (isCurrentlyRaised) {
						raiseHandStore.raiseHand(currentUserId, new Date().toISOString());
					} else {
						raiseHandStore.lowerHand(currentUserId);
					}
					console.error("Failed to toggle raise hand on server:", serverError);
				}
			} else {
				if (isCurrentlyRaised) {
					raiseHandStore.raiseHand(currentUserId, new Date().toISOString());
				} else {
					raiseHandStore.lowerHand(currentUserId);
				}
				console.error("Cannot toggle raise hand: not connected to SFU");
			}
		} catch (error) {
			console.error("Failed to toggle raise hand:", error);
		}
	};

	return {
		setupRaiseHandEvents,
		toggleRaiseHand,
	};
}
