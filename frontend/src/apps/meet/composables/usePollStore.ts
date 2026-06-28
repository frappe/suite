import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { PollPayloadFE } from "../types";

export const usePollStore = defineStore("poll", () => {
	const polls = ref<Record<string, PollPayloadFE>>({});

	const activePolls = computed(() => {
		return Object.values(polls.value).filter((poll) => poll.isActive);
	});

	function addPoll(poll: PollPayloadFE) {
		polls.value = {
			...polls.value,
			[poll.pollId]: poll,
		};
	}

	function updatePoll(poll: PollPayloadFE) {
		const existingPoll = polls.value[poll.pollId];
        if (existingPoll && existingPoll.hasVoted) {
            poll.hasVoted = true;
        }
        
        polls.value[poll.pollId] = poll;
	}

	function setExistingPolls(existingPolls: PollPayloadFE[]) {
		existingPolls.forEach((poll) => {
			polls.value[poll.pollId] = poll;
		});
	}

	const markPollAsVoted = (pollId: string) => {
    if (polls.value[pollId]) {
        polls.value[pollId].hasVoted = true;
    }
};

	function $reset() {
		polls.value = {};
	}

	return {
		polls,
		activePolls,
		addPoll,
		updatePoll,
		setExistingPolls,
		markPollAsVoted,
		$reset,
	};
});