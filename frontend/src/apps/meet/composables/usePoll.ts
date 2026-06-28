import { toast } from "frappe-ui";
import type { SFUClient } from "../utils/SFUClient";
import type { CurrentUser } from "./useCurrentUser";
import { usePollStore } from "./usePollStore";
import { PollPayloadFE } from "../types";

interface PollAPI {
	setupPollEvents: () => void;
	createPoll: (question: string, options: { text: string }[]) => void;
	submitVote: (pollId: string, optionId: string) => void;
}

export function usePoll(deps: {
	pollStore: ReturnType<typeof usePollStore>;
	currentUser: CurrentUser;
	sfuClient: SFUClient;
}): PollAPI {
	const { pollStore, sfuClient } = deps;

	const setupPollEvents = () => {
		sfuClient.on("poll:new", (data: unknown) => {
			const poll = data as PollPayloadFE;
			pollStore.addPoll(poll);
		});

		sfuClient.on("poll:update", (data: unknown) => {
			const poll = data as PollPayloadFE;
			pollStore.updatePoll(poll);
		});

		sfuClient.on("existing_polls", (data: unknown) => {
			const payload = data as { polls: PollPayloadFE[] };
			pollStore.setExistingPolls(payload.polls);
		});
	};

	const createPoll = async (question: string, options: { text: string }[]) => {
		if (!sfuClient.isConnected()) {
			toast.error("Not connected to meeting server");
			return;
		}

		try {
			const response = (await sfuClient.sendRequest("poll:create", {
				question,
				options,
			})) as any;

			if (response && response.success) {
				if (response.poll) {
					pollStore.addPoll(response.poll);
				}
				toast.success("Poll created!");
			} else {
				toast.error(response?.error || "Failed to create poll");
			}
		} catch (error) {
			console.error("Failed to create poll:", error);
			toast.error("Failed to create poll");
		}
	};

	const submitVote = async (pollId: string, optionId: string) => {
		if (!sfuClient.isConnected()) {
			toast.error("Not connected to meeting server");
			return;
		}

		try {
		const response = await sfuClient.sendRequest("poll:vote", {
			pollId,
			optionId,
		}) as { success: boolean; error?: string };

		if (!response.success) {
			throw new Error(response.error ?? "Failed to submit vote");
		}

		pollStore.markPollAsVoted(pollId);
	} catch (error) {
		console.error("Failed to submit vote:", error);
		toast.error((error as Error).message);
		throw error
	}
	};

	return {
		setupPollEvents,
		createPoll,
		submitVote
	};
}