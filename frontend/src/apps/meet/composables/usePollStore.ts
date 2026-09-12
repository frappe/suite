import { defineStore } from "pinia";
import type { PollPayloadFE } from "../types";

export const usePollStore = defineStore("poll", {
	state: () => ({ polls: {} as Record<string, PollPayloadFE> }),
	getters: {
		activePolls: (state) =>
			Object.values(state.polls).filter((poll) => poll.isActive),
	},
	actions: {
		addPoll(poll: PollPayloadFE) {
			this.polls = { ...this.polls, [poll.pollId]: poll };
		},
		updatePoll(poll: PollPayloadFE) {
			if (this.polls[poll.pollId]?.hasVoted) poll.hasVoted = true;
			this.polls[poll.pollId] = poll;
		},
		setExistingPolls(existingPolls: PollPayloadFE[]) {
			for (const poll of existingPolls) this.polls[poll.pollId] = poll;
		},
		markPollAsVoted(pollId: string) {
			if (this.polls[pollId]) this.polls[pollId].hasVoted = true;
		},
	},
});
